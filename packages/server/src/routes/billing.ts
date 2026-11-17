import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../auth.ts';
import type { ServerConfig } from '../config.ts';
import { isAdminOrOwnerRole, isDevPlanSwitchAllowed } from '../billing/config.ts';
import type { OrgCreditStore } from '../billing/creditStore.ts';
import { extractAccessScope } from '../security/scope.ts';

const SubscribeBodySchema = z.object({
  appId: z.string().optional(),
  interval: z.enum(['monthly', 'annual']).default('monthly'),
});

const DevSwitchBodySchema = z.object({
  appId: z.string().optional(),
  plan: z.enum(['free', 'premium']),
  interval: z.enum(['monthly', 'annual']).optional(),
  creditsRemaining: z.number().int().min(0).max(10000).optional(),
  expiresAt: z.string().datetime().optional(),
});

function resolveOrgIdFromScope(
  scope: Awaited<ReturnType<typeof extractAccessScope>>,
  reqBodyOrQueryOrg?: string
): string {
  if ('organizationId' in scope && scope.organizationId) {
    return scope.organizationId;
  }
  if (reqBodyOrQueryOrg && reqBodyOrQueryOrg.trim()) {
    return reqBodyOrQueryOrg.trim();
  }
  return 'demo';
}

export function createBillingRouter(params: {
  cfg: ServerConfig;
  creditStore: OrgCreditStore;
}): Router {
  const router = Router();

  router.get('/status', async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg);
    if (scope.role === 'PUBLIC') {
      const orgId = typeof req.query.orgId === 'string' && req.query.orgId.trim() ? req.query.orgId.trim() : 'demo';
      const status = await params.creditStore.getStatus(orgId, 'PUBLIC', 'guest');
      res.json(status);
      return;
    }

    const orgId = resolveOrgIdFromScope(
      scope,
      typeof req.query.orgId === 'string' ? req.query.orgId : undefined
    );
    const status = await params.creditStore.getStatus(orgId, scope.role, scope.userId);
    res.json(status);
  });

  router.get('/usage', async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg);
    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({
        error: 'Only the organization Admin can view billing usage logs.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }
    const orgId = resolveOrgIdFromScope(
      scope,
      typeof req.query.orgId === 'string' ? req.query.orgId : undefined
    );
    const limit = Number(req.query.limit || 50);
    const logs = await params.creditStore.fetchUsageLogs(orgId, Number.isFinite(limit) ? limit : 50);
    res.json({ orgId, logs });
  });

  router.post('/subscribe', async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg);
    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({
        error: 'Only the organization Admin can subscribe or manage billing plans.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }
    const parsed = SubscribeBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid subscription payload.' });
      return;
    }
    const orgId = resolveOrgIdFromScope(
      scope,
      typeof req.body?.orgId === 'string' ? req.body.orgId : undefined
    );

    const checkout = await params.creditStore.paymentProvider.createCheckout({
      orgId,
      adminUserId: scope.userId,
      interval: parsed.data.interval,
    });

    if (checkout.immediateActivation) {
      const activated = await params.creditStore.activatePremium({
        orgId,
        adminUserId: scope.userId,
        interval: parsed.data.interval,
        provider: checkout.provider,
        providerRef: checkout.providerRef,
      });
      const snapshot = await params.creditStore.getStatus(orgId, scope.role, scope.userId);
      res.json({
        ok: true,
        checkoutUrl: checkout.checkoutUrl,
        subscription: activated.subscription,
        status: snapshot,
      });
      return;
    }

    res.json({
      ok: true,
      checkoutUrl: checkout.checkoutUrl,
      status: await params.creditStore.getStatus(orgId, scope.role, scope.userId),
    });
  });

  router.post('/cancel', async (req: AuthedRequest, res: Response) => {
    const scope = await extractAccessScope(req, params.cfg);
    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({
        error: 'Only the organization Admin can cancel the Premium subscription.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }
    const orgId = resolveOrgIdFromScope(
      scope,
      typeof req.body?.orgId === 'string' ? req.body.orgId : undefined
    );
    await params.creditStore.cancelPremium({ orgId });
    const status = await params.creditStore.getStatus(orgId, scope.role, scope.userId);
    res.json({ ok: true, status });
  });

  router.post('/dev-switch', async (req: AuthedRequest, res: Response) => {
    if (!isDevPlanSwitchAllowed()) {
      res.status(404).json({ error: 'Test plan switcher is disabled in this environment.' });
      return;
    }
    const scope = await extractAccessScope(req, params.cfg);
    if (!isAdminOrOwnerRole(scope.role)) {
      res.status(403).json({
        error: 'Only the organization Admin can switch organization plans.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }
    const parsed = DevSwitchBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid dev plan switch payload.' });
      return;
    }
    const orgId = resolveOrgIdFromScope(
      scope,
      typeof req.body?.orgId === 'string' ? req.body.orgId : undefined
    );
    const status = await params.creditStore.setPlanViaDevSwitch({
      orgId,
      adminUserId: scope.userId,
      plan: parsed.data.plan,
      interval: parsed.data.interval,
      creditsRemaining: parsed.data.creditsRemaining,
      expiresAt: parsed.data.expiresAt,
    });
    res.json({ ok: true, status });
  });

  router.post('/cron-reset', async (req, res: Response) => {
    const secret = process.env.CRON_SECRET || '';
    const auth = String(req.headers.authorization || '');
    if (secret && auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized cron call.' });
      return;
    }
    const out = await params.creditStore.runMonthlyCronReset();
    res.json({ ok: true, ...out });
  });

  return router;
}
