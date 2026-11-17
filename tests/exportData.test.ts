import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { AppProfile, AssistantSseEvent, ExportFilePayload } from '@ai-assistant/core';
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
import {
  clearExportContextMemory,
  exportDataTool,
} from '../packages/server/src/tools/exportTools.ts';
import { generateExportArtifact } from '../packages/widget/src/utils/clientExport.ts';

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
  clearExportContextMemory();
});

async function runAgentTurn(params: {
  profile: AppProfile;
  question: string;
  scope: AccessScope;
  conversationId?: string;
  appState?: Record<string, unknown>;
}) {
  const events: AssistantSseEvent[] = [];
  const llm = createLlmGateway(cfg);
  const actionStore = new ActionLogStore();
  const cache = new ResponseCache(0);

  await runChatAgent({
    profile: params.profile,
    messages: [
      {
        id: `m_${Date.now()}`,
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
    scope: params.scope,
    conversationId: params.conversationId || 'test-conv',
    emit: (ev) => events.push(ev),
  });

  const exportEvent = events.find(
    (e): e is Extract<AssistantSseEvent, { type: 'export_file' }> => e.type === 'export_file'
  );
  const uiAction = events.find((e) => e.type === 'ui_action');
  const chipsEvent = events.find(
    (e): e is Extract<AssistantSseEvent, { type: 'follow_up_chips' }> => e.type === 'follow_up_chips'
  );
  const text = events
    .filter((e): e is Extract<AssistantSseEvent, { type: 'token' }> => e.type === 'token')
    .map((e) => e.delta)
    .join('');

  return { events, exportFile: exportEvent?.exportFile, uiAction, chipsEvent, text };
}

describe('Assistant-generated downloadable exports (export_data)', () => {
  it('filters Fiqh 2 students with pending fees and generates a styled Excel workbook without clicking app UI buttons', async () => {
    const convId = 'conv-fiqh2-pending-xlsx';
    const turn = await runAgentTurn({
      profile: khaznaProfile,
      question: 'give me all Fiqh 2 students with pending fees as Excel',
      scope: adminScope,
      conversationId: convId,
    });

    expect(turn.uiAction).toBeUndefined();
    expect(turn.exportFile).toBeDefined();
    const payload = turn.exportFile!;
    expect(payload.format).toBe('xlsx');
    expect(payload.filename).toMatch(/^.*\.xlsx$/);
    expect(payload.rows.length).toBeGreaterThan(0);
    expect(payload.previewRows.length).toBeLessThanOrEqual(5);

    for (const row of payload.rows) {
      expect(String(row.className)).toBe('Fiqh 2');
      expect(Number(row.pendingFee)).toBeGreaterThan(0);
    }

    const artifact = await generateExportArtifact(payload);
    expect(artifact.uint8.byteLength).toBeGreaterThan(1000);

    // Parse back using ExcelJS to verify bold frozen header and exact rows
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(artifact.uint8) as unknown as ArrayBuffer);
    expect(wb.worksheets.length).toBe(1);
    const sheet = wb.worksheets[0];
    expect(sheet.views[0]?.state).toBe('frozen');
    expect((sheet.views[0] as { ySplit?: number })?.ySplit).toBe(1);

    const headerRow = sheet.getRow(1);
    expect(headerRow.getCell(1).font?.bold).toBe(true);
    expect(sheet.rowCount).toBe(payload.rows.length + 1);
  });

  it('includes ONLY requested columns ("only name and phone") and supports "Same as CSV" follow-up', async () => {
    const convId = 'conv-cols-and-csv-followup';
    const excelTurn = await runAgentTurn({
      profile: khaznaProfile,
      question: 'give me all Fiqh 2 students with only name and phone as Excel',
      scope: adminScope,
      conversationId: convId,
    });

    expect(excelTurn.exportFile).toBeDefined();
    const excelPayload = excelTurn.exportFile!;
    expect(excelPayload.columns.map((c) => c.key)).toEqual(['name', 'phone']);
    expect(excelPayload.columns.map((c) => c.label)).toEqual(['Full Name', 'Phone']);

    const xlsxArtifact = await generateExportArtifact(excelPayload);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xlsxArtifact.uint8) as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    const row1Vals = [sheet.getRow(1).getCell(1).value, sheet.getRow(1).getCell(2).value];
    expect(row1Vals).toEqual(['Full Name', 'Phone']);
    expect(sheet.getRow(1).getCell(3).value).toBeNull();

    // Follow-up in same conversation: "Same as CSV"
    const csvTurn = await runAgentTurn({
      profile: khaznaProfile,
      question: 'Same as CSV',
      scope: adminScope,
      conversationId: convId,
    });

    expect(csvTurn.exportFile).toBeDefined();
    const csvPayload = csvTurn.exportFile!;
    expect(csvPayload.format).toBe('csv');
    expect(csvPayload.columns.map((c) => c.key)).toEqual(['name', 'phone']);
    expect(csvPayload.rows.length).toBe(excelPayload.rows.length);

    const csvArtifact = await generateExportArtifact(csvPayload);
    const csvText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvArtifact.uint8);
    expect(csvText.startsWith('\uFEFF')).toBe(true);
    const parsed = Papa.parse<string[]>(csvText.replace(/^\uFEFF/, ''), { skipEmptyLines: true });
    expect(parsed.data[0]).toEqual(['Full Name', 'Phone']);
    expect(parsed.data.length).toBe(csvPayload.rows.length + 1);
  });

  it('shows a preview and asks once when format is omitted, and handles unsupported formats gracefully', async () => {
    const noFormatTurn = await runAgentTurn({
      profile: khaznaProfile,
      question: 'give me all Fiqh 2 students',
      scope: adminScope,
      conversationId: 'conv-no-format',
    });

    expect(noFormatTurn.exportFile).toBeUndefined();
    expect(noFormatTurn.text).toMatch(/which file format/i);
    expect(noFormatTurn.text).toContain('|');
    expect(noFormatTurn.chipsEvent?.chips.some((c) => /excel/i.test(c.label))).toBe(true);

    const unsupportedTurn = await runAgentTurn({
      profile: khaznaProfile,
      question: 'give me all Fiqh 2 students as Apple Pages',
      scope: adminScope,
      conversationId: 'conv-unsupported',
    });

    expect(unsupportedTurn.exportFile).toBeUndefined();
    expect(unsupportedTurn.text).toMatch(/not supported/i);
    expect(unsupportedTurn.text).toMatch(/Word/i);
  });

  it('generates PDF with embedded Unicode Noto fonts (Latin, Malayalam, Arabic) and page numbers, plus DOCX, JSON, and TXT', async () => {
    const basePayload: Omit<ExportFilePayload, 'format' | 'filename'> = {
      exportId: 'exp_unicode_test',
      title: 'Multilingual Leave & Ledger Report',
      columns: [
        { key: 'id', label: 'ID', format: 'text' },
        { key: 'name', label: 'Name', format: 'text' },
        { key: 'notes', label: 'Notes', format: 'text' },
        { key: 'pendingFee', label: 'Pending Fee', format: 'currency' },
      ],
      rows: [
        { id: 'S0125', name: 'Abdulla M.', notes: 'അബ്ദുള്ള എം. — Fiqh 2', pendingFee: 1500 },
        { id: 'S0126', name: 'Ahmed Ali', notes: 'عبد الله ك. — رسوم مستحقة', pendingFee: 900 },
      ],
      previewRows: [
        { id: 'S0125', name: 'Abdulla M.', notes: 'അബ്ദുള്ള എം. — Fiqh 2', pendingFee: 1500 },
        { id: 'S0126', name: 'Ahmed Ali', notes: 'عبد الله ك. — رسوم مستحقة', pendingFee: 900 },
      ],
      totalRows: 2,
      exportedRows: 2,
      truncated: false,
      rowLimit: 5000,
      generatedAt: '2026-11-16T00:00:00.000Z',
      summaryLine: '2 records, 4 columns',
    };

    const pdfArtifact = await generateExportArtifact({
      ...basePayload,
      format: 'pdf',
      filename: 'multilingual-report.pdf',
    });
    const pdfHeader = new TextDecoder('latin1').decode(pdfArtifact.uint8.slice(0, 8));
    expect(pdfHeader.startsWith('%PDF-')).toBe(true);
    const pdfTextRaw = new TextDecoder('latin1').decode(pdfArtifact.uint8);
    // Verify embedded TrueType fonts rather than Helvetica-only fallback
    expect(pdfTextRaw).toContain('NotoSansMalayalam');
    expect(pdfTextRaw).toContain('NotoNaskhArabic');

    const docxArtifact = await generateExportArtifact({
      ...basePayload,
      format: 'docx',
      filename: 'multilingual-report.docx',
    });
    // DOCX is a valid ZIP archive starting with PK\x03\x04
    expect(docxArtifact.uint8[0]).toBe(0x50);
    expect(docxArtifact.uint8[1]).toBe(0x4b);

    const jsonArtifact = await generateExportArtifact({
      ...basePayload,
      format: 'json',
      filename: 'multilingual-report.json',
    });
    const parsedJson = JSON.parse(new TextDecoder().decode(jsonArtifact.uint8));
    expect(parsedJson.rows).toHaveLength(2);
    expect(parsedJson.rows[0].Name).toBe('Abdulla M.');

    const txtArtifact = await generateExportArtifact({
      ...basePayload,
      format: 'txt',
      filename: 'multilingual-report.txt',
    });
    const txt = new TextDecoder().decode(txtArtifact.uint8);
    expect(txt).toContain('Multilingual Leave & Ledger Report');
    expect(txt).toContain('Abdulla M.');
  });

  it('caps exports at 5,000 rows and sets truncated metadata', async () => {
    const bigRows = Array.from({ length: 5200 }, (_, i) => ({
      id: `R${String(i + 1).padStart(4, '0')}`,
      name: `Student ${i + 1}`,
      pendingFee: 500,
    }));

    const res = await exportDataTool.execute(
      {
        rows: bigRows,
        columns: ['id', 'name', 'pendingFee'],
        format: 'csv',
        title: 'Large Export Cap Test',
      },
      {
        appId: 'khazna-ledger',
        profile: khaznaProfile,
        userId: 'admin-demo',
        authToken: '',
        cfg,
        actionStore: new ActionLogStore(),
        scope: adminScope,
        conversationId: 'conv-cap-5000',
      }
    );

    expect(res.ok).toBe(true);
    expect(res.exportFile).toBeDefined();
    expect(res.exportFile!.totalRows).toBe(5200);
    expect(res.exportFile!.exportedRows).toBe(5000);
    expect(res.exportFile!.truncated).toBe(true);
    expect(res.exportFile!.rows.length).toBe(5000);
    expect(res.exportFile!.previewRows.length).toBe(5);
  });

  it('enforces strict role permissions and never exports sensitive fields', async () => {
    // Student cannot export class/all-student records
    const studentDenied = await runAgentTurn({
      profile: khaznaProfile,
      question: 'give me all Fiqh 2 students with pending fees as Excel',
      scope: studentSafwanScope,
      conversationId: 'conv-student-denied',
    });
    expect(studentDenied.exportFile).toBeUndefined();
    expect(studentDenied.text).toMatch(/don't have access|only export your own/i);

    // Student CAN export their own fee statement
    const studentSelf = await runAgentTurn({
      profile: khaznaProfile,
      question: 'Download my fee statement PDF',
      scope: studentSafwanScope,
      conversationId: 'conv-student-self',
    });
    expect(studentSelf.exportFile).toBeDefined();
    expect(studentSelf.exportFile!.exportedRows).toBe(1);
    expect(studentSelf.exportFile!.rows[0].id).toBe('S0125');

    // Sector Manager cannot export another sector
    const managerCrossSector = await runAgentTurn({
      profile: khaznaProfile,
      question: 'export students in sector dept-civil as Excel',
      scope: managerFiqhScope,
      conversationId: 'conv-mgr-cross-sector',
    });
    expect(managerCrossSector.exportFile).toBeUndefined();
    expect(managerCrossSector.text).toMatch(/don't have access|assigned sector/i);

    // Sensitive fields (password, token, internalId) are stripped even if requested explicitly
    const sensitiveRes = await exportDataTool.execute(
      {
        rows: [
          {
            id: 'S0125',
            name: 'Safwan K.',
            password: 'secret-password',
            token: 'tok-123',
            internalId: 'int-999',
          },
        ],
        columns: ['name', 'password', 'token', 'internalId'],
        format: 'json',
        title: 'Sensitive Strip Check',
      },
      {
        appId: 'khazna-ledger',
        profile: khaznaProfile,
        userId: 'admin-demo',
        authToken: '',
        cfg,
        actionStore: new ActionLogStore(),
        scope: adminScope,
        conversationId: 'conv-sensitive',
      }
    );

    expect(sensitiveRes.ok).toBe(true);
    expect(sensitiveRes.exportFile).toBeDefined();
    const exportedKeys = sensitiveRes.exportFile!.columns.map((c) => c.key);
    expect(exportedKeys).toEqual(['name']);
    expect(sensitiveRes.exportFile!.rows[0]).not.toHaveProperty('password');
    expect(sensitiveRes.exportFile!.rows[0]).not.toHaveProperty('token');
    expect(sensitiveRes.exportFile!.rows[0]).not.toHaveProperty('internalId');
  });

  it('works app-agnostically for Library (second-demo) and Leave Log entity configs', async () => {
    const libraryTurn = await runAgentTurn({
      profile: libraryProfile,
      question: 'export available books as CSV',
      scope: adminScope,
      conversationId: 'conv-library-csv',
      appState: {
        books: [
          {
            id: 'BK-101',
            title: 'Al-Muwatta',
            author: 'Imam Malik',
            isbn: '978-0-111',
            shelf: 'A-12',
            location: 'Floor 1 · Fiqh Wing',
            status: 'available',
          },
          {
            id: 'BK-102',
            title: 'Sahih Al-Bukhari',
            author: 'Imam Bukhari',
            isbn: '978-0-222',
            shelf: 'B-04',
            location: 'Floor 1 · Hadith Wing',
            status: 'checked out',
          },
        ],
      },
    });

    expect(libraryTurn.exportFile).toBeDefined();
    expect(libraryTurn.exportFile!.entityType).toBe('book');
    expect(libraryTurn.exportFile!.rows).toHaveLength(1);
    expect(libraryTurn.exportFile!.rows[0].title).toBe('Al-Muwatta');

    const leaveRes = await exportDataTool.execute(
      {
        entityType: 'leave_request',
        filters: { status: 'approved' },
        format: 'xlsx',
        title: 'Approved Leave Requests',
      },
      {
        appId: 'leave-log',
        profile: { ...khaznaProfile, appId: 'leave-log', displayName: 'Leave Log' },
        userId: 'admin-demo',
        authToken: '',
        cfg,
        actionStore: new ActionLogStore(),
        scope: adminScope,
        conversationId: 'conv-leave-xlsx',
        appState: {
          leaveRequests: [
            {
              id: 'LV-01',
              employeeName: 'Rashid P.',
              department: 'Finance',
              leaveType: 'Casual',
              fromDate: '2026-11-10',
              toDate: '2026-11-12',
              status: 'approved',
            },
            {
              id: 'LV-02',
              employeeName: 'Nabeel K.',
              department: 'IT',
              leaveType: 'Sick',
              fromDate: '2026-11-14',
              toDate: '2026-11-15',
              status: 'pending',
            },
          ],
        },
      }
    );

    expect(leaveRes.ok).toBe(true);
    expect(leaveRes.exportFile).toBeDefined();
    expect(leaveRes.exportFile!.rows).toHaveLength(1);
    expect(leaveRes.exportFile!.rows[0].employeeName).toBe('Rashid P.');
  });
});
