import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppProfile, AssistantSseEvent } from '@ai-assistant/core';
import { loadConfig } from '../packages/server/src/config.ts';
import { ProfileRegistry } from '../packages/server/src/profiles/loader.ts';
import { OrgCreditStore } from '../packages/server/src/billing/creditStore.ts';
import { ActionLogStore } from '../packages/server/src/security/confirmation.ts';
import { ResponseCache } from '../packages/server/src/security/limits.ts';
import { createEmbedder } from '../packages/server/src/rag/embedder.ts';
import { createVectorStore } from '../packages/server/src/rag/store.ts';
import { createLlmGateway } from '../packages/server/src/llm/client.ts';
import { ToolRegistry } from '../packages/server/src/tools/registry.ts';
import { shouldCompressHttpResponse } from '../packages/server/src/routes/chat.ts';
import {
  formatBillingStatusReply,
  isBillingStatusQuestion,
  runChatAgent,
} from '../packages/server/src/llm/agentLoop.ts';
import { resolveGuideStepDecision } from '../packages/server/src/routes/guideStep.ts';
import { useKhazna } from '../src/lib/khazna/store.ts';

let khaznaProfile: AppProfile;

beforeAll(async () => {
  const cfg = loadConfig();
  const registry = new ProfileRegistry();
  await registry.loadAll(cfg.profilesDir);
  khaznaProfile = registry.getProfile('khazna-ledger')!;
});

describe('Problem 1: Progressive scroll loading & page-change state', () => {
  it('routes use ScrollLoadFooter instead of Pager and m.$sectorSlug / admin guards handle admin sector previews', () => {
    const primitivesSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/khazna/primitives.tsx'),
      'utf8'
    );
    const studentsSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/routes/admin.students.index.tsx'),
      'utf8'
    );
    const auditSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/routes/admin.audit.tsx'),
      'utf8'
    );
    const ledgerSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/routes/m.$sectorSlug.ledger.tsx'),
      'utf8'
    );
    const sectorGuardSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/routes/m.$sectorSlug.tsx'),
      'utf8'
    );
    const adminGuardSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/routes/admin.tsx'),
      'utf8'
    );

    expect(primitivesSrc).toContain('export function useProgressiveSlice');
    expect(primitivesSrc).toContain('export function ScrollLoadFooter');
    expect(studentsSrc).not.toContain('<Pager');
    expect(auditSrc).not.toContain('<Pager');
    expect(ledgerSrc).not.toContain('<Pager');
    expect(ledgerSrc).toContain('setFilterType("all")');
    expect(sectorGuardSrc).toContain('st.sessionLoginRole === "admin"');
    expect(adminGuardSrc).toContain('st.sessionLoginRole === "admin"');
  });

  it('preserves sessionLoginRole="admin" across sector preview role switches', () => {
    const st = useKhazna.getState();
    st.setSessionLoginRole('admin');
    st.setCurrentRole('admin');
    st.setManagerSector('dept-civil');
    st.setCurrentRole('manager');

    expect(useKhazna.getState().currentRole).toBe('manager');
    expect(useKhazna.getState().managerSector).toBe('dept-civil');
    expect(useKhazna.getState().sessionLoginRole).toBe('admin');

    st.setCurrentRole('admin');
    expect(useKhazna.getState().currentRole).toBe('admin');
    expect(useKhazna.getState().sessionLoginRole).toBe('admin');
  });
});

describe('Problem 2: AI Agent avatar visibility & WebGL recovery', () => {
  it('avoids strict CSS containment, avoids dual 2D+WebGL canvas reuse, and handles webglcontextlost', () => {
    const stylesSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/widget/src/styles.ts'),
      'utf8'
    );
    const avatarSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/widget/src/components/AssistantAvatar3D.tsx'),
      'utf8'
    );
    const guideCtrlSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/widget/src/guide/GuideAvatarController.ts'),
      'utf8'
    );

    expect(stylesSrc).not.toContain('contain: strict');
    expect(stylesSrc).toContain('contain: layout style');

    expect(avatarSrc).toContain('webglcontextlost');
    expect(avatarSrc).toContain('render2DFrame(true)');
    expect(avatarSrc).toContain('// Render first WebGL frame before swapping out the 2D fallback canvas');

    expect(guideCtrlSrc).toContain('const glCanvas = document.createElement(\'canvas\')');
    expect(guideCtrlSrc).toContain('webglcontextlost');
    expect(guideCtrlSrc).toContain('swapToFresh2DCanvas');
  });
});

describe('Problem 3: Fast Guide step resolution without slow hangs', () => {
  it('fast-paths step >= 2 deterministic form inputs without calling slow external LLM', async () => {
    let fetchCalls = 0;
    const slowFetch: typeof fetch = async () => {
      fetchCalls += 1;
      return new Promise<Response>(() => {
        // Never resolves
      });
    };

    const start = Date.now();
    const decision = await resolveGuideStepDecision({
      goal: 'Add student',
      previousStepSummary: 'clicked students-add-button',
      currentRoute: '/admin/students',
      stepNumber: 2,
      confirmedPath: true,
      openRouterApiKey: 'test-key-should-be-bypassed',
      timeoutMs: 12000,
      fetchImpl: slowFetch,
      pageMap: [
        {
          id: 'student-drawer-name-input',
          tag: 'input',
          type: 'text',
          label: 'Full Name *',
          hasValue: false,
          currentRoute: '/admin/students',
        },
        {
          id: 'student-drawer-submit-btn',
          tag: 'button',
          type: 'submit',
          label: 'Add student',
          hasValue: false,
          sensitive: true,
          currentRoute: '/admin/students',
        },
      ],
    });

    const elapsed = Date.now() - start;
    expect(fetchCalls).toBe(0);
    expect(elapsed).toBeLessThan(200);
    expect(decision.action).toBe('point_and_wait');
    expect(decision.targetId).toBe('student-drawer-name-input');
    expect(decision.provider).toBe('deterministic-fast-path');
  });

  it('bounds step 1 stalled LLM timeout instead of hanging for 12s', async () => {
    const stalledFetch: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    const start = Date.now();
    const decision = await resolveGuideStepDecision({
      goal: 'how to log in',
      previousStepSummary: '',
      currentRoute: '/login',
      stepNumber: 1,
      openRouterApiKey: 'test-key-stalled',
      timeoutMs: 850,
      fetchImpl: stalledFetch,
      pageMap: [
        {
          id: 'email-input',
          tag: 'input',
          type: 'email',
          label: 'Email',
          hasValue: false,
          currentRoute: '/login',
        },
      ],
    });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(decision.provider).toBe('deterministic-dom-fallback');
  });
});

describe('Problem 4: SSE compression bypass & verified org billing replies', () => {
  it('skips HTTP compression on /api/chat and text/event-stream responses', () => {
    expect(
      shouldCompressHttpResponse({ path: '/api/chat' }, { getHeader: () => undefined })
    ).toBe(false);
    expect(
      shouldCompressHttpResponse(
        { originalUrl: '/api/chat?v=1' },
        { getHeader: () => 'application/json' }
      )
    ).toBe(false);
    expect(
      shouldCompressHttpResponse(
        { path: '/api/other' },
        { getHeader: () => 'text/event-stream; charset=utf-8' }
      )
    ).toBe(false);
    expect(
      shouldCompressHttpResponse(
        { path: '/api/profiles' },
        { getHeader: () => 'application/json' }
      )
    ).toBe(true);
  });

  it('detects plan/credit status questions without hijacking guide/upgrade prompts', () => {
    expect(isBillingStatusQuestion('is it my account is premium')).toBe(true);
    expect(isBillingStatusQuestion('am i on free or premium?')).toBe(true);
    expect(isBillingStatusQuestion('how many credits left')).toBe(true);
    expect(isBillingStatusQuestion('how do I upgrade to premium')).toBe(false);
    expect(isBillingStatusQuestion('guide me to cancel my plan')).toBe(false);
  });

  it('returns accurate Free and Premium status replies from OrgCreditStore in runChatAgent', async () => {
    const cfg = loadConfig();
    const embedder = createEmbedder(cfg);
    const vectorStore = createVectorStore(cfg);
    const llm = createLlmGateway(cfg);
    const toolRegistry = new ToolRegistry();
    const actionStore = new ActionLogStore();
    const cache = new ResponseCache(cfg.responseCacheTtlMs);
    const creditStore = new OrgCreditStore();

    // 1. Default org is Free (100 credits/month)
    const freeSnap = await creditStore.getStatus('org_alpha', 'ADMIN', 'admin@alpha.edu');
    expect(freeSnap.effectivePlan).toBe('free');
    expect(formatBillingStatusReply(freeSnap, 'en')).toContain('**Free** plan');

    const freeEvents: AssistantSseEvent[] = [];
    await runChatAgent({
      profile: khaznaProfile,
      messages: [{ id: 'u1', role: 'user', content: 'is it my account is premium' }],
      userId: 'admin@alpha.edu',
      authToken: '',
      cfg,
      embedder,
      vectorStore,
      llm,
      toolRegistry,
      actionStore,
      cache,
      creditStore,
      scope: {
        role: 'ADMIN',
        userId: 'admin@alpha.edu',
        organizationId: 'org_alpha',
      },
      emit: (ev) => freeEvents.push(ev),
    });

    const freeReply = freeEvents
      .filter((e): e is Extract<AssistantSseEvent, { type: 'token' }> => e.type === 'token')
      .map((e) => e.delta)
      .join('');
    expect(freeReply).toContain('**Free** plan');
    expect(freeReply).toContain('100 of 100');

    // 2. Upgrade org to Premium -> Assistant immediately reflects Premium Unlimited
    await creditStore.activatePremium({
      orgId: 'org_alpha',
      adminUserId: 'admin@alpha.edu',
      interval: 'annual',
    });

    const premEvents: AssistantSseEvent[] = [];
    await runChatAgent({
      profile: khaznaProfile,
      messages: [{ id: 'u2', role: 'user', content: 'is it my account is premium' }],
      userId: 'admin@alpha.edu',
      authToken: '',
      cfg,
      embedder,
      vectorStore,
      llm,
      toolRegistry,
      actionStore,
      cache,
      creditStore,
      scope: {
        role: 'ADMIN',
        userId: 'admin@alpha.edu',
        organizationId: 'org_alpha',
      },
      emit: (ev) => premEvents.push(ev),
    });

    const premReply = premEvents
      .filter((e): e is Extract<AssistantSseEvent, { type: 'token' }> => e.type === 'token')
      .map((e) => e.delta)
      .join('');
    expect(premReply).toContain('**Premium** plan');
    expect(premReply).toContain('Unlimited');

    // 3. PUBLIC visitor on /login is never shown any org's plan details
    const publicEvents: AssistantSseEvent[] = [];
    const publicOutcome = await runChatAgent({
      profile: khaznaProfile,
      messages: [{ id: 'u3', role: 'user', content: 'is it my account is premium' }],
      appState: { pathname: '/login', role: 'public' },
      userId: 'guest',
      authToken: '',
      cfg,
      embedder,
      vectorStore,
      llm,
      toolRegistry,
      actionStore,
      cache,
      creditStore,
      scope: {
        role: 'PUBLIC',
        userId: 'guest',
      },
      emit: (ev) => publicEvents.push(ev),
    });
    expect(publicOutcome.refusal).toBe(true);
    expect(publicOutcome.model).toBe('public-auth-guard');
  });
});
