import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger, type ServerConfig } from '../config.ts';
import {
  CREDIT_COSTS,
  FREE_MONTHLY_ALLOWANCE,
  PLAN_PRICING,
  computeCalendarMonthBounds,
  computeDaysUntilExpiry,
  computePremiumExpiry,
  getCreditCost,
  isAdminOrOwnerRole,
  isDevPlanSwitchAllowed,
} from './config.ts';
import {
  ManualPaymentProvider,
  inspectRazorpayConfig,
  type PaymentProvider,
} from './paymentProvider.ts';
import type {
  AiCreditBalanceRecord,
  AiUsageLogRecord,
  BillingAuditRecord,
  BillingStatusSnapshot,
  CheckAndConsumeResult,
  CreditCostAction,
  OrgPlan,
  OrgStatus,
  OrganizationRecord,
  PaymentRecord,
  PlanInterval,
  SubscriptionRecord,
} from './types.ts';

function isMissingTableOrSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /schema cache|could not find the table|relation .* does not exist/i.test(msg)
  );
}

export class OrgCreditStore {
  private readonly client: SupabaseClient | null = null;
  private schemaMissing = false;
  private schemaChecked = false;
  private schemaRetryAtMs = 0;
  private readonly schemaRetryIntervalMs = 10_000;
  private lastPersistenceError: string | undefined;

  private readonly organizations = new Map<string, OrganizationRecord>();
  private readonly balances = new Map<string, AiCreditBalanceRecord>();
  private readonly usageLogs = new Map<string, AiUsageLogRecord[]>();
  private readonly subscriptions = new Map<string, SubscriptionRecord[]>();
  private readonly paymentsByOrderId = new Map<string, PaymentRecord>();
  private readonly paymentsByOrg = new Map<string, PaymentRecord[]>();
  private readonly auditLogs = new Map<string, BillingAuditRecord[]>();
  private readonly webhookEvents = new Set<string>();
  private readonly idempotencyCache = new Map<string, CheckAndConsumeResult>();
  private readonly orgLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly cfg?: Partial<
      Pick<
        ServerConfig,
        | 'supabaseUrl'
        | 'supabaseServiceRoleKey'
        | 'razorpayKeyId'
        | 'razorpayKeySecret'
        | 'razorpayWebhookSecret'
        | 'razorpayTestMode'
      >
    >,
    public readonly paymentProvider: PaymentProvider = new ManualPaymentProvider(),
    clientOverride?: SupabaseClient | null
  ) {
    if (clientOverride) {
      this.client = clientOverride;
    } else if (cfg?.supabaseUrl && cfg?.supabaseServiceRoleKey) {
      this.client = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
        auth: { persistSession: false },
      });
    }
  }

  /** Serializes concurrent mutations per organization so credit decrements are strictly atomic. */
  async withOrgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    const normOrg = this.normalizeOrgId(orgId);
    const prev = this.orgLocks.get(normOrg) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => gate);
    this.orgLocks.set(normOrg, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.orgLocks.get(normOrg) === chained) {
        this.orgLocks.delete(normOrg);
      }
    }
  }

  private normalizeOrgId(orgId: string): string {
    const cleaned = String(orgId || 'demo').trim();
    return cleaned || 'demo';
  }

  private canAttemptSupabase(): boolean {
    if (!this.client) return false;
    if (!this.schemaMissing) return true;
    if (Date.now() >= this.schemaRetryAtMs) {
      return true;
    }
    return false;
  }

  private markSchemaMissing(reason?: string): void {
    this.schemaMissing = true;
    this.schemaChecked = true;
    this.schemaRetryAtMs = Date.now() + this.schemaRetryIntervalMs;
    this.lastPersistenceError =
      reason || 'Supabase billing tables not found (run 001_billing_credits.sql in SQL Editor)';
  }

  private markSchemaReady(): void {
    this.schemaMissing = false;
    this.schemaChecked = true;
    this.schemaRetryAtMs = 0;
    this.lastPersistenceError = undefined;
  }

  async checkSupabaseHealth(): Promise<{
    backend: 'supabase' | 'memory';
    schemaReady: boolean;
    lastError?: string;
  }> {
    if (!this.client) {
      return { backend: 'memory', schemaReady: false };
    }
    if (!this.schemaChecked || (this.schemaMissing && Date.now() >= this.schemaRetryAtMs)) {
      try {
        const { error } = await this.client.from('organization').select('id').limit(1);
        if (error) {
          if (isMissingTableOrSchemaError(error)) {
            this.markSchemaMissing(error.message);
          } else {
            this.schemaChecked = true;
            this.lastPersistenceError = error.message;
          }
        } else {
          this.markSchemaReady();
        }
      } catch (err) {
        this.schemaChecked = true;
        this.lastPersistenceError = err instanceof Error ? err.message : 'Supabase connection error';
      }
    }
    return {
      backend: 'supabase',
      schemaReady: !this.schemaMissing,
      ...(this.lastPersistenceError ? { lastError: this.lastPersistenceError } : {}),
    };
  }

  private isPremiumActive(org: OrganizationRecord, now: Date): boolean {
    if (org.plan !== 'premium' || org.status !== 'active') {
      return false;
    }
    if (org.premiumExpiresAt) {
      const expMs = Date.parse(org.premiumExpiresAt);
      if (Number.isFinite(expMs) && now.getTime() >= expMs) {
        return false;
      }
    }
    return true;
  }

  private ensureOrgAndBalanceSync(
    rawOrgId: string,
    ownerAdminId = 'admin',
    now: Date = new Date()
  ): { org: OrganizationRecord; balance: AiCreditBalanceRecord; changed: boolean } {
    const orgId = this.normalizeOrgId(rawOrgId);
    let changed = false;
    let org = this.organizations.get(orgId);
    if (!org) {
      org = {
        id: orgId,
        ownerAdminId,
        plan: 'free',
        planInterval: null,
        premiumStartedAt: null,
        premiumExpiresAt: null,
        status: 'active',
      };
      this.organizations.set(orgId, org);
      changed = true;
    }

    // Enforce immediate expiry reversion if premium expired
    if (org.plan === 'premium' && !this.isPremiumActive(org, now)) {
      org.plan = 'free';
      org.status = 'expired';
      org.planInterval = null;
      changed = true;
    }

    let balance = this.balances.get(orgId);
    const bounds = computeCalendarMonthBounds(now);
    if (!balance) {
      balance = {
        orgId,
        creditsRemaining: FREE_MONTHLY_ALLOWANCE,
        creditsMonthlyAllowance: FREE_MONTHLY_ALLOWANCE,
        periodStart: bounds.periodStart,
        periodEnd: bounds.periodEnd,
      };
      this.balances.set(orgId, balance);
      changed = true;
    } else if (now.getTime() >= Date.parse(balance.periodEnd)) {
      // Lazy monthly reset (no rollover)
      balance.creditsRemaining = balance.creditsMonthlyAllowance || FREE_MONTHLY_ALLOWANCE;
      balance.periodStart = bounds.periodStart;
      balance.periodEnd = bounds.periodEnd;
      changed = true;
    }

    return { org, balance, changed };
  }

  private async hydrateOrgFromSupabase(
    rawOrgId: string,
    ownerAdminId = 'admin',
    now: Date = new Date()
  ): Promise<{ org: OrganizationRecord; balance: AiCreditBalanceRecord }> {
    const orgId = this.normalizeOrgId(rawOrgId);
    if (!this.canAttemptSupabase()) {
      const { org, balance } = this.ensureOrgAndBalanceSync(orgId, ownerAdminId, now);
      return { org, balance };
    }

    let needsPersist = false;
    try {
      const { data: orgRow, error: orgErr } = await this.client!
        .from('organization')
        .select('*')
        .eq('id', orgId)
        .maybeSingle();

      if (orgErr) {
        if (isMissingTableOrSchemaError(orgErr)) {
          this.markSchemaMissing(orgErr.message);
        } else {
          this.lastPersistenceError = orgErr.message;
          logger.warn({ err: orgErr, orgId }, 'Supabase organization hydration failed');
        }
        const { org, balance } = this.ensureOrgAndBalanceSync(orgId, ownerAdminId, now);
        return { org, balance };
      }

      this.markSchemaReady();

      if (orgRow) {
        const hydratedOrg: OrganizationRecord = {
          id: String(orgRow.id || orgId),
          ownerAdminId: String(orgRow.owner_admin_id || ownerAdminId),
          plan: orgRow.plan === 'premium' ? 'premium' : 'free',
          planInterval:
            orgRow.plan_interval === 'monthly' || orgRow.plan_interval === 'annual'
              ? orgRow.plan_interval
              : null,
          premiumStartedAt: orgRow.premium_started_at || null,
          premiumExpiresAt: orgRow.premium_expires_at || null,
          status:
            orgRow.status === 'cancelled' || orgRow.status === 'expired'
              ? (orgRow.status as OrgStatus)
              : 'active',
        };
        this.organizations.set(orgId, hydratedOrg);
      } else {
        needsPersist = true;
      }

      const { data: balRow, error: balErr } = await this.client!
        .from('ai_credit_balance')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle();

      if (balErr) {
        if (isMissingTableOrSchemaError(balErr)) {
          this.markSchemaMissing(balErr.message);
        } else {
          this.lastPersistenceError = balErr.message;
          logger.warn({ err: balErr, orgId }, 'Supabase balance hydration failed');
        }
      } else if (balRow) {
        this.balances.set(orgId, {
          orgId,
          creditsRemaining: Number(balRow.credits_remaining ?? FREE_MONTHLY_ALLOWANCE),
          creditsMonthlyAllowance: Number(balRow.credits_monthly_allowance ?? FREE_MONTHLY_ALLOWANCE),
          periodStart: String(balRow.period_start),
          periodEnd: String(balRow.period_end),
        });
      } else {
        needsPersist = true;
      }
    } catch (err) {
      this.lastPersistenceError = err instanceof Error ? err.message : 'Supabase hydration error';
      logger.warn({ err, orgId }, 'Supabase hydration exception; continuing with cache');
    }

    const { org, balance, changed } = this.ensureOrgAndBalanceSync(orgId, ownerAdminId, now);
    if ((needsPersist || changed) && this.canAttemptSupabase()) {
      await this.persistOrgToSupabase(org, balance);
    }
    return { org, balance };
  }

  private async persistOrgToSupabase(
    org: OrganizationRecord,
    balance: AiCreditBalanceRecord
  ): Promise<boolean> {
    if (!this.canAttemptSupabase()) return false;
    try {
      const nowIso = new Date().toISOString();
      const { error: orgErr } = await this.client!.from('organization').upsert(
        {
          id: org.id,
          owner_admin_id: org.ownerAdminId,
          plan: org.plan,
          plan_interval: org.planInterval,
          premium_started_at: org.premiumStartedAt,
          premium_expires_at: org.premiumExpiresAt,
          status: org.status,
          updated_at: nowIso,
        },
        { onConflict: 'id' }
      );
      if (orgErr) {
        if (isMissingTableOrSchemaError(orgErr)) {
          this.markSchemaMissing(orgErr.message);
        } else {
          this.lastPersistenceError = orgErr.message;
          logger.warn({ err: orgErr, orgId: org.id }, 'Supabase organization upsert failed');
        }
        return false;
      }

      const { error: balErr } = await this.client!.from('ai_credit_balance').upsert(
        {
          org_id: balance.orgId,
          credits_remaining: balance.creditsRemaining,
          credits_monthly_allowance: balance.creditsMonthlyAllowance,
          period_start: balance.periodStart,
          period_end: balance.periodEnd,
          updated_at: nowIso,
        },
        { onConflict: 'org_id' }
      );
      if (balErr) {
        if (isMissingTableOrSchemaError(balErr)) {
          this.markSchemaMissing(balErr.message);
        } else {
          this.lastPersistenceError = balErr.message;
          logger.warn({ err: balErr, orgId: org.id }, 'Supabase ai_credit_balance upsert failed');
        }
        return false;
      }

      this.markSchemaReady();
      return true;
    } catch (err) {
      this.lastPersistenceError = err instanceof Error ? err.message : 'Supabase upsert exception';
      logger.warn({ err, orgId: org.id }, 'Supabase billing persistence failed');
      return false;
    }
  }

  private async persistSubscriptionToSupabase(sub: SubscriptionRecord): Promise<void> {
    if (!this.canAttemptSupabase()) return;
    try {
      const nowIso = new Date().toISOString();
      const { error } = await this.client!.from('subscription').upsert(
        {
          id: sub.id,
          org_id: sub.orgId,
          interval: sub.interval,
          status: sub.status,
          started_at: sub.startedAt,
          expires_at: sub.expiresAt,
          provider: sub.provider,
          provider_ref: sub.providerRef,
          updated_at: nowIso,
        },
        { onConflict: 'id' }
      );
      if (error) {
        if (isMissingTableOrSchemaError(error)) {
          this.markSchemaMissing(error.message);
        } else {
          this.lastPersistenceError = error.message;
          logger.warn({ err: error, subId: sub.id }, 'Supabase subscription upsert failed');
        }
      }
    } catch (err) {
      this.lastPersistenceError = err instanceof Error ? err.message : 'Supabase subscription error';
      logger.warn({ err, subId: sub.id }, 'Supabase subscription upsert exception');
    }
  }

  private async cancelPreviousSubscriptionsInSupabase(orgId: string, exceptSubId?: string): Promise<void> {
    if (!this.canAttemptSupabase()) return;
    try {
      let query = this.client!
        .from('subscription')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('status', 'active');
      if (exceptSubId) {
        query = query.neq('id', exceptSubId);
      }
      const { error } = await query;
      if (error && isMissingTableOrSchemaError(error)) {
        this.markSchemaMissing(error.message);
      }
    } catch (err) {
      logger.warn({ err, orgId }, 'Supabase previous subscription cancel update failed');
    }
  }

  private async appendUsageLog(entry: AiUsageLogRecord): Promise<void> {
    const existing = this.usageLogs.get(entry.orgId) || [];
    existing.unshift(entry);
    if (existing.length > 500) existing.length = 500;
    this.usageLogs.set(entry.orgId, existing);

    if (!this.canAttemptSupabase()) return;
    try {
      const { error } = await this.client!.from('ai_usage_log').insert({
        id: entry.id,
        org_id: entry.orgId,
        user_id: entry.userId,
        role: entry.role,
        action_feature: entry.action,
        credits_used: entry.creditsUsed,
        idempotency_key: entry.idempotencyKey || null,
        timestamp: entry.timestamp,
        success: entry.success,
        refunded: Boolean(entry.refunded),
        error_reason: entry.errorReason || null,
      });
      if (error) {
        if (isMissingTableOrSchemaError(error)) {
          this.markSchemaMissing(error.message);
        } else {
          this.lastPersistenceError = error.message;
          logger.warn({ err: error, orgId: entry.orgId, logId: entry.id }, 'Supabase ai_usage_log insert failed');
        }
      } else {
        this.markSchemaReady();
      }
    } catch (err) {
      this.lastPersistenceError = err instanceof Error ? err.message : 'Supabase usage log exception';
      logger.warn({ err, orgId: entry.orgId }, 'Supabase ai_usage_log insert exception');
    }
  }

  private async findIdempotentUsageInSupabase(
    orgId: string,
    idempotencyKey: string
  ): Promise<AiUsageLogRecord | null> {
    if (!this.canAttemptSupabase()) return null;
    try {
      const { data, error } = await this.client!
        .from('ai_usage_log')
        .select('*')
        .eq('org_id', orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error) {
        if (isMissingTableOrSchemaError(error)) this.markSchemaMissing(error.message);
        return null;
      }
      if (!data) return null;
      return {
        id: String(data.id),
        orgId: String(data.org_id),
        userId: String(data.user_id),
        role: String(data.role),
        action: String(data.action_feature),
        creditsUsed: Number(data.credits_used ?? 0),
        idempotencyKey: data.idempotency_key || undefined,
        timestamp: String(data.timestamp),
        success: Boolean(data.success),
        refunded: Boolean(data.refunded),
        errorReason: data.error_reason || undefined,
      };
    } catch {
      return null;
    }
  }

  async checkAndConsume(
    rawOrgId: string,
    userId: string,
    role: string,
    actionType: CreditCostAction,
    opts?: {
      idempotencyKey?: string;
      now?: Date;
      costOverride?: number;
    }
  ): Promise<CheckAndConsumeResult> {
    const orgId = this.normalizeOrgId(rawOrgId);
    const now = opts?.now || new Date();

    return this.withOrgLock(orgId, async () => {
      if (opts?.idempotencyKey) {
        const cacheKey = `${orgId}:${opts.idempotencyKey}`;
        const prev = this.idempotencyCache.get(cacheKey);
        if (prev) {
          return { ...prev, deduplicated: true };
        }
      }

      const isAdmin = isAdminOrOwnerRole(role);
      const { org, balance } = await this.hydrateOrgFromSupabase(
        orgId,
        isAdmin ? userId : 'admin',
        now
      );

      if (opts?.idempotencyKey) {
        const dbExisting = await this.findIdempotentUsageInSupabase(orgId, opts.idempotencyKey);
        if (dbExisting && dbExisting.success) {
          const activePrem = this.isPremiumActive(org, now);
          const deduped: CheckAndConsumeResult = {
            allowed: true,
            orgId,
            plan: activePrem ? 'premium' : 'free',
            cost: dbExisting.creditsUsed,
            creditsRemaining: balance.creditsRemaining,
            creditsMonthlyAllowance: balance.creditsMonthlyAllowance,
            periodStart: balance.periodStart,
            periodEnd: balance.periodEnd,
            resetDate: balance.periodEnd,
            consumptionId: dbExisting.id,
            deduplicated: true,
          };
          this.idempotencyCache.set(`${orgId}:${opts.idempotencyKey}`, deduped);
          return deduped;
        }
      }

      const cost =
        typeof opts?.costOverride === 'number' && opts.costOverride >= 0
          ? Math.round(opts.costOverride)
          : getCreditCost(actionType);

      // 1. Premium active: everyone under this admin's org uses assistant with UNLIMITED credits
      if (this.isPremiumActive(org, now)) {
        const logId = `use_${crypto.randomUUID().slice(0, 12)}`;
        // Persist parent org + balance BEFORE usage log insert (FK constraint)
        await this.persistOrgToSupabase(org, balance);
        await this.appendUsageLog({
          id: logId,
          orgId,
          userId,
          role,
          action: actionType,
          creditsUsed: 0,
          idempotencyKey: opts?.idempotencyKey,
          timestamp: now.toISOString(),
          success: true,
        });

        const okRes: CheckAndConsumeResult = {
          allowed: true,
          orgId,
          plan: 'premium',
          cost: 0,
          creditsRemaining: balance.creditsRemaining,
          creditsMonthlyAllowance: balance.creditsMonthlyAllowance,
          periodStart: balance.periodStart,
          periodEnd: balance.periodEnd,
          resetDate: balance.periodEnd,
          consumptionId: logId,
        };
        if (opts?.idempotencyKey) {
          this.idempotencyCache.set(`${orgId}:${opts.idempotencyKey}`, okRes);
        }
        return okRes;
      }

      // 2. FREE plan: ONLY Admin/owner can use the assistant
      if (!isAdmin) {
        const deniedRes: CheckAndConsumeResult = {
          allowed: false,
          orgId,
          plan: 'free',
          cost: 0,
          creditsRemaining: balance.creditsRemaining,
          creditsMonthlyAllowance: balance.creditsMonthlyAllowance,
          periodStart: balance.periodStart,
          periodEnd: balance.periodEnd,
          resetDate: balance.periodEnd,
          errorCode: 'UPGRADE_REQUIRED',
          message: 'AI Assistant is available on the Premium plan. Ask your admin to upgrade.',
        };
        await this.persistOrgToSupabase(org, balance);
        await this.appendUsageLog({
          id: `use_${crypto.randomUUID().slice(0, 12)}`,
          orgId,
          userId,
          role,
          action: actionType,
          creditsUsed: 0,
          idempotencyKey: opts?.idempotencyKey,
          timestamp: now.toISOString(),
          success: false,
          errorReason: 'UPGRADE_REQUIRED',
        });
        return deniedRes;
      }

      // 3. FREE + Admin: atomic decrement if creditsRemaining >= cost
      if (balance.creditsRemaining < cost) {
        const resetLabel = balance.periodEnd.slice(0, 10);
        const exhaustedRes: CheckAndConsumeResult = {
          allowed: false,
          orgId,
          plan: 'free',
          cost,
          creditsRemaining: balance.creditsRemaining,
          creditsMonthlyAllowance: balance.creditsMonthlyAllowance,
          periodStart: balance.periodStart,
          periodEnd: balance.periodEnd,
          resetDate: balance.periodEnd,
          errorCode: 'CREDITS_EXHAUSTED',
          message: `You have used all ${balance.creditsMonthlyAllowance} free credits for this month (remaining: ${balance.creditsRemaining}). Credits reset on ${resetLabel}, or upgrade to Premium for unlimited access.`,
        };
        await this.persistOrgToSupabase(org, balance);
        await this.appendUsageLog({
          id: `use_${crypto.randomUUID().slice(0, 12)}`,
          orgId,
          userId,
          role,
          action: actionType,
          creditsUsed: 0,
          idempotencyKey: opts?.idempotencyKey,
          timestamp: now.toISOString(),
          success: false,
          errorReason: 'CREDITS_EXHAUSTED',
        });
        return exhaustedRes;
      }

      balance.creditsRemaining = Math.max(0, balance.creditsRemaining - cost);
      const consumptionId = `use_${crypto.randomUUID().slice(0, 12)}`;
      // Persist parent org + updated balance BEFORE inserting into ai_usage_log
      await this.persistOrgToSupabase(org, balance);
      await this.appendUsageLog({
        id: consumptionId,
        orgId,
        userId,
        role,
        action: actionType,
        creditsUsed: cost,
        idempotencyKey: opts?.idempotencyKey,
        timestamp: now.toISOString(),
        success: true,
      });

      const allowedRes: CheckAndConsumeResult = {
        allowed: true,
        orgId,
        plan: 'free',
        cost,
        creditsRemaining: balance.creditsRemaining,
        creditsMonthlyAllowance: balance.creditsMonthlyAllowance,
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
        resetDate: balance.periodEnd,
        consumptionId,
      };
      if (opts?.idempotencyKey) {
        this.idempotencyCache.set(`${orgId}:${opts.idempotencyKey}`, allowedRes);
      }
      return allowedRes;
    });
  }

  async refundConsumption(
    rawOrgId: string,
    consumptionId: string,
    errorReason = 'Provider error refund'
  ): Promise<{ refunded: boolean; creditsRemaining: number }> {
    const orgId = this.normalizeOrgId(rawOrgId);
    return this.withOrgLock(orgId, async () => {
      const { org, balance } = await this.hydrateOrgFromSupabase(orgId);
      const logs = this.usageLogs.get(orgId) || [];
      let target = logs.find((l) => l.id === consumptionId);

      if (!target && this.canAttemptSupabase()) {
        try {
          const { data, error } = await this.client!
            .from('ai_usage_log')
            .select('*')
            .eq('org_id', orgId)
            .eq('id', consumptionId)
            .maybeSingle();
          if (!error && data) {
            target = {
              id: String(data.id),
              orgId: String(data.org_id),
              userId: String(data.user_id),
              role: String(data.role),
              action: String(data.action_feature),
              creditsUsed: Number(data.credits_used ?? 0),
              idempotencyKey: data.idempotency_key || undefined,
              timestamp: String(data.timestamp),
              success: Boolean(data.success),
              refunded: Boolean(data.refunded),
              errorReason: data.error_reason || undefined,
            };
          } else if (error && isMissingTableOrSchemaError(error)) {
            this.markSchemaMissing(error.message);
          }
        } catch {
          // ignore
        }
      }

      if (!target || target.refunded || target.creditsUsed <= 0) {
        return { refunded: false, creditsRemaining: balance.creditsRemaining };
      }

      target.refunded = true;
      target.success = false;
      target.errorReason = errorReason;
      balance.creditsRemaining = Math.min(
        balance.creditsMonthlyAllowance,
        balance.creditsRemaining + target.creditsUsed
      );
      await this.persistOrgToSupabase(org, balance);

      if (this.canAttemptSupabase()) {
        try {
          await this.client!
            .from('ai_usage_log')
            .update({
              refunded: true,
              success: false,
              error_reason: errorReason,
            })
            .eq('org_id', orgId)
            .eq('id', consumptionId);
        } catch (err) {
          logger.warn({ err, orgId, consumptionId }, 'Failed to update refunded usage log in Supabase');
        }
      }

      return { refunded: true, creditsRemaining: balance.creditsRemaining };
    });
  }

  private activatePremiumOnOrgSync(params: {
    org: OrganizationRecord;
    orgId: string;
    interval: PlanInterval;
    provider: string | null;
    providerRef: string | null;
    now: Date;
  }): { org: OrganizationRecord; subscription: SubscriptionRecord; extended: boolean } {
    const activeAlready = this.isPremiumActive(params.org, params.now) && Boolean(params.org.premiumExpiresAt);
    const baseDate = activeAlready ? new Date(params.org.premiumExpiresAt!) : params.now;
    const expiresAt = computePremiumExpiry(params.interval, baseDate);

    params.org.plan = 'premium';
    params.org.planInterval = params.interval;
    params.org.premiumStartedAt =
      activeAlready && params.org.premiumStartedAt
        ? params.org.premiumStartedAt
        : params.now.toISOString();
    params.org.premiumExpiresAt = expiresAt;
    params.org.status = 'active';

    const sub: SubscriptionRecord = {
      id: `sub_${crypto.randomUUID().slice(0, 10)}`,
      orgId: params.orgId,
      interval: params.interval,
      status: 'active',
      startedAt: params.org.premiumStartedAt,
      expiresAt,
      provider: params.provider,
      providerRef: params.providerRef,
    };
    const list = this.subscriptions.get(params.orgId) || [];
    for (const prev of list) {
      if (prev.status === 'active') prev.status = 'cancelled';
    }
    list.unshift(sub);
    this.subscriptions.set(params.orgId, list);

    return { org: params.org, subscription: sub, extended: activeAlready };
  }

  async activatePremium(params: {
    orgId: string;
    adminUserId: string;
    interval: PlanInterval;
    provider?: string | null;
    providerRef?: string | null;
    now?: Date;
  }): Promise<{ org: OrganizationRecord; subscription: SubscriptionRecord; extended: boolean }> {
    const orgId = this.normalizeOrgId(params.orgId);
    const now = params.now || new Date();

    return this.withOrgLock(orgId, async () => {
      const { org, balance } = await this.hydrateOrgFromSupabase(orgId, params.adminUserId, now);
      const { subscription, extended } = this.activatePremiumOnOrgSync({
        org,
        orgId,
        interval: params.interval,
        provider: params.provider === undefined ? this.paymentProvider.name : params.provider,
        providerRef: params.providerRef ?? null,
        now,
      });

      await this.persistOrgToSupabase(org, balance);
      await this.cancelPreviousSubscriptionsInSupabase(orgId, subscription.id);
      await this.persistSubscriptionToSupabase(subscription);
      await this.recordAudit({
        orgId,
        actorUserId: params.adminUserId,
        eventType: extended ? 'PREMIUM_EXTENDED' : 'PREMIUM_ACTIVATED',
        summary: extended
          ? `Extended ${params.interval} Premium until ${subscription.expiresAt.slice(0, 10)}`
          : `Activated ${params.interval} Premium until ${subscription.expiresAt.slice(0, 10)}`,
        metadata: {
          interval: params.interval,
          provider: subscription.provider,
          expiresAt: subscription.expiresAt,
        },
        createdAt: now.toISOString(),
      });

      return { org: { ...org }, subscription, extended };
    });
  }

  async cancelPremium(params: {
    orgId: string;
    now?: Date;
  }): Promise<{ org: OrganizationRecord }> {
    const orgId = this.normalizeOrgId(params.orgId);
    const now = params.now || new Date();

    return this.withOrgLock(orgId, async () => {
      const { org, balance } = await this.hydrateOrgFromSupabase(orgId, 'admin', now);
      const list = this.subscriptions.get(orgId) || [];
      for (const sub of list) {
        if (sub.status === 'active') {
          await this.paymentProvider.cancelSubscription({
            orgId,
            providerRef: sub.providerRef,
          });
          sub.status = 'cancelled';
        }
      }
      org.plan = 'free';
      org.planInterval = null;
      org.status = 'cancelled';
      org.premiumExpiresAt = now.toISOString();

      await this.persistOrgToSupabase(org, balance);
      await this.cancelPreviousSubscriptionsInSupabase(orgId);
      return { org: { ...org } };
    });
  }

  async expirePremiumForTest(orgId: string, expiredIso = '2020-01-01T00:00:00.000Z'): Promise<void> {
    const norm = this.normalizeOrgId(orgId);
    await this.withOrgLock(norm, async () => {
      const { org, balance } = await this.hydrateOrgFromSupabase(norm);
      org.premiumExpiresAt = expiredIso;
      await this.persistOrgToSupabase(org, balance);
    });
  }

  async setPeriodEndForTest(orgId: string, periodEndIso: string): Promise<void> {
    const norm = this.normalizeOrgId(orgId);
    await this.withOrgLock(norm, async () => {
      const { org, balance } = await this.hydrateOrgFromSupabase(norm);
      balance.periodEnd = periodEndIso;
      await this.persistOrgToSupabase(org, balance);
    });
  }

  async setPlanViaDevSwitch(params: {
    orgId: string;
    adminUserId: string;
    plan: OrgPlan;
    interval?: PlanInterval;
    creditsRemaining?: number;
    expiresAt?: string;
  }): Promise<BillingStatusSnapshot> {
    if (params.plan === 'premium') {
      await this.activatePremium({
        orgId: params.orgId,
        adminUserId: params.adminUserId,
        interval: params.interval || 'monthly',
        provider: null,
        providerRef: null,
      });
      if (params.expiresAt) {
        await this.expirePremiumForTest(params.orgId, params.expiresAt);
      }
    } else {
      await this.cancelPremium({ orgId: params.orgId });
      if (typeof params.creditsRemaining === 'number') {
        const norm = this.normalizeOrgId(params.orgId);
        await this.withOrgLock(norm, async () => {
          const { org, balance } = await this.hydrateOrgFromSupabase(norm, params.adminUserId);
          balance.creditsRemaining = Math.max(
            0,
            Math.min(balance.creditsMonthlyAllowance, Math.round(params.creditsRemaining!))
          );
          org.status = 'active';
          await this.persistOrgToSupabase(org, balance);
        });
      }
    }
    return this.getStatus(params.orgId, 'ADMIN', params.adminUserId);
  }

  async runMonthlyCronReset(now: Date = new Date()): Promise<{ resetCount: number }> {
    let resetCount = 0;
    const bounds = computeCalendarMonthBounds(now);
    const seenOrgs = new Set<string>(this.balances.keys());

    if (this.canAttemptSupabase()) {
      try {
        const { data, error } = await this.client!
          .from('ai_credit_balance')
          .select('org_id')
          .lte('period_end', now.toISOString());
        if (error && isMissingTableOrSchemaError(error)) {
          this.markSchemaMissing(error.message);
        } else if (Array.isArray(data)) {
          for (const row of data) {
            if (row?.org_id) seenOrgs.add(String(row.org_id));
          }
        }
      } catch {
        // continue with in-memory orgs
      }
    }

    for (const orgId of seenOrgs) {
      await this.withOrgLock(orgId, async () => {
        const beforePeriodEnd = this.balances.get(orgId)?.periodEnd;
        const { org, balance } = await this.hydrateOrgFromSupabase(orgId, 'admin', now);
        const rolledInMemory =
          Boolean(beforePeriodEnd) &&
          now.getTime() >= Date.parse(beforePeriodEnd!) &&
          balance.periodStart === bounds.periodStart;
        const rolledFromDb = !beforePeriodEnd && balance.periodStart === bounds.periodStart;
        if (rolledInMemory || rolledFromDb) {
          resetCount += 1;
        } else if (now.getTime() >= Date.parse(balance.periodEnd)) {
          balance.creditsRemaining = balance.creditsMonthlyAllowance || FREE_MONTHLY_ALLOWANCE;
          balance.periodStart = bounds.periodStart;
          balance.periodEnd = bounds.periodEnd;
          await this.persistOrgToSupabase(org, balance);
          resetCount += 1;
        }
      });
    }
    return { resetCount };
  }

  async getStatus(
    rawOrgId: string,
    role: string,
    userId = 'admin',
    now: Date = new Date()
  ): Promise<BillingStatusSnapshot> {
    const orgId = this.normalizeOrgId(rawOrgId);
    const rzpStatus = inspectRazorpayConfig({
      razorpayKeyId: this.cfg?.razorpayKeyId || '',
      razorpayKeySecret: this.cfg?.razorpayKeySecret || '',
      razorpayWebhookSecret: this.cfg?.razorpayWebhookSecret || '',
      razorpayTestMode: this.cfg?.razorpayTestMode ?? true,
    });
    const razorpayMeta = {
      configured: rzpStatus.configured,
      testMode: rzpStatus.testMode,
      liveKeyBlocked: rzpStatus.liveKeyBlocked,
      webhookConfigured: rzpStatus.webhookConfigured,
    };

    if (String(role || '').toUpperCase() === 'PUBLIC') {
      const bounds = computeCalendarMonthBounds(now);
      return {
        orgId,
        plan: 'free',
        effectivePlan: 'free',
        planInterval: null,
        status: 'active',
        premiumStartedAt: null,
        premiumExpiresAt: null,
        daysUntilExpiry: null,
        expiringSoon: false,
        creditsRemaining: FREE_MONTHLY_ALLOWANCE,
        creditsMonthlyAllowance: FREE_MONTHLY_ALLOWANCE,
        periodStart: bounds.periodStart,
        periodEnd: bounds.periodEnd,
        role: 'PUBLIC',
        isAdmin: false,
        canUseAssistant: true,
        lockedReason: null,
        devSwitchEnabled: false,
        razorpay: razorpayMeta,
        pricing: { ...PLAN_PRICING },
        costs: { ...CREDIT_COSTS },
      };
    }

    return this.withOrgLock(orgId, async () => {
      const isAdmin = isAdminOrOwnerRole(role);
      const { org, balance } = await this.hydrateOrgFromSupabase(
        orgId,
        isAdmin ? userId : 'admin',
        now
      );
      const persistence = await this.checkSupabaseHealth();
      const effectivePlan: OrgPlan = this.isPremiumActive(org, now) ? 'premium' : 'free';
      const daysUntilExpiry =
        effectivePlan === 'premium' ? computeDaysUntilExpiry(org.premiumExpiresAt, now) : null;
      const expiringSoon =
        effectivePlan === 'premium' && daysUntilExpiry !== null && daysUntilExpiry <= 7;

      let lockedReason: BillingStatusSnapshot['lockedReason'] = null;
      if (effectivePlan === 'free') {
        if (!isAdmin) {
          lockedReason = 'UPGRADE_REQUIRED';
        } else if (balance.creditsRemaining <= 0) {
          lockedReason = 'CREDITS_EXHAUSTED';
        }
      }

      return {
        orgId,
        plan: org.plan,
        effectivePlan,
        planInterval: org.planInterval,
        status: org.status,
        premiumStartedAt: org.premiumStartedAt,
        premiumExpiresAt: org.premiumExpiresAt,
        daysUntilExpiry,
        expiringSoon,
        creditsRemaining: balance.creditsRemaining,
        creditsMonthlyAllowance: balance.creditsMonthlyAllowance,
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
        role,
        isAdmin,
        canUseAssistant: lockedReason === null,
        lockedReason,
        devSwitchEnabled: isDevPlanSwitchAllowed(),
        razorpay: razorpayMeta,
        pricing: { ...PLAN_PRICING },
        costs: { ...CREDIT_COSTS },
        persistence,
      };
    });
  }

  // ============================================================================
  // Razorpay Payments, Webhook Idempotency & Billing Audit Trail
  // ============================================================================

  private mapSupabasePaymentRow(row: Record<string, unknown>): PaymentRecord {
    return {
      id: String(row.id),
      orgId: String(row.org_id),
      userId: String(row.user_id),
      plan: row.plan === 'free' ? 'free' : 'premium',
      interval: row.interval === 'annual' ? 'annual' : 'monthly',
      amount: Number(row.amount || 0),
      amountPaise: Number(row.amount_paise || 0),
      currency: 'INR',
      provider: String(row.provider || 'razorpay'),
      razorpayOrderId: String(row.razorpay_order_id),
      razorpayPaymentId: row.razorpay_payment_id ? String(row.razorpay_payment_id) : null,
      method: row.method ? String(row.method) : null,
      status:
        row.status === 'paid' || row.status === 'failed' || row.status === 'refunded'
          ? row.status
          : 'created',
      idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
      errorReason: row.error_reason ? String(row.error_reason) : null,
      createdAt: String(row.created_at),
      paidAt: row.paid_at ? String(row.paid_at) : null,
    };
  }

  private upsertPaymentInMemory(record: PaymentRecord): void {
    this.paymentsByOrderId.set(record.razorpayOrderId, record);
    const list = this.paymentsByOrg.get(record.orgId) || [];
    const idx = list.findIndex((p) => p.id === record.id || p.razorpayOrderId === record.razorpayOrderId);
    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.unshift(record);
    }
    this.paymentsByOrg.set(record.orgId, list);
  }

  private async persistPaymentToSupabase(record: PaymentRecord): Promise<void> {
    if (!this.canAttemptSupabase()) return;
    try {
      const { error } = await this.client!.from('payment').upsert(
        {
          id: record.id,
          org_id: record.orgId,
          user_id: record.userId,
          plan: record.plan,
          interval: record.interval,
          amount: record.amount,
          amount_paise: record.amountPaise,
          currency: record.currency,
          provider: record.provider,
          razorpay_order_id: record.razorpayOrderId,
          razorpay_payment_id: record.razorpayPaymentId,
          method: record.method || null,
          status: record.status,
          idempotency_key: record.idempotencyKey || null,
          error_reason: record.errorReason || null,
          created_at: record.createdAt,
          paid_at: record.paidAt || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (error) {
        if (isMissingTableOrSchemaError(error)) this.markSchemaMissing(error.message);
        else logger.warn({ err: error, orderId: record.razorpayOrderId }, 'Supabase payment upsert failed');
      } else {
        this.markSchemaReady();
      }
    } catch (err) {
      logger.warn({ err, orderId: record.razorpayOrderId }, 'Supabase payment upsert exception');
    }
  }

  async recordAudit(
    entry: Omit<BillingAuditRecord, 'id' | 'createdAt'> & { createdAt?: string }
  ): Promise<BillingAuditRecord> {
    const record: BillingAuditRecord = {
      id: `baud_${crypto.randomUUID().slice(0, 12)}`,
      orgId: this.normalizeOrgId(entry.orgId),
      actorUserId: entry.actorUserId,
      eventType: entry.eventType,
      summary: entry.summary,
      metadata: entry.metadata,
      createdAt: entry.createdAt || new Date().toISOString(),
    };
    const existing = this.auditLogs.get(record.orgId) || [];
    existing.unshift(record);
    if (existing.length > 200) existing.length = 200;
    this.auditLogs.set(record.orgId, existing);

    if (this.canAttemptSupabase()) {
      try {
        const { error } = await this.client!.from('billing_audit_log').insert({
          id: record.id,
          org_id: record.orgId,
          actor_user_id: record.actorUserId,
          event_type: record.eventType,
          summary: record.summary,
          metadata: record.metadata || null,
          created_at: record.createdAt,
        });
        if (error && isMissingTableOrSchemaError(error)) {
          this.markSchemaMissing(error.message);
        }
      } catch {
        // ignore transient audit persistence error
      }
    }
    return record;
  }

  async createPaymentOrderRecord(params: {
    orgId: string;
    userId: string;
    plan?: OrgPlan;
    interval: PlanInterval;
    amountInr: number;
    amountPaise: number;
    razorpayOrderId: string;
    idempotencyKey?: string;
    now?: Date;
  }): Promise<PaymentRecord> {
    const orgId = this.normalizeOrgId(params.orgId);
    const now = params.now || new Date();

    return this.withOrgLock(orgId, async () => {
      const { org, balance } = await this.hydrateOrgFromSupabase(orgId, params.userId, now);
      await this.persistOrgToSupabase(org, balance);

      const record: PaymentRecord = {
        id: `pay_${crypto.randomUUID().slice(0, 12)}`,
        orgId,
        userId: params.userId,
        plan: params.plan || 'premium',
        interval: params.interval,
        amount: params.amountInr,
        amountPaise: params.amountPaise,
        currency: 'INR',
        provider: 'razorpay',
        razorpayOrderId: params.razorpayOrderId,
        razorpayPaymentId: null,
        method: null,
        status: 'created',
        idempotencyKey: params.idempotencyKey,
        errorReason: null,
        createdAt: now.toISOString(),
        paidAt: null,
      };

      this.upsertPaymentInMemory(record);
      await this.persistPaymentToSupabase(record);
      await this.recordAudit({
        orgId,
        actorUserId: params.userId,
        eventType: 'ORDER_CREATED',
        summary: `Created Razorpay ${params.interval} order ${params.razorpayOrderId} (₹${params.amountInr})`,
        metadata: {
          orderId: params.razorpayOrderId,
          interval: params.interval,
          amountInr: params.amountInr,
        },
        createdAt: now.toISOString(),
      });

      return { ...record };
    });
  }

  async getPaymentByOrderId(orderId: string): Promise<PaymentRecord | null> {
    const clean = String(orderId || '').trim();
    if (!clean) return null;
    const cached = this.paymentsByOrderId.get(clean);
    if (cached) return { ...cached };

    if (this.canAttemptSupabase()) {
      try {
        const { data, error } = await this.client!
          .from('payment')
          .select('*')
          .eq('razorpay_order_id', clean)
          .maybeSingle();
        if (error) {
          if (isMissingTableOrSchemaError(error)) this.markSchemaMissing(error.message);
          return null;
        }
        if (data) {
          const mapped = this.mapSupabasePaymentRow(data as Record<string, unknown>);
          this.upsertPaymentInMemory(mapped);
          return { ...mapped };
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  async getPaymentByPaymentId(paymentId: string): Promise<PaymentRecord | null> {
    const clean = String(paymentId || '').trim();
    if (!clean) return null;
    for (const p of this.paymentsByOrderId.values()) {
      if (p.razorpayPaymentId === clean) return { ...p };
    }
    if (this.canAttemptSupabase()) {
      try {
        const { data, error } = await this.client!
          .from('payment')
          .select('*')
          .eq('razorpay_payment_id', clean)
          .maybeSingle();
        if (!error && data) {
          const mapped = this.mapSupabasePaymentRow(data as Record<string, unknown>);
          this.upsertPaymentInMemory(mapped);
          return { ...mapped };
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  async recordWebhookEventIfNew(params: {
    eventId: string;
    eventName: string;
    orderId?: string;
    paymentId?: string;
  }): Promise<boolean> {
    if (!params.eventId) return true;
    if (this.webhookEvents.has(params.eventId)) {
      return false;
    }

    if (this.canAttemptSupabase()) {
      try {
        const { data: existing, error: selErr } = await this.client!
          .from('payment_webhook_event')
          .select('event_id')
          .eq('event_id', params.eventId)
          .maybeSingle();
        if (!selErr && existing) {
          this.webhookEvents.add(params.eventId);
          return false;
        }
        const { error: insErr } = await this.client!.from('payment_webhook_event').insert({
          event_id: params.eventId,
          event_name: params.eventName,
          order_id: params.orderId || null,
          payment_id: params.paymentId || null,
          processed_at: new Date().toISOString(),
        });
        if (insErr) {
          if (insErr.code === '23505') {
            this.webhookEvents.add(params.eventId);
            return false;
          }
          if (isMissingTableOrSchemaError(insErr)) this.markSchemaMissing(insErr.message);
        }
      } catch {
        // fallback to in-memory set
      }
    }

    this.webhookEvents.add(params.eventId);
    return true;
  }

  async markPaymentPaidAndActivatePremium(params: {
    orderId: string;
    razorpayPaymentId: string;
    actorUserId: string;
    intervalOverride?: PlanInterval;
    method?: string | null;
    source: 'verify' | 'webhook';
    eventId?: string;
    now?: Date;
  }): Promise<{
    alreadyProcessed: boolean;
    payment: PaymentRecord;
    org: OrganizationRecord;
    subscription?: SubscriptionRecord;
    extended: boolean;
  }> {
    const existing = await this.getPaymentByOrderId(params.orderId);
    if (!existing) {
      throw new Error(`Payment order "${params.orderId}" not found.`);
    }

    const now = params.now || new Date();
    const orgId = existing.orgId;

    return this.withOrgLock(orgId, async () => {
      const latest = (await this.getPaymentByOrderId(params.orderId)) || existing;
      const { org, balance } = await this.hydrateOrgFromSupabase(orgId, latest.userId || params.actorUserId, now);

      if (latest.status === 'paid') {
        return {
          alreadyProcessed: true,
          payment: { ...latest },
          org: { ...org },
          extended: false,
        };
      }

      const interval = params.intervalOverride || latest.interval;
      latest.status = 'paid';
      latest.razorpayPaymentId = params.razorpayPaymentId;
      latest.method = params.method ?? latest.method ?? null;
      latest.errorReason = null;
      latest.paidAt = now.toISOString();

      const { subscription, extended } = this.activatePremiumOnOrgSync({
        org,
        orgId,
        interval,
        provider: 'razorpay',
        providerRef: params.razorpayPaymentId || latest.razorpayOrderId,
        now,
      });

      this.upsertPaymentInMemory(latest);
      await this.persistOrgToSupabase(org, balance);
      await this.cancelPreviousSubscriptionsInSupabase(orgId, subscription.id);
      await this.persistSubscriptionToSupabase(subscription);
      await this.persistPaymentToSupabase(latest);

      await this.recordAudit({
        orgId,
        actorUserId: params.actorUserId || latest.userId,
        eventType: params.source === 'webhook' ? 'WEBHOOK_PROCESSED' : 'PAYMENT_VERIFIED',
        summary: `${params.source === 'webhook' ? 'Webhook' : 'Checkout'} verified payment ${params.razorpayPaymentId} (₹${latest.amount})`,
        metadata: {
          orderId: latest.razorpayOrderId,
          paymentId: params.razorpayPaymentId,
          method: latest.method,
          eventId: params.eventId,
        },
        createdAt: now.toISOString(),
      });

      await this.recordAudit({
        orgId,
        actorUserId: params.actorUserId || latest.userId,
        eventType: extended ? 'PREMIUM_EXTENDED' : 'PREMIUM_ACTIVATED',
        summary: extended
          ? `Extended ${interval} Premium until ${subscription.expiresAt.slice(0, 10)}`
          : `Activated ${interval} Premium until ${subscription.expiresAt.slice(0, 10)}`,
        metadata: {
          interval,
          expiresAt: subscription.expiresAt,
          orderId: latest.razorpayOrderId,
          paymentId: params.razorpayPaymentId,
        },
        createdAt: now.toISOString(),
      });

      return {
        alreadyProcessed: false,
        payment: { ...latest },
        org: { ...org },
        subscription,
        extended,
      };
    });
  }

  async markPaymentFailed(params: {
    orderId?: string;
    razorpayPaymentId?: string;
    errorReason: string;
    actorUserId?: string;
    now?: Date;
  }): Promise<PaymentRecord | null> {
    const payment = params.orderId
      ? await this.getPaymentByOrderId(params.orderId)
      : params.razorpayPaymentId
        ? await this.getPaymentByPaymentId(params.razorpayPaymentId)
        : null;
    if (!payment) return null;

    const now = params.now || new Date();
    return this.withOrgLock(payment.orgId, async () => {
      const latest = (await this.getPaymentByOrderId(payment.razorpayOrderId)) || payment;
      if (latest.status === 'paid' || latest.status === 'refunded') {
        return { ...latest };
      }
      latest.status = 'failed';
      if (params.razorpayPaymentId) latest.razorpayPaymentId = params.razorpayPaymentId;
      latest.errorReason = params.errorReason;
      this.upsertPaymentInMemory(latest);
      await this.persistPaymentToSupabase(latest);
      await this.recordAudit({
        orgId: latest.orgId,
        actorUserId: params.actorUserId || latest.userId,
        eventType: 'PAYMENT_FAILED',
        summary: `Payment failed for order ${latest.razorpayOrderId}: ${params.errorReason}`,
        metadata: {
          orderId: latest.razorpayOrderId,
          paymentId: params.razorpayPaymentId,
        },
        createdAt: now.toISOString(),
      });
      return { ...latest };
    });
  }

  async markPaymentRefunded(params: {
    orderId?: string;
    razorpayPaymentId?: string;
    actorUserId?: string;
    now?: Date;
  }): Promise<PaymentRecord | null> {
    const payment = params.orderId
      ? await this.getPaymentByOrderId(params.orderId)
      : params.razorpayPaymentId
        ? await this.getPaymentByPaymentId(params.razorpayPaymentId)
        : null;
    if (!payment) return null;

    const now = params.now || new Date();
    return this.withOrgLock(payment.orgId, async () => {
      const latest = (await this.getPaymentByOrderId(payment.razorpayOrderId)) || payment;
      if (latest.status === 'refunded') {
        return { ...latest };
      }
      latest.status = 'refunded';
      this.upsertPaymentInMemory(latest);
      await this.persistPaymentToSupabase(latest);
      await this.recordAudit({
        orgId: latest.orgId,
        actorUserId: params.actorUserId || latest.userId,
        eventType: 'PAYMENT_REFUNDED',
        summary: `Refund processed for payment ${latest.razorpayPaymentId || latest.razorpayOrderId}`,
        metadata: {
          orderId: latest.razorpayOrderId,
          paymentId: latest.razorpayPaymentId,
        },
        createdAt: now.toISOString(),
      });
      return { ...latest };
    });
  }

  async listPayments(rawOrgId: string, limit = 50): Promise<PaymentRecord[]> {
    const orgId = this.normalizeOrgId(rawOrgId);
    const bounded = Math.max(1, Math.min(200, limit));
    if (this.canAttemptSupabase()) {
      try {
        const { data, error } = await this.client!
          .from('payment')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(bounded);
        if (!error && Array.isArray(data)) {
          this.markSchemaReady();
          const mapped = data.map((r) => this.mapSupabasePaymentRow(r as Record<string, unknown>));
          this.paymentsByOrg.set(orgId, mapped);
          for (const p of mapped) {
            this.paymentsByOrderId.set(p.razorpayOrderId, p);
          }
          return mapped;
        }
        if (error && isMissingTableOrSchemaError(error)) {
          this.markSchemaMissing(error.message);
        }
      } catch {
        // fallback to in-memory
      }
    }
    return (this.paymentsByOrg.get(orgId) || []).slice(0, bounded).map((p) => ({ ...p }));
  }

  async listBillingAudit(rawOrgId: string, limit = 50): Promise<BillingAuditRecord[]> {
    const orgId = this.normalizeOrgId(rawOrgId);
    const bounded = Math.max(1, Math.min(200, limit));
    if (this.canAttemptSupabase()) {
      try {
        const { data, error } = await this.client!
          .from('billing_audit_log')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(bounded);
        if (!error && Array.isArray(data)) {
          const mapped: BillingAuditRecord[] = data.map((row) => ({
            id: String(row.id),
            orgId: String(row.org_id),
            actorUserId: String(row.actor_user_id),
            eventType: String(row.event_type) as BillingAuditRecord['eventType'],
            summary: String(row.summary),
            metadata: (row.metadata as Record<string, unknown>) || undefined,
            createdAt: String(row.created_at),
          }));
          this.auditLogs.set(orgId, mapped);
          return mapped;
        }
      } catch {
        // fallback
      }
    }
    return (this.auditLogs.get(orgId) || []).slice(0, bounded);
  }

  getUsageLogs(rawOrgId: string, limit = 50): AiUsageLogRecord[] {
    const orgId = this.normalizeOrgId(rawOrgId);
    return (this.usageLogs.get(orgId) || []).slice(0, Math.max(1, limit));
  }

  async fetchUsageLogs(rawOrgId: string, limit = 50): Promise<AiUsageLogRecord[]> {
    const orgId = this.normalizeOrgId(rawOrgId);
    const bounded = Math.max(1, Math.min(200, limit));
    if (this.canAttemptSupabase()) {
      try {
        const { data, error } = await this.client!
          .from('ai_usage_log')
          .select('*')
          .eq('org_id', orgId)
          .order('timestamp', { ascending: false })
          .limit(bounded);
        if (error) {
          if (isMissingTableOrSchemaError(error)) {
            this.markSchemaMissing(error.message);
          } else {
            this.lastPersistenceError = error.message;
          }
        } else if (Array.isArray(data)) {
          this.markSchemaReady();
          const mapped: AiUsageLogRecord[] = data.map((row) => ({
            id: String(row.id),
            orgId: String(row.org_id),
            userId: String(row.user_id),
            role: String(row.role),
            action: String(row.action_feature),
            creditsUsed: Number(row.credits_used ?? 0),
            idempotencyKey: row.idempotency_key || undefined,
            timestamp: String(row.timestamp),
            success: Boolean(row.success),
            refunded: Boolean(row.refunded),
            errorReason: row.error_reason || undefined,
          }));
          this.usageLogs.set(orgId, mapped);
          return mapped;
        }
      } catch (err) {
        this.lastPersistenceError = err instanceof Error ? err.message : 'Supabase usage query error';
      }
    }
    return this.getUsageLogs(orgId, bounded);
  }
}
