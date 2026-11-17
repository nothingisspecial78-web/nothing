import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantSseEvent } from '@ai-assistant/core';
import { OrgCreditStore } from '../packages/server/src/billing/creditStore.ts';
import { checkAndConsume } from '../packages/server/src/billing/checkAndConsume.ts';
import {
  classifyPublicAuthQuery,
  isPublicAuthContext,
  isPublicGuideGoalAllowed,
} from '../packages/server/src/llm/publicGuard.ts';
import { runChatAgent } from '../packages/server/src/llm/agentLoop.ts';
import { loadConfig } from '../packages/server/src/config.ts';
import { ProfileRegistry } from '../packages/server/src/profiles/loader.ts';
import { createEmbedder } from '../packages/server/src/rag/embedder.ts';
import { createVectorStore } from '../packages/server/src/rag/store.ts';
import { ingestAllProfiles } from '../packages/server/src/rag/retriever.ts';
import { createLlmGateway } from '../packages/server/src/llm/client.ts';
import { ToolRegistry } from '../packages/server/src/tools/registry.ts';
import { ActionLogStore } from '../packages/server/src/security/confirmation.ts';
import { ResponseCache } from '../packages/server/src/security/limits.ts';

interface MockSupabaseState {
  tablesMissing: boolean;
  organizations: Map<string, Record<string, unknown>>;
  balances: Map<string, Record<string, unknown>>;
  usageLogs: Array<Record<string, unknown>>;
  subscriptions: Map<string, Record<string, unknown>>;
  operations: string[];
}

function createStatefulMockSupabase(state: MockSupabaseState): SupabaseClient {
  const makeBuilder = (table: string) => {
    const filters: Array<{ op: 'eq' | 'neq' | 'lte'; col: string; val: unknown }> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitNum: number | null = null;
    let pendingAction:
      | { kind: 'select' }
      | { kind: 'upsert'; row: Record<string, unknown>; onConflict?: string }
      | { kind: 'insert'; row: Record<string, unknown> }
      | { kind: 'update'; patch: Record<string, unknown> } = { kind: 'select' };

    const applyFilters = (rows: Array<Record<string, unknown>>) =>
      rows.filter((r) =>
        filters.every((f) => {
          if (f.op === 'eq') return r[f.col] === f.val;
          if (f.op === 'neq') return r[f.col] !== f.val;
          if (f.op === 'lte') return String(r[f.col] || '') <= String(f.val || '');
          return true;
        })
      );

    const exec = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
      if (state.tablesMissing) {
        return {
          data: null,
          error: {
            code: 'PGRST205',
            message: `Could not find the table 'public.${table}' in the schema cache`,
          },
        };
      }

      if (pendingAction.kind === 'upsert') {
        const row = { ...pendingAction.row };
        state.operations.push(`upsert:${table}:${row.id || row.org_id || ''}`);
        if (table === 'organization') {
          state.organizations.set(String(row.id), row);
        } else if (table === 'ai_credit_balance') {
          const orgId = String(row.org_id);
          if (!state.organizations.has(orgId)) {
            return { data: null, error: { code: '23503', message: 'FK organization missing for balance' } };
          }
          state.balances.set(orgId, row);
        } else if (table === 'subscription') {
          const orgId = String(row.org_id);
          if (!state.organizations.has(orgId)) {
            return { data: null, error: { code: '23503', message: 'FK organization missing for subscription' } };
          }
          state.subscriptions.set(String(row.id), row);
        }
        return { data: row, error: null };
      }

      if (pendingAction.kind === 'insert') {
        const row = { ...pendingAction.row };
        state.operations.push(`insert:${table}:${row.id || ''}`);
        if (table === 'ai_usage_log') {
          const orgId = String(row.org_id);
          if (!state.organizations.has(orgId)) {
            return {
              data: null,
              error: {
                code: '23503',
                message: 'insert or update on table "ai_usage_log" violates foreign key constraint',
              },
            };
          }
          state.usageLogs.push(row);
        }
        return { data: row, error: null };
      }

      if (pendingAction.kind === 'update') {
        state.operations.push(`update:${table}`);
        const patch = pendingAction.patch;
        if (table === 'ai_usage_log') {
          for (const row of applyFilters(state.usageLogs)) {
            Object.assign(row, patch);
          }
        } else if (table === 'subscription') {
          for (const row of applyFilters(Array.from(state.subscriptions.values()))) {
            Object.assign(row, patch);
          }
        }
        return { data: null, error: null };
      }

      // Select
      let rows: Array<Record<string, unknown>> = [];
      if (table === 'organization') rows = Array.from(state.organizations.values());
      else if (table === 'ai_credit_balance') rows = Array.from(state.balances.values());
      else if (table === 'ai_usage_log') rows = [...state.usageLogs];
      else if (table === 'subscription') rows = Array.from(state.subscriptions.values());

      let out = applyFilters(rows);
      if (orderCol) {
        const col = orderCol;
        out.sort((a, b) => {
          const va = String(a[col] || '');
          const vb = String(b[col] || '');
          return orderAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }
      if (typeof limitNum === 'number') {
        out = out.slice(0, limitNum);
      }
      return { data: out, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
        pendingAction = { kind: 'upsert', row, onConflict: opts?.onConflict };
        return builder;
      },
      insert: (row: Record<string, unknown>) => {
        pendingAction = { kind: 'insert', row };
        return builder;
      },
      update: (patch: Record<string, unknown>) => {
        pendingAction = { kind: 'update', patch };
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push({ op: 'eq', col, val });
        return builder;
      },
      neq: (col: string, val: unknown) => {
        filters.push({ op: 'neq', col, val });
        return builder;
      },
      lte: (col: string, val: unknown) => {
        filters.push({ op: 'lte', col, val });
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      limit: (n: number) => {
        limitNum = n;
        return builder;
      },
      maybeSingle: async () => {
        const res = await exec();
        if (res.error) return res;
        const arr = Array.isArray(res.data) ? res.data : [];
        return { data: arr[0] ?? null, error: null };
      },
      then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
        exec().then(resolve, reject),
    };
    return builder;
  };

  return {
    from: (table: string) => makeBuilder(table),
  } as unknown as SupabaseClient;
}

test('Public Auth Guard: classifies login, create-org, password-help, and AI assistant features as allowed; blocks everything else', () => {
  assert.equal(isPublicAuthContext({ role: 'PUBLIC', userId: 'guest' }, '/login'), true);
  assert.equal(isPublicAuthContext(undefined, '/super-admin/login'), true);
  assert.equal(isPublicAuthContext({ role: 'ADMIN', userId: 'a', organizationId: 'demo' }, '/admin'), false);

  // Allowed queries
  assert.deepEqual(classifyPublicAuthQuery('How do I sign in to my account?'), {
    allowed: true,
    category: 'auth_help',
  });
  assert.deepEqual(classifyPublicAuthQuery('How do I create a new organization?'), {
    allowed: true,
    category: 'auth_help',
  });
  assert.deepEqual(classifyPublicAuthQuery('Forgot password reset link'), {
    allowed: true,
    category: 'auth_help',
  });
  assert.deepEqual(classifyPublicAuthQuery('What can this AI assistant do and what are its features?'), {
    allowed: true,
    category: 'assistant_features',
  });
  assert.deepEqual(classifyPublicAuthQuery('Hi'), {
    allowed: true,
    category: 'greeting',
  });

  // Blocked workspace & general queries
  assert.equal(classifyPublicAuthQuery('Who is Safwan K and how much does he owe?').allowed, false);
  assert.equal(classifyPublicAuthQuery('Show students with pending fees').allowed, false);
  assert.equal(classifyPublicAuthQuery('Add Rs 100 as credit to S0125').allowed, false);
  assert.equal(classifyPublicAuthQuery('What is the capital of France?').allowed, false);
  assert.equal(classifyPublicAuthQuery('Export student list as Excel').allowed, false);
  assert.equal(classifyPublicAuthQuery('How do I sign in?', { hasAttachments: true }).allowed, false);

  // Guide goal restriction on PUBLIC
  assert.equal(isPublicGuideGoalAllowed('Guide me to log in'), true);
  assert.equal(isPublicGuideGoalAllowed('Guide me to register a new college'), true);
  assert.equal(isPublicGuideGoalAllowed('Guide me to import students'), false);
  assert.equal(isPublicGuideGoalAllowed('Collect fee from student S0125'), false);
});

test('Public Auth Guard: runChatAgent enforces login/signup/assistant-features restriction end-to-end', async () => {
  const cfg = loadConfig({ openRouterApiKey: '', geminiApiKey: '', groqApiKey: '' });
  const profiles = new ProfileRegistry();
  await profiles.loadAll(cfg.profilesDir);
  const profile = profiles.getProfile('khazna-ledger')!;
  const embedder = createEmbedder(cfg);
  const vectorStore = createVectorStore({ ...cfg, vectorStoreMode: 'memory' });
  await ingestAllProfiles({ profiles, embedder, store: vectorStore });
  const llm = createLlmGateway(cfg);
  const toolRegistry = new ToolRegistry();
  const actionStore = new ActionLogStore();
  const cache = new ResponseCache(0);

  const runPublicPrompt = async (prompt: string) => {
    const events: AssistantSseEvent[] = [];
    const tokens: string[] = [];
    const outcome = await runChatAgent({
      profile,
      messages: [{ role: 'user', content: prompt }],
      context: { routePath: '/login' },
      userId: 'guest',
      authToken: '',
      cfg,
      embedder,
      vectorStore,
      llm,
      toolRegistry,
      actionStore,
      cache,
      scope: { role: 'PUBLIC', userId: 'guest' },
      emit: (ev) => {
        events.push(ev);
        if (ev.type === 'token') tokens.push(ev.delta);
      },
    });
    return { outcome, text: tokens.join(''), events };
  };

  // 1. Blocked workspace/general query -> advises sign in or create organization
  const blockedStudent = await runPublicPrompt('List students with pending fees in Fiqh 2');
  assert.equal(blockedStudent.outcome.refusal, true);
  assert.match(blockedStudent.text, /sign in|create an organization/i);

  const blockedGeneral = await runPublicPrompt('What is the capital of Japan?');
  assert.equal(blockedGeneral.outcome.refusal, true);
  assert.match(blockedGeneral.text, /sign in|create an organization/i);

  // 2. Allowed AI Assistant features question
  const features = await runPublicPrompt('What can this AI assistant do?');
  assert.equal(features.outcome.refusal, false);
  assert.match(features.text, /3D|Excel|Malayalam|Credits|Premium/i);

  // 3. Allowed Create Organization / Sign Up question
  const createOrg = await runPublicPrompt('How do I create an organization?');
  assert.equal(createOrg.outcome.refusal, false);
  assert.match(createOrg.text, /Create College/i);
});

test('Supabase Persistence: FK-safe insert order, cold-start hydration, idempotency, refund & PGRST205 recovery', async () => {
  const dbState: MockSupabaseState = {
    tablesMissing: false,
    organizations: new Map(),
    balances: new Map(),
    usageLogs: [],
    subscriptions: new Map(),
    operations: [],
  };
  const mockClient = createStatefulMockSupabase(dbState);

  // 1. Store 1 deducts credits and persists organization BEFORE ai_usage_log (no FK 23503 error!)
  const store1 = new OrgCreditStore(undefined, undefined, mockClient);
  const c1 = await checkAndConsume(store1, 'org-supa', 'admin@college.edu', 'ADMIN', 'chat', {
    idempotencyKey: 'req-1',
  });
  assert.equal(c1.allowed, true);
  assert.equal(c1.creditsRemaining, 99);

  const c2 = await checkAndConsume(store1, 'org-supa', 'admin@college.edu', 'ADMIN', 'data_query', {
    idempotencyKey: 'req-2',
  });
  assert.equal(c2.allowed, true);
  assert.equal(c2.creditsRemaining, 97);

  // Verify organization upsert preceded ai_usage_log insert
  const firstOrgOp = dbState.operations.findIndex((op) => op.startsWith('upsert:organization:org-supa'));
  const firstLogOp = dbState.operations.findIndex((op) => op.startsWith('insert:ai_usage_log:'));
  assert.ok(firstOrgOp >= 0);
  assert.ok(firstLogOp > firstOrgOp, `Expected org upsert before usage insert, got ${dbState.operations.join(' -> ')}`);
  assert.equal(dbState.usageLogs.length, 2);

  // 2. Fresh store instance (simulating server restart / serverless cold start) hydrates credits & logs from DB!
  const store2 = new OrgCreditStore(undefined, undefined, mockClient);
  const status2 = await store2.getStatus('org-supa', 'ADMIN', 'admin@college.edu');
  assert.equal(status2.creditsRemaining, 97);
  assert.equal(status2.persistence?.backend, 'supabase');
  assert.equal(status2.persistence?.schemaReady, true);

  const dbLogs = await store2.fetchUsageLogs('org-supa', 20);
  assert.equal(dbLogs.length, 2);

  // Idempotency survives cold start via DB lookup
  const replay = await checkAndConsume(store2, 'org-supa', 'admin@college.edu', 'ADMIN', 'chat', {
    idempotencyKey: 'req-1',
  });
  assert.equal(replay.allowed, true);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.creditsRemaining, 97);

  // Refund restores credit in DB even from cold-started store2
  const ref = await store2.refundConsumption('org-supa', c2.consumptionId!, 'Upstream error');
  assert.equal(ref.refunded, true);
  assert.equal(ref.creditsRemaining, 99);
  const refundedRow = dbState.usageLogs.find((r) => r.id === c2.consumptionId);
  assert.equal(refundedRow?.refunded, true);

  // 3. Activate & cancel Premium persists subscription rows
  const { subscription } = await store2.activatePremium({
    orgId: 'org-supa',
    adminUserId: 'admin@college.edu',
    interval: 'annual',
  });
  assert.equal(dbState.subscriptions.get(subscription.id)?.status, 'active');
  await store2.cancelPremium({ orgId: 'org-supa' });
  assert.equal(dbState.subscriptions.get(subscription.id)?.status, 'cancelled');

  // 4. PGRST205 missing schema handles fallback gracefully and recovers when tables appear
  const missingState: MockSupabaseState = {
    tablesMissing: true,
    organizations: new Map(),
    balances: new Map(),
    usageLogs: [],
    subscriptions: new Map(),
    operations: [],
  };
  const recoverClient = createStatefulMockSupabase(missingState);
  const storeMissing = new OrgCreditStore(undefined, undefined, recoverClient);
  const beforeSql = await storeMissing.getStatus('org-rec', 'ADMIN');
  assert.equal(beforeSql.creditsRemaining, 100);
  assert.equal(beforeSql.persistence?.backend, 'supabase');
  assert.equal(beforeSql.persistence?.schemaReady, false);

  // Simulate user running 001_billing_credits.sql and retry cooldown passing
  missingState.tablesMissing = false;
  (storeMissing as unknown as { schemaRetryAtMs: number }).schemaRetryAtMs = 0;
  const afterSqlConsume = await checkAndConsume(storeMissing, 'org-rec', 'admin-rec', 'ADMIN', 'chat');
  assert.equal(afterSqlConsume.creditsRemaining, 99);
  assert.equal(missingState.usageLogs.length, 1);
});
