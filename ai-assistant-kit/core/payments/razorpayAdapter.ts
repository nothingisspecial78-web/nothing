import type { BillingAdapter, CheckoutSession, PaymentVerificationPayload, PlanStatus, UserContext } from '../adapters/types.ts';
import { DEFAULT_FREE_MONTHLY_CREDITS } from '../constants.ts';

async function computeHmacSha256(secret: string, data: string): Promise<string> {
  if (typeof window === 'undefined') {
    const nodeCrypto = await import('node:crypto');
    return nodeCrypto.createHmac('sha256', secret).update(data).digest('hex');
  }
  const enc = new TextEncoder();
  const key = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await window.crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface RazorpayBillingOptions {
  keyId: string;
  keySecret: string;
  currency?: string;
  freeAllowance?: number;
  plans?: Record<string, { price: number; credits: number; name: string }>;
}

/**
 * Drop-in Razorpay BillingAdapter for payments, subscriptions, and credit balances.
 */
export class RazorpayBillingAdapter implements BillingAdapter {
  private keyId: string;
  private keySecret: string;
  private currency: string;
  private freeAllowance: number;
  private plans: Record<string, { price: number; credits: number; name: string }>;
  private orgBalances = new Map<string, { isPremium: boolean; credits: number; planId: string }>();

  constructor(options: RazorpayBillingOptions) {
    this.keyId = options.keyId;
    this.keySecret = options.keySecret;
    this.currency = options.currency || 'INR';
    this.freeAllowance = options.freeAllowance ?? DEFAULT_FREE_MONTHLY_CREDITS;
    this.plans = options.plans || {
      premium_monthly: { price: 99900, credits: 100000, name: 'Premium Monthly' },
      premium_annual: { price: 959000, credits: 1000000, name: 'Premium Annual' },
    };
  }

  async getPlan(orgId: string): Promise<PlanStatus> {
    const existing = this.orgBalances.get(orgId) || {
      isPremium: false,
      credits: this.freeAllowance,
      planId: 'free',
    };

    return {
      planId: existing.planId,
      isPremium: existing.isPremium,
      creditsRemaining: existing.credits,
      creditsMonthlyAllowance: existing.isPremium ? 100000 : this.freeAllowance,
      features: existing.isPremium
        ? ['basic_chat', 'search', 'all_tools', 'unlimited_export', 'voice', 'co_browser']
        : ['basic_chat', 'search'],
    };
  }

  async createCheckout(
    planId: string,
    orgId: string,
    user?: UserContext
  ): Promise<CheckoutSession> {
    const plan = this.plans[planId] || this.plans.premium_monthly;
    const amount = plan.price;
    const orderId = `order_${orgId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      orderId,
      amount,
      currency: this.currency,
      keyId: this.keyId,
      customerName: user?.name,
      customerEmail: user?.email,
      notes: {
        orgId,
        planId,
      },
    };
  }

  async verify(
    payload: PaymentVerificationPayload
  ): Promise<{ verified: boolean; plan?: PlanStatus }> {
    const { orderId, paymentId, signature, planId = 'premium_monthly' } = payload;

    const expectedSignature = await computeHmacSha256(this.keySecret, `${orderId}|${paymentId}`);
    const isValid = expectedSignature === signature;

    if (!isValid) {
      return { verified: false };
    }

    const planConfig = this.plans[planId] || this.plans.premium_monthly;
    const orgId = payload.orderId.split('_')[1] || 'default-org';
    const existing = this.orgBalances.get(orgId) || {
      isPremium: false,
      credits: this.freeAllowance,
      planId: 'free',
    };

    const updated = {
      isPremium: true,
      planId,
      credits: existing.credits + planConfig.credits,
    };
    this.orgBalances.set(orgId, updated);

    return {
      verified: true,
      plan: {
        planId,
        isPremium: true,
        creditsRemaining: updated.credits,
        creditsMonthlyAllowance: planConfig.credits,
        features: ['basic_chat', 'search', 'all_tools', 'unlimited_export', 'voice', 'co_browser'],
      },
    };
  }

  async consumeCredits(
    orgId: string,
    amount: number,
    _reason: string
  ): Promise<{ success: boolean; remaining: number }> {
    const current = this.orgBalances.get(orgId) || {
      isPremium: false,
      credits: this.freeAllowance,
      planId: 'free',
    };
    if (current.credits < amount) {
      return { success: false, remaining: current.credits };
    }
    current.credits -= amount;
    this.orgBalances.set(orgId, current);
    return { success: true, remaining: current.credits };
  }
}
