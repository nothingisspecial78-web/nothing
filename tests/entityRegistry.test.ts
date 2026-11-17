import { beforeAll, describe, expect, it } from 'vitest';
import type { AppProfile, AssistantSseEvent } from '@ai-assistant/core';
import {
  khaznaAssistantConfig,
  leaveLogAssistantConfig,
  libraryAssistantConfig,
} from '../assistant.config.ts';
import { loadConfig, type ServerConfig } from '../packages/server/src/config.ts';
import { ProfileRegistry } from '../packages/server/src/profiles/loader.ts';
import { ActionLogStore } from '../packages/server/src/security/confirmation.ts';
import { ResponseCache } from '../packages/server/src/security/limits.ts';
import { InMemoryVectorStore } from '../packages/server/src/rag/store.ts';
import { createEmbedder } from '../packages/server/src/rag/embedder.ts';
import { ingestAppDocs, retrieveForQuery } from '../packages/server/src/rag/retriever.ts';
import { ToolRegistry } from '../packages/server/src/tools/registry.ts';
import { ENTITY_TOOLS } from '../packages/server/src/tools/entityTools.ts';
import {
  getEntityDetails,
  registerEntityConfig,
  searchEntities,
} from '../packages/server/src/entityRegistry/searchEngine.ts';
import { scopedRepository } from '../packages/server/src/db/scopedDataRepository.ts';
import { runChatAgent } from '../packages/server/src/llm/agentLoop.ts';
import { createLlmGateway } from '../packages/server/src/llm/client.ts';
import type { AccessScope } from '../packages/server/src/security/scope.ts';
import { resolveGuideStepDecision } from '../packages/server/src/routes/guideStep.ts';
import { parseJsonSafely } from '../packages/widget/src/utils/safeFetchJson.ts';

let cfg: ServerConfig;
let registry: ProfileRegistry;
let khaznaProfile: AppProfile;
let libraryProfile: AppProfile;
let vectorStore: InMemoryVectorStore;
let embedder: ReturnType<typeof createEmbedder>;
let toolRegistry: ToolRegistry;

const adminScope: AccessScope = {
  role: 'ADMIN',
  userId: 'admin-demo',
  organizationId: 'demo',
};

const managerFiqhScope: AccessScope = {
  role: 'SECTOR_MANAGER',
  userId: 'mgr-fiqh',
  organizationId: 'demo',
  sectorIds: ['dept-fiqh'],
};

const studentSafwanScope: AccessScope = {
  role: 'STUDENT',
  userId: 'S0125',
  studentId: 'S0125',
  organizationId: 'demo',
  sectorId: 'dept-fiqh',
};

beforeAll(async () => {
  cfg = loadConfig({
    openRouterApiKey: '',
    groqApiKey: '',
    geminiApiKey: '',
  });
  registry = new ProfileRegistry();
  await registry.loadAll(cfg.profilesDir);
  khaznaProfile = registry.getProfile('khazna-ledger')!;
  libraryProfile = registry.getProfile('second-demo')!;
  vectorStore = new InMemoryVectorStore();
  embedder = createEmbedder(cfg);
  toolRegistry = new ToolRegistry();

  await ingestAppDocs({
    appId: 'khazna-ledger',
    profiles: registry,
    embedder,
    store: vectorStore,
  });
  await ingestAppDocs({
    appId: 'second-demo',
    profiles: registry,
    embedder,
    store: vectorStore,
  });

  registerEntityConfig(khaznaAssistantConfig);
  registerEntityConfig(libraryAssistantConfig);
  registerEntityConfig(leaveLogAssistantConfig);
});

async function runAgentQuestion(params: {
  profile: AppProfile;
  question: string;
  scope: AccessScope;
  appState?: Record<string, unknown>;
}) {
  const events: AssistantSseEvent[] = [];
  const llm = createLlmGateway(cfg);
  const actionStore = new ActionLogStore();
  const cache = new ResponseCache(0);

  const res = await runChatAgent({
    profile: params.profile,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: params.question,
        createdAt: new Date().toISOString(),
      },
    ],
    appState: params.appState,
    userId: params.scope.userId,
    authToken: '',
    cfg,
    embedder,
    vectorStore,
    llm,
    toolRegistry,
    actionStore,
    cache,
    emit: (e) => events.push(e),
    scope: params.scope,
  });

  const answer = events
    .filter((e): e is Extract<AssistantSseEvent, { type: 'token' }> => e.type === 'token')
    .map((e) => e.delta)
    .join('');

  return { res, events, answer };
}

describe('App-Agnostic Live Entity Lookup & RBAC Security', () => {
  it('as Admin: "who is abdulla" returns both Student Abdulla M. and Principal Abdulla K. with roles, NOT demo credentials', async () => {
    const { answer } = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is abdulla',
      scope: adminScope,
      appState: { activeOrgId: 'demo', role: 'admin' },
    });

    expect(answer).toContain('Abdulla M.');
    expect(answer).toContain('Student');
    expect(answer).toContain('Fiqh 2');
    expect(answer).toContain('S0135');
    expect(answer).toContain('₹3,000');
    expect(answer).toContain('Abdulla K.');
    expect(answer).toContain('Principal');
    expect(answer).toContain('Which one is meant?');
    expect(answer).not.toContain('khazna@2026');
    expect(answer.toLowerCase()).not.toContain('demo credentials');
  });

  it('as Admin: identifies Teacher, Sector Manager, Office Staff, and Union Manager each with correct role labels', async () => {
    const teacherRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is Usthad Ismail Hudawi',
      scope: adminScope,
    });
    expect(teacherRes.answer).toContain('Usthad Ismail Hudawi');
    expect(teacherRes.answer).toContain('Teacher');

    const managerRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is Jaseel Faizy',
      scope: adminScope,
    });
    expect(managerRes.answer).toContain('Jaseel Faizy');
    expect(managerRes.answer).toContain('Sector Manager');

    const staffRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is Abdul Gafoor P.',
      scope: adminScope,
    });
    expect(staffRes.answer).toContain('Abdul Gafoor P.');
    expect(staffRes.answer).toContain('Office Staff');

    const unionRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is Shuhaib Thangal',
      scope: adminScope,
    });
    expect(unionRes.answer).toContain('Shuhaib Thangal');
    expect(unionRes.answer).toContain('Union Manager');
  });

  it('as Student: searching another student or staff returns access denied message', async () => {
    const otherStudent = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is abdulla',
      scope: studentSafwanScope,
      appState: { activeOrgId: 'demo', role: 'student' },
    });
    expect(otherStudent.answer).toBe("You don't have access to that record.");
    expect(otherStudent.answer).not.toContain('S0135');
    expect(otherStudent.answer).not.toContain('ADM-01');

    const sirajRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is siraj',
      scope: studentSafwanScope,
    });
    expect(sirajRes.answer).toBe("You don't have access to that record.");

    const ownRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is Safwan',
      scope: studentSafwanScope,
    });
    expect(ownRes.answer).toContain('Safwan K.');
    expect(ownRes.answer).toContain('S0125');
  });

  it('as Sector Manager: restricts search to assigned sector and denies out-of-sector records', async () => {
    const allowedRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is Safwan',
      scope: managerFiqhScope,
    });
    expect(allowedRes.answer).toContain('Safwan K.');

    // S0128 Rashid P. belongs to dept-civil
    const deniedRes = await runAgentQuestion({
      profile: khaznaProfile,
      question: 'who is rashid',
      scope: managerFiqhScope,
    });
    expect(deniedRes.answer).toBe("You don't have access to that record.");
  });

  it('supports misspelled/phonetic fuzzy matching ("abdullah", "safwaan", "jaseel faizi") and suggests similar names when missing', async () => {
    const cols = scopedRepository.getEntityCollections();

    const abdullahRes = await searchEntities({
      config: khaznaAssistantConfig,
      collections: cols,
      query: 'abdullah',
      scope: adminScope,
    });
    expect(abdullahRes.ok).toBe(true);
    expect(abdullahRes.matches.some((m) => m.name === 'Abdulla M.' && m.type === 'student')).toBe(true);
    expect(abdullahRes.matches.some((m) => m.name === 'Abdulla K.' && m.type === 'principal')).toBe(true);

    const safwaanRes = await searchEntities({
      config: khaznaAssistantConfig,
      collections: cols,
      query: 'safwaan',
      scope: adminScope,
    });
    expect(safwaanRes.matches.some((m) => m.id === 'S0125')).toBe(true);

    const faiziRes = await searchEntities({
      config: khaznaAssistantConfig,
      collections: cols,
      query: 'jaseel faizi',
      scope: adminScope,
    });
    expect(faiziRes.matches.some((m) => m.name === 'Jaseel Faizy' && m.type === 'sector_manager')).toBe(true);

    const unknownRes = await searchEntities({
      config: khaznaAssistantConfig,
      collections: cols,
      query: 'zyxnonexistent99',
      scope: adminScope,
    });
    expect(unknownRes.matches).toHaveLength(0);
    expect(unknownRes.summary).toContain('No record found for "zyxnonexistent99" in this app');
  });

  it('lists both people with their roles when two people share the same name', async () => {
    const customCols = {
      students: [
        {
          id: 'S0991',
          organizationId: 'demo',
          name: 'Rahul Sharma',
          className: 'Fiqh 2',
          sectorId: 'dept-fiqh',
          phone: '+91 98470 77001',
          pendingFee: 1200,
          balance: -1200,
        },
      ],
      teachers: [
        {
          id: 'T099',
          organizationId: 'demo',
          name: 'Rahul Varma',
          department: 'Dept. of Civil',
          subject: 'Environmental Studies',
          sectorId: 'dept-civil',
          phone: '+91 98470 77002',
          email: 'rahul.t@darululoom.edu.in',
        },
      ],
    };

    const res = await searchEntities({
      config: khaznaAssistantConfig,
      collections: customCols,
      query: 'rahul',
      scope: adminScope,
    });

    expect(res.ok).toBe(true);
    expect(res.matches).toHaveLength(2);
    expect(res.summary).toContain('Rahul Sharma');
    expect(res.summary).toContain('[**Student**]');
    expect(res.summary).toContain('Rahul Varma');
    expect(res.summary).toContain('[**Teacher**]');
    expect(res.summary).toContain('Which one is meant?');

    const details = await getEntityDetails({
      config: khaznaAssistantConfig,
      collections: customCols,
      type: 'student',
      id: 'S0991',
      scope: adminScope,
    });
    expect(details.ok).toBe(true);
    expect(details.summary).toContain('Rahul Sharma');
    expect(details.summary).toContain('₹1,200');
  });

  it('works plug-and-play in a Library config (book -> shelf & location) without changing assistant code', async () => {
    const { answer } = await runAgentQuestion({
      profile: libraryProfile,
      question: 'where is book Clean Architecture',
      scope: adminScope,
      appState: {
        activeOrgId: 'demo',
        collections: {
          books: [
            {
              id: 'BK-101',
              organizationId: 'demo',
              title: 'Clean Architecture',
              author: 'Robert C. Martin',
              isbn: '978-0134494166',
              shelf: 'B2',
              location: 'Engineering & CS Wing · Row 4',
              status: 'Available',
              availableCopies: 3,
              totalCopies: 4,
            },
          ],
          shelves: [
            {
              id: 'SH-B2',
              organizationId: 'demo',
              code: 'B2',
              section: 'Software Engineering',
              floor: '2nd Floor',
              location: 'Engineering & CS Wing · Row 4',
            },
          ],
        },
      },
    });

    expect(answer).toContain('Clean Architecture');
    expect(answer).toContain('Book');
    expect(answer).toContain('B2');
    expect(answer).toContain('Engineering & CS Wing · Row 4');
    expect(answer).toContain('978-0134494166');
  });

  it('works plug-and-play in a Leave Log config without changing assistant code and enforces RBAC', async () => {
    const leaveProfile: AppProfile = {
      appId: 'leave-log',
      displayName: 'Staff Leave Log',
      systemPrompt: 'Assistant for Staff Leave Log.',
      languages: ['en'],
      refusalMessage: 'Only leave log topics.',
      retrieval: { topK: 5, minScore: 0.25 },
      tools: ['search_entities', 'get_entity_details'],
      customTools: [],
      templates: [],
      api: { baseUrl: 'http://localhost:3000/api' },
      auth: { mode: 'hybrid' },
      corsOrigins: ['*'],
    };

    const leaveAppState = {
      activeOrgId: 'demo',
      collections: {
        leaveRequests: [
          {
            id: 'LV-204',
            organizationId: 'demo',
            employeeId: 'EMP-44',
            employeeName: 'Arjun Menon',
            department: 'Operations',
            leaveType: 'Annual Leave',
            status: 'Approved',
            fromDate: '2026-11-14',
            toDate: '2026-11-18',
            reason: 'Family function',
            approvedBy: 'Principal Abdulla K.',
          },
        ],
      },
    };

    const adminLeave = await runAgentQuestion({
      profile: leaveProfile,
      question: 'is Arjun on leave',
      scope: adminScope,
      appState: leaveAppState,
    });
    expect(adminLeave.answer).toContain('Arjun Menon');
    expect(adminLeave.answer).toContain('Leave Request');
    expect(adminLeave.answer).toContain('Approved');
    expect(adminLeave.answer).toContain('2026-11-14');

    const deniedEmployee = await runAgentQuestion({
      profile: leaveProfile,
      question: 'is Arjun on leave',
      scope: {
        role: 'STUDENT',
        userId: 'EMP-99',
        studentId: 'EMP-99',
        organizationId: 'demo',
        sectorId: 'Operations',
      },
      appState: leaveAppState,
    });
    expect(deniedEmployee.answer).toBe("You don't have access to that record.");
  });

  it('keeps demo credentials out of entity lookups and isolates them to onboarding queries', async () => {
    const entityRag = await retrieveForQuery({
      profile: khaznaProfile,
      question: 'who is abdulla',
      embedder,
      store: vectorStore,
      scope: adminScope,
      bypassOutOfScopeGuard: true,
    });
    expect(entityRag.chunks.some((c) => c.source.includes('onboarding-demo'))).toBe(false);
    expect(entityRag.chunks.map((c) => c.content).join('\n')).not.toContain('khazna@2026');

    const onboardingRag = await retrieveForQuery({
      profile: khaznaProfile,
      question: 'how do I log in with try demo credentials?',
      embedder,
      store: vectorStore,
      scope: { role: 'PUBLIC', userId: 'public' },
    });
    expect(onboardingRag.chunks.some((c) => c.source.includes('onboarding-demo'))).toBe(true);
  });

  it('handles HTML responses safely in parseJsonSafely and prevents "how to log in" from routing to /admin/audit', async () => {
    const fakeHtmlRes = new Response('<!doctype html><html><body>SPA</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    const parsed = await parseJsonSafely(fakeHtmlRes, 'Guide request failed');
    expect(parsed.isHtml).toBe(true);
    expect(parsed.data).toBeNull();
    expect(parsed.errorMessage).toContain('HTML page instead of JSON');

    const guideDecision = await resolveGuideStepDecision({
      goal: 'how to log in',
      previousStepSummary: '',
      currentRoute: '/login',
      stepNumber: 1,
      pageMap: [
        { id: 'email-input', tag: 'input', type: 'email', label: 'Email', hasValue: false, currentRoute: '/login' },
        { id: 'password-input', tag: 'input', type: 'password', label: 'Password', hasValue: false, currentRoute: '/login' },
        { id: 'sign-in-btn', tag: 'button', type: 'submit', label: 'Sign In', hasValue: false, currentRoute: '/login' },
      ],
      availableRoutes: [
        { route: '/login', label: 'Sign In / Login Page' },
        { route: '/admin/audit', label: 'Audit Logs' },
      ],
    });
    expect(guideDecision.route).not.toBe('/admin/audit');
    expect(['highlight', 'point_and_wait']).toContain(guideDecision.action);
  });
});

// Keep tool exports exercised explicitly
describe('search_entities and get_entity_details tool wrappers', () => {
  it('executes both tools directly with explicit types filter', async () => {
    const res = await ENTITY_TOOLS.search_entities.execute(
      { query: 'abdulla', types: ['principal'] },
      {
        appId: 'khazna-ledger',
        profile: khaznaProfile,
        userId: 'admin-demo',
        authToken: '',
        cfg,
        actionStore: new ActionLogStore(),
        scope: adminScope,
      }
    );
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('Abdulla K.');
    expect(res.summary).not.toContain('S0135');
  });
});
