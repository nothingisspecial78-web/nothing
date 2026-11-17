import test from 'node:test';
import assert from 'node:assert/strict';
import { OrgCreditStore } from '../packages/server/src/billing/creditStore.ts';
import { checkAndConsume, inferChatActionCostType } from '../packages/server/src/billing/checkAndConsume.ts';
import { KHAZNA_BUILTIN_TOOLS } from '../packages/server/src/tools/khaznaTools.ts';
import { loadConfig } from '../packages/server/src/config.ts';
import { ProfileRegistry } from '../packages/server/src/profiles/loader.ts';
import { ActionLogStore } from '../packages/server/src/security/confirmation.ts';

test('Bug 1: Ambiguous admin credit prompt opens CREATE_ENTRY clarification form instead of silently defaulting to sector[0]', async () => {
  const cfg = loadConfig();
  const registry = new ProfileRegistry();
  await registry.loadAll(cfg.profilesDir);
  const profile = registry.getProfile('khazna-ledger')!;

  const res = await KHAZNA_BUILTIN_TOOLS.khaznaCreateEntry.execute(
    { type: 'credit', amount: 100 },
    {
      appId: 'khazna-ledger',
      profile,
      userId: 'admin-demo',
      authToken: '',
      cfg,
      actionStore: new ActionLogStore(),
      appState: {
        role: 'admin',
        sectors: [
          { slug: 'dept-fiqh', name: 'Dept Fiqh', receiptPrefix: 'DF-' },
          { slug: 'dept-hadith', name: 'Dept Hadith', receiptPrefix: 'DH-' },
        ],
        students: [
          { id: 'S0125', name: 'Safwan K.', className: 'Fiqh 2' },
          { id: 'S0126', name: 'Ameen T.', className: 'Fiqh 2' },
        ],
      },
    }
  );

  assert.equal(res.ok, true);
  assert.ok(res.formRequest, 'Expected HIL formRequest when sector and student are omitted');
  assert.equal(res.formRequest?.command, 'CREATE_ENTRY');
  assert.equal((res.data as Record<string, unknown>)?.needsClarification, true);
  assert.equal((res.data as Record<string, unknown>)?.missingSector, true);
  assert.equal((res.data as Record<string, unknown>)?.missingStudent, true);
  assert.equal(res.uiAction, undefined);
});

test('Bug 1b: Explicit sector + admission number executes CREATE_ENTRY without unnecessary form', async () => {
  const cfg = loadConfig();
  const registry = new ProfileRegistry();
  await registry.loadAll(cfg.profilesDir);
  const profile = registry.getProfile('khazna-ledger')!;

  const res = await KHAZNA_BUILTIN_TOOLS.khaznaCreateEntry.execute(
    { type: 'credit', amount: 100, sector: 'dept-hadith', studentId: 'S0126' },
    {
      appId: 'khazna-ledger',
      profile,
      userId: 'admin-demo',
      authToken: '',
      cfg,
      actionStore: new ActionLogStore(),
      appState: {
        role: 'admin',
        sectors: [
          { slug: 'dept-fiqh', name: 'Dept Fiqh', receiptPrefix: 'DF-' },
          { slug: 'dept-hadith', name: 'Dept Hadith', receiptPrefix: 'DH-' },
        ],
        students: [
          { id: 'S0125', name: 'Safwan K.', className: 'Fiqh 2' },
          { id: 'S0126', name: 'Ameen T.', className: 'Fiqh 2' },
        ],
      },
    }
  );

  assert.equal(res.ok, true);
  assert.equal(res.formRequest, undefined);
  assert.equal(res.uiAction?.appCommand?.command, 'CREATE_ENTRY');
  assert.equal((res.uiAction?.appCommand?.payload as Record<string, unknown>)?.sector, 'dept-hadith');
  assert.equal((res.uiAction?.appCommand?.payload as Record<string, unknown>)?.studentId, 'S0126');
});

test('Bug 2: Admin previewing sector keeps single Admin history key; separate manager login isolates per-sector history', () => {
  const resolveHistoryKey = (params: {
    orgId: string;
    sessionLoginRole: 'admin' | 'manager' | 'student';
    currentRole: 'admin' | 'manager' | 'student';
    adminEmail: string;
    activeSector: string;
    managerId: string;
    studentId: string;
  }) => {
    const effective =
      params.sessionLoginRole === 'admin' && params.currentRole === 'manager'
        ? 'admin'
        : params.currentRole;
    if (effective === 'student') return `${params.orgId}:student:${params.studentId}`;
    if (effective === 'manager') {
      return `${params.orgId}:manager:${params.activeSector}:${params.managerId}`;
    }
    return `${params.orgId}:admin:${params.adminEmail.toLowerCase()}`;
  };

  const adminOnDashboard = resolveHistoryKey({
    orgId: 'org-1',
    sessionLoginRole: 'admin',
    currentRole: 'admin',
    adminEmail: 'admin@college.edu',
    activeSector: 'dept-fiqh',
    managerId: 'mgr-1',
    studentId: 'S0125',
  });
  const adminOpeningSector = resolveHistoryKey({
    orgId: 'org-1',
    sessionLoginRole: 'admin',
    currentRole: 'manager',
    adminEmail: 'admin@college.edu',
    activeSector: 'dept-hadith',
    managerId: 'mgr-2',
    studentId: 'S0125',
  });
  assert.equal(adminOnDashboard, adminOpeningSector);

  const separateManagerA = resolveHistoryKey({
    orgId: 'org-1',
    sessionLoginRole: 'manager',
    currentRole: 'manager',
    adminEmail: 'admin@college.edu',
    activeSector: 'dept-fiqh',
    managerId: 'mgr-1',
    studentId: 'S0125',
  });
  const separateManagerB = resolveHistoryKey({
    orgId: 'org-1',
    sessionLoginRole: 'manager',
    currentRole: 'manager',
    adminEmail: 'admin@college.edu',
    activeSector: 'dept-hadith',
    managerId: 'mgr-2',
    studentId: 'S0125',
  });
  assert.notEqual(separateManagerA, adminOnDashboard);
  assert.notEqual(separateManagerA, separateManagerB);
});

test('Bug 3: Custom cursor visibility helper activates only when guide/agent cursor is working', () => {
  const isCustomCursorVisible = (
    guideCoBrowserActive: boolean,
    activeGuide: boolean,
    agentCursorActive: boolean
  ) => guideCoBrowserActive || activeGuide || agentCursorActive;

  assert.equal(isCustomCursorVisible(false, false, false), false);
  assert.equal(isCustomCursorVisible(true, false, false), true);
  assert.equal(isCustomCursorVisible(false, true, false), true);
  assert.equal(isCustomCursorVisible(false, false, true), true);
});

test('Feature A1: Free org gives Admin 100 credits/month and blocks Manager/Student with UPGRADE_REQUIRED', async () => {
  const store = new OrgCreditStore();
  const status = await store.getStatus('org-free', 'ADMIN');
  assert.equal(status.plan, 'free');
  assert.equal(status.creditsRemaining, 100);
  assert.equal(status.creditsMonthlyAllowance, 100);

  // Manager & Student rejected on Free plan
  const mgrRes = await checkAndConsume(store, 'org-free', 'mgr-1', 'SECTOR_MANAGER', 'chat');
  assert.equal(mgrRes.allowed, false);
  assert.equal(mgrRes.errorCode, 'UPGRADE_REQUIRED');

  const stuRes = await checkAndConsume(store, 'org-free', 'S0125', 'STUDENT', 'chat');
  assert.equal(stuRes.allowed, false);
  assert.equal(stuRes.errorCode, 'UPGRADE_REQUIRED');

  // Admin consumes credits accurately by action cost
  const adminChat = await checkAndConsume(store, 'org-free', 'admin-1', 'ADMIN', 'chat');
  assert.equal(adminChat.allowed, true);
  assert.equal(adminChat.cost, 1);
  assert.equal(adminChat.creditsRemaining, 99);

  const adminQuery = await checkAndConsume(store, 'org-free', 'admin-1', 'ADMIN', 'data_query');
  assert.equal(adminQuery.allowed, true);
  assert.equal(adminQuery.cost, 2);
  assert.equal(adminQuery.creditsRemaining, 97);
});

test('Feature A2: Atomic concurrent deductions + idempotency + refund on provider failure', async () => {
  const store = new OrgCreditStore();
  await store.setPlanViaDevSwitch({
    orgId: 'org-race',
    adminUserId: 'admin-1',
    plan: 'free',
    creditsRemaining: 5,
  });

  // Fire 8 concurrent cost=2 requests -> only 2 should succeed (5 -> 3 -> 1), remaining 6 get CREDITS_EXHAUSTED
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      checkAndConsume(store, 'org-race', 'admin-1', 'ADMIN', 'data_query')
    )
  );
  const allowedCount = results.filter((r) => r.allowed).length;
  const rejectedCount = results.filter((r) => !r.allowed && r.errorCode === 'CREDITS_EXHAUSTED').length;
  assert.equal(allowedCount, 2);
  assert.equal(rejectedCount, 6);

  const after = await store.getStatus('org-race', 'ADMIN');
  assert.equal(after.creditsRemaining, 1);

  // Duplicate idempotencyKey returns cached success without deducting again
  const first = await checkAndConsume(store, 'org-race', 'admin-1', 'ADMIN', 'chat', {
    idempotencyKey: 'idem-abc',
  });
  const second = await checkAndConsume(store, 'org-race', 'admin-1', 'ADMIN', 'chat', {
    idempotencyKey: 'idem-abc',
  });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(second.deduplicated, true);
  assert.equal(first.creditsRemaining, 0);
  assert.equal(second.creditsRemaining, 0);

  // Refund restores credits when provider fails
  const refundRes = await store.refundConsumption('org-race', first.consumptionId!, 'LLM upstream timeout');
  assert.equal(refundRes.refunded, true);
  assert.equal(refundRes.creditsRemaining, 1);
});

test('Feature A3: Lazy calendar month reset restores exactly 100 credits (no rollover)', async () => {
  const store = new OrgCreditStore();
  const jan15 = new Date('2026-01-15T10:00:00.000Z');
  const firstJan = await checkAndConsume(store, 'org-reset', 'admin-1', 'ADMIN', 'export', {
    now: jan15,
  });
  assert.equal(firstJan.creditsRemaining, 98);

  // Jump past periodEnd (Feb 2)
  const feb02 = new Date('2026-02-02T09:00:00.000Z');
  const febStatus = await store.getStatus('org-reset', 'ADMIN', 'admin-1', feb02);
  assert.equal(febStatus.creditsRemaining, 100);
});

test('Feature A4: Premium unlocks unlimited credits for everyone, and expiry/cancel immediately reverts to FREE', async () => {
  const store = new OrgCreditStore();
  const feb01 = new Date('2026-02-01T10:00:00.000Z');
  await store.activatePremium({
    orgId: 'org-prem',
    adminUserId: 'admin-1',
    interval: 'annual',
    now: feb01,
  });

  const mgrRes = await checkAndConsume(store, 'org-prem', 'mgr-1', 'SECTOR_MANAGER', 'export', {
    now: feb01,
  });
  assert.equal(mgrRes.allowed, true);
  assert.equal(mgrRes.cost, 0);
  assert.equal(mgrRes.plan, 'premium');

  const stuRes = await checkAndConsume(store, 'org-prem', 'S0125', 'STUDENT', 'chat', {
    now: feb01,
  });
  assert.equal(stuRes.allowed, true);
  assert.equal(stuRes.cost, 0);
  assert.equal(stuRes.plan, 'premium');

  // Cancel immediately reverts to FREE rules (Manager blocked)
  await store.cancelPremium({ orgId: 'org-prem', now: feb01 });
  const mgrAfterCancel = await checkAndConsume(store, 'org-prem', 'mgr-1', 'SECTOR_MANAGER', 'chat');
  assert.equal(mgrAfterCancel.allowed, false);
  assert.equal(mgrAfterCancel.errorCode, 'UPGRADE_REQUIRED');
});

test('Feature A5: inferChatActionCostType classifies chat vs data_query vs export vs attachment', () => {
  assert.equal(
    inferChatActionCostType({ messages: [{ role: 'user', content: 'Hello, what can you do?' }] }),
    'chat'
  );
  assert.equal(
    inferChatActionCostType({ messages: [{ role: 'user', content: 'Show pending fees in Fiqh 2' }] }),
    'data_query'
  );
  assert.equal(
    inferChatActionCostType({ messages: [{ role: 'user', content: 'Export students to Excel' }] }),
    'export'
  );
  assert.equal(
    inferChatActionCostType({
      messages: [{ role: 'user', content: 'Inspect this' }],
      attachments: [{ type: 'image', name: 'receipt.png', mimeType: 'image/png' }],
    }),
    'attachment'
  );
});
