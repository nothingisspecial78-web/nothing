export interface RazorpaySuccessPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayFailurePayload {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: {
      order_id?: string;
      payment_id?: string;
    };
  };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (resp: RazorpayFailurePayload) => void): void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

export function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay Checkout requires a browser environment.'));
  }
  if (typeof window.Razorpay === 'function') {
    return Promise.resolve();
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          scriptLoadPromise = null;
          reject(new Error('Unable to load Razorpay Checkout script.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => {
      if (typeof window.Razorpay === 'function') {
        resolve();
      } else {
        scriptLoadPromise = null;
        reject(new Error('Razorpay Checkout loaded without constructor.'));
      }
    };
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Failed to load Razorpay Checkout. Please check your internet connection.'));
    };
    document.body.appendChild(script);
  });

  return scriptLoadPromise;
}

export type RazorpayModalOutcome =
  | { status: 'paid'; payload: RazorpaySuccessPayload }
  | { status: 'dismissed' }
  | { status: 'failed'; reason: string; paymentId?: string; orderId?: string };

export async function openRazorpayCheckout(params: {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  appName?: string;
  description: string;
  prefill: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
}): Promise<RazorpayModalOutcome> {
  await loadRazorpayCheckoutScript();
  const RazorpayCtor = window.Razorpay;
  if (!RazorpayCtor) {
    throw new Error('Razorpay Checkout SDK is unavailable.');
  }

  return new Promise<RazorpayModalOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: RazorpayModalOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const isHttps =
      typeof window !== 'undefined' && window.location.protocol === 'https:';

    const options: Record<string, unknown> = {
      key: params.keyId,
      amount: params.amountPaise,
      currency: params.currency,
      order_id: params.orderId,
      name: params.appName || 'Khazna AI',
      description: params.description,
      ...(isHttps ? { image: `${window.location.origin}/apple-touch-icon.png` } : {}),
      prefill: {
        name: params.prefill.name || '',
        email: params.prefill.email || '',
        contact: params.prefill.contact || '',
      },
      notes: params.notes || {},
      theme: {
        color: '#F97316',
      },
      method: {
        upi: true,
        card: true,
        netbanking: true,
        wallet: true,
      },
      config: {
        display: {
          blocks: {
            upi_qr: {
              name: 'UPI QR / GPay / PhonePe / Paytm',
              instruments: [{ method: 'upi' }],
            },
          },
          sequence: ['block.upi_qr'],
          preferences: {
            show_default_blocks: true,
          },
        },
      },
      handler: (response: RazorpaySuccessPayload) => {
        finish({ status: 'paid', payload: response });
      },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          finish({ status: 'dismissed' });
        },
      },
    };

    const instance = new RazorpayCtor(options);
    instance.on('payment.failed', (failure: RazorpayFailurePayload) => {
      const reason =
        failure?.error?.description ||
        failure?.error?.reason ||
        'Payment could not be completed.';
      finish({
        status: 'failed',
        reason,
        paymentId: failure?.error?.metadata?.payment_id,
        orderId: failure?.error?.metadata?.order_id || params.orderId,
      });
    });

    instance.open();
  });
}
