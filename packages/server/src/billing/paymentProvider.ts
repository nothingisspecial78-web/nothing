import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import {
  validatePaymentVerification,
  validateWebhookSignature,
} from 'razorpay/dist/utils/razorpay-utils.js';
import { logger, type ServerConfig } from '../config.ts';
import type { PlanInterval } from './types.ts';
import { getPlanPriceInr, getPlanPricePaise, PLAN_PRICING } from './config.ts';

export interface CheckoutSessionResult {
  checkoutUrl: string | null;
  provider: string | null;
  providerRef: string | null;
  immediateActivation: boolean;
}

export interface WebhookEventResult {
  handled: boolean;
  eventId?: string;
  eventName?: string;
  orderId?: string;
  paymentId?: string;
  orgId?: string;
  interval?: PlanInterval;
  amountPaise?: number;
  currency?: string;
  method?: string | null;
  errorReason?: string | null;
  status?: 'active' | 'cancelled' | 'failed' | 'refunded';
  providerRef?: string;
  skipped?: boolean;
  reason?: string;
}

export interface PaymentOrderRequest {
  orgId: string;
  adminUserId: string;
  plan: 'premium';
  interval: PlanInterval;
  receipt: string;
  notes?: Record<string, string>;
}

export interface PaymentOrderResponse {
  orderId: string;
  amountPaise: number;
  amountInr: number;
  currency: 'INR';
  keyId: string;
  receipt: string;
}

export interface FetchedRazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  captured?: boolean;
  error_description?: string | null;
  error_reason?: string | null;
}

export interface RazorpayClientLike {
  orders: {
    create(params: {
      amount: number;
      currency: string;
      receipt: string;
      notes?: Record<string, string>;
    }): Promise<{
      id: string;
      amount: number | string;
      currency: string;
      receipt?: string;
      status: string;
    }>;
  };
  payments: {
    fetch(paymentId: string): Promise<FetchedRazorpayPayment>;
  };
}

export interface PaymentProvider {
  readonly name: string | null;
  createCheckout(input: {
    orgId: string;
    adminUserId: string;
    interval: PlanInterval;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<CheckoutSessionResult>;
  handleWebhook(payload: unknown, signature?: string): Promise<WebhookEventResult>;
  cancelSubscription(input: {
    orgId: string;
    providerRef: string | null;
  }): Promise<{ cancelled: boolean }>;
}

export interface RazorpayConfigStatus {
  configured: boolean;
  testMode: boolean;
  liveKeyBlocked: boolean;
  webhookConfigured: boolean;
  keyIdPrefix: string;
}

export function inspectRazorpayConfig(
  cfg: Pick<
    ServerConfig,
    'razorpayKeyId' | 'razorpayKeySecret' | 'razorpayWebhookSecret' | 'razorpayTestMode'
  >
): RazorpayConfigStatus {
  const keyId = String(cfg.razorpayKeyId || '').trim();
  const keySecret = String(cfg.razorpayKeySecret || '').trim();
  const webhookSecret = String(cfg.razorpayWebhookSecret || '').trim();
  const testMode = Boolean(cfg.razorpayTestMode);
  const liveKeyBlocked = testMode && keyId.startsWith('rzp_live_');
  const configured = Boolean(keyId && keySecret && !liveKeyBlocked);

  return {
    configured,
    testMode,
    liveKeyBlocked,
    webhookConfigured: Boolean(webhookSecret),
    keyIdPrefix: keyId ? keyId.slice(0, 9) : '',
  };
}

/**
 * Default manual provider kept for dev-switch / unit testing without Razorpay keys.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name: string | null = null;

  async createCheckout(input: {
    orgId: string;
    adminUserId: string;
    interval: PlanInterval;
  }): Promise<CheckoutSessionResult> {
    void input;
    void PLAN_PRICING;
    return {
      checkoutUrl: null,
      provider: null,
      providerRef: `manual_${crypto.randomUUID().slice(0, 8)}`,
      immediateActivation: true,
    };
  }

  async handleWebhook(): Promise<WebhookEventResult> {
    return { handled: false };
  }

  async cancelSubscription(): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }
}

/**
 * Production Razorpay TEST MODE / Live Orders Provider built on the official `razorpay` Node SDK.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = 'razorpay';
  private readonly sdkClient: RazorpayClientLike | null;
  private loggedMissingWebhookWarning = false;

  constructor(
    private readonly cfg: Pick<
      ServerConfig,
      'razorpayKeyId' | 'razorpayKeySecret' | 'razorpayWebhookSecret' | 'razorpayTestMode'
    >,
    clientOverride?: RazorpayClientLike | null
  ) {
    const status = inspectRazorpayConfig(cfg);
    if (status.liveKeyBlocked) {
      logger.error(
        { keyPrefix: status.keyIdPrefix, testMode: true },
        'SECURITY REFUSAL: rzp_live_ key detected while app is in RAZORPAY_TEST_MODE. Refusing live payment operations.'
      );
      this.sdkClient = null;
      return;
    }

    if (clientOverride) {
      this.sdkClient = clientOverride;
    } else if (status.configured) {
      this.sdkClient = new Razorpay({
        key_id: cfg.razorpayKeyId,
        key_secret: cfg.razorpayKeySecret,
      }) as unknown as RazorpayClientLike;
      if (status.testMode) {
        logger.info({ keyPrefix: status.keyIdPrefix }, 'Razorpay initialized in TEST MODE');
      }
    } else {
      this.sdkClient = null;
    }
  }

  getConfigStatus(): RazorpayConfigStatus {
    return inspectRazorpayConfig(this.cfg);
  }

  private assertReady(): RazorpayClientLike {
    const status = this.getConfigStatus();
    if (status.liveKeyBlocked) {
      throw new Error(
        'Live Razorpay keys (rzp_live_) are blocked while TEST MODE is active. Use an rzp_test_ key.'
      );
    }
    if (!status.configured || !this.sdkClient) {
      throw new Error(
        'Razorpay is not configured on the server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
      );
    }
    return this.sdkClient;
  }

  async createCheckout(input: {
    orgId: string;
    adminUserId: string;
    interval: PlanInterval;
  }): Promise<CheckoutSessionResult> {
    const order = await this.createOrder({
      orgId: input.orgId,
      adminUserId: input.adminUserId,
      plan: 'premium',
      interval: input.interval,
      receipt: `rcpt_${input.orgId.slice(0, 12)}_${Date.now()}`,
    });
    return {
      checkoutUrl: null,
      provider: this.name,
      providerRef: order.orderId,
      immediateActivation: false,
    };
  }

  async createOrder(input: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    const client = this.assertReady();
    const amountInr = getPlanPriceInr(input.interval);
    const amountPaise = getPlanPricePaise(input.interval);

    const created = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: input.receipt.slice(0, 40),
      notes: {
        orgId: input.orgId,
        userId: input.adminUserId,
        plan: input.plan,
        interval: input.interval,
        ...(input.notes || {}),
      },
    });

    return {
      orderId: String(created.id),
      amountPaise: Number(created.amount ?? amountPaise),
      amountInr,
      currency: 'INR',
      keyId: this.cfg.razorpayKeyId,
      receipt: String(created.receipt || input.receipt),
    };
  }

  verifyCheckoutSignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const status = this.getConfigStatus();
    if (status.liveKeyBlocked || !status.configured) {
      return false;
    }
    if (!params.orderId || !params.paymentId || !params.signature) {
      return false;
    }
    try {
      return validatePaymentVerification(
        {
          order_id: params.orderId,
          payment_id: params.paymentId,
        },
        params.signature,
        this.cfg.razorpayKeySecret
      );
    } catch {
      return false;
    }
  }

  async fetchPayment(paymentId: string): Promise<FetchedRazorpayPayment> {
    const client = this.assertReady();
    return client.payments.fetch(paymentId);
  }

  verifyWebhook(rawBody: string | Buffer, signature: string | undefined): {
    valid: boolean;
    skipped: boolean;
    reason?: string;
  } {
    const secret = String(this.cfg.razorpayWebhookSecret || '').trim();
    if (!secret) {
      if (!this.loggedMissingWebhookWarning) {
        this.loggedMissingWebhookWarning = true;
        logger.warn(
          'RAZORPAY_WEBHOOK_SECRET is not configured yet — skipping webhook signature verification cleanly.'
        );
      }
      return {
        valid: false,
        skipped: true,
        reason: 'RAZORPAY_WEBHOOK_SECRET not configured',
      };
    }

    if (!signature || !signature.trim()) {
      return {
        valid: false,
        skipped: false,
        reason: 'Missing X-Razorpay-Signature header',
      };
    }

    const bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    try {
      const ok = validateWebhookSignature(bodyText, signature.trim(), secret);
      return ok
        ? { valid: true, skipped: false }
        : { valid: false, skipped: false, reason: 'Invalid Razorpay webhook signature' };
    } catch {
      return {
        valid: false,
        skipped: false,
        reason: 'Webhook signature validation error',
      };
    }
  }

  parseWebhookPayload(
    rawBody: string | Buffer,
    eventIdHeader?: string
  ): WebhookEventResult {
    const bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}');
    const parsed = JSON.parse(bodyText) as {
      event?: string;
      payload?: {
        payment?: { entity?: Record<string, unknown> };
        order?: { entity?: Record<string, unknown> };
        refund?: { entity?: Record<string, unknown> };
      };
    };

    const eventName = String(parsed.event || '').trim();
    const paymentEntity = parsed.payload?.payment?.entity;
    const orderEntity = parsed.payload?.order?.entity;
    const refundEntity = parsed.payload?.refund?.entity;

    const orderId =
      (paymentEntity?.order_id ? String(paymentEntity.order_id) : undefined) ||
      (orderEntity?.id ? String(orderEntity.id) : undefined);
    const paymentId =
      (paymentEntity?.id ? String(paymentEntity.id) : undefined) ||
      (refundEntity?.payment_id ? String(refundEntity.payment_id) : undefined);

    const notes = ((paymentEntity?.notes || orderEntity?.notes || {}) as Record<string, unknown>);
    const orgId = typeof notes.orgId === 'string' && notes.orgId ? notes.orgId : undefined;
    const interval =
      notes.interval === 'monthly' || notes.interval === 'annual' ? notes.interval : undefined;

    const amountRaw = paymentEntity?.amount ?? orderEntity?.amount_paid ?? orderEntity?.amount;
    const amountPaise = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw || 0);
    const currency = String(paymentEntity?.currency || orderEntity?.currency || 'INR').toUpperCase();
    const method = paymentEntity?.method ? String(paymentEntity.method) : null;

    const fallbackEventHash = crypto
      .createHash('sha256')
      .update(`${eventName}:${orderId || ''}:${paymentId || ''}:${bodyText}`)
      .digest('hex')
      .slice(0, 24);
    const eventId = (eventIdHeader && eventIdHeader.trim()) || `evt_${fallbackEventHash}`;

    if (eventName === 'payment.captured' || eventName === 'order.paid') {
      return {
        handled: true,
        eventId,
        eventName,
        orderId,
        paymentId,
        orgId,
        interval,
        amountPaise: Number.isFinite(amountPaise) ? amountPaise : 0,
        currency,
        method,
        status: 'active',
        providerRef: orderId || paymentId,
      };
    }

    if (eventName === 'payment.failed') {
      return {
        handled: true,
        eventId,
        eventName,
        orderId,
        paymentId,
        orgId,
        interval,
        errorReason:
          String(
            paymentEntity?.error_description ||
              paymentEntity?.error_reason ||
              'Payment failed at Razorpay gateway'
          ) || 'Payment failed',
        status: 'failed',
        providerRef: orderId || paymentId,
      };
    }

    if (eventName === 'refund.processed') {
      return {
        handled: true,
        eventId,
        eventName,
        orderId,
        paymentId,
        orgId,
        interval,
        status: 'refunded',
        providerRef: paymentId || orderId,
      };
    }

    return {
      handled: false,
      eventId,
      eventName,
      orderId,
      paymentId,
    };
  }

  async handleWebhook(payload: unknown, signature?: string): Promise<WebhookEventResult> {
    const rawBody =
      typeof payload === 'string' || Buffer.isBuffer(payload)
        ? payload
        : JSON.stringify(payload || {});
    const check = this.verifyWebhook(rawBody, signature);
    if (check.skipped) {
      return { handled: false, skipped: true, reason: check.reason };
    }
    if (!check.valid) {
      return { handled: false, skipped: false, reason: check.reason };
    }
    return this.parseWebhookPayload(rawBody);
  }

  async cancelSubscription(): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }
}
