import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { OrgCreditStore } from '../packages/server/src/billing/creditStore.ts';
import { getPlanPriceInr, getPlanPricePaise } from '../packages/server/src/billing/config.ts';
import {
  RazorpayPaymentProvider,
  type FetchedRazorpayPayment,
  type RazorpayClientLike,
} from '../packages/server/src/billing/paymentProvider.ts';
import {
  createPaymentsRouter,
  createPaymentWebhookHandler,
} from '../packages/server/src/routes/payments.ts';
import { loadConfig } from '../packages/server/src/config.ts';
import {
  enqueueOfflineAction,
  isPaymentEndpoint,
  readOfflineQueue,
  replayOfflineQueue,
  type OfflineQueueStorageLike,
} from '../src/lib/network/offlineQueue.ts';
import { NetworkOfflineError, resilientFetch } from '../src/lib/network/resilientFetch.ts';

const FAKE_TEST_KEY_ID = 'rzp_test_unit_key_12345';
const FAKE_TEST_SECRET = 'unit_test_key_secret_abcde12345';
const FAKE_WEBHOOK_SECRET = 'unit_test_webhook_secret_xyz789';

function createMemoryStorage(): OfflineQueueStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function signCheckout(orderId: string, paymentId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

function signWebhook(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function withPaymentServer(
  opts: {
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
    testMode?: boolean;
    rateLimitMaxUser?: number;
    fetchedPaymentOverride?: Partial<FetchedRazorpayPayment>;
  },
  fn: (ctx: { baseUrl: string; creditStore: OrgCreditStore; provider: RazorpayPaymentProvider }) => Promise<void>
): Promise<void> {
  const cfg = loadConfig({
    nodeEnv: 'test',
    razorpayKeyId: opts.keyId ?? FAKE_TEST_KEY_ID,
    razorpayKeySecret: opts.keySecret ?? FAKE_TEST_SECRET,
    razorpayWebhookSecret: opts.webhookSecret ?? FAKE_WEBHOOK_SECRET,
    razorpayTestMode: opts.testMode ?? true,
    rateLimitMaxUser: opts.rateLimitMaxUser ?? 40,
  });

  let orderCounter = 0;
  const createdOrders = new Map<string, { id: string; amount: number; currency: string; receipt: string }>();

  const mockClient: RazorpayClientLike = {
    orders: {
      async create(params) {
        orderCounter += 1;
        const id = `order_mock_${orderCounter}`;
        const record = {
          id,
          amount: params.amount,
          currency: params.currency,
          receipt: params.receipt,
          status: 'created',
        };
        createdOrders.set(id, record);
        return record;
      },
    },
    payments: {
      async fetch(paymentId) {
        const latestOrder = Array.from(createdOrders.values()).at(-1);
        return {
          id: paymentId,
          order_id: opts.fetchedPaymentOverride?.order_id ?? latestOrder?.id ?? 'order_mock_1',
          amount: opts.fetchedPaymentOverride?.amount ?? latestOrder?.amount ?? getPlanPricePaise('monthly'),
          currency: opts.fetchedPaymentOverride?.currency ?? 'INR',
          status: opts.fetchedPaymentOverride?.status ?? 'captured',
          method: opts.fetchedPaymentOverride?.method ?? 'upi',
          captured: true,
        };
      },
    },
  };

  const provider = new RazorpayPaymentProvider(cfg, mockClient);
  const creditStore = new OrgCreditStore(cfg, provider);

  const app = express();
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '2mb' }),
    createPaymentWebhookHandler({ cfg, creditStore, razorpayProvider: provider })
  );
  app.use(express.json());
  app.use('/api/payments', createPaymentsRouter({ cfg, creditStore, razorpayProvider: provider }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn({ baseUrl, creditStore, provider });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test('Payment Security 1: Unauthenticated requests (even with spoofed body.appState) and non-Admin roles are rejected', async () => {
  await withPaymentServer({}, async ({ baseUrl }) => {
    // 1. Unauthenticated with forged body.appState -> 401
    const unauthRes = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interval: 'monthly',
        orgId: 'org-1',
        appState: { role: 'admin', college: { id: 'org-1' } },
      }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Manager -> 403
    const mgrRes = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'demo:SECTOR_MANAGER:mgr-1:dept-fiqh::org-1',
      },
      body: JSON.stringify({ interval: 'monthly', orgId: 'org-1' }),
    });
    assert.equal(mgrRes.status, 403);

    // 3. Student -> 403
    const stuRes = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'demo:STUDENT:S0125:dept-fiqh:S0125:org-1',
      },
      body: JSON.stringify({ interval: 'annual', orgId: 'org-1' }),
    });
    assert.equal(stuRes.status, 403);

    // 4. Cross-org Admin -> 403
    const crossOrgRes = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'demo:ADMIN:admin@org1.edu:::org-1',
      },
      body: JSON.stringify({ interval: 'monthly', orgId: 'org-other' }),
    });
    assert.equal(crossOrgRes.status, 403);
  });
});

test('Payment Security 2: Live key (rzp_live_) is refused while TEST MODE is active', async () => {
  await withPaymentServer(
    { keyId: 'rzp_live_forbidden_in_test', testMode: true },
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/payments/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'demo:ADMIN:admin@org1.edu:::org-1',
        },
        body: JSON.stringify({ interval: 'monthly', orgId: 'org-1' }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { errorCode?: string };
      assert.equal(body.errorCode, 'LIVE_KEY_BLOCKED');
    }
  );
});

test('Payment Flow 3: Create Order ignores tampered client amount, verifies signature + gateway status, activates & extends Premium idempotently', async () => {
  await withPaymentServer({}, async ({ baseUrl, creditStore }) => {
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'demo:ADMIN:admin@org1.edu:::org-1',
    };

    // Pass tampered client amount: 1 — server must ignore and charge server PLAN_PRICING (monthly = 999 INR = 99900 paise)
    const createRes = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ interval: 'monthly', orgId: 'org-1', amount: 1 }),
    });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as {
      orderId: string;
      amount: number;
      amountInr: number;
      currency: string;
      keyId: string;
      testMode: boolean;
    };
    assert.equal(created.amountInr, getPlanPriceInr('monthly'));
    assert.equal(created.amount, getPlanPricePaise('monthly'));
    assert.equal(created.currency, 'INR');
    assert.equal(created.keyId, FAKE_TEST_KEY_ID);
    assert.equal(created.testMode, true);
    // Must NEVER return secret
    assert.equal(JSON.stringify(created).includes(FAKE_TEST_SECRET), false);

    // Invalid signature -> 400 & nothing activated
    const badSigRes = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        razorpay_order_id: created.orderId,
        razorpay_payment_id: 'pay_bad_sig_1',
        razorpay_signature: 'invalid_signature_value',
        orgId: 'org-1',
      }),
    });
    assert.equal(badSigRes.status, 400);
    const stillFree = await creditStore.getStatus('org-1', 'ADMIN');
    assert.equal(stillFree.effectivePlan, 'free');

    // Valid signature -> activates Premium
    const payId1 = 'pay_valid_1';
    const sig1 = signCheckout(created.orderId, payId1, FAKE_TEST_SECRET);
    const verifyRes = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        razorpay_order_id: created.orderId,
        razorpay_payment_id: payId1,
        razorpay_signature: sig1,
        orgId: 'org-1',
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verified1 = (await verifyRes.json()) as {
      ok: boolean;
      alreadyProcessed: boolean;
      extended: boolean;
      status: { effectivePlan: string; premiumExpiresAt: string; planInterval: string };
    };
    assert.equal(verified1.ok, true);
    assert.equal(verified1.alreadyProcessed, false);
    assert.equal(verified1.extended, false);
    assert.equal(verified1.status.effectivePlan, 'premium');
    assert.equal(verified1.status.planInterval, 'monthly');
    const firstExpiryMs = Date.parse(verified1.status.premiumExpiresAt);

    // Re-verifying the same orderId MUST be idempotent and NOT double-extend expiry
    const verifyDupRes = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        razorpay_order_id: created.orderId,
        razorpay_payment_id: payId1,
        razorpay_signature: sig1,
        orgId: 'org-1',
      }),
    });
    assert.equal(verifyDupRes.status, 200);
    const dupJson = (await verifyDupRes.json()) as {
      alreadyProcessed: boolean;
      status: { premiumExpiresAt: string };
    };
    assert.equal(dupJson.alreadyProcessed, true);
    assert.equal(Date.parse(dupJson.status.premiumExpiresAt), firstExpiryMs);

    // Manager & Student automatically unlocked
    const mgrStatus = await creditStore.getStatus('org-1', 'SECTOR_MANAGER', 'mgr-1');
    const stuStatus = await creditStore.getStatus('org-1', 'STUDENT', 'S0125');
    assert.equal(mgrStatus.canUseAssistant, true);
    assert.equal(stuStatus.canUseAssistant, true);

    // Second order while Premium active (annual switch/extension) MUST extend from current expiry!
    const createAnnualRes = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ interval: 'annual', orgId: 'org-1' }),
    });
    const annualOrder = (await createAnnualRes.json()) as { orderId: string; amount: number };
    assert.equal(annualOrder.amount, getPlanPricePaise('annual'));

    const payId2 = 'pay_valid_annual_2';
    const sig2 = signCheckout(annualOrder.orderId, payId2, FAKE_TEST_SECRET);
    const verifyAnnualRes = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        razorpay_order_id: annualOrder.orderId,
        razorpay_payment_id: payId2,
        razorpay_signature: sig2,
        orgId: 'org-1',
      }),
    });
    assert.equal(verifyAnnualRes.status, 200);
    const verified2 = (await verifyAnnualRes.json()) as {
      extended: boolean;
      status: { planInterval: string; premiumExpiresAt: string };
    };
    assert.equal(verified2.extended, true);
    assert.equal(verified2.status.planInterval, 'annual');
    const extendedExpiryMs = Date.parse(verified2.status.premiumExpiresAt);
    // Should be ~1 year beyond firstExpiryMs (at least +360 days after firstExpiryMs)
    assert.ok(extendedExpiryMs - firstExpiryMs > 360 * 24 * 60 * 60 * 1000);

    // History returns paid records + audit logs
    const historyRes = await fetch(`${baseUrl}/api/payments/history?orgId=org-1`, {
      headers: authHeaders,
    });
    assert.equal(historyRes.status, 200);
    const historyJson = (await historyRes.json()) as {
      payments: Array<{ status: string }>;
      auditLogs: Array<{ eventType: string }>;
    };
    assert.equal(historyJson.payments.length, 2);
    assert.ok(historyJson.payments.every((p) => p.status === 'paid'));
    assert.ok(historyJson.auditLogs.some((l) => l.eventType === 'PREMIUM_EXTENDED'));
  });
});

test('Payment Security 4: Verify rejects gateway amount mismatch or uncaptured status', async () => {
  await withPaymentServer(
    { fetchedPaymentOverride: { amount: 100, status: 'captured' } },
    async ({ baseUrl, creditStore }) => {
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: 'demo:ADMIN:admin@org1.edu:::org-mismatch',
      };
      const createRes = await fetch(`${baseUrl}/api/payments/create-order`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ interval: 'monthly', orgId: 'org-mismatch' }),
      });
      const created = (await createRes.json()) as { orderId: string };
      const payId = 'pay_amt_mismatch';
      const sig = signCheckout(created.orderId, payId, FAKE_TEST_SECRET);

      const verifyRes = await fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          razorpay_order_id: created.orderId,
          razorpay_payment_id: payId,
          razorpay_signature: sig,
          orgId: 'org-mismatch',
        }),
      });
      assert.equal(verifyRes.status, 400);
      const body = (await verifyRes.json()) as { errorCode?: string };
      assert.equal(body.errorCode, 'AMOUNT_MISMATCH');
      const status = await creditStore.getStatus('org-mismatch', 'ADMIN');
      assert.equal(status.effectivePlan, 'free');
    }
  );
});

test('Webhook 5: Raw signature verification, unset-secret skip, idempotent activation & failure/refund handling', async () => {
  // Part A: unset webhook secret skips gracefully with 200
  await withPaymentServer({ webhookSecret: '' }, async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'payment.captured' }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { skipped?: boolean };
    assert.equal(json.skipped, true);
  });

  // Part B: valid/invalid signature & idempotent event processing
  await withPaymentServer({ webhookSecret: FAKE_WEBHOOK_SECRET }, async ({ baseUrl, creditStore }) => {
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'demo:ADMIN:admin@wh.edu:::org-wh',
    };
    const createRes = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ interval: 'monthly', orgId: 'org-wh' }),
    });
    const created = (await createRes.json()) as { orderId: string; amount: number };

    const rawCaptured = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_wh_1',
            order_id: created.orderId,
            amount: created.amount,
            currency: 'INR',
            method: 'upi',
            notes: { orgId: 'org-wh', interval: 'monthly' },
          },
        },
      },
    });

    // Reject invalid signature -> 400
    const badWh = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': 'tampered_sig',
        'X-Razorpay-Event-Id': 'evt_wh_1',
      },
      body: rawCaptured,
    });
    assert.equal(badWh.status, 400);

    // Accept valid signature -> activates premium
    const goodSig = signWebhook(rawCaptured, FAKE_WEBHOOK_SECRET);
    const okWh = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': goodSig,
        'X-Razorpay-Event-Id': 'evt_wh_1',
      },
      body: rawCaptured,
    });
    assert.equal(okWh.status, 200);
    const statusAfterWh = await creditStore.getStatus('org-wh', 'ADMIN');
    assert.equal(statusAfterWh.effectivePlan, 'premium');
    const expiry1 = Date.parse(statusAfterWh.premiumExpiresAt!);

    // Replay exact event id -> deduplicated, expiry unchanged
    const dupWh = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': goodSig,
        'X-Razorpay-Event-Id': 'evt_wh_1',
      },
      body: rawCaptured,
    });
    assert.equal(dupWh.status, 200);
    const dupJson = (await dupWh.json()) as { deduplicated?: boolean };
    assert.equal(dupJson.deduplicated, true);
    const statusAfterDup = await creditStore.getStatus('org-wh', 'ADMIN');
    assert.equal(Date.parse(statusAfterDup.premiumExpiresAt!), expiry1);

    // refund.processed marks payment refunded
    const rawRefund = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_1', payment_id: 'pay_wh_1' } },
      },
    });
    const refundRes = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signWebhook(rawRefund, FAKE_WEBHOOK_SECRET),
        'X-Razorpay-Event-Id': 'evt_wh_refund_1',
      },
      body: rawRefund,
    });
    assert.equal(refundRes.status, 200);
    const payments = await creditStore.listPayments('org-wh', 10);
    assert.equal(payments[0]?.status, 'refunded');
  });
});

test('Offline Queue 6: Blocks payment endpoints, persists FIFO order, replays chronologically and clears on success', async () => {
  assert.equal(isPaymentEndpoint('/api/payments/create-order'), true);
  assert.equal(isPaymentEndpoint('/api/payments/verify'), true);
  assert.equal(isPaymentEndpoint('/api/sync/ack'), false);

  const storage = createMemoryStorage();

  // Attempting to enqueue a payment action must throw
  assert.throws(() => {
    enqueueOfflineAction(
      {
        kind: 'http',
        url: '/api/payments/create-order',
        method: 'POST',
        body: { interval: 'monthly' },
        label: 'Upgrade',
      },
      storage
    );
  }, /Payment operations require a live internet connection/);

  // Enqueue two non-payment actions out of chronological timestamp order -> read sorts FIFO
  enqueueOfflineAction(
    {
      kind: 'khazna_sync',
      url: '/api/sync/ack',
      method: 'POST',
      actionType: 'UPDATE_STUDENT',
      body: { id: 'S0125' },
      label: 'Update student',
      createdAt: '2026-11-16T10:00:05.000Z',
      idempotencyKey: 'k-2',
    },
    storage
  );
  enqueueOfflineAction(
    {
      kind: 'khazna_sync',
      url: '/api/sync/ack',
      method: 'POST',
      actionType: 'CREATE_ENTRY',
      body: { amount: 500 },
      label: 'Create entry',
      createdAt: '2026-11-16T10:00:01.000Z',
      idempotencyKey: 'k-1',
    },
    storage
  );

  const queued = readOfflineQueue(storage);
  assert.equal(queued.length, 2);
  assert.equal(queued[0].actionType, 'CREATE_ENTRY');
  assert.equal(queued[1].actionType, 'UPDATE_STUDENT');

  const executedOrder: string[] = [];
  const replayRes = await replayOfflineQueue({
    storage,
    isOnline: () => true,
    executor: async (item) => {
      executedOrder.push(item.actionType || item.id);
      return true;
    },
  });

  assert.equal(replayRes.synced, 2);
  assert.equal(replayRes.remaining, 0);
  assert.deepEqual(executedOrder, ['CREATE_ENTRY', 'UPDATE_STUDENT']);
  assert.equal(readOfflineQueue(storage).length, 0);
});

test('Resilient Fetch 7: Retries transient errors up to maxRetries and never queues payment endpoints offline', async () => {
  let attempts = 0;
  const retryDelays: number[] = [];

  const res = await resilientFetch('https://example.test/api/data', {
    method: 'GET',
    maxRetries: 2,
    baseDelayMs: 5,
    timeoutMs: 2000,
    onRetry: (_attempt, delayMs) => retryDelays.push(delayMs),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(JSON.stringify({ error: 'Upstream busy' }), { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.equal(res.status, 200);
  assert.equal(attempts, 3);
  assert.deepEqual(retryDelays, [5, 10]);

  // Simulate offline navigator on a payment endpoint -> throws NetworkOfflineError
  const origNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  try {
    await assert.rejects(
      () =>
        resilientFetch('/api/payments/create-order', {
          method: 'POST',
          queueIfOffline: true,
          body: JSON.stringify({ interval: 'monthly' }),
        }),
      (err: unknown) => err instanceof NetworkOfflineError
    );
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      configurable: true,
    });
  }
});
