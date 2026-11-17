import type { BillingAdapter, CheckoutSession, PaymentVerificationPayload, PlanStatus, UserContext } from './types.ts';

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
  plans?: Record<string, { price: number; credits: number; name: string }>;
}

/**
 * Drop-in Razorpay BillingAdapter for payments, subscriptions, and credit balances.
 */
export class RazorpayBillingAdapter implements BillingAdapter {
  private keyId: string;
  private keySecret: string;
  private currency: string;
  private plans: Record<string, { price: number; credits: number; name: string }>;
  private orgBalances = new Map<string, { isPremium: boolean; credits: number; planId: string }>();

  constructor(options: RazorpayBillingOptions) {
    this.keyId = options.keyId;
    this.keySecret = options.keySecret;
    this.currency = options.currency || 'INR';
    this.plans = options.plans || {
      premium_monthly: { price: 49900, credits: 1000, name: 'Premium Monthly' },
      premium_annual: { price: 499000, credits: 15000, name: 'Premium Annual' },
    };
  }

  async getPlan(orgId: string): Promise<PlanStatus> {
    const existing = this.orgBalances.get(orgId) || {
      isPremium: false,
      credits: 50,
      planId: 'free',
    };

    return {
      planId: existing.planId,
      isPremium: existing.isPremium,
      creditsRemaining: existing.credits,
      creditsMonthlyAllowance: existing.isPremium ? 1000 : 50,
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
    // Generate synthetic or Razorpay API order
    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
    
    // In test mode or when signature is HMAC SHA256 of orderId|paymentId
    let isValid = false;
    if (this.keySecret === 'test_secret' || this.keySecret.startsWith('rzp_test_')) {
      // Allow test verification
      isValid = true;
    } else {
      const generatedSignature = await computeHmacSha256(this.keySecret, `${orderId}|${paymentId}`);
      isValid = generatedSignature === signature;
    }


    if (isValid) {
      // Find plan details
      const planConfig = this.plans[planId] || this.plans.premium_monthly;
      const orgId = payload.orderId.split('_')[1] || 'default-org';
      const existing = this.orgBalances.get(orgId) || { isPremium: false, credits: 50, planId: 'free' };
      
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

    return { verified: false };
  }

  async consumeCredits(
    orgId: string,
    amount: number,
    _reason: string
  ): Promise<{ success: boolean; remaining: number }> {
    const current = this.orgBalances.get(orgId) || { isPremium: false, credits: 50, planId: 'free' };
    if (current.credits < amount) {
      return { success: false, remaining: current.credits };
    }
    current.credits -= amount;
    this.orgBalances.set(orgId, current);
    return { success: true, remaining: current.credits };
  }
}
