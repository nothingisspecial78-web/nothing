import { z } from 'zod';
import type { ExportColumn } from '@ai-assistant/core';
import type { ToolDefinition } from './types.ts';
import {
  scopedRepository,
  setConversationFocus,
  getConversationFocus,
} from '../db/scopedDataRepository.ts';
import type { AccessScope } from '../security/scope.ts';
import { saveAndBuildDatasetExport } from './datasetState.ts';

function fmtInr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function getScope(ctx: { scope?: AccessScope }): AccessScope {
  return (
    (ctx.scope as AccessScope) || {
      role: 'PUBLIC',
      userId: 'anonymous',
    }
  );
}

function denyScope() {
  return {
    ok: false,
    summary: "I can't access that with your account.",
    data: { found: false, denied: true },
  };
}

export const findStudentsTool: ToolDefinition = {
  name: 'find_students',
  description:
    'Search for students within your authorized scope by full/partial name, admission number, phone, email, or guardian name. Tolerates case, transliteration, and minor spelling differences.',
  risk: 'read',
  inputSchema: z.object({
    query: z.string().min(1).describe('Student name, admission number (e.g. S0125, CF-2026-001), phone, or email'),
    conversationId: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Student search term (name, Ad.No, phone, or email)' },
      conversationId: { type: 'string' },
    },
    required: ['query'],
  },
  summarize: (args) => `Search students matching "${String(args.query)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();

    const res = await scopedRepository.findStudents(String(args.query), scope);
    const convId = String(args.conversationId || ctx.conversationId || '');

    if (res.matches.length === 1) {
      const s = res.matches[0];
      if (convId) {
        setConversationFocus(convId, {
          type: 'student',
          id: s.id,
          name: s.name,
          organizationId: s.organizationId,
          updatedAt: new Date().toISOString(),
        });
      }
      return {
        ok: true,
        summary: `Found student **${s.name}** (Ad.No: \`${s.id}\`, Class: **${s.className}**).`,
        data: s,
      };
    }

    if (res.disambiguation && res.disambiguation.length > 1) {
      const options = res.disambiguation
        .map((d, i) => `${i + 1}. **${d.name}** (\`${d.id}\`) · ${d.className}`)
        .join('\n');
      return {
        ok: true,
        summary: `Multiple students matched "${String(args.query)}". Please specify which student:\n${options}`,
        data: { matches: res.disambiguation, disambiguation: true },
      };
    }

    return {
      ok: true,
      summary: res.message || 'No records found matching the query within your authorized scope.',
      data: { matches: [] },
    };
  },
};

export const getStudentTool: ToolDefinition = {
  name: 'get_student',
  description: 'Retrieve full details for a student by admission number or ID within your authorized scope.',
  risk: 'read',
  inputSchema: z.object({
    studentId: z.string().min(1).describe('Admission number (e.g. S0125)'),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string' },
    },
    required: ['studentId'],
  },
  summarize: (args) => `Get student details for ${String(args.studentId)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();

    const student = await scopedRepository.getStudent(String(args.studentId), scope);
    if (!student) return denyScope();

    const convId = ctx.conversationId;
    if (convId) {
      setConversationFocus(convId, {
        type: 'student',
        id: student.id,
        name: student.name,
        organizationId: student.organizationId,
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      ok: true,
      summary: `**${student.name}** (Ad.No: \`${student.id}\`) · Class: **${student.className}** · Joined: ${student.joined} · Status: **${student.status}**`,
      data: student,
    };
  },
};

export const listStudentsScopedTool: ToolDefinition = {
  name: 'list_students',
  description: 'List students within your authorized scope, optionally filtered by className or status.',
  risk: 'read',
  inputSchema: z.object({
    className: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      className: { type: 'string' },
      status: { type: 'string', enum: ['active', 'inactive'] },
      limit: { type: 'number' },
    },
  },
  summarize: (args) => `List students${args.className ? ` in ${String(args.className)}` : ''}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const res = await scopedRepository.listStudents(
      {
        className: typeof args.className === 'string' ? args.className : undefined,
        status: typeof args.status === 'string' ? args.status : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      },
      scope
    );
    const listText = res.students.slice(0, 15).map((s) => `- **${s.name}** (\`${s.id}\`, ${s.className})`).join('\n');
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: args.className ? `${String(args.className)} Students` : 'Students List',
      entityType: 'student',
      entityNoun: res.students.length === 1 ? 'student' : 'students',
      columns: [
        { key: 'id', label: 'Ad.No', format: 'text' },
        { key: 'name', label: 'Full Name', format: 'text' },
        { key: 'className', label: 'Class', format: 'text' },
        { key: 'status', label: 'Status', format: 'text' },
      ],
      rows: res.students.map((s) => ({
        id: s.id,
        name: s.name,
        className: s.className,
        status: s.status,
      })),
      rawRows: res.students as unknown as Array<Record<string, unknown>>,
    });
    return {
      ok: true,
      summary: res.total === 0 ? 'No students found in your scope.' : `Found **${res.total}** student(s):\n${listText}`,
      data: res,
      ...(exportFile ? { exportFile } : {}),
    };
  },
};

export const summarizeStudentFinanceTool: ToolDefinition = {
  name: 'summarize_student_finance',
  description:
    'Calculate live financial summary for a student (total fee charged, total paid, pending dues, status, and recent payments). Numbers are calculated strictly in code.',
  risk: 'read',
  inputSchema: z.object({
    studentId: z.string().optional().describe('Admission number. If omitted, uses student currently in conversation focus or authenticated student.'),
    conversationId: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string' },
      conversationId: { type: 'string' },
    },
  },
  summarize: (args) => `Calculate student financial summary${args.studentId ? ` for ${String(args.studentId)}` : ''}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();

    let targetId = args.studentId ? String(args.studentId) : '';
    const convId = String(args.conversationId || ctx.conversationId || '');

    if (!targetId && convId) {
      const focus = getConversationFocus(convId, scope);
      if (focus && focus.type === 'student') targetId = focus.id;
    }
    if (!targetId && scope.role === 'STUDENT') {
      targetId = scope.studentId;
    }

    if (!targetId) {
      return {
        ok: false,
        summary: 'Please specify the student name or admission number to calculate financial details.',
        data: {},
      };
    }

    const summary = await scopedRepository.summarizeStudentFinance(targetId, scope);
    if (!summary) return denyScope();

    if (convId) {
      setConversationFocus(convId, {
        type: 'student',
        id: summary.student.id,
        name: summary.student.name,
        organizationId: summary.student.organizationId,
        updatedAt: new Date().toISOString(),
      });
    }

    const lines = [
      `Financial Summary for **${summary.student.name}** (\`${summary.student.id}\`):`,
      `- **Total Billed**: ${fmtInr(summary.totalDebit)}`,
      `- **Total Paid**: ${fmtInr(summary.totalCredit)}`,
      `- **Net Pending Balance**: **${fmtInr(summary.netBalance)}** (${summary.status})`,
    ];

    if (summary.recentTransactions.length > 0) {
      lines.push('', '**Recent Payments & Fees:**');
      summary.recentTransactions.slice(0, 5).forEach((t) => {
        lines.push(`- ${t.title} (${t.type}) — ${fmtInr(t.amount)} on ${t.date} · Receipt \`${t.receiptNo}\``);
      });
    }

    return {
      ok: true,
      summary: lines.join('\n'),
      data: summary,
    };
  },
};

export const findSectorsTool: ToolDefinition = {
  name: 'find_sectors',
  description: 'Search sectors by name or code within user scope.',
  risk: 'read',
  inputSchema: z.object({ query: z.string().min(1) }),
  jsonParameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  summarize: (args) => `Search sectors matching "${String(args.query)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const sectors = await scopedRepository.findSectors(String(args.query), scope);
    if (sectors.length === 0) return denyScope();
    const lines = sectors.map((s) => `- **${s.name}** (\`${s.slug}\`) · Target: ${fmtInr(s.target)} · Balance: ${fmtInr(s.balance)}`);
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: 'Sectors Summary',
      entityType: 'sector',
      entityNoun: sectors.length === 1 ? 'sector' : 'sectors',
      columns: [
        { key: 'slug', label: 'Sector Slug', format: 'text' },
        { key: 'name', label: 'Sector Name', format: 'text' },
        { key: 'target', label: 'Target', format: 'currency' },
        { key: 'balance', label: 'Balance', format: 'currency' },
      ],
      rows: sectors.map((s) => ({
        slug: s.slug,
        name: s.name,
        target: s.target,
        balance: s.balance,
      })),
      rawRows: sectors as unknown as Array<Record<string, unknown>>,
    });
    return { ok: true, summary: lines.join('\n'), data: sectors, ...(exportFile ? { exportFile } : {}) };
  },
};

export const getSectorTool: ToolDefinition = {
  name: 'get_sector',
  description: 'Retrieve details for a specific sector by slug or name within user scope.',
  risk: 'read',
  inputSchema: z.object({ sector: z.string().min(1) }),
  jsonParameters: {
    type: 'object',
    properties: { sector: { type: 'string' } },
    required: ['sector'],
  },
  summarize: (args) => `Get sector details for "${String(args.sector)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const s = await scopedRepository.getSector(String(args.sector), scope);
    if (!s) return denyScope();
    return {
      ok: true,
      summary: `**${s.name}** (\`${s.slug}\`) · Manager: ${s.managerName || 'Unassigned'} · Target: ${fmtInr(s.target)} · Balance: **${fmtInr(s.balance)}**`,
      data: s,
    };
  },
};

export const summarizeSectorFinanceTool: ToolDefinition = {
  name: 'summarize_sector_finance',
  description: 'Compute sector collection total, debit total, net balance, and collection percentage.',
  risk: 'read',
  inputSchema: z.object({ sector: z.string().min(1) }),
  jsonParameters: {
    type: 'object',
    properties: { sector: { type: 'string' } },
    required: ['sector'],
  },
  summarize: (args) => `Summarize finances for sector "${String(args.sector)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const res = await scopedRepository.summarizeSectorFinance(String(args.sector), scope);
    if (!res) return denyScope();
    const lines = [
      `Sector Finance for **${res.sector.name}** (\`${res.sector.slug}\`):`,
      `- **Annual Target**: ${fmtInr(res.target)}`,
      `- **Total Collections (Credit)**: ${fmtInr(res.credit)}`,
      `- **Total Expenses (Debit)**: ${fmtInr(res.debit)}`,
      `- **Net Available Balance**: **${fmtInr(res.balance)}**`,
      `- **Collection Rate**: **${res.collectionRate}%** across ${res.studentCount} students.`,
    ];
    return { ok: true, summary: lines.join('\n'), data: res };
  },
};

export const findClassesTool: ToolDefinition = {
  name: 'find_classes',
  description: 'Search academic classes within your authorized scope.',
  risk: 'read',
  inputSchema: z.object({ query: z.string().optional() }),
  jsonParameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
  },
  summarize: (args) => `Find classes${args.query ? ` matching "${String(args.query)}"` : ''}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const classesRaw = await scopedRepository.findClasses(String(args.query || ''), scope);
    if (classesRaw.length === 0) return { ok: true, summary: 'No classes found in your scope.', data: [] };
    const classes = [...classesRaw].sort((a, b) => Number(b.totalBalance ?? 0) - Number(a.totalBalance ?? 0));
    const lines = classes.map((c) => `- **${c.name}** · ${c.studentCount} student(s) · Pending: ${fmtInr(c.totalBalance)}`);
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: 'Class Balances Summary',
      entityType: 'class',
      entityNoun: classes.length === 1 ? 'class' : 'classes',
      columns: [
        { key: 'name', label: 'Class', format: 'text' },
        { key: 'studentCount', label: 'Students', format: 'text' },
        { key: 'totalBalance', label: 'Pending Dues', format: 'currency' },
      ],
      rows: classes.map((c) => ({
        name: c.name,
        studentCount: c.studentCount,
        totalBalance: c.totalBalance,
      })),
      rawRows: classes as unknown as Array<Record<string, unknown>>,
    });
    return {
      ok: true,
      summary: `Found ${classes.length} class(es):\n${lines.join('\n')}`,
      data: classes,
      ...(exportFile ? { exportFile } : {}),
    };
  },
};

export const getClassTool: ToolDefinition = {
  name: 'get_class',
  description: 'Get summary statistics for a single class by name.',
  risk: 'read',
  inputSchema: z.object({ className: z.string().min(1) }),
  jsonParameters: {
    type: 'object',
    properties: { className: { type: 'string' } },
    required: ['className'],
  },
  summarize: (args) => `Get class details for "${String(args.className)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const cls = await scopedRepository.getClass(String(args.className), scope);
    if (!cls) return denyScope();
    return {
      ok: true,
      summary: `Class **${cls.name}**: ${cls.studentCount} student(s) · Billed: ${fmtInr(cls.totalDebit)} · Collected: ${fmtInr(cls.totalCredit)} · Balance: ${fmtInr(cls.totalBalance)}`,
      data: cls,
    };
  },
};

export const reportClassTool: ToolDefinition = {
  name: 'report_class',
  description: 'Generate class-wise financial report (student count, collection status, totals, and defaulters).',
  risk: 'read',
  inputSchema: z.object({ className: z.string().min(1) }),
  jsonParameters: {
    type: 'object',
    properties: { className: { type: 'string' } },
    required: ['className'],
  },
  summarize: (args) => `Generate class report for "${String(args.className)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const rep = await scopedRepository.reportClass(String(args.className), scope);
    if (!rep) {
      return { ok: false, summary: `No class records found for "${String(args.className)}" within authorized scope.`, data: null };
    }
    const lines = [
      `### Class Report: **${rep.className}**`,
      `- **Students Enrolled**: ${rep.studentCount}`,
      `- **Total Fees Charged**: ${fmtInr(rep.totalDebit)}`,
      `- **Total Collected**: ${fmtInr(rep.totalCredit)}`,
      `- **Pending Fees**: **${fmtInr(rep.totalPending)}**`,
      `- **Defaulters**: ${rep.defaultersCount} student(s) with pending balance.`,
    ];
    return { ok: true, summary: lines.join('\n'), data: rep };
  },
};

export const summarizeClassTool: ToolDefinition = {
  ...reportClassTool,
  name: 'summarize_class',
  description: 'Summarize financial performance and pending dues for a specific class.',
};

export const findPaymentsTool: ToolDefinition = {
  name: 'find_payments',
  description: 'Search payments and fee entries by student name, receipt number, or description within authorized scope.',
  risk: 'read',
  inputSchema: z.object({ query: z.string().min(1) }),
  jsonParameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  summarize: (args) => `Search payments matching "${String(args.query)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const txs = await scopedRepository.findPayments(String(args.query), scope);
    if (txs.length === 0) return { ok: true, summary: 'No matching payments found within your scope.', data: [] };
    const lines = txs.slice(0, 10).map((t) => `- \`${t.receiptNo}\` ${t.title} (${t.type}) — ${fmtInr(t.amount)} · ${t.studentName || t.studentId} (${t.date})`);
    return { ok: true, summary: `Found ${txs.length} payment/entry record(s):\n${lines.join('\n')}`, data: txs };
  },
};

export const listPaymentsTool: ToolDefinition = {
  name: 'list_payments',
  description: 'List payments and fee entries filtered by sector, type, or date range within authorized scope.',
  risk: 'read',
  inputSchema: z.object({
    sector: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    type: z.enum(['credit', 'debit']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sector: { type: 'string' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      type: { type: 'string', enum: ['credit', 'debit'] },
      limit: { type: 'number' },
    },
  },
  summarize: () => 'List scoped payments and fee entries',
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const res = await scopedRepository.listPayments(
      {
        sector: typeof args.sector === 'string' ? args.sector : undefined,
        startDate: typeof args.startDate === 'string' ? args.startDate : undefined,
        endDate: typeof args.endDate === 'string' ? args.endDate : undefined,
        type: args.type === 'credit' || args.type === 'debit' ? args.type : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      },
      scope
    );
    const lines = res.transactions.slice(0, 10).map((t) => `- \`${t.receiptNo}\` **${t.title}** (${t.type}) — ${fmtInr(t.amount)} · ${t.date}`);
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: 'Payments & Fee Entries',
      entityType: 'transaction',
      entityNoun: res.transactions.length === 1 ? 'entry' : 'entries',
      columns: [
        { key: 'receiptNo', label: 'Receipt', format: 'text' },
        { key: 'date', label: 'Date', format: 'date' },
        { key: 'studentName', label: 'Student', format: 'text' },
        { key: 'type', label: 'Type', format: 'text' },
        { key: 'title', label: 'Description', format: 'text' },
        { key: 'amount', label: 'Amount', format: 'currency' },
      ],
      rows: res.transactions.map((t) => ({
        receiptNo: t.receiptNo,
        date: String(t.date || '').slice(0, 10),
        studentName: t.studentName || t.studentId,
        type: t.type,
        title: t.title,
        amount: t.amount,
      })),
      rawRows: res.transactions as unknown as Array<Record<string, unknown>>,
    });
    return {
      ok: true,
      summary: `Found ${res.total} entry(ies) totaling ${fmtInr(res.totalAmount)}:\n${lines.join('\n')}`,
      data: res,
      ...(exportFile ? { exportFile } : {}),
    };
  },
};

export const summarizeCollectionsTool: ToolDefinition = {
  name: 'summarize_collections',
  description: 'Compute fee collections vs charges summary across sectors for a given period within authorized scope.',
  risk: 'read',
  inputSchema: z.object({
    sector: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sector: { type: 'string' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
    },
  },
  summarize: () => 'Summarize fee collections across authorized scope',
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const summary = await scopedRepository.summarizeCollections(
      {
        sector: typeof args.sector === 'string' ? args.sector : undefined,
        startDate: typeof args.startDate === 'string' ? args.startDate : undefined,
        endDate: typeof args.endDate === 'string' ? args.endDate : undefined,
      },
      scope
    );
    return {
      ok: true,
      summary: `Collections Summary (${summary.transactionCount} entries): Credits **${fmtInr(summary.totalCredit)}**, Debits **${fmtInr(summary.totalDebit)}**, Net Balance **${fmtInr(summary.netBalance)}**.`,
      data: summary,
    };
  },
};

export const reportDefaultersTool: ToolDefinition = {
  name: 'report_defaulters',
  description: 'List all students with pending fees in a sector or across the organization (within user scope).',
  risk: 'read',
  inputSchema: z.object({ sector: z.string().optional() }),
  jsonParameters: {
    type: 'object',
    properties: { sector: { type: 'string' } },
  },
  summarize: (args) => `Report defaulters${args.sector ? ` in sector ${String(args.sector)}` : ''}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const rep = await scopedRepository.reportDefaulters(args.sector ? String(args.sector) : undefined, scope);
    if (rep.totalDefaulters === 0) {
      return { ok: true, summary: 'No defaulters found! All student fees are currently settled.', data: rep };
    }
    const lines = [
      `Found **${rep.totalDefaulters}** defaulter(s) with total pending dues of **${fmtInr(rep.totalAmountOwed)}**:`,
      '',
    ];
    rep.defaulters.slice(0, 10).forEach((d, i) => {
      lines.push(`${i + 1}. **${d.name}** (\`${d.studentId}\`, ${d.className}) — Owed: **${fmtInr(d.amountOwed)}** in ${d.sector}`);
    });
    if (rep.defaulters.length > 10) {
      lines.push('', `*(Showing 10 of ${rep.defaulters.length} defaulters)*`);
    }
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: args.sector ? `${String(args.sector)} Defaulters` : 'Fee Defaulters',
      entityType: 'student',
      entityNoun: rep.defaulters.length === 1 ? 'defaulter' : 'defaulters',
      columns: [
        { key: 'studentId', label: 'Ad.No', format: 'text' },
        { key: 'name', label: 'Full Name', format: 'text' },
        { key: 'className', label: 'Class', format: 'text' },
        { key: 'sector', label: 'Sector', format: 'text' },
        { key: 'amountOwed', label: 'Due', format: 'currency' },
      ],
      rows: rep.defaulters.map((d) => ({
        studentId: d.studentId,
        name: d.name,
        className: d.className,
        sector: d.sector,
        amountOwed: d.amountOwed,
      })),
      rawRows: rep.defaulters as unknown as Array<Record<string, unknown>>,
    });
    return { ok: true, summary: lines.join('\n'), data: rep, ...(exportFile ? { exportFile } : {}) };
  },
};

export const listBatchesTool: ToolDefinition = {
  name: 'list_batches',
  description: 'List bulk fee/credit batches within your authorized scope.',
  risk: 'read',
  inputSchema: z.object({
    sector: z.string().optional(),
    status: z.enum(['posted', 'voided']).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sector: { type: 'string' },
      status: { type: 'string', enum: ['posted', 'voided'] },
    },
  },
  summarize: () => 'List bulk batches',
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const list = await scopedRepository.listBatches(
      {
        sector: typeof args.sector === 'string' ? args.sector : undefined,
        status: args.status === 'posted' || args.status === 'voided' ? args.status : undefined,
      },
      scope
    );
    const lines = list.map((b) => `- \`${b.id}\` **${b.title}** (${b.sector}) — ${fmtInr(b.totalAmount)} (${b.studentCount} students) [${b.status}]`);
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: 'Bulk Batches',
      entityType: 'batch',
      entityNoun: list.length === 1 ? 'batch' : 'batches',
      columns: [
        { key: 'id', label: 'Batch ID', format: 'text' },
        { key: 'title', label: 'Title', format: 'text' },
        { key: 'sector', label: 'Sector', format: 'text' },
        { key: 'studentCount', label: 'Students', format: 'text' },
        { key: 'totalAmount', label: 'Total Amount', format: 'currency' },
        { key: 'status', label: 'Status', format: 'text' },
      ],
      rows: list.map((b) => ({
        id: b.id,
        title: b.title,
        sector: b.sector,
        studentCount: b.studentCount,
        totalAmount: b.totalAmount,
        status: b.status,
      })),
      rawRows: list as unknown as Array<Record<string, unknown>>,
    });
    return {
      ok: true,
      summary: list.length ? `Found ${list.length} batch(es):\n${lines.join('\n')}` : 'No batches found in your scope.',
      data: list,
      ...(exportFile ? { exportFile } : {}),
    };
  },
};

export const getBatchTool: ToolDefinition = {
  name: 'get_batch',
  description: 'Fetch details of a single bulk batch by ID (e.g. B-2026-01).',
  risk: 'read',
  inputSchema: z.object({ batchId: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { batchId: { type: 'string' } }, required: ['batchId'] },
  summarize: (args) => `Get batch ${String(args.batchId)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const batch = await scopedRepository.getBatch(String(args.batchId), scope);
    if (!batch) return denyScope();
    return {
      ok: true,
      summary: `Batch \`${batch.id}\` (**${batch.title}**) in ${batch.sector}: ${fmtInr(batch.amountPerStudent)} × ${batch.studentCount} = **${fmtInr(batch.totalAmount)}** [${batch.status}]`,
      data: batch,
    };
  },
};

export const summarizeBatchesTool: ToolDefinition = {
  name: 'summarize_batches',
  description: 'Summarize posted and voided batch counts and amounts within scope.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Summarize bulk batches',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const sum = await scopedRepository.summarizeBatches(scope);
    return {
      ok: true,
      summary: `Batches Summary: **${sum.postedCount}** posted, **${sum.voidedCount}** voided (${sum.totalBatches} total), posted volume **${fmtInr(sum.totalAmount)}**.`,
      data: sum,
    };
  },
};

export const findUsersTool: ToolDefinition = {
  name: 'find_users',
  description: 'Admin only: Search administrators and sector managers by name, email, or sector.',
  risk: 'read',
  inputSchema: z.object({ query: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  summarize: (args) => `Search users matching "${String(args.query)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return denyScope();
    const users = await scopedRepository.findUsers(String(args.query), scope);
    const lines = users.map((u) => `- **${u.name}** (${u.email}) · ${u.role} · Sectors: ${u.sectorIds.join(', ') || 'All'}`);
    return { ok: true, summary: users.length ? `Found ${users.length} user(s):\n${lines.join('\n')}` : 'No matching users found.', data: users };
  },
};

export const listUsersTool: ToolDefinition = {
  name: 'list_users',
  description: 'Admin only: List all administrators and sector managers in the organization.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'List organization users & managers',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return denyScope();
    const users = await scopedRepository.listUsers(scope);
    const lines = users.map((u) => `- **${u.name}** (${u.email}) · ${u.role} [${u.status}]`);
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: 'Organization Managers & Admins',
      entityType: 'user',
      entityNoun: users.length === 1 ? 'user' : 'users',
      columns: [
        { key: 'id', label: 'ID', format: 'text' },
        { key: 'name', label: 'Name', format: 'text' },
        { key: 'email', label: 'Email', format: 'text' },
        { key: 'role', label: 'Role', format: 'text' },
        { key: 'status', label: 'Status', format: 'text' },
      ],
      rows: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
      })),
      rawRows: users as unknown as Array<Record<string, unknown>>,
    });
    return { ok: true, summary: `Found ${users.length} user(s):\n${lines.join('\n')}`, data: users, ...(exportFile ? { exportFile } : {}) };
  },
};

export const getUserTool: ToolDefinition = {
  name: 'get_user',
  description: 'Admin only: Get details of a specific manager or administrator by ID or email.',
  risk: 'read',
  inputSchema: z.object({ userId: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
  summarize: (args) => `Get user details for "${String(args.userId)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return denyScope();
    const user = await scopedRepository.getUser(String(args.userId), scope);
    if (!user) return denyScope();
    return {
      ok: true,
      summary: `**${user.name}** (\`${user.id}\`) · ${user.email} · ${user.role} · Sectors: ${user.sectorIds.join(', ') || 'All'}`,
      data: user,
    };
  },
};

export const summarizeManagersTool: ToolDefinition = {
  name: 'summarize_managers',
  description: 'Admin only: Summarize active sector managers and admin coverage.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Summarize sector managers',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return denyScope();
    const sum = await scopedRepository.summarizeManagers(scope);
    return {
      ok: true,
      summary: `Managers Summary: **${sum.activeManagers}** active sector manager(s), **${sum.admins}** admin(s), covering sectors: ${sum.sectorsCovered.join(', ') || 'none'}.`,
      data: sum,
    };
  },
};

export const findFundsTool: ToolDefinition = {
  name: 'find_funds',
  description: 'Search fund pools by name, funding type, or target sector.',
  risk: 'read',
  inputSchema: z.object({ query: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  summarize: (args) => `Search funds matching "${String(args.query)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const funds = await scopedRepository.findFunds(String(args.query), scope);
    const lines = funds.map((f) => `- **${f.sourceName}** (${f.fundingType}) — ${fmtInr(f.amount)} → \`${f.targetSector}\``);
    return { ok: true, summary: funds.length ? `Found ${funds.length} fund(s):\n${lines.join('\n')}` : 'No matching funds found.', data: funds };
  },
};

export const listFundsTool: ToolDefinition = {
  name: 'list_funds',
  description: 'List all fund sources within authorized scope.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'List funds',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const funds = await scopedRepository.listFunds(scope);
    const lines = funds.map((f) => `- **${f.sourceName}** (${f.fundingType}) — ${fmtInr(f.amount)} → \`${f.targetSector}\``);
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: 'Campus Funds',
      entityType: 'fund',
      entityNoun: funds.length === 1 ? 'fund' : 'funds',
      columns: [
        { key: 'id', label: 'ID', format: 'text' },
        { key: 'sourceName', label: 'Source', format: 'text' },
        { key: 'fundingType', label: 'Type', format: 'text' },
        { key: 'targetSector', label: 'Target Sector', format: 'text' },
        { key: 'amount', label: 'Amount', format: 'currency' },
      ],
      rows: funds.map((f) => ({
        id: f.id,
        sourceName: f.sourceName,
        fundingType: f.fundingType,
        targetSector: f.targetSector,
        amount: f.amount,
      })),
      rawRows: funds as unknown as Array<Record<string, unknown>>,
    });
    return { ok: true, summary: `Found ${funds.length} fund(s):\n${lines.join('\n')}`, data: funds, ...(exportFile ? { exportFile } : {}) };
  },
};

export const getFundTool: ToolDefinition = {
  name: 'get_fund',
  description: 'Get details of a single fund pool by ID.',
  risk: 'read',
  inputSchema: z.object({ fundId: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { fundId: { type: 'string' } }, required: ['fundId'] },
  summarize: (args) => `Get fund ${String(args.fundId)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const fund = await scopedRepository.getFund(String(args.fundId), scope);
    if (!fund) return denyScope();
    return {
      ok: true,
      summary: `Fund **${fund.sourceName}** (\`${fund.id}\`): ${fmtInr(fund.amount)} (${fund.fundingType}) allocated to \`${fund.targetSector}\`.`,
      data: fund,
    };
  },
};

export const reportFundUtilizationTool: ToolDefinition = {
  name: 'report_fund_utilization',
  description: 'Report fund pools and utilization across Charity, Government Grant, Endowment, and Student Fees.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Generate fund utilization report',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const rep = await scopedRepository.reportFundUtilization(scope);
    const lines = [
      `### Campus Funding Overview`,
      `- **Total Available Funds**: **${fmtInr(rep.totalFunding)}**`,
      '',
      '**Breakdown by Source Type:**',
    ];
    for (const [type, amt] of Object.entries(rep.fundsByType)) {
      lines.push(`- **${type}**: ${fmtInr(amt)}`);
    }
    return { ok: true, summary: lines.join('\n'), data: rep };
  },
};

export const listSignatoriesTool: ToolDefinition = {
  name: 'list_signatories',
  description: 'List authorized report/receipt signatories.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'List authorized signatories',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return denyScope();
    const list = await scopedRepository.listSignatories(scope);
    const lines = list.map((s) => `- **${s.fullName}** (${s.designation}) · ${s.role}${s.sectorId ? ` · \`${s.sectorId}\`` : ''}`);
    return { ok: true, summary: `Found ${list.length} signatory record(s):\n${lines.join('\n')}`, data: list };
  },
};

export const getSignatoryTool: ToolDefinition = {
  name: 'get_signatory',
  description: 'Get details of a signatory by ID.',
  risk: 'read',
  inputSchema: z.object({ signatoryId: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { signatoryId: { type: 'string' } }, required: ['signatoryId'] },
  summarize: (args) => `Get signatory ${String(args.signatoryId)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return denyScope();
    const sig = await scopedRepository.getSignatory(String(args.signatoryId), scope);
    if (!sig) return denyScope();
    return { ok: true, summary: `**${sig.fullName}** — ${sig.designation} (${sig.role})`, data: sig };
  },
};

export const summarizeSignatoriesTool: ToolDefinition = {
  name: 'summarize_signatories',
  description: 'Summarize active signatories by role.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Summarize signatories',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return denyScope();
    const sum = await scopedRepository.summarizeSignatories(scope);
    return { ok: true, summary: `Signatories: **${sum.activeCount}** active out of ${sum.total} configured.`, data: sum };
  },
};

export const listNoticesTool: ToolDefinition = {
  name: 'list_notices',
  description: 'List notices and notifications visible to the current user role.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'List notices',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const list = await scopedRepository.listNotices(scope);
    const lines = list.map((n) => `- [${n.read ? 'Read' : 'Unread'}] **${n.title}**: ${n.body}`);
    return { ok: true, summary: list.length ? `Found ${list.length} notice(s):\n${lines.join('\n')}` : 'No notices available.', data: list };
  },
};

export const getNoticeTool: ToolDefinition = {
  name: 'get_notice',
  description: 'Get details for a specific notice by ID.',
  risk: 'read',
  inputSchema: z.object({ noticeId: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { noticeId: { type: 'string' } }, required: ['noticeId'] },
  summarize: (args) => `Get notice ${String(args.noticeId)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const n = await scopedRepository.getNotice(String(args.noticeId), scope);
    if (!n) return denyScope();
    return { ok: true, summary: `**${n.title}** (${n.kind}): ${n.body}`, data: n };
  },
};

export const summarizeNoticesTool: ToolDefinition = {
  name: 'summarize_notices',
  description: 'Summarize unread and total notices for current user.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Summarize notices',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const sum = await scopedRepository.summarizeNotices(scope);
    return { ok: true, summary: `Notices: **${sum.unreadCount}** unread out of ${sum.total} total.`, data: sum };
  },
};

export const listIssuedReportsTool: ToolDefinition = {
  name: 'list_issued_reports',
  description: 'List issued verification reports within authorized scope.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'List issued reports',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const list = await scopedRepository.listIssuedReports(scope);
    const lines = list.map((r) => `- \`${r.ref}\` **${r.title}** (${r.format.toUpperCase()}) · Status: ${r.status}`);
    return { ok: true, summary: list.length ? `Issued Reports (${list.length}):\n${lines.join('\n')}` : 'No issued reports found.', data: list };
  },
};

export const getIssuedReportTool: ToolDefinition = {
  name: 'get_issued_report',
  description: 'Get details for an issued report by verification reference (e.g. KHZ-2026-1001).',
  risk: 'read',
  inputSchema: z.object({ ref: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  summarize: (args) => `Get issued report ${String(args.ref)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const rep = await scopedRepository.getIssuedReport(String(args.ref), scope);
    if (!rep) return denyScope();
    return { ok: true, summary: `Report \`${rep.ref}\`: **${rep.title}** (${rep.format.toUpperCase()}) · Issued by ${rep.issuedBy} · Status: **${rep.status}**`, data: rep };
  },
};

export const summarizeIssuedReportsTool: ToolDefinition = {
  name: 'summarize_issued_reports',
  description: 'Summarize issued verification report counts by validity status.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Summarize issued reports',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const sum = await scopedRepository.summarizeIssuedReports(scope);
    return { ok: true, summary: `Issued Reports Summary: **${sum.validCount}** valid, **${sum.revokedCount}** revoked (${sum.total} total).`, data: sum };
  },
};

export const listAuditLogsTool: ToolDefinition = {
  name: 'list_audit_logs',
  description: 'List immutable audit log events within authorized scope.',
  risk: 'read',
  inputSchema: z.object({ action: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
  jsonParameters: {
    type: 'object',
    properties: { action: { type: 'string' }, limit: { type: 'number' } },
  },
  summarize: () => 'List audit logs',
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const logs = await scopedRepository.listAuditLogs(
      {
        action: typeof args.action === 'string' ? args.action : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      },
      scope
    );
    const lines = logs.map((l) => `- \`${l.id}\` **${l.action}** on \`${l.target}\` by ${l.actor}: ${l.details}`);
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope,
      userId: ctx.userId,
      title: 'Audit Logs',
      entityType: 'audit_log',
      entityNoun: logs.length === 1 ? 'event' : 'events',
      columns: [
        { key: 'id', label: 'Event ID', format: 'text' },
        { key: 'action', label: 'Action', format: 'text' },
        { key: 'target', label: 'Target', format: 'text' },
        { key: 'actor', label: 'Actor', format: 'text' },
        { key: 'details', label: 'Details', format: 'text' },
      ],
      rows: logs.map((l) => ({
        id: l.id,
        action: l.action,
        target: l.target,
        actor: l.actor,
        details: l.details,
      })),
      rawRows: logs as unknown as Array<Record<string, unknown>>,
    });
    return {
      ok: true,
      summary: logs.length ? `Audit Log (${logs.length} events):\n${lines.join('\n')}` : 'No audit events found.',
      data: logs,
      ...(exportFile ? { exportFile } : {}),
    };
  },
};

export const getAuditLogTool: ToolDefinition = {
  name: 'get_audit_log',
  description: 'Fetch a single audit log entry by ID.',
  risk: 'read',
  inputSchema: z.object({ auditId: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { auditId: { type: 'string' } }, required: ['auditId'] },
  summarize: (args) => `Get audit log ${String(args.auditId)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const log = await scopedRepository.getAuditLog(String(args.auditId), scope);
    if (!log) return denyScope();
    return { ok: true, summary: `Audit \`${log.id}\`: **${log.action}** by ${log.actor} (${log.role}) — ${log.details}`, data: log };
  },
};

export const summarizeAuditActivityTool: ToolDefinition = {
  name: 'summarize_audit_activity',
  description: 'Summarize audit log event counts grouped by action type.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Summarize audit activity',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC' || scope.role === 'STUDENT') return denyScope();
    const sum = await scopedRepository.summarizeAuditActivity(scope);
    const breakdown = Object.entries(sum.byAction).map(([k, v]) => `${k}: ${v}`).join(', ');
    return { ok: true, summary: `Audit Activity: **${sum.totalEvents}** event(s) (${breakdown || 'none'}).`, data: sum };
  },
};

export const getReceiptTool: ToolDefinition = {
  name: 'get_receipt',
  description: 'Fetch complete details for a payment or fee entry by receipt number (e.g. OF-1047, DF-201).',
  risk: 'read',
  inputSchema: z.object({ receiptNo: z.string().min(1) }),
  jsonParameters: {
    type: 'object',
    properties: { receiptNo: { type: 'string' } },
    required: ['receiptNo'],
  },
  summarize: (args) => `Lookup receipt "${String(args.receiptNo)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    const tx = await scopedRepository.getReceipt(String(args.receiptNo), scope);
    if (!tx) return denyScope();
    const lines = [
      `Receipt Details (\`${tx.receiptNo}\`):`,
      `- **Student**: ${tx.studentName || tx.studentId} (\`${tx.studentId}\`)`,
      `- **Type**: **${tx.type.toUpperCase()}** · ${tx.title}`,
      `- **Amount**: **${fmtInr(tx.amount)}**`,
      `- **Sector**: ${tx.sector}`,
      `- **Date**: ${tx.date}`,
      ...(tx.voided ? [`- **Status**: ⚠️ VOIDED by ${tx.voided.by} on ${tx.voided.at} (Reason: ${tx.voided.reason})`] : []),
    ];
    return { ok: true, summary: lines.join('\n'), data: tx };
  },
};

export const listOrganizationsTool: ToolDefinition = {
  name: 'list_organizations',
  description: 'Platform Super Admin only: List all organizations on the platform with metrics and totals.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'List all platform organizations',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN') return denyScope();
    const orgs = await scopedRepository.listOrganizations(scope);
    const lines = [
      `### Platform Organizations (${orgs.length} total):`,
      '',
      ...orgs.map(
        (o, i) =>
          `${i + 1}. **${o.name}** (\`${o.id}\`) — Admin: ${o.adminEmail} · Students: ${o.studentCount} · Collections: ${fmtInr(o.totalCollections)}`
      ),
    ];
    return { ok: true, summary: lines.join('\n'), data: orgs };
  },
};

export const getOrganizationTool: ToolDefinition = {
  name: 'get_organization',
  description: 'Platform Super Admin only: Get detailed tenant metrics and sectors for a single organization.',
  risk: 'read',
  inputSchema: z.object({ orgId: z.string().min(1) }),
  jsonParameters: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] },
  summarize: (args) => `Get organization details for ${String(args.orgId)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN') return denyScope();
    const detail = await scopedRepository.getOrganizationDetail(String(args.orgId), scope);
    if (!detail) return denyScope();
    return {
      ok: true,
      summary: `**${detail.organization.name}** (\`${detail.organization.id}\`): ${detail.studentCount} student(s), ${detail.sectorCount} sector(s), Credits: ${fmtInr(detail.totalCredits)}, Net Balance: ${fmtInr(detail.netBalance)}.`,
      data: detail,
    };
  },
};

export const summarizePlatformUsageTool: ToolDefinition = {
  name: 'summarize_platform_usage',
  description: 'Platform Super Admin only: Compute platform-wide metrics (organizations, users, tokens, collections).',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Summarize platform usage metrics',
  async execute(_args, ctx) {
    const scope = getScope(ctx);
    if (scope.role !== 'SUPER_ADMIN') return denyScope();
    const usage = await scopedRepository.summarizePlatformUsage(scope);
    const lines = [
      `### Platform Usage & Health Overview`,
      `- **Total Organizations**: ${usage.totalOrganizations}`,
      `- **Total Students**: ${usage.totalStudents}`,
      `- **Total Collections**: ${fmtInr(usage.totalCredits)} across ${usage.totalTransactions} transactions`,
      `- **Active Monthly Users**: ${usage.activeUsersMonthly}`,
      `- **AI Assistant Requests Today**: ${usage.aiAssistantRequestsToday}`,
    ];
    return { ok: true, summary: lines.join('\n'), data: usage };
  },
};

export const queryDataTool: ToolDefinition = {
  name: 'query_data',
  description:
    'Generic governed structured query tool. Accepts allow-listed entities, fields, and operators with mandatory server-side scope injection. Never executes raw SQL.',
  risk: 'read',
  inputSchema: z.object({
    entity: z.enum([
      'students',
      'sectors',
      'classes',
      'payments',
      'funds',
      'batches',
      'managers',
      'signatories',
      'notices',
      'issued_reports',
      'audit_logs',
    ]),
    filters: z
      .array(
        z.object({
          field: z.string(),
          op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
          value: z.unknown(),
        })
      )
      .optional(),
    fields: z.array(z.string()).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        enum: [
          'students',
          'sectors',
          'classes',
          'payments',
          'funds',
          'batches',
          'managers',
          'signatories',
          'notices',
          'issued_reports',
          'audit_logs',
        ],
      },
      filters: { type: 'array', items: { type: 'object' } },
      fields: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
    },
    required: ['entity'],
  },
  summarize: (args) => `Structured query on "${String(args.entity)}"`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();
    try {
      const res = await scopedRepository.executeStructuredQuery(
        {
          entity: args.entity as
            | 'students'
            | 'sectors'
            | 'classes'
            | 'payments'
            | 'funds'
            | 'batches'
            | 'managers'
            | 'signatories'
            | 'notices'
            | 'issued_reports'
            | 'audit_logs',
          filters: Array.isArray(args.filters)
            ? (args.filters as Array<{
                field: string;
                op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
                value: unknown;
              }>)
            : undefined,
          fields: Array.isArray(args.fields) ? args.fields.map(String) : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        },
        scope
      );
      const qRows = res.rows as Array<Record<string, unknown>>;
      const colKeys = qRows.length > 0 ? Object.keys(qRows[0]) : [];
      const qColumns: ExportColumn[] = colKeys.map((k) => ({ key: k, label: k, format: 'text' }));
      const exportFile = saveAndBuildDatasetExport({
        appId: ctx.appId,
        conversationId: ctx.conversationId,
        scope,
        userId: ctx.userId,
        title: `${String(args.entity)} Query Results`,
        entityType: String(args.entity),
        columns: qColumns,
        rows: qRows,
        rawRows: qRows,
      });
      return {
        ok: true,
        summary: `Retrieved ${res.rows.length} record(s) from "${args.entity}".`,
        data: res,
        ...(exportFile ? { exportFile } : {}),
      };
    } catch (err: unknown) {
      return {
        ok: false,
        summary: `Query rejected: ${err instanceof Error ? err.message : 'Invalid query'}`,
        data: null,
      };
    }
  },
};

export const comparePeriodsTool: ToolDefinition = {
  name: 'compare_periods',
  description:
    'Compare collections, debits, net balance, and transaction counts between two date periods within your authorized scope.',
  risk: 'read',
  inputSchema: z.object({
    period1Start: z.string().min(4),
    period1End: z.string().min(4),
    period2Start: z.string().min(4),
    period2End: z.string().min(4),
    sector: z.string().optional(),
    period1Label: z.string().optional(),
    period2Label: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      period1Start: { type: 'string', description: 'YYYY-MM-DD start of baseline period' },
      period1End: { type: 'string', description: 'YYYY-MM-DD end of baseline period' },
      period2Start: { type: 'string', description: 'YYYY-MM-DD start of comparison period' },
      period2End: { type: 'string', description: 'YYYY-MM-DD end of comparison period' },
      sector: { type: 'string', description: 'Optional sector slug' },
      period1Label: { type: 'string' },
      period2Label: { type: 'string' },
    },
    required: ['period1Start', 'period1End', 'period2Start', 'period2End'],
  },
  summarize: (args) =>
    `Compare period ${String(args.period1Label || `${args.period1Start}..${args.period1End}`)} vs ${String(args.period2Label || `${args.period2Start}..${args.period2End}`)}`,
  async execute(args, ctx) {
    const scope = getScope(ctx);
    if (scope.role === 'PUBLIC') return denyScope();

    const sectorArg = typeof args.sector === 'string' && args.sector.trim() ? args.sector.trim() : undefined;
    if (
      scope.role === 'SECTOR_MANAGER' &&
      sectorArg &&
      !(scope.sectorIds || []).some((s) => s.toLowerCase() === sectorArg.toLowerCase())
    ) {
      return denyScope();
    }

    const res = await scopedRepository.comparePeriods(
      {
        period1Start: String(args.period1Start),
        period1End: String(args.period1End),
        period2Start: String(args.period2Start),
        period2End: String(args.period2End),
        sector: sectorArg,
      },
      scope
    );

    const p1Label = String(args.period1Label || `${res.period1.start} to ${res.period1.end}`);
    const p2Label = String(args.period2Label || `${res.period2.start} to ${res.period2.end}`);
    const deltaSign = res.deltaCredit >= 0 ? '+' : '-';
    const pctText =
      res.percentChangeCredit !== null
        ? ` (${res.percentChangeCredit >= 0 ? '+' : ''}${res.percentChangeCredit}%)`
        : '';

    const lines = [
      `### Period Comparison${sectorArg ? ` · Sector \`${sectorArg}\`` : ''}`,
      `- **${p1Label}**: Credits ${fmtInr(res.period1.credit)}, Debits ${fmtInr(res.period1.debit)}, Net ${fmtInr(res.period1.net)} (${res.period1.count} entries)`,
      `- **${p2Label}**: Credits ${fmtInr(res.period2.credit)}, Debits ${fmtInr(res.period2.debit)}, Net ${fmtInr(res.period2.net)} (${res.period2.count} entries)`,
      `- **Collection Change**: ${deltaSign}${fmtInr(Math.abs(res.deltaCredit))}${pctText} · **Net Change**: ${res.deltaNet >= 0 ? '+' : '-'}${fmtInr(Math.abs(res.deltaNet))}`,
    ];

    return { ok: true, summary: lines.join('\n'), data: res };
  },
};

export const DATA_ACCESS_TOOLS: Record<string, ToolDefinition> = {
  find_students: findStudentsTool,
  get_student: getStudentTool,
  list_students: listStudentsScopedTool,
  summarize_student_finance: summarizeStudentFinanceTool,
  find_sectors: findSectorsTool,
  get_sector: getSectorTool,
  summarize_sector_finance: summarizeSectorFinanceTool,
  find_classes: findClassesTool,
  get_class: getClassTool,
  summarize_class: summarizeClassTool,
  report_class: reportClassTool,
  find_payments: findPaymentsTool,
  list_payments: listPaymentsTool,
  summarize_collections: summarizeCollectionsTool,
  compare_periods: comparePeriodsTool,
  report_defaulters: reportDefaultersTool,
  get_receipt: getReceiptTool,
  list_batches: listBatchesTool,
  get_batch: getBatchTool,
  summarize_batches: summarizeBatchesTool,
  find_users: findUsersTool,
  list_users: listUsersTool,
  get_user: getUserTool,
  summarize_managers: summarizeManagersTool,
  find_funds: findFundsTool,
  list_funds: listFundsTool,
  get_fund: getFundTool,
  report_fund_utilization: reportFundUtilizationTool,
  list_signatories: listSignatoriesTool,
  get_signatory: getSignatoryTool,
  summarize_signatories: summarizeSignatoriesTool,
  list_notices: listNoticesTool,
  get_notice: getNoticeTool,
  summarize_notices: summarizeNoticesTool,
  list_issued_reports: listIssuedReportsTool,
  get_issued_report: getIssuedReportTool,
  summarize_issued_reports: summarizeIssuedReportsTool,
  list_audit_logs: listAuditLogsTool,
  get_audit_log: getAuditLogTool,
  summarize_audit_activity: summarizeAuditActivityTool,
  list_organizations: listOrganizationsTool,
  get_organization: getOrganizationTool,
  summarize_platform_usage: summarizePlatformUsageTool,
  query_data: queryDataTool,
};
