import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../auth.ts';
import {
  getPlanPriceInr,
  getPlanPricePaise,
  isAdminOrOwnerRole,
} from '../billing/config.ts';
import type { OrgCreditStore } from '../billing/creditStore.ts';
import type { RazorpayPaymentProvider } from '../billing/paymentProvider.ts';
import { logger, type ServerConfig } from '../config.ts';
import { createPaymentRateLimiter } from '../security/limits.ts';
import { extractAccessScope, isAllowedOrganization } from '../security/scope.ts';

const CreateOrderSchema = z.object({
  plan: z.literal('premium').default('premium'),
  interval: z.enum(['monthly', 'annual']),
  orgId: z.string().min(1).max(120).optional(),
  idempotencyKey: z.string().min(4).max(120).optional(),
});

const VerifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(4).max(120),
  razorpay_payment_id: z.string().min(4).max(120),
  razorpay_signature: z.string().min(8).max(256),
  orgId: z.string().min(1).max(120).optional(),
});

const RecordFailureSchema = z.object({
  razorpay_order_id: z.string().min(4).max(120).optional(),
  razorpay_payment_id: z.string().min(4).max(120).optional(),
  reason: z.string().min(1).max(500),
  orgId: z.string().min(1).max(120).optional(),
});

function resolveScopedOrgId(
  scope: Awaited<ReturnType<typeof extractAccessScope>>,
  requestedOrgId?: string
): string {
  if (scope.role === 'SUPER_ADMIN') {
    return requestedOrgId?.trim() || scope.organizationId || 'demo';
  }
  if ('organizationId' in scope && scope.organizationId) {
    return scope.organizationId;
  }
  return requestedOrgId?.trim() || 'demo';
}

export function createPaymentWebhookHandler(params: {
  cfg: ServerConfig;
  creditStore: OrgCreditStore;
  razorpayProvider: RazorpayPaymentProvider;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const rawBody: string | Buffer = Buffer.isBuffer(req.body)
        ? req.body
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body || {});

      const sigHeader = req.headers['x-razorpay-signature'];
      const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      const check = params.razorpayProvider.verifyWebhook(rawBody, signature);

      if (check.skipped) {
        res.status(200).json({ ok: true, skipped: true, reason: check.reason });
        return;
      }

      if (!check.valid) {
        logger.warn({ reason: check.reason }, 'Rejected invalid Razorpay webhook signature');
        res.status(400).json({ error: check.reason || 'Invalid webhook signature.' });
        return;
      }

      const eventIdHeaderRaw = req.headers['x-razorpay-event-id'];
      const eventIdHeader = Array.isArray(eventIdHeaderRaw)
        ? eventIdHeaderRaw[0]
        : eventIdHeaderRaw;

      const parsed = params.razorpayProvider.parseWebhookPayload(rawBody, eventIdHeader);
      if (parsed.eventId) {
        const isNew = await params.creditStore.recordWebhookEventIfNew({
          eventId: parsed.eventId,
          eventName: parsed.eventName || 'unknown',
          orderId: parsed.orderId,
          paymentId: parsed.paymentId,
        });
        if (!isNew) {
          res.status(200).json({ ok: true, deduplicated: true, eventId: parsed.eventId });
          return;
        }
      }

      if (!parsed.handled) {
        res.status(200).json({ ok: true, handled: false, eventName: parsed.eventName });
        return;
      }

      if (parsed.status === 'active' && parsed.orderId && parsed.paymentId) {
        const stored = await params.creditStore.getPaymentByOrderId(parsed.orderId);
        if (stored) {
          if (
            typeof parsed.amountPaise === 'number' &&
            parsed.amountPaise > 0 &&
            parsed.amountPaise !== stored.amountPaise
          ) {
            await params.creditStore.markPaymentFailed({
              orderId: parsed.orderId,
              razorpayPaymentId: parsed.paymentId,
              errorReason: `Webhook amount mismatch: expected ${stored.amountPaise}, got ${parsed.amountPaise}`,
              actorUserId: 'webhook',
            });
            res.status(200).json({ ok: true, handled: true, mismatch: true });
            return;
          }
          if (parsed.currency && parsed.currency !== stored.currency) {
            await params.creditStore.markPaymentFailed({
              orderId: parsed.orderId,
              razorpayPaymentId: parsed.paymentId,
              errorReason: `Webhook currency mismatch: expected ${stored.currency}, got ${parsed.currency}`,
              actorUserId: 'webhook',
            });
            res.status(200).json({ ok: true, handled: true, mismatch: true });
            return;
          }
          await params.creditStore.markPaymentPaidAndActivatePremium({
            orderId: parsed.orderId,
            razorpayPaymentId: parsed.paymentId,
            actorUserId: stored.userId || 'webhook',
            intervalOverride: parsed.interval || stored.interval,
            method: parsed.method || null,
            source: 'webhook',
            eventId: parsed.eventId,
          });
        } else {
          logger.warn(
            { orderId: parsed.orderId, eventName: parsed.eventName },
            'Webhook received for unknown orderId'
          );
        }
      } else if (parsed.status === 'failed') {
        await params.creditStore.markPaymentFailed({
          orderId: parsed.orderId,
          razorpayPaymentId: parsed.paymentId,
          errorReason: parsed.errorReason || 'Payment failed',
          actorUserId: 'webhook',
        });
      } else if (parsed.status === 'refunded') {
        await params.creditStore.markPaymentRefunded({
          orderId: parsed.orderId,
          razorpayPaymentId: parsed.paymentId,
          actorUserId: 'webhook',
        });
      }

      res.status(200).json({
        ok: true,
        handled: true,
        eventName: parsed.eventName,
        eventId: parsed.eventId,
      });
    } catch (err) {
      logger.error({ err }, 'Razorpay webhook processing error');
      res.status(500).json({ error: 'Failed to process Razorpay webhook.' });
    }
  };
}

export function createPaymentsRouter(params: {
  cfg: ServerConfig;
  creditStore: OrgCreditStore;
  razorpayProvider: RazorpayPaymentProvider;
}): Router {
  const router = Router();
  const paymentLimiter = createPaymentRateLimiter(params.cfg);

  router.post('/create-order', paymentLimiter, async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg, {
      defaultUnauthenticatedRole: 'PUBLIC',
      ignoreBodyAppState: true,
    });

    if (scope.role === 'PUBLIC') {
      res.status(401).json({
        error: 'Authentication required to create a payment order.',
        errorCode: 'UNAUTHORIZED',
      });
      return;
    }

    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({
        error: 'Only the organization Admin can start a Premium checkout.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }

    const parsed = CreateOrderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid order request payload.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const orgId = resolveScopedOrgId(scope, parsed.data.orgId);
    if (
      scope.role !== 'SUPER_ADMIN' &&
      parsed.data.orgId &&
      !isAllowedOrganization(scope, parsed.data.orgId)
    ) {
      res.status(403).json({
        error: 'Cannot initiate payment order for another organization.',
        errorCode: 'FORBIDDEN_ORG',
      });
      return;
    }

    const rzpStatus = params.razorpayProvider.getConfigStatus();
    if (rzpStatus.liveKeyBlocked) {
      res.status(400).json({
        error:
          'Live Razorpay keys (rzp_live_) are refused while TEST MODE is enabled. Configure rzp_test_ credentials.',
        errorCode: 'LIVE_KEY_BLOCKED',
      });
      return;
    }
    if (!rzpStatus.configured) {
      res.status(503).json({
        error: 'Razorpay is not configured on this server.',
        errorCode: 'RAZORPAY_NOT_CONFIGURED',
      });
      return;
    }

    try {
      const interval = parsed.data.interval;
      const amountInr = getPlanPriceInr(interval);
      const amountPaise = getPlanPricePaise(interval);
      const receipt = `khz_${orgId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}_${Date.now().toString(36)}`;

      const order = await params.razorpayProvider.createOrder({
        orgId,
        adminUserId: scope.userId,
        plan: parsed.data.plan,
        interval,
        receipt,
      });

      const paymentRecord = await params.creditStore.createPaymentOrderRecord({
        orgId,
        userId: scope.userId,
        plan: 'premium',
        interval,
        amountInr,
        amountPaise: order.amountPaise,
        razorpayOrderId: order.orderId,
        idempotencyKey: parsed.data.idempotencyKey,
      });

      res.json({
        ok: true,
        paymentId: paymentRecord.id,
        orderId: order.orderId,
        amount: order.amountPaise,
        amountInr,
        currency: order.currency,
        keyId: order.keyId,
        testMode: rzpStatus.testMode,
      });
    } catch (err) {
      logger.error({ err, orgId }, 'Failed to create Razorpay order');
      res.status(502).json({
        error:
          err instanceof Error ? err.message : 'Unable to create Razorpay order right now.',
        errorCode: 'ORDER_CREATE_FAILED',
      });
    }
  });

  router.post('/verify', paymentLimiter, async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg, {
      defaultUnauthenticatedRole: 'PUBLIC',
      ignoreBodyAppState: true,
    });

    if (scope.role === 'PUBLIC') {
      res.status(401).json({
        error: 'Authentication required to verify payment.',
        errorCode: 'UNAUTHORIZED',
      });
      return;
    }

    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({
        error: 'Only the organization Admin can verify Premium payments.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }

    const parsed = VerifyPaymentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Missing or invalid Razorpay payment verification fields.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;
    const stored = await params.creditStore.getPaymentByOrderId(razorpay_order_id);
    if (!stored) {
      res.status(404).json({
        error: 'Payment order not found.',
        errorCode: 'ORDER_NOT_FOUND',
      });
      return;
    }

    const orgId = resolveScopedOrgId(scope, parsed.data.orgId);
    if (scope.role !== 'SUPER_ADMIN' && stored.orgId !== orgId) {
      res.status(403).json({
        error: 'Order does not belong to this organization.',
        errorCode: 'FORBIDDEN_ORG',
      });
      return;
    }

    // 1. Validate HMAC SHA256 signature using SDK utility
    const signatureOk = params.razorpayProvider.verifyCheckoutSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!signatureOk) {
      await params.creditStore.markPaymentFailed({
        orderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        errorReason: 'Invalid Razorpay signature',
        actorUserId: scope.userId,
      });
      res.status(400).json({
        error: 'Payment signature verification failed.',
        errorCode: 'INVALID_SIGNATURE',
      });
      return;
    }

    // 2. Idempotent short-circuit if already verified/captured
    if (stored.status === 'paid') {
      const statusSnapshot = await params.creditStore.getStatus(
        stored.orgId,
        scope.role,
        scope.userId
      );
      res.json({
        ok: true,
        alreadyProcessed: true,
        extended: false,
        payment: stored,
        status: statusSnapshot,
      });
      return;
    }

    // 3. Fetch authoritative payment record from Razorpay API & verify status, order, amount, currency
    try {
      const fetched = await params.razorpayProvider.fetchPayment(razorpay_payment_id);
      const paymentStatus = String(fetched.status || '').toLowerCase();
      if (paymentStatus !== 'captured' && paymentStatus !== 'authorized') {
        const msg = `Payment status is "${fetched.status}" (expected captured or authorized).`;
        await params.creditStore.markPaymentFailed({
          orderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          errorReason: msg,
          actorUserId: scope.userId,
        });
        res.status(400).json({ error: msg, errorCode: 'PAYMENT_NOT_CAPTURED' });
        return;
      }

      if (fetched.order_id && fetched.order_id !== razorpay_order_id) {
        const msg = 'Payment order ID mismatch.';
        await params.creditStore.markPaymentFailed({
          orderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          errorReason: msg,
          actorUserId: scope.userId,
        });
        res.status(400).json({ error: msg, errorCode: 'ORDER_MISMATCH' });
        return;
      }

      if (Number(fetched.amount) !== stored.amountPaise) {
        const msg = `Amount mismatch: expected ${stored.amountPaise} paise, got ${fetched.amount}.`;
        await params.creditStore.markPaymentFailed({
          orderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          errorReason: msg,
          actorUserId: scope.userId,
        });
        res.status(400).json({ error: msg, errorCode: 'AMOUNT_MISMATCH' });
        return;
      }

      if (String(fetched.currency || '').toUpperCase() !== stored.currency) {
        const msg = `Currency mismatch: expected ${stored.currency}, got ${fetched.currency}.`;
        await params.creditStore.markPaymentFailed({
          orderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          errorReason: msg,
          actorUserId: scope.userId,
        });
        res.status(400).json({ error: msg, errorCode: 'CURRENCY_MISMATCH' });
        return;
      }

      const activated = await params.creditStore.markPaymentPaidAndActivatePremium({
        orderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        actorUserId: scope.userId,
        method: fetched.method || null,
        source: 'verify',
      });

      const statusSnapshot = await params.creditStore.getStatus(
        stored.orgId,
        scope.role,
        scope.userId
      );

      res.json({
        ok: true,
        alreadyProcessed: activated.alreadyProcessed,
        extended: activated.extended,
        payment: activated.payment,
        subscription: activated.subscription,
        status: statusSnapshot,
      });
    } catch (err) {
      logger.error({ err, orderId: razorpay_order_id }, 'Razorpay payment fetch/verify failed');
      res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : 'Unable to confirm payment with Razorpay gateway.',
        errorCode: 'GATEWAY_VERIFY_FAILED',
      });
    }
  });

  router.post('/record-failure', paymentLimiter, async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg, {
      defaultUnauthenticatedRole: 'PUBLIC',
      ignoreBodyAppState: true,
    });
    if (scope.role === 'PUBLIC') {
      res.status(401).json({ error: 'Unauthorized', errorCode: 'UNAUTHORIZED' });
      return;
    }
    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({ error: 'Forbidden', errorCode: 'FORBIDDEN' });
      return;
    }
    const parsed = RecordFailureSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid failure payload' });
      return;
    }
    const orgId = resolveScopedOrgId(scope, parsed.data.orgId);
    if (scope.role !== 'SUPER_ADMIN' && parsed.data.orgId && !isAllowedOrganization(scope, parsed.data.orgId)) {
      res.status(403).json({ error: 'Forbidden organization access.', errorCode: 'FORBIDDEN_ORG' });
      return;
    }
    if (parsed.data.razorpay_order_id) {
      const stored = await params.creditStore.getPaymentByOrderId(parsed.data.razorpay_order_id);
      if (stored && scope.role !== 'SUPER_ADMIN' && stored.orgId !== orgId) {
        res.status(403).json({ error: 'Order does not belong to this organization.', errorCode: 'FORBIDDEN_ORG' });
        return;
      }
    }
    const updated = await params.creditStore.markPaymentFailed({
      orderId: parsed.data.razorpay_order_id,
      razorpayPaymentId: parsed.data.razorpay_payment_id,
      errorReason: parsed.data.reason,
      actorUserId: scope.userId,
    });
    res.json({ ok: true, payment: updated });
  });

  router.get('/history', async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg, {
      defaultUnauthenticatedRole: 'PUBLIC',
      ignoreBodyAppState: true,
    });

    if (scope.role === 'PUBLIC') {
      res.status(401).json({ error: 'Unauthorized', errorCode: 'UNAUTHORIZED' });
      return;
    }

    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({
        error: 'Only the organization Admin can view payment history.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }

    const reqOrg = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
    const orgId = resolveScopedOrgId(scope, reqOrg);
    if (scope.role !== 'SUPER_ADMIN' && reqOrg && !isAllowedOrganization(scope, reqOrg)) {
      res.status(403).json({ error: 'Forbidden organization access.', errorCode: 'FORBIDDEN_ORG' });
      return;
    }

    const [payments, auditLogs] = await Promise.all([
      params.creditStore.listPayments(orgId, 50),
      params.creditStore.listBillingAudit(orgId, 50),
    ]);
    const rzpStatus = params.razorpayProvider.getConfigStatus();

    res.json({
      orgId,
      payments,
      auditLogs,
      testMode: rzpStatus.testMode,
      liveKeyBlocked: rzpStatus.liveKeyBlocked,
      webhookConfigured: rzpStatus.webhookConfigured,
    });
  });

  return router;
}
