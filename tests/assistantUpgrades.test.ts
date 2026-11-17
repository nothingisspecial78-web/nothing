import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
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
import { ingestAppDocs } from '../packages/server/src/rag/retriever.ts';
import { ToolRegistry } from '../packages/server/src/tools/registry.ts';
import { registerEntityConfig } from '../packages/server/src/entityRegistry/searchEngine.ts';
import { runChatAgent } from '../packages/server/src/llm/agentLoop.ts';
import { createLlmGateway } from '../packages/server/src/llm/client.ts';
import type { AccessScope } from '../packages/server/src/security/scope.ts';
import { clearExportContextMemory } from '../packages/server/src/tools/exportTools.ts';
import {
  clearConversationDatasetMemory,
  getUserRecentActivity,
  recordUserAbandonedForm,
} from '../packages/server/src/tools/datasetState.ts';
import {
  clearSuggestionChipsCache,
  getSuggestionChips,
} from '../packages/server/src/chips/suggestionChips.ts';
import { generateExportArtifact } from '../packages/widget/src/utils/clientExport.ts';

let cfg: ServerConfig;
let registry: ProfileRegistry;
let khaznaProfile: AppProfile;
let vectorStore: InMemoryVectorStore;
let embedder: ReturnType<typeof createEmbedder>;
let toolRegistry: ToolRegistry;

const adminScope: AccessScope = {
  role: 'ADMIN',
  userId: 'admin-demo',
  organizationId: 'demo',
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
  vectorStore = new InMemoryVectorStore();
  embedder = createEmbedder(cfg);
  toolRegistry = new ToolRegistry();

  await ingestAppDocs({
    appId: 'khazna-ledger',
    profiles: registry,
    embedder,
    store: vectorStore,
  });

  registerEntityConfig(khaznaAssistantConfig);
  registerEntityConfig(libraryAssistantConfig);
  registerEntityConfig(leaveLogAssistantConfig);
  clearExportContextMemory();
  clearConversationDatasetMemory();
  clearSuggestionChipsCache();
});

async function runTurn(params: {
  question: string;
  scope: AccessScope;
  conversationId: string;
}) {
  const events: AssistantSseEvent[] = [];
  const llm = createLlmGateway(cfg);
  const actionStore = new ActionLogStore();
  const cache = new ResponseCache(0);

  await runChatAgent({
    profile: khaznaProfile,
    messages: [
      {
        id: `u_${Date.now()}`,
        role: 'user',
        content: params.question,
        createdAt: new Date().toISOString(),
      },
    ],
    userId: params.scope.userId,
    authToken: '',
    cfg,
    embedder,
    vectorStore,
    llm,
    toolRegistry,
    actionStore,
    cache,
    scope: params.scope,
    conversationId: params.conversationId,
    emit: (ev) => events.push(ev),
  });

  const exportEvent = events.find(
    (e): e is Extract<AssistantSseEvent, { type: 'export_file' }> => e.type === 'export_file'
  );
  const chipsEvent = events.find(
    (e): e is Extract<AssistantSseEvent, { type: 'follow_up_chips' }> => e.type === 'follow_up_chips'
  );
  const text = events
    .filter((e): e is Extract<AssistantSseEvent, { type: 'token' }> => e.type === 'token')
    .map((e) => e.delta)
    .join('');

  return { events, exportFile: exportEvent?.exportFile, chipsEvent, text };
}

describe('Upgraded Khazna Assistant: Intent parsing, Follow-ups & Conversation Export Card', () => {
  it('handles "give the list of net worth minus" with ONLY negative balance rows, Due-only columns, follow-up refinement, and "download this given data as excel file"', async () => {
    const convId = 'conv-net-worth-minus-e2e';

    // 1. Initial query: "give the list of net worth minus"
    const t1 = await runTurn({
      question: 'give the list of net worth minus',
      scope: adminScope,
      conversationId: convId,
    });

    expect(t1.exportFile).toBeDefined();
    const keys1 = t1.exportFile!.columns.map((c) => c.key);
    expect(keys1).toEqual(['id', 'name', 'className', 'pendingFee']);
    expect(keys1).not.toContain('debitTotal');
    expect(keys1).not.toContain('paidTotal');

    expect(t1.exportFile!.rows.length).toBeGreaterThan(0);
    for (const row of t1.exportFile!.rows) {
      expect(Number(row.pendingFee)).toBeGreaterThan(0);
    }
    expect(t1.text).toMatch(/negative balance/i);
    expect(t1.text).toContain('|');

    // 2. Follow-up column addition: "add phone number"
    const t2 = await runTurn({
      question: 'add phone number',
      scope: adminScope,
      conversationId: convId,
    });
    expect(t2.exportFile).toBeDefined();
    expect(t2.exportFile!.columns.map((c) => c.key)).toEqual([
      'id',
      'name',
      'className',
      'pendingFee',
      'phone',
    ]);
    expect(t2.exportFile!.rows.length).toBe(t1.exportFile!.rows.length);

    // 3. Follow-up filter refinement: "only Fiqh 2"
    const t3 = await runTurn({
      question: 'only Fiqh 2',
      scope: adminScope,
      conversationId: convId,
    });
    expect(t3.exportFile).toBeDefined();
    expect(t3.exportFile!.rows.length).toBeGreaterThan(0);
    expect(t3.exportFile!.rows.length).toBeLessThanOrEqual(t1.exportFile!.rows.length);
    for (const row of t3.exportFile!.rows) {
      expect(String(row.className)).toBe('Fiqh 2');
    }

    // 4. Explicit follow-up download: "can you download this given data as excel file"
    const t4 = await runTurn({
      question: 'can you download this given data as excel file',
      scope: adminScope,
      conversationId: convId,
    });

    expect(t4.text).not.toMatch(/There is no previous dataset/i);
    expect(t4.exportFile).toBeDefined();
    expect(t4.exportFile!.format).toBe('xlsx');
    expect(t4.exportFile!.rows.length).toBe(t3.exportFile!.rows.length);
    expect(t4.exportFile!.columns.map((c) => c.key)).toEqual(
      t3.exportFile!.columns.map((c) => c.key)
    );

    // Verify all 4 formats (Excel, PDF with Noto fonts, CSV, DOCX) work directly from the ExportCard payload!
    const xlsxArt = await generateExportArtifact({ ...t4.exportFile!, format: 'xlsx' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xlsxArt.uint8) as unknown as ArrayBuffer);
    expect(wb.worksheets[0].rowCount).toBe(t3.exportFile!.rows.length + 1);

    const csvArt = await generateExportArtifact({
      ...t4.exportFile!,
      format: 'csv',
      filename: t4.exportFile!.filename.replace(/\.xlsx$/, '.csv'),
    });
    const csvParsed = Papa.parse<string[]>(
      new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvArt.uint8).replace(/^\uFEFF/, ''),
      { skipEmptyLines: true }
    );
    expect(csvParsed.data.length).toBe(t3.exportFile!.rows.length + 1);

    const pdfArt = await generateExportArtifact({
      ...t4.exportFile!,
      format: 'pdf',
      filename: t4.exportFile!.filename.replace(/\.xlsx$/, '.pdf'),
    });
    const pdfRaw = new TextDecoder('latin1').decode(pdfArt.uint8);
    expect(pdfRaw.startsWith('%PDF-')).toBe(true);
    expect(pdfRaw).toContain('NotoSansMalayalam');
    expect(pdfRaw).toContain('NotoNaskhArabic');

    const docxArt = await generateExportArtifact({
      ...t4.exportFile!,
      format: 'docx',
      filename: t4.exportFile!.filename.replace(/\.xlsx$/, '.docx'),
    });
    expect(docxArt.uint8[0]).toBe(0x50);
    expect(docxArt.uint8[1]).toBe(0x4b);
  });

  it('reuses USER_LATEST_DATASET when user asks "can you download this given data as excel file" from a fresh conversation ID under same user scope', async () => {
    const convA = 'conv-user-fallback-a';
    const convB = 'conv-user-fallback-b';

    const t1 = await runTurn({
      question: 'give the list of net worth minus',
      scope: adminScope,
      conversationId: convA,
    });
    expect(t1.exportFile).toBeDefined();

    const t2 = await runTurn({
      question: 'can you download this given data as excel file',
      scope: adminScope,
      conversationId: convB,
    });
    expect(t2.text).not.toMatch(/There is no previous dataset/i);
    expect(t2.exportFile).toBeDefined();
    expect(t2.exportFile!.rows.length).toBe(t1.exportFile!.rows.length);
  });

  it('enforces RBAC on "net worth minus" queries for STUDENT role and updates Personal chip after abandoned HIL form', async () => {
    const denied = await runTurn({
      question: 'give the list of net worth minus',
      scope: studentSafwanScope,
      conversationId: 'conv-student-networth-denied',
    });
    expect(denied.exportFile).toBeUndefined();
    expect(denied.text).toMatch(/don't have access|only/i);

    recordUserAbandonedForm({
      appId: 'khazna-ledger',
      scope: adminScope,
      userId: adminScope.userId,
      formType: 'khaznaCreateEntry',
      title: 'Record Fee Deposit',
      prompt: 'Record a fee deposit',
    });
    const recent = getUserRecentActivity('khazna-ledger', adminScope, adminScope.userId);
    const chipsRes = getSuggestionChips(
      { userId: adminScope.userId, role: 'ADMIN', scope: adminScope },
      { pathname: '/admin/students' },
      recent,
      { appId: 'khazna-ledger', config: khaznaAssistantConfig, bypassCache: true }
    );
    expect(chipsRes.chips).toHaveLength(3);
    expect(chipsRes.chips[0].slot).toBe('personal');
    expect(chipsRes.chips[0].label).toMatch(/Resume: Record Fee Deposit/);
  });
});
