import { z } from 'zod';
import {
  DEFAULT_IMPORT_BATCH_SIZE,
  type AppProfile,
  type DeclarativeToolDefinition,
} from '@ai-assistant/core';
import type { AccessScope } from '../security/scope.ts';
import { appInternalFetch, resolveAppBaseUrl } from '../auth.ts';
import { KHAZNA_BUILTIN_TOOLS } from './khaznaTools.ts';
import { DATA_ACCESS_TOOLS } from './dataAccessTools.ts';
import { ENTITY_TOOLS } from './entityTools.ts';
import { EXPORT_TOOLS } from './exportTools.ts';
import { GUIDE_TOOLS } from './guideTools.ts';
import { QUERY_TOOLS } from './queryTools.ts';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './types.ts';

async function callConnectedAppApi(
  ctx: ToolExecutionContext,
  path: string,
  method: string,
  body?: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const base = resolveAppBaseUrl(ctx.profile.api.baseUrl, ctx.cfg.port, ctx.appId).replace(/\/$/, '');
  const relativePath = path.replace(/^\/+/, '');
  const targetUrl = new URL(relativePath, `${base}/`);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-app-id': ctx.appId,
  };
  if (ctx.authToken) {
    headers.Authorization = `Bearer ${ctx.authToken}`;
  }

  const res = await appInternalFetch(targetUrl, {
    method,
    headers,
    body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const errMsg = typeof parsed.error === 'string' ? parsed.error : `App API returned HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return { status: res.status, data: parsed };
}

function normalizeFundingChoice(
  raw: string | undefined
): 'Student Fees' | 'Charity' | 'Government Grant' | 'Endowment' {
  const lower = (raw || '').toLowerCase().trim();
  if (lower.includes('charity')) return 'Charity';
  if (lower.includes('grant') || lower.includes('govt') || lower.includes('government')) {
    return 'Government Grant';
  }
  if (lower.includes('endowment')) return 'Endowment';
  return 'Student Fees';
}

function makeDefaultEmail(fullName: string): string {
  const slug = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32);
  return `${slug || 'student'}@campus.edu`;
}

function makeNextAdmissionNo(existingStudents: Array<Record<string, unknown>>): string {
  let maxSeq = 104;
  for (const stu of existingStudents) {
    const adm = String(stu.admissionNo || '');
    const m = /CF-\d{4}-(\d+)/i.exec(adm);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n) && n >= maxSeq && n < 200) {
        maxSeq = n;
      }
    }
  }
  const candidate = (seq: number) => `CF-2026-${String(seq).padStart(3, '0')}`;
  let next = maxSeq + 1;
  while (existingStudents.some((s) => String(s.admissionNo || '').toUpperCase() === candidate(next))) {
    next += 1;
  }
  return candidate(next);
}

const listStudentsTool: ToolDefinition = {
  name: 'listStudents',
  description: 'List enrolled students in College Finance, optionally filtered by sectorCode or search query.',
  risk: 'read',
  inputSchema: z.object({
    query: z.string().optional(),
    sectorCode: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional student name or admission number filter' },
      sectorCode: { type: 'string', description: 'Optional sector code filter e.g. ENG, SCI' },
    },
  },
  summarize: (args) =>
    `List students${args.sectorCode ? ` in sector ${args.sectorCode}` : ''}${args.query ? ` matching "${args.query}"` : ''}`,
  async execute(args, ctx) {
    const params = new URLSearchParams();
    if (typeof args.query === 'string' && args.query) params.set('q', args.query);
    if (typeof args.sectorCode === 'string' && args.sectorCode) params.set('sector', args.sectorCode);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const { data } = await callConnectedAppApi(ctx, `/students${qs}`, 'GET');
    const list = Array.isArray(data.students) ? data.students : [];
    return {
      ok: true,
      summary: `Retrieved ${list.length} student record(s).`,
      data,
    };
  },
};

const getFinanceOverviewTool: ToolDefinition = {
  name: 'getFinanceOverview',
  description:
    'Retrieve live College Finance KPIs, active sectors, fund pools, and student totals.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: {
    type: 'object',
    properties: {},
  },
  summarize: () => 'Retrieve College Finance overview, sectors, and fund sources',
  async execute(_args, ctx) {
    const [overviewRes, sectorsRes, fundsRes, studentsRes] = await Promise.all([
      callConnectedAppApi(ctx, '/overview', 'GET'),
      callConnectedAppApi(ctx, '/sectors', 'GET'),
      callConnectedAppApi(ctx, '/funds', 'GET'),
      callConnectedAppApi(ctx, '/students', 'GET'),
    ]);
    return {
      ok: true,
      summary: 'Retrieved College Finance overview, sectors, and fund sources.',
      data: {
        overview: overviewRes.data,
        sectors: sectorsRes.data.sectors || [],
        funds: fundsRes.data.funds || [],
        students: studentsRes.data.students || [],
      },
    };
  },
};

const addStudentTool: ToolDefinition = {
  name: 'addStudent',
  description:
    'Enroll a new student into College Finance immediately and update the live Student Fee Directory. Auto-generates admission number or campus email if omitted, and matches sector/union automatically.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    fullName: z.string().min(2).max(120),
    admissionNo: z.string().optional(),
    email: z.string().optional(),
    sectorCode: z.string().optional(),
    unionName: z.string().optional(),
    fundingOption: z.string().optional(),
    feeAmount: z.coerce.number().min(0).optional(),
    markPaid: z.boolean().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      fullName: { type: 'string', description: 'Student full name (e.g. Kiran Verma)' },
      admissionNo: {
        type: 'string',
        description: 'Optional admission number (e.g. CF-2026-108). Auto-generated if omitted.',
      },
      email: {
        type: 'string',
        description: 'Optional student email address. Auto-generated if omitted.',
      },
      sectorCode: {
        type: 'string',
        description: 'Sector code (e.g. ENG, SCI, COM, ART). Defaults to ENG.',
      },
      unionName: { type: 'string', description: 'Optional student union name' },
      fundingOption: {
        type: 'string',
        enum: ['Student Fees', 'Charity', 'Government Grant', 'Endowment'],
        description: 'Funding option for the student',
      },
      feeAmount: { type: 'number', description: 'Assessed fee amount (defaults to 42000)' },
      markPaid: { type: 'boolean', description: 'Set to true if the fee is already paid' },
    },
    required: ['fullName'],
  },
  summarize: (args) =>
    `Enroll student ${args.fullName}${args.sectorCode ? ` (${String(args.sectorCode).toUpperCase()})` : ''}`,
  async execute(args, ctx) {
    const [studentsRes, sectorsRes] = await Promise.all([
      callConnectedAppApi(ctx, '/students', 'GET'),
      callConnectedAppApi(ctx, '/sectors', 'GET'),
    ]);
    const existingStudents = Array.isArray(studentsRes.data.students)
      ? (studentsRes.data.students as Array<Record<string, unknown>>)
      : [];
    const sectors = Array.isArray(sectorsRes.data.sectors)
      ? (sectorsRes.data.sectors as Array<Record<string, unknown>>)
      : [];

    const fullName = String(args.fullName).trim();
    const admissionNo =
      typeof args.admissionNo === 'string' && args.admissionNo.trim()
        ? args.admissionNo.trim().toUpperCase()
        : makeNextAdmissionNo(existingStudents);
    const email =
      typeof args.email === 'string' && args.email.includes('@')
        ? args.email.trim()
        : makeDefaultEmail(fullName);

    const requestedSector = typeof args.sectorCode === 'string' ? args.sectorCode.trim().toLowerCase() : 'eng';
    const matchedSector =
      sectors.find(
        (s) =>
          String(s.code || '').toLowerCase() === requestedSector ||
          String(s.name || '').toLowerCase().includes(requestedSector)
      ) || sectors[0];

    const sectorCode = matchedSector
      ? String(matchedSector.code)
      : (typeof args.sectorCode === 'string' && args.sectorCode.trim()
          ? args.sectorCode.trim().toUpperCase()
          : 'ENG');
    const unionName =
      typeof args.unionName === 'string' && args.unionName.trim()
        ? args.unionName.trim()
        : matchedSector
          ? String(matchedSector.unionName)
          : 'Tech Union';

    const fundingOption = normalizeFundingChoice(
      typeof args.fundingOption === 'string' ? args.fundingOption : undefined
    );
    const feeAmount =
      typeof args.feeAmount === 'number' && !Number.isNaN(args.feeAmount) ? args.feeAmount : 42000;

    const { data } = await callConnectedAppApi(ctx, '/students', 'POST', {
      admissionNo,
      fullName,
      email,
      sectorCode,
      unionName,
      fundingOption,
      feeAmount,
    });

    let student = (data.student || data) as Record<string, unknown>;
    const id = String(student.id || '');
    if (args.markPaid === true && id) {
      const paidRes = await callConnectedAppApi(ctx, `/students/${encodeURIComponent(id)}/pay`, 'POST');
      student = (paidRes.data.student || student) as Record<string, unknown>;
    }

    return {
      ok: true,
      summary: `Enrolled student **${student.fullName}** (${student.admissionNo}, ${student.sectorCode} · ${student.unionName}, ${student.fundingOption}, fee ${Number(student.feeAmount || 0).toLocaleString()}).`,
      data: { student },
      createdIds: id ? [id] : [],
      uiAction: {
        action: 'refresh',
        fallbackTabSelector: '[data-aia-tab="students"]',
        highlightSelector: id ? `[data-aia-row="${id}"]` : undefined,
        refreshApp: true,
        label: `Enrolled ${fullName} (${admissionNo})`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    for (const id of createdIds) {
      await callConnectedAppApi(ctx, `/students/${encodeURIComponent(id)}`, 'DELETE');
    }
    return {
      ok: true,
      summary: `Removed ${createdIds.length} enrolled student(s).`,
      data: { undoneIds: createdIds },
    };
  },
};

const createSectorTool: ToolDefinition = {
  name: 'createSector',
  description: 'Create a new academic sector and student union budget allocation in College Finance.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    code: z.string().min(2).max(20).optional(),
    name: z.string().min(2).max(100),
    unionName: z.string().min(2).max(80).optional(),
    annualBudget: z.coerce.number().min(0).default(250000),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Short uppercase sector code (e.g. BIO). Auto-derived if omitted.' },
      name: { type: 'string', description: 'Full sector name (e.g. Biotechnology)' },
      unionName: { type: 'string', description: 'Associated student union name' },
      annualBudget: { type: 'number', description: 'Annual budget allocation amount' },
    },
    required: ['name'],
  },
  summarize: (args) => {
    const name = String(args.name || 'New Sector');
    const code = String(args.code || name.slice(0, 3)).toUpperCase();
    return `Create sector "${name}" (${code}) with union "${args.unionName || `${name} Union`}" and budget ${args.annualBudget ?? 250000}`;
  },
  async execute(args, ctx) {
    const name = String(args.name).trim();
    const rawCode =
      typeof args.code === 'string' && args.code.trim()
        ? args.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
        : name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    const unionName =
      typeof args.unionName === 'string' && args.unionName.trim()
        ? args.unionName.trim()
        : `${name.split(/\s+/)[0]} Union`;
    const annualBudget =
      typeof args.annualBudget === 'number' && !Number.isNaN(args.annualBudget)
        ? args.annualBudget
        : 250000;

    const { data } = await callConnectedAppApi(ctx, '/sectors', 'POST', {
      code: rawCode,
      name,
      unionName,
      annualBudget,
    });
    const sector = (data.sector || data) as Record<string, unknown>;
    const createdId = sector.id ? String(sector.id) : '';
    return {
      ok: true,
      summary: `Created sector **${sector.code || rawCode}** (${sector.name || name}) with union **${sector.unionName || unionName}** and annual budget ${Number(sector.annualBudget ?? annualBudget).toLocaleString()}.`,
      data,
      createdIds: createdId ? [createdId] : [],
      uiAction: {
        action: 'refresh',
        fallbackTabSelector: '[data-aia-tab="sectors"]',
        highlightSelector: createdId ? `[data-aia-row="${createdId}"]` : undefined,
        refreshApp: true,
        label: `Created sector ${sector.code || rawCode}`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    for (const id of createdIds) {
      await callConnectedAppApi(ctx, `/sectors/${encodeURIComponent(id)}`, 'DELETE');
    }
    return {
      ok: true,
      summary: `Rolled back ${createdIds.length} created sector(s).`,
      data: { undoneIds: createdIds },
    };
  },
};

const addFundTool: ToolDefinition = {
  name: 'addFund',
  description: 'Add a funding source entry (Student Fees, Charity, Government Grant, or Endowment) in College Finance.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    sourceName: z.string().min(2).max(120),
    fundingType: z.string().optional(),
    targetSector: z.string().default('All Sectors'),
    amount: z.coerce.number().positive().default(50000),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sourceName: { type: 'string', description: 'Donor or fund pool name' },
      fundingType: {
        type: 'string',
        enum: ['Student Fees', 'Charity', 'Government Grant', 'Endowment'],
        description: 'Funding source category',
      },
      targetSector: { type: 'string', description: 'Sector code or All Sectors' },
      amount: { type: 'number', description: 'Allocated fund amount' },
    },
    required: ['sourceName', 'amount'],
  },
  summarize: (args) =>
    `Add ${normalizeFundingChoice(String(args.fundingType || 'Charity'))} fund "${args.sourceName}" of ${args.amount} for ${args.targetSector || 'All Sectors'}`,
  async execute(args, ctx) {
    const fundingType = normalizeFundingChoice(
      typeof args.fundingType === 'string' ? args.fundingType : 'Charity'
    );
    const targetSector =
      typeof args.targetSector === 'string' && args.targetSector.trim()
        ? args.targetSector.trim()
        : 'All Sectors';
    const amount = typeof args.amount === 'number' && args.amount > 0 ? args.amount : 50000;

    const { data } = await callConnectedAppApi(ctx, '/funds', 'POST', {
      sourceName: String(args.sourceName).trim(),
      fundingType,
      targetSector,
      amount,
    });
    const fund = (data.fund || data) as Record<string, unknown>;
    const createdId = fund.id ? String(fund.id) : '';
    return {
      ok: true,
      summary: `Added ${fundingType} fund **${args.sourceName}** (${Number(amount).toLocaleString()} for ${targetSector}).`,
      data,
      createdIds: createdId ? [createdId] : [],
      uiAction: {
        action: 'refresh',
        fallbackTabSelector: '[data-aia-tab="funds"]',
        highlightSelector: createdId ? `[data-aia-row="${createdId}"]` : undefined,
        refreshApp: true,
        label: `Added fund ${args.sourceName}`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    for (const id of createdIds) {
      await callConnectedAppApi(ctx, `/funds/${encodeURIComponent(id)}`, 'DELETE');
    }
    return {
      ok: true,
      summary: `Removed ${createdIds.length} fund source entry.`,
      data: { undoneIds: createdIds },
    };
  },
};

const importStudentsTool: ToolDefinition = {
  name: 'importStudents',
  description: 'Import validated student rows from an uploaded spreadsheet into College Finance in batches.',
  risk: 'write',
  autoExecute: false,
  inputSchema: z.object({
    uploadId: z.string().min(1),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      uploadId: { type: 'string', description: 'Upload preview ID returned by /api/upload' },
    },
    required: ['uploadId'],
  },
  summarize: (args) => {
    const count = Array.isArray(args.rows) ? args.rows.length : 'validated';
    return `Import ${count} student row(s) from upload ${args.uploadId} into College Finance`;
  },
  async execute(args, ctx) {
    let rowsToImport = Array.isArray(args.rows)
      ? (args.rows as Array<Record<string, unknown>>)
      : undefined;

    if (!rowsToImport && typeof args.uploadId === 'string') {
      const preview = ctx.actionStore.getUploadPreview(args.uploadId, ctx.appId);
      if (!preview) {
        throw new Error(`Upload preview "${args.uploadId}" not found or expired.`);
      }
      rowsToImport = preview.validRows.map((r) => r.data);
    }

    if (!rowsToImport || rowsToImport.length === 0) {
      return {
        ok: false,
        summary: 'No valid student rows to import.',
        data: { addedCount: 0, failedRows: [] },
      };
    }

    const batchSize = DEFAULT_IMPORT_BATCH_SIZE;
    let addedCount = 0;
    const createdIds: string[] = [];
    const failedRows: Array<{ admissionNo?: string; reason: string }> = [];

    for (let i = 0; i < rowsToImport.length; i += batchSize) {
      const batch = rowsToImport.slice(i, i + batchSize);
      const { data } = await callConnectedAppApi(ctx, '/students/import', 'POST', {
        students: batch,
      });
      addedCount += Number(data.addedCount || 0);
      if (Array.isArray(data.createdIds)) {
        createdIds.push(...data.createdIds.map(String));
      }
      if (Array.isArray(data.failedRows)) {
        failedRows.push(
          ...(data.failedRows as Array<{ admissionNo?: string; reason: string }>)
        );
      }
    }

    return {
      ok: true,
      summary: `Imported ${addedCount} student(s)${failedRows.length > 0 ? `, ${failedRows.length} failed` : ''}.`,
      data: {
        addedCount,
        failedCount: failedRows.length,
        failedRows,
        createdIds,
      },
      createdIds,
    };
  },
  async undo(createdIds, _args, ctx) {
    if (createdIds.length === 0) {
      return { ok: true, summary: 'No imported student IDs to undo.', data: { undoneCount: 0 } };
    }
    const { data } = await callConnectedAppApi(ctx, '/students/import/undo', 'POST', {
      ids: createdIds,
    });
    return {
      ok: true,
      summary: `Rolled back ${data.undoneCount ?? createdIds.length} imported student record(s).`,
      data,
    };
  },
};

function findMatchingStudent(
  students: Array<Record<string, unknown>>,
  args: Record<string, unknown>
): Record<string, unknown> | undefined {
  const qId = typeof args.studentId === 'string' ? args.studentId.trim().toLowerCase() : '';
  const qAdm = typeof args.admissionNo === 'string' ? args.admissionNo.trim().toLowerCase() : '';
  const qName = typeof args.studentName === 'string' ? args.studentName.trim().toLowerCase() : '';
  const qCtx = typeof args.contextText === 'string' ? args.contextText.trim().toLowerCase() : '';

  if (qId) {
    const m = students.find((s) => String(s.id || '').toLowerCase() === qId);
    if (m) return m;
  }
  if (qAdm) {
    const m = students.find((s) => String(s.admissionNo || '').toLowerCase() === qAdm);
    if (m) return m;
  }
  if (qName) {
    const m = students.find((s) => {
      const name = String(s.fullName || '').toLowerCase();
      return name === qName || name.includes(qName);
    });
    if (m) return m;
  }
  if (qCtx) {
    const m = students.find((s) => {
      const adm = String(s.admissionNo || '').toLowerCase();
      const name = String(s.fullName || '').toLowerCase();
      return (adm && qCtx.includes(adm)) || (name && qCtx.includes(name));
    });
    if (m) return m;
  }
  return undefined;
}

const markStudentPaidTool: ToolDefinition = {
  name: 'markStudentPaid',
  description:
    'Locate a pending student fee record in College Finance and automatically click its Mark Paid button. Accepts studentName, admissionNo, or studentId (or omit to target the single pending student).',
  risk: 'write',
  uiTrigger: true,
  inputSchema: z.object({
    studentId: z.string().optional(),
    admissionNo: z.string().optional(),
    studentName: z.string().optional(),
    contextText: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string', description: 'Internal student record ID (e.g. stu-103)' },
      admissionNo: { type: 'string', description: 'Admission number (e.g. CF-2026-003)' },
      studentName: { type: 'string', description: 'Full or partial student name (e.g. Devika Ramesh)' },
    },
  },
  summarize: (args) => {
    const target = args.studentName || args.admissionNo || args.studentId || 'pending student';
    return `Click "Mark Paid" for ${target}`;
  },
  async execute(args, ctx) {
    const { data } = await callConnectedAppApi(ctx, '/students', 'GET');
    const students = Array.isArray(data.students)
      ? (data.students as Array<Record<string, unknown>>)
      : [];

    let match = findMatchingStudent(students, args);
    const hasQuery = Boolean(args.studentId || args.admissionNo || args.studentName);
    if (!match && !hasQuery) {
      const pending = students.filter((s) => s.status === 'Pending');
      if (pending.length === 1) {
        match = pending[0];
      } else if (pending.length > 1) {
        const list = pending
          .slice(0, 6)
          .map((s) => `${s.fullName} (${s.admissionNo})`)
          .join(', ');
        return {
          ok: false,
          summary: `Multiple pending students found: ${list}. Please tell me which student to mark as paid.`,
          data: { pendingCount: pending.length },
        };
      }
    }

    if (!match) {
      return {
        ok: false,
        summary: 'No matching pending student was found to mark as paid.',
        data: { found: false },
      };
    }

    const id = String(match.id);
    const fullName = String(match.fullName || 'Student');
    const admissionNo = String(match.admissionNo || '');
    const status = String(match.status || '');
    const feeAmount = Number(match.feeAmount || 0);

    if (status !== 'Pending') {
      return {
        ok: false,
        summary: `${fullName} (${admissionNo}) is already marked as ${status}.`,
        data: { student: match },
      };
    }

    return {
      ok: true,
      summary: `Clicked "Mark Paid" for ${fullName} (${admissionNo}, fee ${feeAmount.toLocaleString()}).`,
      data: { student: match },
      createdIds: [id],
      uiAction: {
        action: 'click',
        selector: `[data-aia-action="mark-paid"][data-aia-id="${id}"]`,
        fallbackTabSelector: '[data-aia-tab="students"]',
        label: `Mark Paid — ${fullName} (${admissionNo})`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    for (const id of createdIds) {
      await callConnectedAppApi(ctx, `/students/${encodeURIComponent(id)}/unpay`, 'POST');
    }
    return {
      ok: true,
      summary: `Reverted payment status to Pending for ${createdIds.length} student(s).`,
      data: { undoneIds: createdIds },
    };
  },
};

const unmarkStudentPaidTool: ToolDefinition = {
  name: 'unmarkStudentPaid',
  description: 'Revert a student payment status back to Pending in College Finance.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    studentId: z.string().optional(),
    admissionNo: z.string().optional(),
    studentName: z.string().optional(),
    contextText: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string', description: 'Internal student record ID' },
      admissionNo: { type: 'string', description: 'Admission number' },
      studentName: { type: 'string', description: 'Full or partial student name' },
    },
  },
  summarize: (args) =>
    `Set student ${args.studentName || args.admissionNo || args.studentId || 'record'} back to Pending`,
  async execute(args, ctx) {
    const { data } = await callConnectedAppApi(ctx, '/students', 'GET');
    const students = Array.isArray(data.students)
      ? (data.students as Array<Record<string, unknown>>)
      : [];

    const match = findMatchingStudent(students, args);
    if (!match) {
      return {
        ok: false,
        summary: 'No matching student was found to revert to Pending.',
        data: { found: false },
      };
    }

    const id = String(match.id);
    const fullName = String(match.fullName || 'Student');
    const admissionNo = String(match.admissionNo || '');
    await callConnectedAppApi(ctx, `/students/${encodeURIComponent(id)}/unpay`, 'POST');

    return {
      ok: true,
      summary: `Reverted **${fullName}** (${admissionNo}) fee status to **Pending**.`,
      data: { student: { ...match, status: 'Pending' } },
      createdIds: [id],
      uiAction: {
        action: 'refresh',
        fallbackTabSelector: '[data-aia-tab="students"]',
        highlightSelector: `[data-aia-row="${id}"]`,
        refreshApp: true,
        label: `Reverted ${fullName} to Pending`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    for (const id of createdIds) {
      await callConnectedAppApi(ctx, `/students/${encodeURIComponent(id)}/pay`, 'POST');
    }
    return {
      ok: true,
      summary: `Restored Paid status for ${createdIds.length} student(s).`,
      data: { undoneIds: createdIds },
    };
  },
};

const controlAppUiTool: ToolDefinition = {
  name: 'controlAppUi',
  description:
    'Navigate tabs (students, sectors, funds, import, catalog, loans) or apply/clear search and sector filters directly in the live web app UI.',
  risk: 'read',
  inputSchema: z.object({
    tab: z.string().optional(),
    searchQuery: z.string().optional(),
    sectorFilter: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      tab: {
        type: 'string',
        description: 'Target tab name (students, sectors, funds, import, catalog, loans)',
      },
      searchQuery: {
        type: 'string',
        description: 'Search text to filter the Student Fee Directory (use empty string "" to clear)',
      },
      sectorFilter: {
        type: 'string',
        description: 'Sector code filter (e.g. ENG, SCI, COM, ART, or "" for All Sectors)',
      },
    },
  },
  summarize: (args) => {
    const parts: string[] = [];
    if (args.tab) parts.push(`open ${args.tab} tab`);
    if (typeof args.sectorFilter === 'string') {
      parts.push(args.sectorFilter ? `filter by sector ${args.sectorFilter}` : 'clear sector filter');
    }
    if (typeof args.searchQuery === 'string') {
      parts.push(args.searchQuery ? `search "${args.searchQuery}"` : 'clear search');
    }
    return `Update app UI: ${parts.join(', ') || 'navigate'}`;
  },
  async execute(args) {
    const tab = typeof args.tab === 'string' && args.tab.trim() ? args.tab.trim().toLowerCase() : undefined;
    const followUps: Array<{ action: 'click' | 'set_value'; selector: string; value?: string }> = [];

    if (typeof args.searchQuery === 'string') {
      followUps.push({
        action: 'set_value',
        selector: '[data-aia-control="search-students"]',
        value: args.searchQuery,
      });
    }
    if (typeof args.sectorFilter === 'string') {
      followUps.push({
        action: 'set_value',
        selector: '[data-aia-control="sector-filter"]',
        value: args.sectorFilter.toUpperCase(),
      });
    }

    const tabSelector = tab ? `[data-aia-tab="${tab}"]` : undefined;
    const primarySelector = tabSelector || followUps[0]?.selector;
    const primaryAction = tabSelector ? 'click' : followUps.length > 0 ? 'set_value' : 'click';
    const primaryValue = tabSelector ? undefined : followUps[0]?.value;
    const remaining = tabSelector ? followUps : followUps.slice(1);

    const summaryParts: string[] = [];
    if (tab) summaryParts.push(`switched to the **${tab}** view`);
    if (typeof args.sectorFilter === 'string') {
      summaryParts.push(
        args.sectorFilter
          ? `filtered by sector **${args.sectorFilter.toUpperCase()}**`
          : 'cleared the sector filter'
      );
    }
    if (typeof args.searchQuery === 'string') {
      summaryParts.push(args.searchQuery ? `searched for **${args.searchQuery}**` : 'cleared search');
    }

    return {
      ok: true,
      summary: `Done — ${summaryParts.join(' and ') || 'updated the view'}.`,
      data: { tab, searchQuery: args.searchQuery, sectorFilter: args.sectorFilter },
      uiAction: {
        action: primaryAction,
        selector: primarySelector,
        fallbackTabSelector: tabSelector,
        value: primaryValue,
        followUpActions: remaining.length > 0 ? remaining : undefined,
        label: summaryParts.join(', ') || 'Updated UI',
      },
    };
  },
};

const listLoansTool: ToolDefinition = {
  name: 'listLoans',
  description: 'List active and returned book loans in Campus Library.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'List Campus Library loans',
  async execute(_args, ctx) {
    const { data } = await callConnectedAppApi(ctx, '/loans', 'GET');
    const loans = Array.isArray(data.loans) ? data.loans : [];
    return {
      ok: true,
      summary: `Retrieved ${loans.length} library loan(s).`,
      data,
    };
  },
};

const addBookTool: ToolDefinition = {
  name: 'addBook',
  description:
    'Add a new book to the Campus Library catalog immediately and highlight it in the UI. Auto-generates ISBN/shelf defaults if omitted.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    title: z.string().min(2).max(160),
    author: z.string().default('Staff Author'),
    isbn: z.string().optional(),
    shelf: z.string().default('CS-08'),
    copies: z.coerce.number().int().min(1).default(1),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Book title' },
      author: { type: 'string', description: 'Author full name' },
      isbn: { type: 'string', description: 'ISBN-13 identifier (auto-generated if omitted)' },
      shelf: { type: 'string', description: 'Shelf code (e.g. CS-09)' },
      copies: { type: 'number', description: 'Number of copies (defaults to 1)' },
    },
    required: ['title'],
  },
  summarize: (args) => `Add book "${args.title}" by ${args.author || 'Staff Author'}`,
  async execute(args, ctx) {
    const title = String(args.title).trim();
    const author =
      typeof args.author === 'string' && args.author.trim() ? args.author.trim() : 'Staff Author';
    const isbn =
      typeof args.isbn === 'string' && args.isbn.trim()
        ? args.isbn.trim()
        : `978-${Math.floor(1000000000 + Math.random() * 8999999999)}`;
    const shelf = typeof args.shelf === 'string' && args.shelf.trim() ? args.shelf.trim() : 'CS-08';
    const copies = typeof args.copies === 'number' && args.copies >= 1 ? Math.round(args.copies) : 1;

    const { data } = await callConnectedAppApi(ctx, '/books', 'POST', {
      title,
      author,
      isbn,
      shelf,
      copies,
    });
    const record = (data.record || data) as Record<string, unknown>;
    const id = String(record.id || data.id || '');
    return {
      ok: true,
      summary: `Added book **${title}** by ${author} (${copies} copies, shelf ${shelf}, ISBN ${isbn}).`,
      data,
      createdIds: id ? [id] : [],
      uiAction: {
        action: 'refresh',
        fallbackTabSelector: '[data-aia-tab="catalog"]',
        highlightSelector: id ? `[data-aia-row="${id}"]` : undefined,
        refreshApp: true,
        label: `Added book ${title}`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    const { data } = await callConnectedAppApi(ctx, '/books/undo', 'POST', { ids: createdIds });
    return {
      ok: true,
      summary: `Removed ${createdIds.length} added book(s).`,
      data,
    };
  },
};

const borrowBookTool: ToolDefinition = {
  name: 'borrowBook',
  description:
    'Check out / issue a book loan in Campus Library immediately. Matches by bookId or bookTitle.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    bookId: z.string().optional(),
    bookTitle: z.string().optional(),
    memberName: z.string().default('Campus Student'),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      bookId: { type: 'string', description: 'Book ID (e.g. bk-3)' },
      bookTitle: { type: 'string', description: 'Book title or partial title' },
      memberName: { type: 'string', description: 'Borrower name' },
    },
    required: ['memberName'],
  },
  summarize: (args) =>
    `Checkout book ${args.bookTitle || args.bookId || ''} to ${args.memberName || 'Campus Student'}`,
  async execute(args, ctx) {
    const { data: booksData } = await callConnectedAppApi(ctx, '/books', 'GET');
    const books = Array.isArray(booksData.books)
      ? (booksData.books as Array<Record<string, unknown>>)
      : [];

    const qId = typeof args.bookId === 'string' ? args.bookId.trim().toLowerCase() : '';
    const qTitle = typeof args.bookTitle === 'string' ? args.bookTitle.trim().toLowerCase() : '';
    const match =
      (qId ? books.find((b) => String(b.id || '').toLowerCase() === qId) : undefined) ||
      (qTitle
        ? books.find((b) => String(b.title || '').toLowerCase().includes(qTitle))
        : undefined);

    if (!match) {
      return {
        ok: false,
        summary: `Book "${args.bookTitle || args.bookId || ''}" was not found in the library catalog.`,
        data: { found: false },
      };
    }

    const bookId = String(match.id);
    const memberName =
      typeof args.memberName === 'string' && args.memberName.trim()
        ? args.memberName.trim()
        : 'Campus Student';

    const { data } = await callConnectedAppApi(ctx, '/loans', 'POST', { bookId, memberName });
    const loan = (data.record || data) as Record<string, unknown>;
    const loanId = String(loan.id || data.id || '');
    return {
      ok: true,
      summary: `Checked out **${match.title}** to **${memberName}** (due ${loan.dueDate}).`,
      data,
      createdIds: loanId ? [loanId] : [],
      uiAction: {
        action: 'refresh',
        fallbackTabSelector: '[data-aia-tab="catalog"]',
        highlightSelector: `[data-aia-row="${bookId}"]`,
        refreshApp: true,
        label: `Checked out ${match.title} to ${memberName}`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    const { data } = await callConnectedAppApi(ctx, '/loans/undo', 'POST', { ids: createdIds });
    return {
      ok: true,
      summary: `Cancelled ${createdIds.length} book checkout(s).`,
      data,
    };
  },
};

const returnBookTool: ToolDefinition = {
  name: 'returnBook',
  description: 'Mark an active Campus Library book loan as returned.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    loanId: z.string().optional(),
    bookTitle: z.string().optional(),
    memberName: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      loanId: { type: 'string', description: 'Loan ID (e.g. ln-1)' },
      bookTitle: { type: 'string', description: 'Book title for the active loan' },
      memberName: { type: 'string', description: 'Borrower name on the active loan' },
    },
  },
  summarize: (args) =>
    `Mark loan returned for ${args.bookTitle || args.memberName || args.loanId || 'active loan'}`,
  async execute(args, ctx) {
    const { data: loansData } = await callConnectedAppApi(ctx, '/loans', 'GET');
    const loans = Array.isArray(loansData.loans)
      ? (loansData.loans as Array<Record<string, unknown>>)
      : [];
    const activeLoans = loans.filter((l) => !l.returned);

    const qId = typeof args.loanId === 'string' ? args.loanId.trim().toLowerCase() : '';
    const qTitle = typeof args.bookTitle === 'string' ? args.bookTitle.trim().toLowerCase() : '';
    const qMember = typeof args.memberName === 'string' ? args.memberName.trim().toLowerCase() : '';

    let match =
      (qId ? activeLoans.find((l) => String(l.id || '').toLowerCase() === qId) : undefined) ||
      (qTitle
        ? activeLoans.find((l) => String(l.bookTitle || '').toLowerCase().includes(qTitle))
        : undefined) ||
      (qMember
        ? activeLoans.find((l) => String(l.memberName || '').toLowerCase().includes(qMember))
        : undefined);

    if (!match && !qId && !qTitle && !qMember && activeLoans.length === 1) {
      match = activeLoans[0];
    }

    if (!match) {
      return {
        ok: false,
        summary: 'No matching active loan was found to mark as returned.',
        data: { activeCount: activeLoans.length },
      };
    }

    const loanId = String(match.id);
    await callConnectedAppApi(ctx, `/loans/${encodeURIComponent(loanId)}/return`, 'POST');
    return {
      ok: true,
      summary: `Marked **${match.bookTitle}** (borrowed by ${match.memberName}) as **Returned**.`,
      data: { loan: { ...match, returned: true } },
      createdIds: [loanId],
      uiAction: {
        action: 'refresh',
        fallbackTabSelector: '[data-aia-tab="loans"]',
        highlightSelector: `[data-aia-row="${loanId}"]`,
        refreshApp: true,
        label: `Returned ${match.bookTitle}`,
      },
    };
  },
  async undo(createdIds, _args, ctx) {
    for (const id of createdIds) {
      await callConnectedAppApi(ctx, `/loans/${encodeURIComponent(id)}/unreturn`, 'POST');
    }
    return {
      ok: true,
      summary: `Reverted ${createdIds.length} loan(s) back to Checked Out.`,
      data: { undoneIds: createdIds },
    };
  },
};

function compileDeclarativeTool(def: DeclarativeToolDefinition): ToolDefinition {
  const zodShape: Record<string, z.ZodTypeAny> = {};
  const jsonProps: Record<string, unknown> = {};
  const requiredFields: string[] = [];

  for (const [key, prop] of Object.entries(def.parameters)) {
    let zProp: z.ZodTypeAny;
    if (prop.type === 'number') {
      zProp = z.coerce.number();
    } else if (prop.type === 'boolean') {
      zProp = z.boolean();
    } else if (prop.type === 'array') {
      zProp = z.array(z.unknown());
    } else {
      zProp = prop.enum && prop.enum.length > 0 ? z.enum(prop.enum as [string, ...string[]]) : z.string();
    }
    zodShape[key] = prop.required ? zProp : zProp.optional();
    if (prop.required) requiredFields.push(key);
    jsonProps[key] = {
      type: prop.type,
      description: prop.description,
      ...(prop.enum ? { enum: prop.enum } : {}),
    };
  }

  return {
    name: def.name,
    description: def.description,
    risk: def.risk,
    autoExecute: def.autoExecute,
    inputSchema: z.object(zodShape),
    jsonParameters: {
      type: 'object',
      properties: jsonProps,
      ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
    },
    summarize: (args) => {
      if (!def.summaryTemplate) {
        return `Execute ${def.name} with ${JSON.stringify(args)}`;
      }
      return def.summaryTemplate.replace(/\{(\w+)\}/g, (_, k) => String(args[k] ?? ''));
    },
    async execute(args, ctx): Promise<ToolExecutionResult> {
      let targetPath = def.path;
      let body: unknown = args;
      if (def.method === 'GET') {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null && String(v).length > 0) {
            qs.set(k, String(v));
          }
        }
        const qStr = qs.toString();
        if (qStr) targetPath += (targetPath.includes('?') ? '&' : '?') + qStr;
        body = undefined;
      }

      const { data } = await callConnectedAppApi(ctx, targetPath, def.method, body);
      const createdId =
        typeof data.id === 'string'
          ? [data.id]
          : Array.isArray(data.createdIds)
            ? data.createdIds.map(String)
            : data.record && typeof (data.record as Record<string, unknown>).id === 'string'
              ? [String((data.record as Record<string, unknown>).id)]
              : [];

      return {
        ok: true,
        summary: `Executed ${def.name} successfully.`,
        data,
        createdIds: createdId,
        uiAction:
          def.risk === 'write'
            ? {
                action: 'refresh',
                fallbackTabSelector: def.tabSelector,
                highlightSelector: createdId[0] ? `[data-aia-row="${createdId[0]}"]` : undefined,
                refreshApp: true,
                label: def.name,
              }
            : undefined,
      };
    },
    undo: def.undoPath
      ? async (createdIds, _args, ctx) => {
          const { data } = await callConnectedAppApi(ctx, def.undoPath!, 'POST', { ids: createdIds });
          return {
            ok: true,
            summary: `Rolled back ${def.name} (${createdIds.length} record(s)).`,
            data,
          };
        }
      : undefined,
  };
}

const BUILTIN_TOOLS: Record<string, ToolDefinition> = {
  listStudents: listStudentsTool,
  getFinanceOverview: getFinanceOverviewTool,
  addStudent: addStudentTool,
  createSector: createSectorTool,
  addFund: addFundTool,
  importStudents: importStudentsTool,
  markStudentPaid: markStudentPaidTool,
  unmarkStudentPaid: unmarkStudentPaidTool,
  controlAppUi: controlAppUiTool,
  listLoans: listLoansTool,
  addBook: addBookTool,
  borrowBook: borrowBookTool,
  returnBook: returnBookTool,
  ...KHAZNA_BUILTIN_TOOLS,
  ...DATA_ACCESS_TOOLS,
  ...ENTITY_TOOLS,
  ...EXPORT_TOOLS,
  ...QUERY_TOOLS,
  ...Object.fromEntries(GUIDE_TOOLS.map((t) => [t.name, t])),
};

const PUBLIC_ALLOWED_TOOLS = new Set([
  'search_guides',
  'start_guide',
]);

const STUDENT_ALLOWED_TOOLS = new Set([
  'search_entities',
  'get_entity_details',
  'query_entities',
  'export_data',
  'khaznaGetOverview',
  'khaznaGetStudentAccount',
  'khaznaCreateEntry',
  'khaznaDownloadStudentStatement',
  'khaznaUpdatePhone',
  'khaznaMarkNoticeRead',
  'khaznaSetTheme',
  'controlAppUi',
  'khaznaPrintPage',
  'get_student',
  'summarize_student_finance',
  'find_payments',
  'list_payments',
  'summarize_collections',
  'compare_periods',
  'get_receipt',
  'list_notices',
  'get_notice',
  'summarize_notices',
  'query_data',
  'search_guides',
  'start_guide',
]);

const MANAGER_ALLOWED_TOOLS = new Set([
  'search_entities',
  'get_entity_details',
  'query_entities',
  'export_data',
  'khaznaGetOverview',
  'khaznaGetStudentAccount',
  'khaznaListStudents',
  'khaznaListTransactions',
  'khaznaCreateEntry',
  'khaznaCollectDues',
  'khaznaEditEntry',
  'khaznaVoidEntry',
  'khaznaUnvoidEntry',
  'khaznaPostBatch',
  'khaznaVoidBatch',
  'khaznaImportBulkEntries',
  'khaznaDownloadReport',
  'khaznaDownloadStudentStatement',
  'khaznaUpdatePhone',
  'khaznaMarkNoticeRead',
  'khaznaSetTheme',
  'khaznaNavigate',
  'khaznaOpenInteractiveForm',
  'controlAppUi',
  'khaznaPrintPage',
  'find_students',
  'get_student',
  'list_students',
  'summarize_student_finance',
  'find_sectors',
  'get_sector',
  'summarize_sector_finance',
  'find_classes',
  'get_class',
  'summarize_class',
  'report_class',
  'find_payments',
  'list_payments',
  'summarize_collections',
  'compare_periods',
  'report_defaulters',
  'get_receipt',
  'list_batches',
  'get_batch',
  'summarize_batches',
  'find_funds',
  'list_funds',
  'get_fund',
  'report_fund_utilization',
  'list_notices',
  'get_notice',
  'summarize_notices',
  'list_issued_reports',
  'get_issued_report',
  'summarize_issued_reports',
  'list_audit_logs',
  'get_audit_log',
  'summarize_audit_activity',
  'query_data',
  'search_guides',
  'start_guide',
]);

export class ToolRegistry {
  getToolsForProfile(profile: AppProfile, scope?: AccessScope): Map<string, ToolDefinition> {
    const map = new Map<string, ToolDefinition>();
    for (const def of profile.customTools || []) {
      map.set(def.name, compileDeclarativeTool(def));
    }
    for (const toolName of profile.tools || []) {
      const builtin = BUILTIN_TOOLS[toolName];
      if (builtin && !map.has(toolName)) {
        map.set(toolName, builtin);
      }
    }

    if (scope) {
      if (scope.role !== 'SUPER_ADMIN') {
        map.delete('list_organizations');
        map.delete('get_organization');
        map.delete('summarize_platform_usage');
      }

      if (profile.appId === 'khazna-ledger') {
        if (scope.role === 'PUBLIC') {
          for (const name of Array.from(map.keys())) {
            if (!PUBLIC_ALLOWED_TOOLS.has(name)) {
              map.delete(name);
            }
          }
        } else if (scope.role === 'STUDENT') {
          for (const name of Array.from(map.keys())) {
            if (!STUDENT_ALLOWED_TOOLS.has(name)) {
              map.delete(name);
            }
          }
        } else if (scope.role === 'SECTOR_MANAGER') {
          for (const name of Array.from(map.keys())) {
            if (!MANAGER_ALLOWED_TOOLS.has(name)) {
              map.delete(name);
            }
          }
        }
      }
    }

    return map;
  }

  getTool(profile: AppProfile, toolName: string, scope?: AccessScope): ToolDefinition | undefined {
    return this.getToolsForProfile(profile, scope).get(toolName);
  }
}
