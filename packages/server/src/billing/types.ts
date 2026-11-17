export type OrgPlan = 'free' | 'premium';
export type PlanInterval = 'monthly' | 'annual';
export type OrgStatus = 'active' | 'cancelled' | 'expired';

export type CreditCostAction =
  | 'chat'
  | 'data_query'
  | 'tool_call'
  | 'export'
  | 'voice'
  | 'attachment'
  | 'guide';

export interface OrganizationRecord {
  id: string;
  ownerAdminId: string;
  plan: OrgPlan;
  planInterval: PlanInterval | null;
  premiumStartedAt: string | null;
  premiumExpiresAt: string | null;
  status: OrgStatus;
}

export interface AiCreditBalanceRecord {
  orgId: string;
  creditsRemaining: number;
  creditsMonthlyAllowance: number;
  periodStart: string;
  periodEnd: string;
}

export interface AiUsageLogRecord {
  id: string;
  orgId: string;
  userId: string;
  role: string;
  action: CreditCostAction | string;
  creditsUsed: number;
  idempotencyKey?: string;
  timestamp: string;
  success: boolean;
  refunded?: boolean;
  errorReason?: string;
}

export interface SubscriptionRecord {
  id: string;
  orgId: string;
  interval: PlanInterval;
  status: 'active' | 'cancelled' | 'expired';
  startedAt: string;
  expiresAt: string;
  provider: string | null;
  providerRef: string | null;
}

export type PaymentStatus = 'created' | 'paid' | 'failed' | 'refunded';

export interface PaymentRecord {
  id: string;
  orgId: string;
  userId: string;
  plan: OrgPlan;
  interval: PlanInterval;
  amount: number; // INR rupees
  amountPaise: number;
  currency: 'INR';
  provider: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  method?: string | null;
  status: PaymentStatus;
  idempotencyKey?: string;
  errorReason?: string | null;
  createdAt: string;
  paidAt?: string | null;
}

export interface BillingAuditRecord {
  id: string;
  orgId: string;
  actorUserId: string;
  eventType:
    | 'ORDER_CREATED'
    | 'PAYMENT_VERIFIED'
    | 'PAYMENT_FAILED'
    | 'PAYMENT_REFUNDED'
    | 'WEBHOOK_PROCESSED'
    | 'PREMIUM_ACTIVATED'
    | 'PREMIUM_EXTENDED'
    | 'PREMIUM_CANCELLED'
    | 'PREMIUM_EXPIRED';
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface BillingStatusSnapshot {
  orgId: string;
  plan: OrgPlan;
  effectivePlan: OrgPlan;
  planInterval: PlanInterval | null;
  status: OrgStatus;
  premiumStartedAt: string | null;
  premiumExpiresAt: string | null;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  creditsRemaining: number;
  creditsMonthlyAllowance: number;
  periodStart: string;
  periodEnd: string;
  role: string;
  isAdmin: boolean;
  canUseAssistant: boolean;
  lockedReason: 'UPGRADE_REQUIRED' | 'CREDITS_EXHAUSTED' | null;
  devSwitchEnabled: boolean;
  razorpay?: {
    configured: boolean;
    testMode: boolean;
    liveKeyBlocked: boolean;
    webhookConfigured: boolean;
  };
  pricing: {
    currency: 'INR';
    monthlyPrice: number;
    annualPrice: number;
    annualMonthlyEquivalent: number;
    annualSavingsPercent: number;
  };
  costs: Record<CreditCostAction, number>;
  persistence?: {
    backend: 'supabase' | 'memory';
    schemaReady: boolean;
    lastError?: string;
  };
}

export type CheckAndConsumeErrorCode = 'UPGRADE_REQUIRED' | 'CREDITS_EXHAUSTED';

export interface CheckAndConsumeResult {
  allowed: boolean;
  orgId: string;
  plan: OrgPlan;
  cost: number;
  creditsRemaining: number;
  creditsMonthlyAllowance: number;
  periodStart: string;
  periodEnd: string;
  resetDate: string;
  consumptionId?: string;
  deduplicated?: boolean;
  errorCode?: CheckAndConsumeErrorCode;
  message?: string;
}
