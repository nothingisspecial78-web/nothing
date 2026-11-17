import type { CreditCostAction, PlanInterval } from './types.ts';

/**
 * Single-source-of-truth config for organization AI credit allowances,
 * per-action credit costs, and subscription tier pricing (100/month free default).
 */
export const FREE_MONTHLY_ALLOWANCE = Number(process.env.AI_FREE_MONTHLY_CREDITS || 100);

export const CREDIT_COSTS: Record<CreditCostAction, number> = {
  chat: Number(process.env.AI_COST_CHAT || 1),
  data_query: Number(process.env.AI_COST_DATA_QUERY || 2),
  tool_call: Number(process.env.AI_COST_TOOL_CALL || 2),
  export: Number(process.env.AI_COST_EXPORT || 2),
  voice: Number(process.env.AI_COST_VOICE || 1),
  attachment: Number(process.env.AI_COST_ATTACHMENT || 2),
  guide: Number(process.env.AI_COST_GUIDE || 1),
};

export const PLAN_PRICING = {
  currency: 'INR' as const,
  monthlyPrice: 999,
  annualPrice: 9590,
  annualMonthlyEquivalent: 799,
  annualSavingsPercent: 20,
};

export function getCreditCost(
  actionType: CreditCostAction,
  overrides?: Partial<Record<CreditCostAction, number>>
): number {
  const custom = overrides?.[actionType];
  if (typeof custom === 'number' && Number.isFinite(custom) && custom >= 0) {
    return custom;
  }
  const raw = CREDIT_COSTS[actionType];
  return Number.isFinite(raw) && raw >= 0 ? raw : 1;
}

export function isAdminOrOwnerRole(
  roleRaw: string,
  extraOwnerRoles: string[] = []
): boolean {
  const r = String(roleRaw || '').trim().toUpperCase();
  if (r === 'ADMIN' || r === 'OWNER' || r === 'SUPER_ADMIN') {
    return true;
  }
  return extraOwnerRoles.some((er) => er.trim().toUpperCase() === r);
}

export function isDevPlanSwitchAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    return false;
  }
  return String(env.ALLOW_DEV_PLAN_SWITCH || 'true').toLowerCase() === 'true';
}

export function computeCalendarMonthBounds(refDate: Date = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

export function computePremiumExpiry(interval: PlanInterval, fromDate: Date = new Date()): string {
  const next = new Date(fromDate.getTime());
  if (interval === 'annual') {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next.toISOString();
}

export function getPlanPriceInr(interval: PlanInterval, pricing = PLAN_PRICING): number {
  return interval === 'annual' ? pricing.annualPrice : pricing.monthlyPrice;
}

export function getPlanPricePaise(interval: PlanInterval, pricing = PLAN_PRICING): number {
  return Math.round(getPlanPriceInr(interval, pricing) * 100);
}

export function computeDaysUntilExpiry(
  expiresAtIso: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!expiresAtIso) return null;
  const expMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expMs)) return null;
  const diffMs = expMs - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 86_400_000);
}
