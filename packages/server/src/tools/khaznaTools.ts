import crypto from 'node:crypto';
import { z } from 'zod';
import {
  DEFAULT_IMPORT_BATCH_SIZE,
  type CursorWaypoint,
  type ExportColumn,
  type FormRequest,
} from '@ai-assistant/core';
import { saveAndBuildDatasetExport } from './datasetState.ts';
import type { ToolDefinition, ToolExecutionContext } from './types.ts';

function readAppState(ctx: ToolExecutionContext): Record<string, unknown> {
  return (ctx.appState && typeof ctx.appState === 'object' ? ctx.appState : {}) as Record<
    string,
    unknown
  >;
}

type KhaznaRole = 'admin' | 'manager' | 'student';

function getRole(state: Record<string, unknown>): KhaznaRole {
  const r = String(state.role || 'admin').toLowerCase();
  if (r === 'student' || r === 'manager' || r === 'admin') return r;
  return 'admin';
}

function getAllowedSectorSlug(state: Record<string, unknown>): string {
  return typeof state.managerSector === 'string' && state.managerSector.trim()
    ? state.managerSector.trim()
    : 'dept-fiqh';
}

function getAllowedStudentId(state: Record<string, unknown>): string {
  return typeof state.meStudentId === 'string' ? state.meStudentId.trim() : '';
}

function denyRole(action: string, role: KhaznaRole) {
  return {
    ok: false,
    summary: `Access denied: your current **${role}** account does not have permission to ${action}.`,
    data: { denied: true, role, action },
  };
}

function normalizeSectorToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bdepartment\b/g, 'dept')
    .replace(/\bdivision\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isSameSectorQuery(
  reqRaw: string,
  assignedSlug: string,
  assignedSecRec?: Record<string, unknown>
): boolean {
  const reqNorm = normalizeSectorToken(reqRaw);
  if (!reqNorm) return true;
  const slugNorm = normalizeSectorToken(assignedSlug);
  const nameNorm = normalizeSectorToken(String(assignedSecRec?.name || ''));
  const shortNorm = normalizeSectorToken(String(assignedSecRec?.short || ''));
  if (
    slugNorm === reqNorm ||
    nameNorm === reqNorm ||
    shortNorm === reqNorm ||
    slugNorm.includes(reqNorm) ||
    nameNorm.includes(reqNorm) ||
    reqNorm.includes(slugNorm) ||
    (nameNorm && reqNorm.includes(nameNorm))
  ) {
    return true;
  }
  const reqWords = reqNorm.split(' ').filter((w) => w.length >= 3 && w !== 'dept' && w !== 'sector');
  return reqWords.some((w) => slugNorm.includes(w) || nameNorm.includes(w));
}

function resolveSectorSlug(
  rawSector: unknown,
  sectors: Array<Record<string, unknown>>,
  fallbackSlug = 'dept-fiqh'
): { slug: string; name: string; receiptPrefix: string; matched: boolean } {
  const qRaw = typeof rawSector === 'string' ? rawSector.trim() : '';
  const qNorm = normalizeSectorToken(qRaw);
  if (qNorm && sectors.length > 0) {
    const matched = sectors.find((s) => isSameSectorQuery(qRaw, String(s.slug || ''), s));
    if (matched) {
      return {
        slug: String(matched.slug),
        name: String(matched.name || matched.slug),
        receiptPrefix: String(matched.receiptPrefix || 'KZ-'),
        matched: true,
      };
    }
  }
  const fallback =
    sectors.find((s) => String(s.slug) === fallbackSlug) ||
    sectors[0] || {
      slug: fallbackSlug,
      name: fallbackSlug,
      receiptPrefix: 'KZ-',
    };
  return {
    slug: String(fallback.slug),
    name: String(fallback.name || fallback.slug),
    receiptPrefix: String(fallback.receiptPrefix || 'KZ-'),
    matched: false,
  };
}

function findMatchingStudentsInState(
  students: Array<Record<string, unknown>>,
  args: Record<string, unknown>
): { exact?: Record<string, unknown>; matches: Array<Record<string, unknown>> } {
  const qId = typeof args.studentId === 'string' ? args.studentId.trim().toLowerCase() : '';
  const qName = typeof args.studentName === 'string' ? args.studentName.trim().toLowerCase() : '';
  if (qId) {
    const byId = students.find((s) => String(s.id || '').toLowerCase() === qId);
    if (byId) return { exact: byId, matches: [byId] };
  }
  if (qName) {
    const exact = students.find((s) => String(s.name || '').toLowerCase() === qName);
    if (exact) return { exact, matches: [exact] };
    const partial = students.filter((s) => String(s.name || '').toLowerCase().includes(qName));
    if (partial.length > 0) return { matches: partial };
    const words = qName.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length > 0) {
      const allWords = students.filter((s) => {
        const nm = String(s.name || '').toLowerCase();
        return words.every((w) => nm.includes(w));
      });
      if (allWords.length > 0) return { matches: allWords };
    }
  }
  return { matches: [] };
}

function findStudentInState(
  students: Array<Record<string, unknown>>,
  args: Record<string, unknown>
): Record<string, unknown> | undefined {
  return findMatchingStudentsInState(students, args).matches[0];
}

function fmtInr(n: number): string {
  const abs = Math.abs(Math.round(n)).toLocaleString('en-IN');
  return n < 0 ? `-₹${abs}` : `₹${abs}`;
}

export const khaznaGetOverviewTool: ToolDefinition = {
  name: 'khaznaGetOverview',
  description:
    'Read the strictly role-scoped live Khazna Campus Ledger display report (Student sees only their own account & transactions; Sector Manager sees only their assigned sector and students within that sector; College Admin sees active campus totals).',
  risk: 'read',
  inputSchema: z.object({
    sector: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sector: { type: 'string', description: 'Optional sector slug or name to inspect' },
    },
  },
  summarize: () => 'Read currently open Khazna display report',
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    const collegeObj = (state.college && typeof state.college === 'object'
      ? state.college
      : {}) as Record<string, unknown>;
    const collegeName = String(collegeObj.name || 'Khazna Campus');

    if (role === 'student') {
      const me = ((state.meStudent || {}) as Record<string, unknown>);
      const mySummary = ((state.mySummary || {}) as Record<string, unknown>);
      const mySectors = Array.isArray(state.mySectors)
        ? (state.mySectors as Array<Record<string, unknown>>)
        : [];
      const myTxs = Array.isArray(state.myTransactions)
        ? (state.myTransactions as Array<Record<string, unknown>>)
        : [];

      const lines = [
        `Here is your current **Student Display Report** for **${collegeName}**:`,
        `- **Student**: ${String(me.name || 'Student')} (${String(me.id || state.meStudentId || '—')}) · Class: ${String(me.className || '—')}`,
        `- **My Total Credit**: ${fmtInr(Number(mySummary.credit || 0))}`,
        `- **My Total Debit**: ${fmtInr(Number(mySummary.debit || 0))}`,
        `- **My Net Balance**: ${fmtInr(Number(mySummary.balance || 0))}`,
      ];

      if (mySectors.length > 0) {
        lines.push('', '**My Sector Balances:**');
        mySectors.forEach((sec, idx) => {
          lines.push(
            `${idx + 1}. **${String(sec.name || sec.slug)}** — Credit: ${fmtInr(Number(sec.credit || 0))}, Debit: ${fmtInr(Number(sec.debit || 0))}, Balance: ${fmtInr(Number(sec.balance || 0))}`
          );
        });
      }

      if (myTxs.length > 0) {
        lines.push('', '**My Recent Transactions:**');
        myTxs.slice(0, 8).forEach((t) => {
          lines.push(
            `- ${String(t.title || 'Entry')} (${String(t.type || 'credit')}) — ${fmtInr(Number(t.amount || 0))} · Receipt \`${String(t.receiptNo || t.id)}\` (${String(t.date || '')})`
          );
        });
      } else {
        lines.push('', 'No transactions recorded on your account yet.');
      }

      const formattedReport = lines.join('\n');
      return {
        ok: true,
        summary: formattedReport,
        data: { role, college: collegeObj, meStudent: me, mySummary, mySectors, myTransactions: myTxs, formattedReport },
        uiAction: {
          action: 'refresh',
          cursorWaypoints: [
            { label: 'Inspecting your student ledger cards', selector: 'main', action: 'move', delayMs: 420 },
          ],
          label: 'Student display report',
        },
      };
    }

    if (role === 'manager') {
      const managerSectorSlug = getAllowedSectorSlug(state);
      const sectors = Array.isArray(state.sectors)
        ? (state.sectors as Array<Record<string, unknown>>)
        : [];
      const sec = sectors.find((s) => String(s.slug) === managerSectorSlug) || sectors[0] || {};
      const reqSector = typeof args.sector === 'string' ? args.sector.trim() : '';
      if (reqSector && !isSameSectorQuery(reqSector, managerSectorSlug, sec)) {
        return denyRole(`view budget or balance for sector "${reqSector}" outside your assigned sector (${managerSectorSlug})`, role);
      }
      const txs = Array.isArray(state.recentTransactions)
        ? (state.recentTransactions as Array<Record<string, unknown>>)
        : [];
      const students = Array.isArray(state.students)
        ? (state.students as Array<Record<string, unknown>>)
        : [];

      const lines = [
        `Here is the current **Sector Manager Display Report** for **${collegeName}**:`,
        `- **Assigned Sector**: ${String(sec.name || managerSectorSlug)} (\`${managerSectorSlug}\`)`,
        `- **Target**: ${fmtInr(Number(sec.target || 0))}`,
        `- **Credits**: ${fmtInr(Number(sec.credit || 0))}`,
        `- **Debits**: ${fmtInr(Number(sec.debit || 0))}`,
        `- **Net Balance**: ${fmtInr(Number(sec.balance || 0))}`,
        `- **Students Active in Sector**: ${students.length}`,
      ];

      if (txs.length > 0) {
        lines.push('', '**Recent Sector Transactions:**');
        txs.slice(0, 8).forEach((t) => {
          lines.push(
            `- ${String(t.title || 'Entry')} (${String(t.type || 'credit')}) — ${fmtInr(Number(t.amount || 0))} by ${String(t.studentName || t.studentId)} · Receipt \`${String(t.receiptNo || t.id)}\``
          );
        });
      }

      const formattedReport = lines.join('\n');
      return {
        ok: true,
        summary: formattedReport,
        data: { ...state, formattedReport },
        uiAction: {
          action: 'refresh',
          cursorWaypoints: [
            { label: `Scanning ${String(sec.name || managerSectorSlug)} ledger`, selector: 'main', action: 'move', delayMs: 420 },
          ],
          label: 'Manager display report',
        },
      };
    }

    // College Admin
    const sectors = Array.isArray(state.sectors)
      ? (state.sectors as Array<Record<string, unknown>>)
      : [];
    const txs = Array.isArray(state.recentTransactions)
      ? (state.recentTransactions as Array<Record<string, unknown>>)
      : [];

    const lines = [
      `Here is the current **Admin Display Report** for **${collegeName}**:`,
      `- **Total Students**: ${Number(state.totalStudents || 0)}`,
      `- **Active Sectors**: ${sectors.length}`,
    ];

    if (sectors.length > 0) {
      lines.push('', '**Sectors Overview:**');
      sectors.forEach((s, idx) => {
        lines.push(
          `${idx + 1}. **${String(s.name || s.slug)}** — Target: ${fmtInr(Number(s.target || 0))}, Credits: ${fmtInr(Number(s.credit || 0))}, Debits: ${fmtInr(Number(s.debit || 0))}, Balance: ${fmtInr(Number(s.balance || 0))} (${Number(s.count || 0)} entries)`
        );
      });
    }

    if (txs.length > 0) {
      lines.push('', '**Recent Campus Transactions:**');
      txs.slice(0, 8).forEach((t) => {
        lines.push(
          `- ${String(t.title || 'Entry')} (${String(t.type || 'credit')}) — ${fmtInr(Number(t.amount || 0))} by ${String(t.studentName || t.studentId)}`
        );
      });
    }

    const formattedReport = lines.join('\n');
    return {
      ok: true,
      summary: formattedReport,
      data: { ...state, formattedReport },
      uiAction: {
        action: 'refresh',
        cursorWaypoints: [
          { label: 'Inspecting active campus dashboard', selector: 'main', action: 'move', delayMs: 420 },
        ],
        label: 'Admin display report',
      },
    };
  },
};

export const khaznaListStudentsTool: ToolDefinition = {
  name: 'khaznaListStudents',
  description:
    'List, count, or search students permitted for the current role (Student sees only themselves; Manager sees student balances in their assigned sector only; Admin sees active org directory), including debit charges and pending dues.',
  risk: 'read',
  inputSchema: z.object({
    query: z.string().optional(),
    className: z.string().optional(),
    sector: z.string().optional(),
    pendingOnly: z.boolean().optional(),
    hasDebit: z.boolean().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional student name or Ad.No (e.g. S0125)' },
      className: { type: 'string', description: 'Optional class name filter (e.g. Fiqh 2)' },
      sector: { type: 'string', description: 'Optional sector slug or name' },
      pendingOnly: { type: 'boolean', description: 'When true, return only students with pending/due fee balance' },
      hasDebit: { type: 'boolean', description: 'When true, return only students who have debit entries/charges' },
    },
  },
  summarize: (args) =>
    `List Khazna students${args.hasDebit ? ' with debit entries' : args.pendingOnly ? ' with pending fees' : ''}${args.className ? ` in ${String(args.className)}` : ''}${args.sector ? ` (${String(args.sector)})` : ''}${args.query ? ` matching "${String(args.query)}"` : ''}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);

    if (role === 'student') {
      const me = (state.meStudent || {}) as Record<string, unknown>;
      return {
        ok: true,
        summary: `Showing only your own student profile: **${String(me.name || 'Student')}** (${String(me.id || getAllowedStudentId(state))}). Access to other students' records is restricted in Student view.`,
        data: { total: me.id ? 1 : 0, students: me.id ? [me] : [] },
      };
    }

    const managerSector = getAllowedSectorSlug(state);
    const sectorsList = Array.isArray(state.sectors)
      ? (state.sectors as Array<Record<string, unknown>>)
      : [];
    const assignedSecRec = sectorsList.find((s) => String(s.slug) === managerSector) || sectorsList[0];
    const sectorQ = typeof args.sector === 'string' ? args.sector.trim() : '';

    if (role === 'manager' && sectorQ && !isSameSectorQuery(sectorQ, managerSector, assignedSecRec)) {
      return denyRole(`view students outside your assigned sector (${managerSector})`, role);
    }

    const resolvedAdminSector =
      role === 'admin' && sectorQ ? resolveSectorSlug(sectorQ, sectorsList, '') : undefined;
    const targetSectorSlug =
      resolvedAdminSector?.matched ? resolvedAdminSector.slug : undefined;

    const students = Array.isArray(state.students)
      ? (state.students as Array<Record<string, unknown>>)
      : [];
    const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const cls = typeof args.className === 'string' ? args.className.trim().toLowerCase() : '';
    const pendingOnly = Boolean(args.pendingOnly);
    const hasDebit = Boolean(args.hasDebit);

    const getMetrics = (s: Record<string, unknown>) => {
      const secMap =
        s.bySector && typeof s.bySector === 'object'
          ? (s.bySector as Record<string, Record<string, unknown>>)
          : undefined;
      const src =
        role === 'admin' && targetSectorSlug && secMap
          ? secMap[targetSectorSlug] || { credit: 0, debit: 0, balance: 0 }
          : s;
      const credit = Number(src.credit ?? 0);
      const debit = Number(src.debit ?? 0);
      const bal = Number(src.balance ?? credit - debit);
      const explicitPending = Number(src.pendingFee ?? src.due ?? 0);
      const netDue = explicitPending > 0 ? explicitPending : bal < 0 ? Math.abs(bal) : 0;
      return { credit, debit, bal, netDue };
    };

    const filtered = students.filter((s) => {
      if (cls && !String(s.className || '').toLowerCase().includes(cls)) return false;
      const { debit, netDue } = getMetrics(s);
      if (pendingOnly && !(netDue > 0)) return false;
      if (hasDebit && !(debit > 0 || netDue > 0)) return false;
      if (q) {
        const hay = `${s.id || ''} ${s.name || ''} ${s.className || ''} ${s.guardian || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const totalDebit = filtered.reduce((acc, s) => acc + getMetrics(s).debit, 0);
    const dueStudents = filtered.filter((s) => getMetrics(s).netDue > 0);
    const totalDue = dueStudents.reduce((acc, s) => acc + getMetrics(s).netDue, 0);

    const scopeNote =
      role === 'manager'
        ? ` in sector \`${managerSector}\``
        : targetSectorSlug
          ? ` in sector \`${targetSectorSlug}\``
          : '';

    const listed = filtered
      .slice(0, 15)
      .map((s) => {
        const { credit, debit, netDue } = getMetrics(s);
        const parts: string[] = [];
        if (debit > 0 || hasDebit) parts.push(`Debit: ${fmtInr(debit)}`);
        if (credit > 0 || hasDebit) parts.push(`Credit: ${fmtInr(credit)}`);
        if (netDue > 0) parts.push(`Due: ${fmtInr(netDue)}`);
        else if (hasDebit || pendingOnly) parts.push('Settled');
        const note = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
        return `- **${String(s.name || s.id)}** (\`${String(s.id)}\`, ${String(s.className || '—')})${note}`;
      })
      .join('\n');

    let summary: string;
    if (filtered.length === 0) {
      summary = `Found **0** matching students${hasDebit ? ' with debit entries' : pendingOnly ? ' with pending fees' : ''}${scopeNote}.`;
    } else if (hasDebit) {
      summary = `Found **${filtered.length}** student(s) with debit entries${scopeNote} (total debited: ${fmtInr(totalDebit)}; **${dueStudents.length}** currently have unpaid dues totaling ${fmtInr(totalDue)}):\n${listed}`;
    } else if (pendingOnly) {
      summary = `Found **${filtered.length}** student(s) with pending dues${scopeNote} (total due: ${fmtInr(totalDue)}):\n${listed}`;
    } else {
      summary = `Found **${filtered.length}** student(s)${scopeNote}:\n${listed}`;
    }

    const exportColumns: ExportColumn[] = hasDebit
      ? [
          { key: 'id', label: 'Ad.No', format: 'text' },
          { key: 'name', label: 'Full Name', format: 'text' },
          { key: 'className', label: 'Class', format: 'text' },
          { key: 'debitTotal', label: 'Debit', format: 'currency' },
          { key: 'paidTotal', label: 'Credit', format: 'currency' },
          { key: 'pendingFee', label: 'Due', format: 'currency' },
        ]
      : pendingOnly
        ? [
            { key: 'id', label: 'Ad.No', format: 'text' },
            { key: 'name', label: 'Full Name', format: 'text' },
            { key: 'className', label: 'Class', format: 'text' },
            { key: 'pendingFee', label: 'Due', format: 'currency' },
          ]
        : [
            { key: 'id', label: 'Ad.No', format: 'text' },
            { key: 'name', label: 'Full Name', format: 'text' },
            { key: 'className', label: 'Class', format: 'text' },
            { key: 'pendingFee', label: 'Due', format: 'currency' },
            { key: 'balance', label: 'Balance', format: 'currency' },
          ];

    const exportRows = filtered.map((s) => {
      const m = getMetrics(s);
      const base: Record<string, unknown> = {
        id: s.id || '',
        name: s.name || '',
        className: s.className || '',
        debitTotal: m.debit,
        paidTotal: m.credit,
        pendingFee: m.netDue,
        balance: m.bal,
        phone: s.phone || '',
      };
      const projected: Record<string, unknown> = {};
      for (const col of exportColumns) {
        projected[col.key] = base[col.key] ?? s[col.key] ?? '';
      }
      return projected;
    });

    const listTitle = cls
      ? `${cls.toUpperCase()} Students`
      : hasDebit
        ? 'Students with Debit Entries'
        : pendingOnly
          ? 'Students with Pending Dues'
          : 'Students List';

    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope: ctx.scope,
      userId: ctx.userId,
      title: listTitle,
      entityType: 'student',
      entityNoun: filtered.length === 1 ? 'student' : 'students',
      columns: exportColumns,
      rows: exportRows,
      rawRows: filtered.map((s) => {
        const m = getMetrics(s);
        return {
          ...s,
          debitTotal: m.debit,
          paidTotal: m.credit,
          pendingFee: m.netDue,
          balance: m.bal,
        };
      }),
      filters: {
        ...(cls ? { className: cls } : {}),
        ...(targetSectorSlug ? { sectorId: targetSectorSlug } : {}),
      },
      pendingOnly,
    });

    return {
      ok: true,
      summary,
      data: {
        total: filtered.length,
        totalStudentsInScope: students.length,
        totalDebit,
        dueCount: dueStudents.length,
        totalDue,
        students: filtered.slice(0, 25),
      },
      ...(exportFile ? { exportFile } : {}),
    };
  },
};

export const khaznaListTransactionsTool: ToolDefinition = {
  name: 'khaznaListTransactions',
  description:
    'List Khazna ledger entries strictly within current role permissions (Student: own transactions only; Manager: assigned sector only; Admin: active org).',
  risk: 'read',
  inputSchema: z.object({
    sector: z.string().optional(),
    studentQuery: z.string().optional(),
    type: z.enum(['credit', 'debit', 'all']).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sector: { type: 'string', description: 'Optional sector slug or name' },
      studentQuery: { type: 'string', description: 'Optional student name or Ad.No' },
      type: { type: 'string', enum: ['credit', 'debit', 'all'] },
    },
  },
  summarize: () => 'List matching Khazna ledger transactions',
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    const managerSector = getAllowedSectorSlug(state);
    const sectorQ = typeof args.sector === 'string' ? args.sector.trim().toLowerCase() : '';
    const studentQ =
      typeof args.studentQuery === 'string' ? args.studentQuery.trim().toLowerCase() : '';
    const type = args.type || 'all';

    const sectorsList = Array.isArray(state.sectors)
      ? (state.sectors as Array<Record<string, unknown>>)
      : [];
    const assignedSecRec = sectorsList.find((s) => String(s.slug) === managerSector) || sectorsList[0];

    if (role === 'manager' && sectorQ && !isSameSectorQuery(sectorQ, managerSector, assignedSecRec)) {
      return denyRole(`view transactions outside your assigned sector (${managerSector})`, role);
    }

    const rawTxs =
      role === 'student'
        ? Array.isArray(state.myTransactions)
          ? (state.myTransactions as Array<Record<string, unknown>>)
          : []
        : Array.isArray(state.recentTransactions)
          ? (state.recentTransactions as Array<Record<string, unknown>>)
          : [];

    const filtered = rawTxs.filter((t) => {
      if (role === 'manager' && String(t.sector || '') !== managerSector) return false;
      if (sectorQ && !String(t.sector || '').toLowerCase().includes(sectorQ)) return false;
      if (type !== 'all' && String(t.type || '') !== type) return false;
      if (studentQ) {
        const hay = `${t.studentId || ''} ${t.studentName || ''} ${t.title || ''} ${t.receiptNo || ''}`.toLowerCase();
        if (!hay.includes(studentQ)) return false;
      }
      return true;
    });

    const txColumns: ExportColumn[] = [
      { key: 'receiptNo', label: 'Receipt', format: 'text' },
      { key: 'date', label: 'Date', format: 'date' },
      { key: 'studentName', label: 'Student', format: 'text' },
      { key: 'sector', label: 'Sector', format: 'text' },
      { key: 'type', label: 'Type', format: 'text' },
      { key: 'title', label: 'Title', format: 'text' },
      { key: 'amount', label: 'Amount', format: 'currency' },
    ];
    const txRows = filtered.map((t) => ({
      receiptNo: t.receiptNo || '',
      date: String(t.date || '').slice(0, 10),
      studentName: t.studentName || t.studentId || '',
      sector: t.sector || '',
      type: t.type || '',
      title: t.title || '',
      amount: Number(t.amount ?? 0),
    }));
    const exportFile = saveAndBuildDatasetExport({
      appId: ctx.appId,
      conversationId: ctx.conversationId,
      scope: ctx.scope,
      userId: ctx.userId,
      title: 'Ledger Entries',
      entityType: 'transaction',
      entityNoun: filtered.length === 1 ? 'entry' : 'entries',
      columns: txColumns,
      rows: txRows,
      rawRows: filtered,
    });

    return {
      ok: true,
      summary: `Retrieved ${filtered.length} permitted ledger entry(ies).`,
      data: { transactions: filtered.slice(0, 25) },
      ...(exportFile ? { exportFile } : {}),
    };
  },
};

export const khaznaCreateCollegeAccountTool: ToolDefinition = {
  name: 'khaznaCreateCollegeAccount',
  description:
    'Create a brand-new isolated Khazna Campus Ledger account/organization for a college with college name, administrator full name, email, and password.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    college: z.string().min(3).max(160),
    fullName: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(4).max(120),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      college: { type: 'string', description: 'College or institution name e.g. Islahul Uloom Arabic College' },
      fullName: { type: 'string', description: 'Super administrator full name' },
      email: { type: 'string', description: 'Administrator email address' },
      password: { type: 'string', description: 'Account password' },
    },
    required: ['college', 'fullName', 'email', 'password'],
  },
  summarize: (args) => `Create campus account "${String(args.college)}" for ${String(args.fullName)}`,
  async execute(args) {
    const college = String(args.college).trim();
    const fullName = String(args.fullName).trim();
    const email = String(args.email).trim().toLowerCase();
    const password = String(args.password);

    return {
      ok: true,
      summary: `Created a new isolated Khazna Campus account for **${college}** (Admin: **${fullName}**, Email: \`${email}\`) and opened the Admin dashboard.`,
      data: { college, fullName, email },
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'SIGNUP_COLLEGE',
          payload: { college, name: fullName, email, password },
        },
        cursorWaypoints: [
          { label: 'Registering campus workspace', xPercent: 52, yPercent: 28, action: 'move', delayMs: 360 },
          { label: `Creating ${college}`, selector: 'main', action: 'click', delayMs: 420 },
        ],
        label: `Created campus account ${college}`,
      },
    };
  },
};

export const khaznaNavigateTool: ToolDefinition = {
  name: 'khaznaNavigate',
  description:
    'Navigate within the user’s permitted workspace pages (Admin, Manager of assigned sector, or Student portal) or switch demo role when explicitly requested.',
  risk: 'read',
  inputSchema: z.object({
    route: z.string().optional(),
    role: z.enum(['admin', 'manager', 'student']).optional(),
    sector: z.string().optional(),
    loadDemo: z.boolean().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      route: { type: 'string' },
      role: { type: 'string', enum: ['admin', 'manager', 'student'] },
      sector: { type: 'string' },
      loadDemo: { type: 'boolean' },
    },
  },
  summarize: (args) => `Navigate Khazna to ${String(args.route || args.role || 'workspace')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const currentRole = getRole(state);
    const assignedSector = getAllowedSectorSlug(state);
    const sectors = Array.isArray(state.sectors)
      ? (state.sectors as Array<Record<string, unknown>>)
      : [];

    const reqRole = args.role as KhaznaRole | undefined;
    let route = typeof args.route === 'string' && args.route.trim() ? args.route.trim() : '';
    if (route === '/logout') route = '/login';

    if (route === '/login') {
      const currentPath = String(state.pathname || '');
      const alreadyOnLogin = currentPath === '/login';
      return {
        ok: true,
        summary: alreadyOnLogin
          ? 'You are already signed out on the Login page (`/login`).'
          : 'Signed out of your current session and navigated to the Login page (`/login`).',
        data: { route: '/login', signOut: true },
        uiAction: {
          action: 'refresh',
          appCommand: {
            command: 'NAVIGATE',
            payload: {
              route: '/login',
              signOut: true,
            },
          },
          cursorWaypoints: [
            { label: 'Signing out to Login', selector: 'main, header', action: 'click', delayMs: 320 },
          ],
          label: 'Sign out to /login',
        },
      };
    }

    // Enforce strict RBAC on route navigation when user is NOT loading demo or switching roles explicitly via "open demo"
    if (!args.loadDemo && !reqRole) {
      if (currentRole === 'student' && (route.startsWith('/admin') || route.startsWith('/m/'))) {
        return denyRole(`open ${route}`, currentRole);
      }
      if (currentRole === 'manager' && route.startsWith('/admin')) {
        return denyRole(`open ${route}`, currentRole);
      }
    }

    const resolved =
      currentRole === 'manager' && !reqRole && !args.loadDemo
        ? { slug: assignedSector, name: assignedSector, receiptPrefix: '' }
        : resolveSectorSlug(args.sector, sectors, assignedSector);

    if (!route) {
      const targetRole = reqRole || currentRole;
      if (targetRole === 'admin') route = '/admin';
      else if (targetRole === 'manager') route = `/m/${resolved.slug}`;
      else route = '/app';
    }

    return {
      ok: true,
      summary: `Opened **${route}**${reqRole ? ` as **${reqRole}**` : ''}.`,
      data: { route, role: reqRole, sectorSlug: resolved.slug },
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'NAVIGATE',
          payload: {
            route,
            role: reqRole,
            sectorSlug: resolved.slug,
            loadDemo: args.loadDemo === true,
          },
        },
        cursorWaypoints: [
          { label: `Navigating to ${route}`, selector: 'nav a, main', action: 'click', delayMs: 360 },
        ],
        label: `Navigate to ${route}`,
      },
    };
  },
};

export const khaznaCreateEntryTool: ToolDefinition = {
  name: 'khaznaCreateEntry',
  description:
    'Post a new Credit (deposit/payment) or Debit (fee/charge) entry into a Khazna sector ledger immediately. Manager can only post inside their assigned sector.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    studentId: z.string().optional(),
    studentName: z.string().optional(),
    sector: z.string().optional(),
    type: z.enum(['credit', 'debit']).default('credit'),
    title: z.string().optional(),
    amount: z.coerce.number().positive(),
    reason: z.string().optional(),
    receiptNo: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string' },
      studentName: { type: 'string' },
      sector: { type: 'string' },
      type: { type: 'string', enum: ['credit', 'debit'] },
      title: { type: 'string' },
      amount: { type: 'number' },
      reason: { type: 'string' },
      receiptNo: { type: 'string' },
    },
    required: ['amount'],
  },
  summarize: (args) =>
    `Post ${String(args.type || 'credit')} ₹${Number(args.amount || 0).toLocaleString('en-IN')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') {
      return denyRole('post ledger entries', role);
    }

    const sectors = Array.isArray(state.sectors)
      ? (state.sectors as Array<Record<string, unknown>>)
      : [];
    const students = Array.isArray(state.students)
      ? (state.students as Array<Record<string, unknown>>)
      : [];

    const assignedSector = getAllowedSectorSlug(state);
    const assignedSecRec = sectors.find((s) => String(s.slug) === assignedSector) || sectors[0];
    if (role === 'manager' && typeof args.sector === 'string' && args.sector.trim()) {
      if (!isSameSectorQuery(args.sector, assignedSector, assignedSecRec)) {
        return denyRole(`post entries into sector "${String(args.sector).trim()}"`, role);
      }
    }

    const sectorExplicitlyMatched =
      typeof args.sector === 'string' && args.sector.trim().length > 0;
    const resolvedSector = resolveSectorSlug(
      role === 'manager' ? assignedSector : args.sector,
      sectors,
      assignedSector
    );
    const hasConfirmedSector =
      role === 'manager' || (sectorExplicitlyMatched && resolvedSector.matched);

    const hasStudentQuery =
      (typeof args.studentId === 'string' && args.studentId.trim().length > 0) ||
      (typeof args.studentName === 'string' && args.studentName.trim().length > 0);
    const studentLookup = hasStudentQuery
      ? findMatchingStudentsInState(students, args)
      : { matches: [] as Array<Record<string, unknown>> };
    const matchedStudent =
      studentLookup.exact || (studentLookup.matches.length === 1 ? studentLookup.matches[0] : undefined);

    const entryType = args.type === 'debit' ? 'debit' : 'credit';
    const title =
      typeof args.title === 'string' && args.title.trim()
        ? args.title.trim()
        : entryType === 'credit'
          ? 'Fee Payment'
          : 'Term Fee Charge';
    const amount = Math.max(1, Math.round(Number(args.amount)));

    if (!hasConfirmedSector || !matchedStudent) {
      const missingParts: string[] = [];
      if (!hasConfirmedSector) missingParts.push('which **sector**');
      if (!matchedStudent) {
        missingParts.push(
          studentLookup.matches.length > 1
            ? `which exact **student** (${studentLookup.matches.slice(0, 4).map((s) => `${String(s.name)} (${String(s.id)})`).join(', ')})`
            : 'which **student admission number**'
        );
      }

      const sectorOptions = sectors.map((s) => String(s.slug));
      const studentOptions = (studentLookup.matches.length > 1 ? studentLookup.matches : students.slice(0, 25)).map(
        (s) => String(s.id)
      );

      return {
        ok: true,
        summary: `Before I record **${entryType.toUpperCase()} ₹${amount.toLocaleString('en-IN')}**, please clarify ${missingParts.join(' and ')} below.`,
        data: {
          needsClarification: true,
          missingSector: !hasConfirmedSector,
          missingStudent: !matchedStudent,
          type: entryType,
          amount,
        },
        formRequest: {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Complete Ledger Entry Details',
          description: `Specify ${missingParts.map((p) => p.replace(/\*\*/g, '')).join(' and ')} for this ₹${amount.toLocaleString('en-IN')} ${entryType} entry.`,
          submitLabel: 'Post Entry',
          command: 'CREATE_ENTRY',
          fields: [
            ...(role === 'admin'
              ? [
                  {
                    key: 'sector',
                    label: 'Sector',
                    type: 'select' as const,
                    required: true,
                    placeholder: '-- Select a sector --',
                    options: sectorOptions,
                    value: hasConfirmedSector ? resolvedSector.slug : '',
                  },
                ]
              : []),
            matchedStudent
              ? {
                  key: 'studentId',
                  label: 'Student Ad.No',
                  type: 'text' as const,
                  required: true,
                  value: String(matchedStudent.id),
                }
              : studentLookup.matches.length > 1
                ? {
                    key: 'studentId',
                    label: 'Student Ad.No',
                    type: 'select' as const,
                    required: true,
                    placeholder: '-- Select matching student --',
                    options: studentOptions,
                    value: '',
                  }
                : {
                    key: 'studentId',
                    label: 'Student Ad.No',
                    type: 'text' as const,
                    required: true,
                    placeholder: 'Enter admission no. (e.g. S0125)',
                    value: '',
                  },
            {
              key: 'type',
              label: 'Entry Type',
              type: 'select' as const,
              required: true,
              options: ['credit', 'debit'],
              value: entryType,
            },
            {
              key: 'amount',
              label: 'Amount (₹)',
              type: 'number' as const,
              required: true,
              value: amount,
            },
            {
              key: 'title',
              label: 'Title / Note',
              type: 'text' as const,
              required: true,
              value: title,
            },
          ],
        },
      };
    }

    const sector = resolvedSector;
    const student = matchedStudent;
    const studentId = String(student.id);
    const studentName = String(student.name || studentId);
    const date = new Date().toISOString().slice(0, 10);
    const receiptNo =
      typeof args.receiptNo === 'string' && args.receiptNo.trim()
        ? args.receiptNo.trim().toUpperCase()
        : `${sector.receiptPrefix}${Math.floor(2000 + Math.random() * 7000)}`;
    const clientTxId = `TX_AI_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    return {
      ok: true,
      summary: `Posted **${entryType.toUpperCase()} ₹${amount.toLocaleString('en-IN')}** (${title}) for **${studentName}** (${studentId}) in **${sector.name}** — Receipt \`${receiptNo}\`.`,
      data: { txId: clientTxId, sector: sector.slug, studentId, studentName, type: entryType, title, amount, date, receiptNo },
      createdIds: [clientTxId],
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'CREATE_ENTRY',
          payload: {
            txId: clientTxId,
            sector: sector.slug,
            studentId,
            type: entryType,
            title,
            reason: typeof args.reason === 'string' ? args.reason : undefined,
            amount,
            date,
            receiptNo,
          },
        },
        cursorWaypoints: [
          { label: `Opening ${sector.name} ledger`, selector: 'main', action: 'move', delayMs: 360 },
          { label: `Posting ${receiptNo}`, selector: 'main button, main', action: 'click', delayMs: 420 },
        ],
        label: `Posted ${receiptNo} (₹${amount.toLocaleString('en-IN')})`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Removed ${createdIds.length} AI-posted ledger entry(ies).`,
      data: { undoneIds: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_ENTRIES', payload: { ids: createdIds } },
        label: 'Undo posted ledger entry',
      },
    };
  },
};

export const khaznaEditEntryTool: ToolDefinition = {
  name: 'khaznaEditEntry',
  description: 'Edit an existing ledger entry (title, amount, type, reason) in permitted sectors.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    receiptNo: z.string().optional(),
    txId: z.string().optional(),
    title: z.string().optional(),
    amount: z.coerce.number().positive().optional(),
    type: z.enum(['credit', 'debit']).optional(),
    reason: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      receiptNo: { type: 'string' },
      txId: { type: 'string' },
      title: { type: 'string' },
      amount: { type: 'number' },
      type: { type: 'string', enum: ['credit', 'debit'] },
      reason: { type: 'string' },
    },
  },
  summarize: (args) => `Edit entry ${String(args.receiptNo || args.txId || '')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') return denyRole('edit ledger entries', role);

    const txs = Array.isArray(state.recentTransactions)
      ? (state.recentTransactions as Array<Record<string, unknown>>)
      : [];
    const qRec = typeof args.receiptNo === 'string' ? args.receiptNo.trim().toLowerCase() : '';
    const qId = typeof args.txId === 'string' ? args.txId.trim().toLowerCase() : '';
    const match =
      (qId ? txs.find((t) => String(t.id || '').toLowerCase() === qId) : undefined) ||
      (qRec ? txs.find((t) => String(t.receiptNo || '').toLowerCase() === qRec) : undefined);

    if (!match) {
      return { ok: false, summary: 'No matching transaction found to edit.', data: { found: false } };
    }
    if (role === 'manager' && String(match.sector || '') !== getAllowedSectorSlug(state)) {
      return denyRole('edit entries in another sector', role);
    }

    return {
      ok: true,
      summary: `Updated ledger entry \`${String(match.receiptNo || match.id)}\`.`,
      data: { id: match.id },
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'EDIT_ENTRY',
          payload: {
            id: String(match.id),
            ...(args.title ? { title: String(args.title) } : {}),
            ...(args.amount ? { amount: Number(args.amount) } : {}),
            ...(args.type ? { type: String(args.type) } : {}),
            ...(args.reason ? { reason: String(args.reason) } : {}),
          },
        },
        cursorWaypoints: [{ label: `Updating ${String(match.receiptNo || match.id)}`, selector: 'main', action: 'click', delayMs: 360 }],
        label: `Edited ${String(match.receiptNo || match.id)}`,
      },
    };
  },
};

export const khaznaVoidEntryTool: ToolDefinition = {
  name: 'khaznaVoidEntry',
  description: 'Void an existing Khazna ledger entry by receipt number with a written reason.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    receiptNo: z.string().optional(),
    txId: z.string().optional(),
    studentName: z.string().optional(),
    reason: z.string().default('Corrected via AI Agent'),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      receiptNo: { type: 'string' },
      txId: { type: 'string' },
      studentName: { type: 'string' },
      reason: { type: 'string' },
    },
  },
  summarize: (args) => `Void ledger entry ${String(args.receiptNo || args.txId || args.studentName || 'selected')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') return denyRole('void ledger entries', role);

    const txs = Array.isArray(state.recentTransactions)
      ? (state.recentTransactions as Array<Record<string, unknown>>)
      : [];
    const active = txs.filter((t) => !t.voided);
    const qReceipt = typeof args.receiptNo === 'string' ? args.receiptNo.trim().toLowerCase() : '';
    const qTxId = typeof args.txId === 'string' ? args.txId.trim().toLowerCase() : '';
    const qStu = typeof args.studentName === 'string' ? args.studentName.trim().toLowerCase() : '';

    const match =
      (qTxId ? active.find((t) => String(t.id || '').toLowerCase() === qTxId) : undefined) ||
      (qReceipt ? active.find((t) => String(t.receiptNo || '').toLowerCase() === qReceipt) : undefined) ||
      (qStu ? active.find((t) => String(t.studentName || '').toLowerCase().includes(qStu)) : undefined);

    if (!match) {
      return {
        ok: false,
        summary: 'No matching active ledger entry was found to void.',
        data: { found: false },
      };
    }
    if (role === 'manager' && String(match.sector || '') !== getAllowedSectorSlug(state)) {
      return denyRole('void entries outside your assigned sector', role);
    }

    const txId = String(match.id);
    const receiptNo = String(match.receiptNo || txId);
    const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : 'Corrected via AI Agent';

    return {
      ok: true,
      summary: `Voided receipt **${receiptNo}** (${String(match.title)}, ${fmtInr(Number(match.amount || 0))}) — Reason: "${reason}".`,
      data: { txId, receiptNo, reason },
      createdIds: [txId],
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'VOID_ENTRY',
          payload: { id: txId, receiptNo, reason, sector: match.sector },
        },
        cursorWaypoints: [{ label: `Voiding receipt ${receiptNo}`, selector: 'main', action: 'click', delayMs: 380 }],
        label: `Voided ${receiptNo}`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Restored ${createdIds.length} voided entry(ies).`,
      data: { undoneIds: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'UNVOID_ENTRIES', payload: { ids: createdIds } },
        cursorWaypoints: [{ label: 'Restoring voided entry', selector: 'main', action: 'click', delayMs: 360 }],
        label: 'Restore voided entry',
      },
    };
  },
};

export const khaznaUnvoidEntryTool: ToolDefinition = {
  name: 'khaznaUnvoidEntry',
  description: 'Restore a voided Khazna ledger entry by receipt number or transaction ID.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    receiptNo: z.string().optional(),
    txId: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      receiptNo: { type: 'string' },
      txId: { type: 'string' },
    },
  },
  summarize: (args) => `Restore voided entry ${String(args.receiptNo || args.txId || '')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') return denyRole('restore voided ledger entries', role);

    const txs = Array.isArray(state.recentTransactions)
      ? (state.recentTransactions as Array<Record<string, unknown>>)
      : [];
    const voidedTxs = txs.filter((t) => Boolean(t.voided));
    const qRec = typeof args.receiptNo === 'string' ? args.receiptNo.trim().toLowerCase() : '';
    const qId = typeof args.txId === 'string' ? args.txId.trim().toLowerCase() : '';

    const match =
      (qId ? voidedTxs.find((t) => String(t.id || '').toLowerCase() === qId) : undefined) ||
      (qRec ? voidedTxs.find((t) => String(t.receiptNo || '').toLowerCase() === qRec) : undefined) ||
      voidedTxs[0];

    if (!match) {
      return {
        ok: false,
        summary: 'No matching voided ledger entry found to restore.',
        data: { found: false },
      };
    }
    if (role === 'manager' && String(match.sector || '') !== getAllowedSectorSlug(state)) {
      return denyRole('restore voided entries outside your assigned sector', role);
    }

    const txId = String(match.id);
    const receiptNo = String(match.receiptNo || txId);
    return {
      ok: true,
      summary: `Restored voided receipt **${receiptNo}** (${String(match.title || 'Entry')}).`,
      data: { txId, receiptNo },
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'UNVOID_ENTRIES',
          payload: { ids: [txId], sector: match.sector },
        },
        cursorWaypoints: [{ label: `Restoring receipt ${receiptNo}`, selector: 'main', action: 'click', delayMs: 360 }],
        label: `Restored ${receiptNo}`,
      },
    };
  },
};

export const khaznaAddStudentTool: ToolDefinition = {
  name: 'khaznaAddStudent',
  description: 'Add a new student directly into Khazna Campus Ledger Student Directory (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    name: z.string().min(2).max(120),
    id: z.string().optional(),
    className: z.string().optional(),
    phone: z.string().optional(),
    guardian: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      id: { type: 'string' },
      className: { type: 'string' },
      phone: { type: 'string' },
      guardian: { type: 'string' },
    },
    required: ['name'],
  },
  summarize: (args) => `Add student ${String(args.name)} to Khazna directory`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('add students to the campus directory', role);

    const students = Array.isArray(state.students)
      ? (state.students as Array<Record<string, unknown>>)
      : [];
    const classes = Array.isArray(state.classes) ? state.classes.map(String) : ['Fiqh 2', 'Thanawiyya 1'];

    let nextId = typeof args.id === 'string' && args.id.trim() ? args.id.trim().toUpperCase() : '';
    if (!nextId) {
      let maxNum = 160;
      for (const s of students) {
        const m = /^S(\d+)$/i.exec(String(s.id || ''));
        if (m) maxNum = Math.max(maxNum, Number(m[1]));
      }
      nextId = `S${String(maxNum + 1).padStart(4, '0')}`;
    }

    const reqClass = typeof args.className === 'string' ? args.className.trim().toLowerCase() : '';
    const matchedClass =
      (reqClass
        ? classes.find((c) => c.toLowerCase() === reqClass || c.toLowerCase().includes(reqClass))
        : undefined) ||
      (typeof args.className === 'string' && args.className.trim() ? args.className.trim() : classes[0] || 'Fiqh 2');

    const student = {
      id: nextId,
      name: String(args.name).trim(),
      className: matchedClass,
      phone: typeof args.phone === 'string' && args.phone.trim() ? args.phone.trim() : '9847000000',
      guardian: typeof args.guardian === 'string' && args.guardian.trim() ? args.guardian.trim() : 'Parent / Guardian',
      joined: new Date().toISOString().slice(0, 10),
    };

    return {
      ok: true,
      summary: `Enrolled **${student.name}** (${student.id}, class **${student.className}**) into Khazna Student Directory.`,
      data: { student },
      createdIds: [student.id],
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'ADD_STUDENT', payload: student },
        cursorWaypoints: [
          { label: 'Opening Student Directory', selector: 'main', action: 'move', delayMs: 320 },
          { label: `Enrolling ${student.name}`, selector: 'main', action: 'click', delayMs: 380 },
        ],
        label: `Added student ${student.name}`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Removed ${createdIds.length} added student(s) from Khazna.`,
      data: { undoneIds: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_STUDENTS', payload: { ids: createdIds } },
        label: 'Undo added student',
      },
    };
  },
};

export const khaznaEditStudentTool: ToolDefinition = {
  name: 'khaznaEditStudent',
  description: 'Edit an existing student record (name, className, phone, guardian, status) (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    studentId: z.string().optional(),
    studentName: z.string().optional(),
    name: z.string().optional(),
    className: z.string().optional(),
    phone: z.string().optional(),
    guardian: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string' },
      studentName: { type: 'string' },
      name: { type: 'string' },
      className: { type: 'string' },
      phone: { type: 'string' },
      guardian: { type: 'string' },
      status: { type: 'string', enum: ['active', 'inactive'] },
    },
  },
  summarize: (args) => `Edit student ${String(args.studentId || args.studentName || '')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('edit student directory records', role);

    const students = Array.isArray(state.students)
      ? (state.students as Array<Record<string, unknown>>)
      : [];
    const target = findStudentInState(students, args);
    if (!target) {
      return { ok: false, summary: 'Student not found in directory.', data: { found: false } };
    }

    const patch: Record<string, unknown> = {};
    if (typeof args.name === 'string' && args.name.trim()) patch.name = args.name.trim();
    if (typeof args.className === 'string' && args.className.trim()) patch.className = args.className.trim();
    if (typeof args.phone === 'string' && args.phone.trim()) patch.phone = args.phone.trim();
    if (typeof args.guardian === 'string' && args.guardian.trim()) patch.guardian = args.guardian.trim();
    if (args.status) patch.status = args.status;

    return {
      ok: true,
      summary: `Updated student **${String(target.name)}** (${String(target.id)}).`,
      data: { id: target.id, patch },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'EDIT_STUDENT', payload: { id: String(target.id), patch } },
        cursorWaypoints: [{ label: `Updating ${String(target.name)}`, selector: 'main', action: 'click', delayMs: 360 }],
        label: `Edited ${String(target.name)}`,
      },
    };
  },
};

export const khaznaDeleteStudentTool: ToolDefinition = {
  name: 'khaznaDeleteStudent',
  description: 'Remove a student from the directory (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    studentId: z.string().optional(),
    studentName: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: { studentId: { type: 'string' }, studentName: { type: 'string' } },
  },
  summarize: (args) => `Remove student ${String(args.studentName || args.studentId || '')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('delete students', role);

    const students = Array.isArray(state.students)
      ? (state.students as Array<Record<string, unknown>>)
      : [];
    const target = findStudentInState(students, args);
    if (!target) return { ok: false, summary: 'Student not found.', data: { found: false } };

    return {
      ok: true,
      summary: `Removed student **${String(target.name)}** (${String(target.id)}).`,
      data: { id: target.id },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_STUDENTS', payload: { ids: [String(target.id)] } },
        label: `Deleted student ${String(target.name)}`,
      },
    };
  },
};

export const khaznaCreateSectorTool: ToolDefinition = {
  name: 'khaznaCreateSector',
  description: 'Create a new Khazna finance sector with receipt prefix and term target (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    name: z.string().min(2).max(80),
    description: z.string().optional(),
    receiptPrefix: z.string().optional(),
    target: z.coerce.number().min(0).default(300000),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      receiptPrefix: { type: 'string' },
      target: { type: 'number' },
    },
    required: ['name'],
  },
  summarize: (args) => `Create Khazna sector "${String(args.name)}"`,
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role !== 'admin') return denyRole('create finance sectors', role);

    const name = String(args.name).trim();
    const initials =
      name
        .split(/\s+/)
        .map((w) => w[0] || '')
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'SC';
    const receiptPrefix =
      typeof args.receiptPrefix === 'string' && args.receiptPrefix.trim()
        ? args.receiptPrefix.trim().toUpperCase()
        : `${initials}-`;
    const target = typeof args.target === 'number' && !Number.isNaN(args.target) ? args.target : 300000;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sector';

    return {
      ok: true,
      summary: `Created Khazna sector **${name}** (receipt prefix \`${receiptPrefix}\`, target ${fmtInr(target)}).`,
      data: { slug, name, receiptPrefix, target },
      createdIds: [slug],
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'CREATE_SECTOR',
          payload: {
            slug,
            name,
            description:
              typeof args.description === 'string' && args.description.trim()
                ? args.description.trim()
                : `${name} — campus ledger sector.`,
            receiptPrefix,
            target,
            color: 'var(--sector-fiqh)',
          },
        },
        cursorWaypoints: [{ label: `Creating sector ${name}`, selector: 'main', action: 'click', delayMs: 380 }],
        label: `Created sector ${name}`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Removed ${createdIds.length} created sector(s).`,
      data: { undoneIds: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_SECTORS', payload: { slugs: createdIds } },
        label: 'Undo created sector',
      },
    };
  },
};

export const khaznaUpdateSectorTool: ToolDefinition = {
  name: 'khaznaUpdateSector',
  description: 'Update an existing sector’s description, term target, or receipt prefix (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    sector: z.string(),
    description: z.string().optional(),
    target: z.coerce.number().min(0).optional(),
    receiptPrefix: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sector: { type: 'string' },
      description: { type: 'string' },
      target: { type: 'number' },
      receiptPrefix: { type: 'string' },
    },
    required: ['sector'],
  },
  summarize: (args) => `Update sector ${String(args.sector)}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('update sectors', role);

    const sectors = Array.isArray(state.sectors) ? (state.sectors as Array<Record<string, unknown>>) : [];
    const sec = resolveSectorSlug(args.sector, sectors, 'office');
    return {
      ok: true,
      summary: `Updated sector **${sec.name}**.`,
      data: { slug: sec.slug },
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'UPDATE_SECTOR',
          payload: {
            slug: sec.slug,
            patch: {
              ...(typeof args.description === 'string' ? { description: args.description } : {}),
              ...(typeof args.target === 'number' ? { target: args.target } : {}),
              ...(typeof args.receiptPrefix === 'string' ? { receiptPrefix: args.receiptPrefix.toUpperCase() } : {}),
            },
          },
        },
        label: `Updated ${sec.name}`,
      },
    };
  },
};

export const khaznaDeleteSectorTool: ToolDefinition = {
  name: 'khaznaDeleteSector',
  description: 'Delete a sector (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({ sector: z.string() }),
  jsonParameters: {
    type: 'object',
    properties: { sector: { type: 'string' } },
    required: ['sector'],
  },
  summarize: (args) => `Delete sector ${String(args.sector)}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('delete sectors', role);

    const sectors = Array.isArray(state.sectors) ? (state.sectors as Array<Record<string, unknown>>) : [];
    const sec = resolveSectorSlug(args.sector, sectors, '');
    return {
      ok: true,
      summary: `Deleted sector **${sec.name}**.`,
      data: { slug: sec.slug },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_SECTORS', payload: { slugs: [sec.slug] } },
        label: `Deleted sector ${sec.name}`,
      },
    };
  },
};

export const khaznaManageClassTool: ToolDefinition = {
  name: 'khaznaManageClass',
  description: 'Add, rename, or remove an academic class in Khazna (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    action: z.enum(['add', 'edit', 'remove']),
    className: z.string().min(1),
    newName: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'edit', 'remove'] },
      className: { type: 'string' },
      newName: { type: 'string' },
    },
    required: ['action', 'className'],
  },
  summarize: (args) => `${String(args.action)} class ${String(args.className)}`,
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role !== 'admin') return denyRole('manage classes', role);

    return {
      ok: true,
      summary: `Executed class ${String(args.action)}: **${String(args.className)}**${args.newName ? ` -> **${String(args.newName)}**` : ''}.`,
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'MANAGE_CLASS', payload: args },
        cursorWaypoints: [{ label: `Class ${String(args.action)}: ${String(args.className)}`, selector: 'main', action: 'click', delayMs: 360 }],
        label: `Class ${String(args.action)}`,
      },
    };
  },
};

export const khaznaPostBatchTool: ToolDefinition = {
  name: 'khaznaPostBatch',
  description: 'Post a bulk ledger batch entry across a class of students.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    sector: z.string().optional(),
    className: z.string().optional(),
    type: z.enum(['credit', 'debit']).default('debit'),
    title: z.string().min(2),
    amount: z.coerce.number().positive(),
    reason: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      sector: { type: 'string' },
      className: { type: 'string' },
      type: { type: 'string', enum: ['credit', 'debit'] },
      title: { type: 'string' },
      amount: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['title', 'amount'],
  },
  summarize: (args) => `Post bulk ${String(args.type || 'debit')} "${String(args.title)}"`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') return denyRole('post bulk batches', role);

    const sectors = Array.isArray(state.sectors) ? (state.sectors as Array<Record<string, unknown>>) : [];
    const students = Array.isArray(state.students) ? (state.students as Array<Record<string, unknown>>) : [];
    const assignedSector = getAllowedSectorSlug(state);
    const assignedSecRec = sectors.find((s) => String(s.slug) === assignedSector) || sectors[0];
    if (role === 'manager' && typeof args.sector === 'string' && args.sector.trim()) {
      if (!isSameSectorQuery(args.sector, assignedSector, assignedSecRec)) {
        return denyRole(`post bulk batches into sector "${String(args.sector).trim()}"`, role);
      }
    }
    const sector = resolveSectorSlug(role === 'manager' ? assignedSector : args.sector, sectors, assignedSector);

    const clsQuery =
      typeof args.className === 'string' && args.className.trim()
        ? args.className.trim().toLowerCase()
        : 'fiqh 2';
    let targets = students.filter((s) => String(s.className || '').toLowerCase().includes(clsQuery));
    if (targets.length === 0) targets = students.slice(0, 8);

    const studentIds = targets.map((s) => String(s.id));
    const batchId = `B-AI-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const amount = Math.max(1, Math.round(Number(args.amount)));
    const date = new Date().toISOString().slice(0, 10);

    return {
      ok: true,
      summary: `Posted bulk **${String(args.type || 'debit')}** batch **${String(args.title)}** (${fmtInr(amount)} × ${studentIds.length} students) in **${sector.name}**.`,
      data: { batchId, sector: sector.slug, count: studentIds.length, amount },
      createdIds: [batchId],
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'POST_BATCH',
          payload: {
            batchId,
            sector: sector.slug,
            studentIds,
            type: args.type === 'credit' ? 'credit' : 'debit',
            title: String(args.title).trim(),
            reason: typeof args.reason === 'string' ? args.reason : undefined,
            amount,
            date,
            receiptPrefix: `${sector.receiptPrefix}B-`,
            receiptStart: 1,
          },
        },
        cursorWaypoints: [{ label: `Posting batch ${String(args.title)}`, selector: 'main', action: 'click', delayMs: 400 }],
        label: `Posted batch ${String(args.title)}`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Removed ${createdIds.length} bulk batch(es) and their transactions.`,
      data: { undoneIds: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_BATCHES', payload: { ids: createdIds } },
        label: 'Undo bulk batch',
      },
    };
  },
};

export const khaznaVoidBatchTool: ToolDefinition = {
  name: 'khaznaVoidBatch',
  description: 'Void a bulk batch and its member transactions.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({ batchId: z.string(), reason: z.string().default('Voided via AI Agent') }),
  jsonParameters: {
    type: 'object',
    properties: { batchId: { type: 'string' }, reason: { type: 'string' } },
    required: ['batchId'],
  },
  summarize: (args) => `Void batch ${String(args.batchId)}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') return denyRole('void batches', role);
    return {
      ok: true,
      summary: `Voided batch **${String(args.batchId)}** — Reason: "${String(args.reason || 'Voided via AI Agent')}".`,
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'VOID_BATCH', payload: { id: String(args.batchId), reason: String(args.reason || 'Voided via AI Agent') } },
        cursorWaypoints: [{ label: `Voiding batch ${String(args.batchId)}`, selector: 'main', action: 'click', delayMs: 380 }],
        label: `Voided batch ${String(args.batchId)}`,
      },
    };
  },
};

export const khaznaDeleteBatchTool: ToolDefinition = {
  name: 'khaznaDeleteBatch',
  description: 'Delete a batch and reverse its entries.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({ batchId: z.string() }),
  jsonParameters: { type: 'object', properties: { batchId: { type: 'string' } }, required: ['batchId'] },
  summarize: (args) => `Delete batch ${String(args.batchId)}`,
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role === 'student') return denyRole('delete batches', role);
    return {
      ok: true,
      summary: `Deleted batch **${String(args.batchId)}**.`,
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_BATCHES', payload: { ids: [String(args.batchId)] } },
        cursorWaypoints: [{ label: `Deleting batch ${String(args.batchId)}`, selector: 'main', action: 'click', delayMs: 380 }],
        label: `Deleted batch ${String(args.batchId)}`,
      },
    };
  },
};

export const khaznaImportStudentsTool: ToolDefinition = {
  name: 'khaznaImportStudents',
  description: 'Verify CSV/Excel student schema and bulk import rows into Khazna Student Directory (Admin only).',
  risk: 'write',
  autoExecute: false,
  inputSchema: z.object({
    uploadId: z.string().min(1),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    targetArea: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      uploadId: { type: 'string' },
      targetArea: { type: 'string' },
    },
    required: ['uploadId'],
  },
  summarize: (args) => {
    const count = Array.isArray(args.rows) ? args.rows.length : 'validated';
    return `Verify & import ${count} student row(s) into Student Directory`;
  },
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('bulk import students', role);

    let rowsToImport = Array.isArray(args.rows)
      ? (args.rows as Array<Record<string, unknown>>)
      : undefined;

    if (!rowsToImport && typeof args.uploadId === 'string') {
      const preview = ctx.actionStore.getUploadPreview(args.uploadId, ctx.appId);
      if (!preview) throw new Error(`Upload preview "${args.uploadId}" not found or expired.`);
      if (preview.formatMatched === false || (preview.missingRequiredColumns?.length || 0) > 0) {
        return {
          ok: false,
          summary: `Cannot start bulk upload to Student Directory: CSV format mismatch (missing: ${(preview.missingRequiredColumns || []).join(', ') || 'required student columns'}).`,
          data: { formatMatched: false, missingRequiredColumns: preview.missingRequiredColumns },
        };
      }
      if (preview.targetTool !== 'khaznaImportStudents') {
        return {
          ok: false,
          summary: `CSV format does not match the **Student Directory** schema (detected template: \`${preview.templateId}\`).`,
          data: { formatMatched: false },
        };
      }
      rowsToImport = preview.validRows.map((r) => r.data);
    }

    if (!rowsToImport || rowsToImport.length === 0) {
      return { ok: false, summary: 'No valid student rows to import.', data: { addedCount: 0 } };
    }

    const today = new Date().toISOString().slice(0, 10);
    const normalized = rowsToImport.slice(0, DEFAULT_IMPORT_BATCH_SIZE * 5).map((r, idx) => ({
      id: String(r.id || `S_IMP_${Date.now().toString(36).slice(-3).toUpperCase()}_${idx + 1}`).toUpperCase(),
      name: String(r.name || 'Student').trim(),
      className: String(r.className || 'Fiqh 2').trim(),
      phone: String(r.phone || '9847000000').trim(),
      guardian: String(r.guardian || 'Parent / Guardian').trim(),
      joined: today,
    }));

    const createdIds = normalized.map((s) => s.id);
    const waypoints: CursorWaypoint[] = [
      { label: 'Verified Students CSV schema', selector: 'main', action: 'move', delayMs: 360 },
      { label: 'Opening Bulk Student Import', selector: 'a[href*="/admin/students"]', action: 'click', delayMs: 420 },
      { label: `Uploading ${normalized.length} students`, selector: 'main', action: 'click', delayMs: 450 },
    ];

    return {
      ok: true,
      summary: `Verified Student Directory CSV format and imported **${normalized.length}** student(s).`,
      data: { addedCount: normalized.length, createdIds },
      createdIds,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'IMPORT_STUDENTS', payload: { students: normalized } },
        cursorWaypoints: waypoints,
        label: `Imported ${normalized.length} students`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Rolled back ${createdIds.length} imported student record(s).`,
      data: { undoneCount: createdIds.length },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_STUDENTS', payload: { ids: createdIds } },
        label: 'Undo imported students',
      },
    };
  },
};

export const khaznaImportManagersTool: ToolDefinition = {
  name: 'khaznaImportManagers',
  description: 'Verify CSV/Excel manager schema and bulk import sector managers into Khazna (Admin only).',
  risk: 'write',
  autoExecute: false,
  inputSchema: z.object({
    uploadId: z.string().min(1),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: { uploadId: { type: 'string' } },
    required: ['uploadId'],
  },
  summarize: () => 'Verify & import sector managers from CSV',
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('bulk import sector managers', role);

    let rowsToImport = Array.isArray(args.rows)
      ? (args.rows as Array<Record<string, unknown>>)
      : undefined;

    if (!rowsToImport && typeof args.uploadId === 'string') {
      const preview = ctx.actionStore.getUploadPreview(args.uploadId, ctx.appId);
      if (!preview) throw new Error(`Upload preview "${args.uploadId}" not found or expired.`);
      if (preview.formatMatched === false || preview.targetTool !== 'khaznaImportManagers') {
        return {
          ok: false,
          summary: `Cannot start bulk upload to **Admins / Managers**: CSV format does not match the managers schema (${(preview.missingRequiredColumns || []).join(', ') || `template ${preview.templateId}`}).`,
          data: { formatMatched: false },
        };
      }
      rowsToImport = preview.validRows.map((r) => r.data);
    }

    if (!rowsToImport || rowsToImport.length === 0) {
      return { ok: false, summary: 'No valid manager rows to import.', data: { addedCount: 0 } };
    }

    const managers = rowsToImport.slice(0, 100).map((r) => ({
      name: String(r.name || 'Manager').trim(),
      email: String(r.email || '').trim().toLowerCase(),
      phone: String(r.phone || '9847000000').trim(),
      sectors: String(r.sectors || 'office')
        .split(/[;,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    }));

    return {
      ok: true,
      summary: `Verified Managers CSV format and imported **${managers.length}** sector manager(s).`,
      data: { addedCount: managers.length, managers },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'IMPORT_MANAGERS', payload: { managers } },
        cursorWaypoints: [
          { label: 'Verified Managers CSV schema', selector: 'main', action: 'move', delayMs: 360 },
          { label: `Uploading ${managers.length} managers`, selector: 'a[href*="/admin/admins"], main', action: 'click', delayMs: 420 },
        ],
        label: `Imported ${managers.length} managers`,
      },
    };
  },
};

export const khaznaImportBulkEntriesTool: ToolDefinition = {
  name: 'khaznaImportBulkEntries',
  description: 'Verify CSV/Excel bulk ledger entry schema and post credit/debit rows to the target sector.',
  risk: 'write',
  autoExecute: false,
  inputSchema: z.object({
    uploadId: z.string().min(1),
    sector: z.string().optional(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: { uploadId: { type: 'string' }, sector: { type: 'string' } },
    required: ['uploadId'],
  },
  summarize: () => 'Verify & post bulk ledger entries from CSV',
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') return denyRole('bulk upload ledger entries', role);

    const assignedSector = getAllowedSectorSlug(state);
    const sectors = Array.isArray(state.sectors) ? (state.sectors as Array<Record<string, unknown>>) : [];
    const targetSector = resolveSectorSlug(role === 'manager' ? assignedSector : args.sector, sectors, assignedSector);

    let rowsToImport = Array.isArray(args.rows)
      ? (args.rows as Array<Record<string, unknown>>)
      : undefined;

    if (!rowsToImport && typeof args.uploadId === 'string') {
      const preview = ctx.actionStore.getUploadPreview(args.uploadId, ctx.appId);
      if (!preview) throw new Error(`Upload preview "${args.uploadId}" not found or expired.`);
      if (preview.formatMatched === false || preview.targetTool !== 'khaznaImportBulkEntries') {
        return {
          ok: false,
          summary: `Cannot start bulk upload to **Bulk Entries**: CSV format does not match the bulk entries schema (${(preview.missingRequiredColumns || []).join(', ') || `template ${preview.templateId}`}).`,
          data: { formatMatched: false },
        };
      }
      rowsToImport = preview.validRows.map((r) => r.data);
    }

    if (!rowsToImport || rowsToImport.length === 0) {
      return { ok: false, summary: 'No valid ledger entry rows to import.', data: { addedCount: 0 } };
    }

    const today = new Date().toISOString().slice(0, 10);
    const entries = rowsToImport.slice(0, 200).map((r, idx) => ({
      id: `TX_CSV_${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      sector: role === 'manager' ? assignedSector : String(r.sector || targetSector.slug).toLowerCase(),
      studentId: String(r.studentId || '').toUpperCase(),
      type: String(r.type || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
      title: String(r.title || 'Bulk Entry').trim(),
      amount: Math.max(1, Math.round(Number(r.amount || 0))),
      date: String(r.date || today),
      receiptNo: String(r.receiptNo || `${targetSector.receiptPrefix}CSV-${idx + 1}`),
      reason: typeof r.reason === 'string' ? r.reason : undefined,
    }));

    return {
      ok: true,
      summary: `Verified Bulk Entries CSV format and posted **${entries.length}** ledger entry(ies) into **${targetSector.name}**.`,
      data: { addedCount: entries.length, sector: targetSector.slug },
      createdIds: entries.map((e) => e.id),
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'IMPORT_BULK_ENTRIES', payload: { sector: targetSector.slug, entries } },
        cursorWaypoints: [
          { label: 'Verified Bulk Entries CSV schema', selector: 'main', action: 'move', delayMs: 360 },
          { label: `Uploading ${entries.length} entries to ${targetSector.name}`, selector: 'main', action: 'click', delayMs: 450 },
        ],
        label: `Imported ${entries.length} bulk entries`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Removed ${createdIds.length} bulk-imported ledger entry(ies).`,
      data: { undoneIds: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_ENTRIES', payload: { ids: createdIds } },
        label: 'Undo bulk entries',
      },
    };
  },
};

export const khaznaImportSectorsTool: ToolDefinition = {
  name: 'khaznaImportSectors',
  description: 'Verify CSV/Excel sector schema and bulk create sectors in Khazna (Admin only).',
  risk: 'write',
  autoExecute: false,
  inputSchema: z.object({
    uploadId: z.string().min(1),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: { uploadId: { type: 'string' } },
    required: ['uploadId'],
  },
  summarize: () => 'Verify & import sectors from spreadsheet',
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role !== 'admin') return denyRole('bulk import sectors', role);

    let rowsToImport = Array.isArray(args.rows)
      ? (args.rows as Array<Record<string, unknown>>)
      : undefined;

    if (!rowsToImport && typeof args.uploadId === 'string') {
      const preview = ctx.actionStore.getUploadPreview(args.uploadId, ctx.appId);
      if (!preview) throw new Error(`Upload preview "${args.uploadId}" not found or expired.`);
      if (preview.formatMatched === false || preview.targetTool !== 'khaznaImportSectors') {
        return {
          ok: false,
          summary: `Cannot start bulk upload to **Sectors**: format does not match the sectors schema (${(preview.missingRequiredColumns || []).join(', ') || `template ${preview.templateId}`}).`,
          data: { formatMatched: false },
        };
      }
      rowsToImport = preview.validRows.map((r) => r.data);
    }

    if (!rowsToImport || rowsToImport.length === 0) {
      return { ok: false, summary: 'No valid sector rows to import.', data: { addedCount: 0 } };
    }

    const sectors = rowsToImport.slice(0, 100).map((r, idx) => {
      const name = String(r.name || `Sector ${idx + 1}`).trim();
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || `sector-${Date.now().toString(36)}-${idx}`;
      const rawPrefix = String(r.receiptPrefix || '').trim().toUpperCase();
      const receiptPrefix = rawPrefix ? (rawPrefix.endsWith('-') ? rawPrefix : `${rawPrefix}-`) : `${name.slice(0, 2).toUpperCase() || 'SC'}-`;
      return {
        slug,
        name,
        receiptPrefix,
        target: r.target !== undefined ? Math.max(0, Math.round(Number(r.target) || 0)) : undefined,
        description: typeof r.description === 'string' ? r.description.trim() : undefined,
        color: typeof r.color === 'string' ? r.color.trim() : undefined,
      };
    });

    const createdSlugs = sectors.map((s) => s.slug);

    return {
      ok: true,
      summary: `Verified Sectors format and imported **${sectors.length}** sector(s).`,
      data: { addedCount: sectors.length, sectors },
      createdIds: createdSlugs,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'IMPORT_SECTORS', payload: { sectors } },
        cursorWaypoints: [
          { label: 'Verified Sectors schema', selector: 'main', action: 'move', delayMs: 360 },
          { label: `Creating ${sectors.length} sectors`, selector: 'a[href*="/admin/sectors"], main', action: 'click', delayMs: 420 },
        ],
        label: `Imported ${sectors.length} sectors`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Removed ${createdIds.length} bulk-imported sector(s).`,
      data: { undoneSlugs: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_SECTORS', payload: { slugs: createdIds } },
        label: 'Undo imported sectors',
      },
    };
  },
};

export const khaznaDownloadReportTool: ToolDefinition = {
  name: 'khaznaDownloadReport',
  description: 'Immediately download a Class Report as PDF, Excel (.xlsx), or CSV.',
  risk: 'read',
  inputSchema: z.object({
    format: z.enum(['pdf', 'xlsx', 'csv']).default('pdf'),
    sector: z.string().optional(),
    className: z.string().optional(),
    contentFilter: z.enum(['all', 'credit', 'debit']).default('all'),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['pdf', 'xlsx', 'csv'] },
      sector: { type: 'string' },
      className: { type: 'string' },
      contentFilter: { type: 'string', enum: ['all', 'credit', 'debit'] },
    },
  },
  summarize: (args) => `Download Khazna class report (${String(args.format || 'pdf').toUpperCase()})`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') {
      return {
        ok: true,
        summary: 'Generated and downloaded your **Personal Student Statement (PDF)**.',
        data: { format: 'pdf' },
        uiAction: {
          action: 'refresh',
          appCommand: { command: 'DOWNLOAD_STUDENT_STATEMENT', payload: { format: 'pdf', studentId: getAllowedStudentId(state) } },
          cursorWaypoints: [{ label: 'Downloading your statement', selector: 'main', action: 'click', delayMs: 360 }],
          label: 'Downloaded statement',
        },
      };
    }

    const assignedSector = getAllowedSectorSlug(state);
    const sectors = Array.isArray(state.sectors) ? (state.sectors as Array<Record<string, unknown>>) : [];
    const assignedSecRec = sectors.find((s) => String(s.slug) === assignedSector) || sectors[0];
    if (role === 'manager' && typeof args.sector === 'string' && args.sector.trim()) {
      if (!isSameSectorQuery(args.sector, assignedSector, assignedSecRec)) {
        return denyRole(`download reports for sector "${String(args.sector).trim()}"`, role);
      }
    }
    const sector = resolveSectorSlug(role === 'manager' ? assignedSector : args.sector, sectors, assignedSector);
    const fmt = (String(args.format || 'pdf') as 'pdf' | 'xlsx' | 'csv');
    const className = typeof args.className === 'string' && args.className.trim() ? args.className.trim() : 'All Classes';

    return {
      ok: true,
      summary: `Generated and downloaded **${className}** ${fmt.toUpperCase()} report for **${sector.name}**.`,
      data: { format: fmt, sector: sector.slug, className },
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'DOWNLOAD_REPORT',
          payload: { format: fmt, sector: sector.slug, className, contentFilter: args.contentFilter || 'all' },
        },
        cursorWaypoints: [{ label: `Downloading ${fmt.toUpperCase()} report`, selector: 'main', action: 'click', delayMs: 380 }],
        label: `Downloaded ${fmt.toUpperCase()} report`,
      },
    };
  },
};

export const khaznaDownloadStudentStatementTool: ToolDefinition = {
  name: 'khaznaDownloadStudentStatement',
  description: 'Download a student financial statement as PDF or CSV (Student can only download their own statement).',
  risk: 'read',
  inputSchema: z.object({
    format: z.enum(['pdf', 'csv']).default('pdf'),
    studentId: z.string().optional(),
    studentName: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['pdf', 'csv'] },
      studentId: { type: 'string' },
      studentName: { type: 'string' },
    },
  },
  summarize: () => 'Download student financial statement',
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    const meId = getAllowedStudentId(state);

    if (role === 'student') {
      return {
        ok: true,
        summary: `Downloaded your **Personal Student Statement** (${String(args.format || 'pdf').toUpperCase()}).`,
        data: { studentId: meId, format: args.format || 'pdf' },
        uiAction: {
          action: 'refresh',
          appCommand: { command: 'DOWNLOAD_STUDENT_STATEMENT', payload: { format: args.format || 'pdf', studentId: meId } },
          label: 'Downloaded statement',
        },
      };
    }

    const students = Array.isArray(state.students) ? (state.students as Array<Record<string, unknown>>) : [];
    const stu = findStudentInState(students, args) || students[0];
    const sid = stu ? String(stu.id) : String(args.studentId || meId || 'S0125');

    return {
      ok: true,
      summary: `Downloaded **${stu ? String(stu.name) : sid}** statement (${String(args.format || 'pdf').toUpperCase()}).`,
      data: { studentId: sid, format: args.format || 'pdf' },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DOWNLOAD_STUDENT_STATEMENT', payload: { format: args.format || 'pdf', studentId: sid } },
        cursorWaypoints: [{ label: `Downloading ${sid} statement`, selector: 'main', action: 'click', delayMs: 360 }],
        label: 'Downloaded student statement',
      },
    };
  },
};

export const khaznaDownloadAuditCsvTool: ToolDefinition = {
  name: 'khaznaDownloadAuditCsv',
  description: 'Download the active organization Audit Log as CSV (Admin only).',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Download Audit Log CSV',
  async execute(_args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role !== 'admin') return denyRole('download the full audit log CSV', role);
    return {
      ok: true,
      summary: 'Downloaded the active organization **Audit Log CSV**.',
      data: { downloaded: true },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DOWNLOAD_AUDIT_CSV', payload: {} },
        cursorWaypoints: [{ label: 'Exporting Audit Log CSV', selector: 'main', action: 'click', delayMs: 360 }],
        label: 'Downloaded Audit Log CSV',
      },
    };
  },
};

export const khaznaDownloadTemplateCsvTool: ToolDefinition = {
  name: 'khaznaDownloadTemplateCsv',
  description: 'Download a sample CSV import template (students, managers, or bulk-entries).',
  risk: 'read',
  inputSchema: z.object({ template: z.enum(['students', 'managers', 'bulk-entries']).default('students') }),
  jsonParameters: {
    type: 'object',
    properties: { template: { type: 'string', enum: ['students', 'managers', 'bulk-entries'] } },
  },
  summarize: (args) => `Download ${String(args.template || 'students')} CSV template`,
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role === 'student') return denyRole('download import CSV templates', role);
    const tpl = String(args.template || 'students');
    return {
      ok: true,
      summary: `Downloaded the **${tpl}** CSV template.`,
      data: { template: tpl },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DOWNLOAD_TEMPLATE_CSV', payload: { template: tpl } },
        cursorWaypoints: [{ label: `Downloading ${tpl} CSV template`, selector: 'main', action: 'click', delayMs: 340 }],
        label: `Downloaded ${tpl} template`,
      },
    };
  },
};

export const khaznaPrintPageTool: ToolDefinition = {
  name: 'khaznaPrintPage',
  description: 'Trigger browser print dialog for the current Khazna view.',
  risk: 'read',
  inputSchema: z.object({}),
  jsonParameters: { type: 'object', properties: {} },
  summarize: () => 'Print current page',
  async execute() {
    return {
      ok: true,
      summary: 'Opened the print dialog for the current ledger view.',
      data: { printed: true },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'PRINT_PAGE', payload: {} },
        cursorWaypoints: [{ label: 'Preparing print view', selector: 'main', action: 'click', delayMs: 320 }],
        label: 'Print page',
      },
    };
  },
};

export const khaznaManageManagerTool: ToolDefinition = {
  name: 'khaznaManageManager',
  description: 'Invite, edit, assign sectors, toggle status, or delete a sector manager (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    action: z.enum(['invite', 'edit', 'assign', 'toggle', 'delete']),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    sectors: z.array(z.string()).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['invite', 'edit', 'assign', 'toggle', 'delete'] },
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      sectors: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },
  summarize: (args) => `${String(args.action)} manager ${String(args.name || args.email || '')}`,
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role !== 'admin') return denyRole('manage sector managers', role);
    return {
      ok: true,
      summary: `Completed manager **${String(args.action)}**${args.name ? ` for **${String(args.name)}**` : ''}.`,
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'MANAGE_MANAGER', payload: args },
        label: `Manager ${String(args.action)}`,
      },
    };
  },
};

export const khaznaUpdateInstitutionTool: ToolDefinition = {
  name: 'khaznaUpdateInstitution',
  description: 'Update official institution profile fields for certificates & reports (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    name: z.string().optional(),
    short_name: z.string().optional(),
    tagline: z.string().optional(),
    reg_no: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    verify_mask_names: z.boolean().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      short_name: { type: 'string' },
      tagline: { type: 'string' },
      reg_no: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
      verify_mask_names: { type: 'boolean' },
    },
  },
  summarize: () => 'Update Institution Profile',
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role !== 'admin') return denyRole('update the institution profile', role);
    return {
      ok: true,
      summary: 'Updated official **Institution Profile** settings.',
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'UPDATE_INSTITUTION', payload: args },
        label: 'Updated Institution Profile',
      },
    };
  },
};

export const khaznaManageSignatoryTool: ToolDefinition = {
  name: 'khaznaManageSignatory',
  description: 'Add, edit, toggle, or delete official PDF report signatories (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    action: z.enum(['add', 'toggle', 'delete']),
    full_name: z.string().optional(),
    designation: z.string().optional(),
    role: z.enum(['principal', 'accounts_officer', 'hod', 'sector_manager', 'class_teacher', 'other']).optional(),
    sector_id: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'toggle', 'delete'] },
      full_name: { type: 'string' },
      designation: { type: 'string' },
      role: { type: 'string', enum: ['principal', 'accounts_officer', 'hod', 'sector_manager', 'class_teacher', 'other'] },
      sector_id: { type: 'string' },
    },
    required: ['action'],
  },
  summarize: (args) => `${String(args.action)} signatory ${String(args.full_name || '')}`,
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role !== 'admin') return denyRole('manage official signatories', role);
    return {
      ok: true,
      summary: `Completed signatory **${String(args.action)}**${args.full_name ? ` (${String(args.full_name)})` : ''}.`,
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'MANAGE_SIGNATORY', payload: args },
        label: `Signatory ${String(args.action)}`,
      },
    };
  },
};

export const khaznaManageIssuedReportTool: ToolDefinition = {
  name: 'khaznaManageIssuedReport',
  description: 'Re-download, revoke, or extend QR verification for an issued PDF report (Admin only).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    action: z.enum(['download', 'revoke', 'extend']),
    ref: z.string().optional(),
    reason: z.string().optional(),
    newExpiry: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['download', 'revoke', 'extend'] },
      ref: { type: 'string' },
      reason: { type: 'string' },
      newExpiry: { type: 'string' },
    },
    required: ['action'],
  },
  summarize: (args) => `${String(args.action)} issued report ${String(args.ref || '')}`,
  async execute(args, ctx) {
    const role = getRole(readAppState(ctx));
    if (role !== 'admin') return denyRole('manage issued verification reports', role);
    return {
      ok: true,
      summary: `Executed **${String(args.action)}** on issued report${args.ref ? ` \`${String(args.ref)}\`` : ''}.`,
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'MANAGE_ISSUED_REPORT', payload: args },
        label: `Report ${String(args.action)}`,
      },
    };
  },
};

export const khaznaUpdatePhoneTool: ToolDefinition = {
  name: 'khaznaUpdatePhone',
  description: 'Update the signed-in student’s phone number (or admin update of student phone).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    studentId: z.string().optional(),
    phone: z.string().min(6).max(24),
  }),
  jsonParameters: {
    type: 'object',
    properties: { studentId: { type: 'string' }, phone: { type: 'string' } },
    required: ['phone'],
  },
  summarize: (args) => `Update phone number to ${String(args.phone)}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    const targetId = role === 'student' ? getAllowedStudentId(state) : String(args.studentId || getAllowedStudentId(state) || 'S0125');
    return {
      ok: true,
      summary: `Updated phone number to **${String(args.phone)}**.`,
      data: { studentId: targetId, phone: args.phone },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'UPDATE_PHONE', payload: { studentId: targetId, phone: String(args.phone) } },
        label: 'Updated phone number',
      },
    };
  },
};

export const khaznaMarkNoticeReadTool: ToolDefinition = {
  name: 'khaznaMarkNoticeRead',
  description: 'Mark one or all notifications as read.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    all: z.boolean().default(true),
    noticeId: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: { all: { type: 'boolean' }, noticeId: { type: 'string' } },
  },
  summarize: () => 'Mark notifications as read',
  async execute(args) {
    return {
      ok: true,
      summary: args.noticeId ? 'Marked notification as read.' : 'Marked all notifications as read.',
      data: args,
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'MARK_NOTICE_READ', payload: args },
        label: 'Marked notifications read',
      },
    };
  },
};

export const khaznaSetThemeTool: ToolDefinition = {
  name: 'khaznaSetTheme',
  description: 'Switch Khazna Campus Ledger between Light Appearance and Dark Appearance.',
  risk: 'read',
  inputSchema: z.object({
    theme: z.enum(['light', 'dark', 'toggle']).default('toggle'),
  }),
  jsonParameters: {
    type: 'object',
    properties: { theme: { type: 'string', enum: ['light', 'dark', 'toggle'] } },
  },
  summarize: (args) => `Switch Khazna appearance (${String(args.theme || 'toggle')})`,
  async execute(args) {
    const mode = args.theme || 'toggle';
    return {
      ok: true,
      summary: `Updated Khazna appearance to **${mode === 'toggle' ? 'next theme' : `${mode} mode`}**.`,
      data: { theme: mode },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'SET_THEME', payload: { theme: mode } },
        cursorWaypoints: [{ label: `Switching appearance (${mode})`, xPercent: 85, yPercent: 10, action: 'click', delayMs: 320 }],
        label: `Theme: ${mode}`,
      },
    };
  },
};

export const khaznaOpenInteractiveFormTool: ToolDefinition = {
  name: 'khaznaOpenInteractiveForm',
  description:
    'Render a Human-in-the-Loop structured form directly inside chat when the user wants to add/create/update a record without providing all required details yet.',
  risk: 'read',
  inputSchema: z.object({
    formType: z.enum([
      'CREATE_COLLEGE_ACCOUNT',
      'ADD_STUDENT',
      'CREATE_ENTRY',
      'POST_BATCH',
      'CREATE_SECTOR',
      'INVITE_MANAGER',
      'ADD_SIGNATORY',
      'UPDATE_INSTITUTION',
      'UPDATE_PHONE',
    ]),
    prefillName: z.string().optional(),
    prefillClass: z.string().optional(),
    prefillSector: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      formType: {
        type: 'string',
        enum: [
          'CREATE_COLLEGE_ACCOUNT',
          'ADD_STUDENT',
          'CREATE_ENTRY',
          'POST_BATCH',
          'CREATE_SECTOR',
          'INVITE_MANAGER',
          'ADD_SIGNATORY',
          'UPDATE_INSTITUTION',
          'UPDATE_PHONE',
        ],
      },
      prefillName: { type: 'string' },
      prefillClass: { type: 'string' },
      prefillSector: { type: 'string' },
    },
    required: ['formType'],
  },
  summarize: (args) => `Open Human-in-the-Loop form: ${String(args.formType)}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    const formType = String(args.formType);

    if (
      role === 'student' &&
      ['ADD_STUDENT', 'CREATE_ENTRY', 'POST_BATCH', 'CREATE_SECTOR', 'INVITE_MANAGER', 'ADD_SIGNATORY', 'UPDATE_INSTITUTION'].includes(
        formType
      )
    ) {
      return denyRole(`open the ${formType.toLowerCase().replace(/_/g, ' ')} form`, role);
    }
    if (
      role === 'manager' &&
      ['ADD_STUDENT', 'CREATE_SECTOR', 'INVITE_MANAGER', 'ADD_SIGNATORY', 'UPDATE_INSTITUTION'].includes(formType)
    ) {
      return denyRole(`open the ${formType.toLowerCase().replace(/_/g, ' ')} form`, role);
    }

    const sectors = Array.isArray(state.sectors) ? (state.sectors as Array<Record<string, unknown>>) : [];
    const sectorNames = sectors.map((s) => String(s.name || s.slug));
    const classes = Array.isArray(state.classes) ? state.classes.map(String) : ['Fiqh 2', 'Thanawiyya 1', 'Civil 1'];

    let formRequest: FormRequest;
    switch (formType) {
      case 'CREATE_COLLEGE_ACCOUNT':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Create New Khazna Campus Account',
          description: 'Creates an isolated campus ledger workspace for your college.',
          submitLabel: 'Create Account',
          command: 'SIGNUP_COLLEGE',
          fields: [
            { key: 'college', label: 'College Name', type: 'text', required: true, placeholder: 'Islahul Uloom Arabic College' },
            { key: 'name', label: 'Your Full Name', type: 'text', required: true, placeholder: 'Midlaj' },
            { key: 'email', label: 'Admin Email', type: 'email', required: true, placeholder: 'admin@college.edu' },
            { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'Minimum 4 characters' },
          ],
        };
        break;
      case 'ADD_STUDENT':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Enroll New Student',
          description: 'Enter the student columns below; Ad.No will be auto-assigned if left empty.',
          submitLabel: 'Enroll Student',
          command: 'ADD_STUDENT',
          fields: [
            {
              key: 'name',
              label: 'Full Name',
              type: 'text',
              required: true,
              placeholder: 'e.g. Amina K.',
              ...(typeof args.prefillName === 'string' && args.prefillName ? { value: args.prefillName } : {}),
            },
            {
              key: 'className',
              label: 'Class',
              type: 'select',
              required: true,
              options: classes.length ? classes : ['Fiqh 2'],
              value:
                (typeof args.prefillClass === 'string' && args.prefillClass) ||
                classes[0] ||
                'Fiqh 2',
            },
            { key: 'id', label: 'Ad.No (optional)', type: 'text', placeholder: 'Auto-assigned if blank' },
            { key: 'phone', label: 'Phone', type: 'text', placeholder: '9847000000' },
            { key: 'guardian', label: 'Guardian Name', type: 'text', placeholder: 'Parent / Guardian' },
          ],
        };
        break;
      case 'CREATE_SECTOR':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Create Finance Sector',
          description: 'Configure a new campus ledger sector and receipt prefix.',
          submitLabel: 'Create Sector',
          command: 'CREATE_SECTOR',
          fields: [
            { key: 'name', label: 'Sector Name', type: 'text', required: true, placeholder: 'e.g. Hostel Mess' },
            { key: 'receiptPrefix', label: 'Receipt Prefix', type: 'text', placeholder: 'e.g. HM-' },
            { key: 'target', label: 'Term Target (₹)', type: 'number', value: 300000 },
            { key: 'description', label: 'Description', type: 'text', placeholder: 'Purpose of this sector' },
          ],
        };
        break;
      case 'POST_BATCH':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Post Bulk Class Batch',
          description: 'Charge or credit all students in a class together.',
          submitLabel: 'Post Batch',
          command: 'POST_BATCH',
          fields: [
            { key: 'title', label: 'Batch Title', type: 'text', required: true, placeholder: 'e.g. Study Tour Fee' },
            { key: 'type', label: 'Type', type: 'select', options: ['debit', 'credit'], value: 'debit' },
            { key: 'amount', label: 'Amount per student (₹)', type: 'number', required: true, value: 500 },
            { key: 'className', label: 'Target Class', type: 'select', options: classes.length ? classes : ['Fiqh 2'], value: classes[0] || 'Fiqh 2' },
            ...(role === 'admin' && sectorNames.length > 0
              ? [{ key: 'sector', label: 'Sector', type: 'select' as const, options: sectorNames, value: sectorNames[0] }]
              : []),
          ],
        };
        break;
      case 'INVITE_MANAGER':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Invite Sector Manager',
          description: 'Grant manager access to selected sectors.',
          submitLabel: 'Send Invite',
          command: 'MANAGE_MANAGER',
          presetPayload: { action: 'invite' },
          fields: [
            { key: 'name', label: 'Manager Name', type: 'text', required: true, placeholder: 'Full name' },
            { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'manager@college.edu' },
            { key: 'phone', label: 'Phone', type: 'text', placeholder: '9847000000' },
          ],
        };
        break;
      case 'ADD_SIGNATORY':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Authorize PDF Signatory',
          description: 'Add an official signatory for verified PDF reports.',
          submitLabel: 'Save Signatory',
          command: 'MANAGE_SIGNATORY',
          presetPayload: { action: 'add' },
          fields: [
            { key: 'full_name', label: 'Full Name', type: 'text', required: true },
            { key: 'designation', label: 'Designation', type: 'text', required: true },
            { key: 'role', label: 'Role', type: 'select', options: ['principal', 'accounts_officer', 'hod', 'sector_manager', 'class_teacher', 'other'], value: 'hod' },
          ],
        };
        break;
      case 'UPDATE_INSTITUTION':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Update Institution Profile',
          description: 'Edit official college metadata printed on PDF statements.',
          submitLabel: 'Save Profile',
          command: 'UPDATE_INSTITUTION',
          fields: [
            { key: 'name', label: 'Institution Name', type: 'text', required: true },
            { key: 'short_name', label: 'Short Code', type: 'text', placeholder: 'IUAC' },
            { key: 'reg_no', label: 'Registration No', type: 'text' },
            { key: 'city', label: 'City', type: 'text' },
          ],
        };
        break;
      case 'UPDATE_PHONE':
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Update Contact Phone',
          description: 'Update the registered mobile number.',
          submitLabel: 'Save Phone',
          command: 'UPDATE_PHONE',
          presetPayload: { studentId: getAllowedStudentId(state) || 'S0125' },
          fields: [
            { key: 'phone', label: 'New Phone Number', type: 'text', required: true, placeholder: '+91 98470 00000' },
          ],
        };
        break;
      default: {
        // CREATE_ENTRY
        const sectorSlugs = (Array.isArray(state.sectors)
          ? (state.sectors as Array<Record<string, unknown>>).map((s) => String(s.slug || '')).filter(Boolean)
          : []);
        const prefillSlug =
          typeof args.prefillSector === 'string' && args.prefillSector.trim()
            ? resolveSectorSlug(args.prefillSector, (state.sectors as Array<Record<string, unknown>>) || [], '')
            : null;
        formRequest = {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Post Ledger Entry',
          description: 'Select the sector and admission number to record a credit or debit entry.',
          submitLabel: 'Post Entry',
          command: 'CREATE_ENTRY',
          fields: [
            ...(role === 'admin' && sectorSlugs.length > 0
              ? [
                  {
                    key: 'sector',
                    label: 'Sector',
                    type: 'select' as const,
                    required: true,
                    placeholder: '-- Select a sector --',
                    options: sectorSlugs,
                    value: prefillSlug?.matched ? prefillSlug.slug : '',
                  },
                ]
              : []),
            { key: 'studentId', label: 'Student Ad.No', type: 'text', required: true, value: '', placeholder: 'e.g. S0125' },
            { key: 'type', label: 'Entry Type', type: 'select', required: true, options: ['credit', 'debit'], value: 'credit' },
            { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Fee Payment / Mess Bill' },
            { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, value: 500 },
          ],
        };
        break;
      }
    }

    return {
      ok: true,
      summary: `Please fill in the **${formRequest.title}** fields below and submit.`,
      data: { formId: formRequest.formId },
      formRequest,
    };
  },
};

export const khaznaGetStudentAccountTool: ToolDefinition = {
  name: 'khaznaGetStudentAccount',
  description:
    'Look up an individual student’s live account status, credit/debit totals, net balance, dues status, and recent transactions (all sectors for College Admin, assigned sector only for Sector Manager, own account only for Student).',
  risk: 'read',
  inputSchema: z.object({
    studentId: z.string().optional(),
    studentName: z.string().optional(),
    sector: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string', description: 'Student admission ID such as S0156' },
      studentName: { type: 'string', description: 'Student full or partial name such as Siraj Usman' },
      sector: { type: 'string', description: 'Optional sector filter such as dept-fiqh or Dept. Fiqh' },
    },
  },
  summarize: (args) =>
    `Check student account status${args.studentName ? ` for ${String(args.studentName)}` : args.studentId ? ` (${String(args.studentId)})` : ''}${args.sector ? ` in ${String(args.sector)}` : ''}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    const sectors = Array.isArray(state.sectors)
      ? (state.sectors as Array<Record<string, unknown>>)
      : [];

    // 1. Strict Student Isolation: only view their own account
    if (role === 'student') {
      const me = (state.meStudent || {}) as Record<string, unknown>;
      const meId = String(me.id || getAllowedStudentId(state) || '').toLowerCase();
      const meName = String(me.name || '').toLowerCase();
      const reqId = typeof args.studentId === 'string' ? args.studentId.trim().toLowerCase() : '';
      const reqName = typeof args.studentName === 'string' ? args.studentName.trim().toLowerCase() : '';

      const matchesSelf =
        (!reqId && !reqName) ||
        (reqId && reqId === meId) ||
        (reqName && meName && (meName.includes(reqName) || reqName.includes(meName)));

      if (!matchesSelf) {
        return denyRole("view other students' balances or transactions", role);
      }

      const mySummary = (state.mySummary || {}) as Record<string, unknown>;
      const mySectors = Array.isArray(state.mySectors)
        ? (state.mySectors as Array<Record<string, unknown>>)
        : [];
      const myTxs = Array.isArray(state.myTransactions)
        ? (state.myTransactions as Array<Record<string, unknown>>)
        : [];

      let targetSecSlug = '';
      let targetSecName = '';
      if (typeof args.sector === 'string' && args.sector.trim()) {
        const res = resolveSectorSlug(args.sector, mySectors, '');
        if (res.matched) {
          targetSecSlug = res.slug;
          targetSecName = res.name;
        }
      }

      if (targetSecSlug) {
        const secRec = mySectors.find((s) => String(s.slug) === targetSecSlug) || {};
        const secTxs = myTxs.filter((t) => String(t.sector || '') === targetSecSlug);
        const bal = Number(secRec.balance || 0);
        const lines = [
          `**${String(me.name || 'Student')}** (${String(me.id || meId)}) — **${targetSecName}** Account Status:`,
          `- **Credit**: ${fmtInr(Number(secRec.credit || 0))}`,
          `- **Debit**: ${fmtInr(Number(secRec.debit || 0))}`,
          `- **Net Balance**: ${fmtInr(bal)} (${bal < 0 ? `Due ${fmtInr(Math.abs(bal))}` : bal > 0 ? 'Advance Credit' : 'Settled'})`,
          `- **Entries**: ${Number(secRec.count || secTxs.length)}`,
        ];
        if (secTxs.length > 0) {
          lines.push('', `**Recent ${targetSecName} Entries:**`);
          secTxs.slice(0, 6).forEach((t) => {
            lines.push(
              `- ${String(t.title || 'Entry')} (${String(t.type || 'credit')}) — ${fmtInr(Number(t.amount || 0))} · \`${String(t.receiptNo || t.id)}\` (${String(t.date || '')})`
            );
          });
        }
        const formattedReport = lines.join('\n');
        return {
          ok: true,
          summary: formattedReport,
          data: { student: me, sector: secRec, transactions: secTxs, formattedReport },
          uiAction: {
            action: 'refresh',
            cursorWaypoints: [
              { label: `Reading your ${targetSecName} balance`, selector: 'main', action: 'move', delayMs: 360 },
            ],
            label: `${targetSecName} account status`,
          },
        };
      }

      const netBal = Number(mySummary.balance || 0);
      const formattedReport = [
        `**${String(me.name || 'Student')}** (${String(me.id || meId)}) — **Your Account Status**:`,
        `- **Total Credit**: ${fmtInr(Number(mySummary.credit || 0))}`,
        `- **Total Debit**: ${fmtInr(Number(mySummary.debit || 0))}`,
        `- **Net Balance**: ${fmtInr(netBal)} (${netBal < 0 ? `Due ${fmtInr(Math.abs(netBal))}` : 'Settled / Advance'})`,
      ].join('\n');
      return {
        ok: true,
        summary: formattedReport,
        data: { student: me, mySummary, mySectors, formattedReport },
      };
    }

    // 2. Sector Manager: strictly assigned managerSector only
    if (role === 'manager') {
      const assignedSlug = getAllowedSectorSlug(state);
      const assignedSecRec = sectors.find((s) => String(s.slug) === assignedSlug) || sectors[0] || {};
      const assignedSecName = String(assignedSecRec.name || assignedSlug);

      if (typeof args.sector === 'string' && args.sector.trim()) {
        if (!isSameSectorQuery(args.sector, assignedSlug, assignedSecRec)) {
          return denyRole(
            `view student balances in sector "${args.sector.trim()}" outside your assigned sector (${assignedSecName})`,
            role
          );
        }
      }

      const students = Array.isArray(state.students)
        ? (state.students as Array<Record<string, unknown>>)
        : [];
      const found = findMatchingStudentsInState(students, args);
      if (!found.exact && found.matches.length > 1) {
        const list = found.matches
          .slice(0, 8)
          .map((m, i) => `${i + 1}. **${String(m.name)}** (\`${String(m.id)}\`) · Class: ${String(m.className || '—')}`)
          .join('\n');
        return {
          ok: true,
          summary: `Multiple students matched "${String(args.studentName || args.studentId || '')}" in **${assignedSecName}**. Please specify by Admission ID:\n${list}`,
          data: { disambiguation: true, matches: found.matches, sector: assignedSlug },
        };
      }
      const student = found.exact || found.matches[0];
      if (!student) {
        return {
          ok: false,
          summary: `No matching student found in **${assignedSecName}**${args.studentName ? ` for "${String(args.studentName)}"` : ''}.`,
          data: { found: false, sector: assignedSlug },
        };
      }

      const txs = Array.isArray(state.recentTransactions)
        ? (state.recentTransactions as Array<Record<string, unknown>>)
        : [];
      const stuTxs = txs.filter(
        (t) => String(t.studentId || '') === String(student.id) && String(t.sector || '') === assignedSlug
      );

      let credit = Number(student.credit ?? 0);
      let debit = Number(student.debit ?? 0);
      let balance = Number(student.balance ?? credit - debit);
      let count = Number(student.count ?? stuTxs.length);

      const bySector =
        student.bySector && typeof student.bySector === 'object'
          ? ((student.bySector as Record<string, Record<string, unknown>>)[assignedSlug] || null)
          : null;
      if (bySector) {
        credit = Number(bySector.credit ?? credit);
        debit = Number(bySector.debit ?? debit);
        balance = Number(bySector.balance ?? credit - debit);
        count = Number(bySector.count ?? count);
      }

      const statusLabel =
        balance < 0
          ? `Pending Dues (${fmtInr(Math.abs(balance))})`
          : balance > 0
            ? 'Advance Credit'
            : 'Settled (₹0)';

      const lines = [
        `**${String(student.name)}** (${String(student.id)} · Class: **${String(student.className || '—')}**) — **${assignedSecName}** Account Status:`,
        `- **Credit**: ${fmtInr(credit)}`,
        `- **Debit**: ${fmtInr(debit)}`,
        `- **Net Balance**: ${fmtInr(balance)} · **Status**: ${statusLabel}`,
        `- **Recorded Entries**: ${count}`,
      ];

      if (stuTxs.length > 0) {
        lines.push('', `**Recent ${assignedSecName} Transactions:**`);
        stuTxs.slice(0, 6).forEach((t) => {
          lines.push(
            `- ${String(t.title || 'Entry')} (${String(t.type || 'credit')}) — ${fmtInr(Number(t.amount || 0))} · \`${String(t.receiptNo || t.id)}\` (${String(t.date || '')})${t.voided ? ' [VOID]' : ''}`
          );
        });
      } else {
        lines.push('', `No individual entries in the current transaction window for ${String(student.name)} in ${assignedSecName}.`);
      }

      const formattedReport = lines.join('\n');
      return {
        ok: true,
        summary: formattedReport,
        data: { student, sector: assignedSecName, credit, debit, balance, count, transactions: stuTxs, formattedReport },
        uiAction: {
          action: 'refresh',
          cursorWaypoints: [
            { label: `Checking ${String(student.name)} in ${assignedSecName}`, selector: 'main', action: 'move', delayMs: 360 },
          ],
          label: `${String(student.name)} · ${assignedSecName}`,
        },
      };
    }

    // 3. College Admin: full access across all sectors & students
    const students = Array.isArray(state.students)
      ? (state.students as Array<Record<string, unknown>>)
      : [];
    const found = findMatchingStudentsInState(students, args);
    if (!found.exact && found.matches.length > 1) {
      const list = found.matches
        .slice(0, 8)
        .map((m, i) => `${i + 1}. **${String(m.name)}** (\`${String(m.id)}\`) · Class: ${String(m.className || '—')}`)
        .join('\n');
      return {
        ok: true,
        summary: `Multiple students matched "${String(args.studentName || args.studentId || '')}". Please specify which student:\n${list}`,
        data: { disambiguation: true, matches: found.matches },
      };
    }
    const student = found.exact || found.matches[0];
    if (!student) {
      return {
        ok: false,
        summary: `No student found matching "${String(args.studentName || args.studentId || '')}" in the active campus directory.`,
        data: { found: false },
      };
    }

    const bySectorMap =
      student.bySector && typeof student.bySector === 'object'
        ? (student.bySector as Record<string, { credit?: number; debit?: number; balance?: number; count?: number }>)
        : {};
    const txs = Array.isArray(state.recentTransactions)
      ? (state.recentTransactions as Array<Record<string, unknown>>)
      : [];

    if (typeof args.sector === 'string' && args.sector.trim()) {
      const resolved = resolveSectorSlug(args.sector, sectors, '');
      if (!resolved.matched) {
        return {
          ok: false,
          summary: `Sector "${args.sector.trim()}" was not found in active Khazna sectors.`,
          data: { found: false },
        };
      }
      const secEntry = bySectorMap[resolved.slug];
      const stuSecTxs = txs.filter(
        (t) => String(t.studentId || '') === String(student.id) && String(t.sector || '') === resolved.slug
      );

      let credit = Number(secEntry?.credit ?? 0);
      let debit = Number(secEntry?.debit ?? 0);
      let count = Number(secEntry?.count ?? 0);
      if (!secEntry && stuSecTxs.length > 0) {
        for (const t of stuSecTxs) {
          if (t.voided) continue;
          if (t.type === 'credit') credit += Number(t.amount || 0);
          else debit += Number(t.amount || 0);
          count += 1;
        }
      }
      const balance = Number(secEntry?.balance ?? credit - debit);
      const overallBal = Number(student.balance ?? balance);
      const statusLabel =
        balance < 0
          ? `Pending Dues (${fmtInr(Math.abs(balance))})`
          : balance > 0
            ? 'Advance Credit'
            : 'Settled (₹0)';

      const lines = [
        `**${String(student.name)}** (${String(student.id)} · Class: **${String(student.className || '—')}**) — **${resolved.name}** Account Status:`,
        `- **${resolved.name} Credit**: ${fmtInr(credit)}`,
        `- **${resolved.name} Debit**: ${fmtInr(debit)}`,
        `- **${resolved.name} Net Balance**: ${fmtInr(balance)} · **Status**: ${statusLabel}`,
        `- **${resolved.name} Entries**: ${count}`,
        `- **Overall Campus Net Balance**: ${fmtInr(overallBal)}`,
      ];

      if (stuSecTxs.length > 0) {
        lines.push('', `**Recent ${resolved.name} Transactions:**`);
        stuSecTxs.slice(0, 6).forEach((t) => {
          lines.push(
            `- ${String(t.title || 'Entry')} (${String(t.type || 'credit')}) — ${fmtInr(Number(t.amount || 0))} · \`${String(t.receiptNo || t.id)}\` (${String(t.date || '')})${t.voided ? ' [VOID]' : ''}`
          );
        });
      }

      const formattedReport = lines.join('\n');
      return {
        ok: true,
        summary: formattedReport,
        data: {
          student,
          sector: resolved.slug,
          sectorName: resolved.name,
          credit,
          debit,
          balance,
          count,
          transactions: stuSecTxs,
          formattedReport,
        },
        uiAction: {
          action: 'refresh',
          cursorWaypoints: [
            { label: `Inspecting ${String(student.name)} (${resolved.name})`, selector: 'main', action: 'move', delayMs: 360 },
          ],
          label: `${String(student.name)} · ${resolved.name}`,
        },
      };
    }

    // All sectors for this student
    const totalCredit = Number(student.credit ?? 0);
    const totalDebit = Number(student.debit ?? 0);
    const netBalance = Number(student.balance ?? totalCredit - totalDebit);
    const lines = [
      `**${String(student.name)}** (${String(student.id)} · Class: **${String(student.className || '—')}**) — **All-Sector Account Status**:`,
      `- **Total Credit**: ${fmtInr(totalCredit)}`,
      `- **Total Debit**: ${fmtInr(totalDebit)}`,
      `- **Overall Net Balance**: ${fmtInr(netBalance)} (${netBalance < 0 ? `Due ${fmtInr(Math.abs(netBalance))}` : 'Settled / Advance'})`,
    ];

    if (sectors.length > 0) {
      lines.push('', '**Sector Breakdown:**');
      sectors.forEach((sec, idx) => {
        const sSlug = String(sec.slug);
        const sData = bySectorMap[sSlug] || { credit: 0, debit: 0, balance: 0, count: 0 };
        lines.push(
          `${idx + 1}. **${String(sec.name || sSlug)}** — Credit: ${fmtInr(Number(sData.credit || 0))}, Debit: ${fmtInr(Number(sData.debit || 0))}, Balance: ${fmtInr(Number(sData.balance || 0))} (${Number(sData.count || 0)} entries)`
        );
      });
    }

    const formattedReport = lines.join('\n');
    return {
      ok: true,
      summary: formattedReport,
      data: { student, bySector: bySectorMap, formattedReport },
      uiAction: {
        action: 'refresh',
        cursorWaypoints: [
          { label: `Inspecting ${String(student.name)} account`, selector: 'main', action: 'move', delayMs: 360 },
        ],
        label: `${String(student.name)} account status`,
      },
    };
  },
};

export const khaznaCollectDuesTool: ToolDefinition = {
  name: 'khaznaCollectDues',
  description:
    'Collect / settle pending negative dues for a student in a Khazna sector by posting an exact Cash Deposit credit entry (matches UI Collect button).',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    studentId: z.string().optional(),
    studentName: z.string().optional(),
    sector: z.string().optional(),
    amount: z.coerce.number().positive().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      studentId: { type: 'string' },
      studentName: { type: 'string' },
      sector: { type: 'string' },
      amount: { type: 'number' },
    },
  },
  summarize: (args) =>
    `Collect pending dues for ${String(args.studentName || args.studentId || 'student')}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (role === 'student') {
      return denyRole('collect student dues', role);
    }

    const sectors = Array.isArray(state.sectors)
      ? (state.sectors as Array<Record<string, unknown>>)
      : [];
    const students = Array.isArray(state.students)
      ? (state.students as Array<Record<string, unknown>>)
      : [];

    const assignedSector = getAllowedSectorSlug(state);
    const assignedSecRec = sectors.find((s) => String(s.slug) === assignedSector) || sectors[0];
    if (role === 'manager' && typeof args.sector === 'string' && args.sector.trim()) {
      if (!isSameSectorQuery(args.sector, assignedSector, assignedSecRec)) {
        return denyRole(`collect dues in sector "${args.sector.trim()}" outside your assigned sector`, role);
      }
    }

    const sectorExplicitlyMatched =
      typeof args.sector === 'string' && args.sector.trim().length > 0;
    const sector = resolveSectorSlug(
      role === 'manager' ? assignedSector : args.sector,
      sectors,
      assignedSector
    );
    const hasConfirmedSector =
      role === 'manager' || (sectorExplicitlyMatched && sector.matched);
    const hasStudentQuery =
      (typeof args.studentId === 'string' && args.studentId.trim().length > 0) ||
      (typeof args.studentName === 'string' && args.studentName.trim().length > 0);
    const studentLookup = hasStudentQuery
      ? findMatchingStudentsInState(students, args)
      : { matches: [] as Array<Record<string, unknown>> };
    const student =
      studentLookup.exact || (studentLookup.matches.length === 1 ? studentLookup.matches[0] : undefined);

    if (!hasConfirmedSector || !student) {
      const missingParts: string[] = [];
      if (!hasConfirmedSector) missingParts.push('which **sector**');
      if (!student) missingParts.push('which **student admission number**');
      return {
        ok: true,
        summary: `Please clarify ${missingParts.join(' and ')} before collecting dues.`,
        data: { needsClarification: true, missingSector: !hasConfirmedSector, missingStudent: !student },
        formRequest: {
          formId: `form_${crypto.randomUUID().slice(0, 8)}`,
          title: 'Collect Student Dues',
          description: `Select the ${missingParts.map((p) => p.replace(/\*\*/g, '')).join(' and ')} to collect dues.`,
          submitLabel: 'Collect Dues',
          command: 'CREATE_ENTRY',
          fields: [
            ...(role === 'admin'
              ? [
                  {
                    key: 'sector',
                    label: 'Sector',
                    type: 'select' as const,
                    required: true,
                    placeholder: '-- Select a sector --',
                    options: sectors.map((s) => String(s.slug)),
                    value: hasConfirmedSector ? sector.slug : '',
                  },
                ]
              : []),
            {
              key: 'studentId',
              label: 'Student Ad.No',
              type: 'text' as const,
              required: true,
              placeholder: 'Enter admission no. (e.g. S0125)',
              value: student ? String(student.id) : '',
            },
            { key: 'type', label: 'Entry Type', type: 'select' as const, required: true, options: ['credit'], value: 'credit' },
            ...(typeof args.amount === 'number' && args.amount > 0
              ? [{ key: 'amount', label: 'Amount (₹)', type: 'number' as const, required: true, value: Math.round(args.amount) }]
              : [{ key: 'amount', label: 'Amount (₹)', type: 'number' as const, required: true, placeholder: 'Enter fee amount' }]),
            { key: 'title', label: 'Title', type: 'text' as const, required: true, value: 'Due Collection' },
          ],
        },
      };
    }

    const studentId = String(student.id);
    const studentName = String(student.name || studentId);
    const bySector =
      student.bySector && typeof student.bySector === 'object'
        ? ((student.bySector as Record<string, { balance?: number }>)[sector.slug] || null)
        : null;
    const sectorBal = bySector
      ? Number(bySector.balance ?? 0)
      : role === 'manager'
        ? Number(student.balance ?? 0)
        : Number(student.balance ?? 0);

    const amount =
      typeof args.amount === 'number' && args.amount > 0
        ? Math.round(args.amount)
        : sectorBal < 0
          ? Math.abs(Math.round(sectorBal))
          : 0;

    if (amount <= 0) {
      return {
        ok: false,
        summary: `**${studentName}** (${studentId}) has no pending negative dues in **${sector.name}** (current balance: ${fmtInr(sectorBal)}). Specify an amount to post an advance deposit.`,
        data: { studentId, sector: sector.slug, balance: sectorBal },
      };
    }

    const date = new Date().toISOString().slice(0, 10);
    const receiptNo = `${sector.receiptPrefix}${Math.floor(2000 + Math.random() * 7000)}`;
    const txId = `TX_COL_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    return {
      ok: true,
      summary: `Collected **${fmtInr(amount)}** (` + '`Cash Deposit`' + `) to settle pending dues for **${studentName}** (${studentId}) in **${sector.name}** — Receipt \`${receiptNo}\`.`,
      data: { txId, sector: sector.slug, studentId, studentName, amount, receiptNo },
      createdIds: [txId],
      uiAction: {
        action: 'refresh',
        appCommand: {
          command: 'CREATE_ENTRY',
          payload: {
            txId,
            sector: sector.slug,
            studentId,
            type: 'credit',
            title: 'Cash Deposit',
            amount,
            date,
            receiptNo,
          },
        },
        cursorWaypoints: [
          { label: `Opening ${sector.name} dues`, selector: 'main', action: 'move', delayMs: 360 },
          { label: `Collecting ${fmtInr(amount)} (${receiptNo})`, selector: 'main button, main', action: 'click', delayMs: 420 },
        ],
        label: `Collected ${fmtInr(amount)} from ${studentName}`,
      },
    };
  },
  async undo(createdIds) {
    return {
      ok: true,
      summary: `Reversed ${createdIds.length} collected dues entry(ies).`,
      data: { undoneIds: createdIds },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'DELETE_ENTRIES', payload: { ids: createdIds } },
        label: 'Undo dues collection',
      },
    };
  },
};

export const khaznaManageWorkspaceTool: ToolDefinition = {
  name: 'khaznaManageWorkspace',
  description: 'Switch between college workspaces/organizations, delete an organization, or reload the demo workspace.',
  risk: 'write',
  autoExecute: true,
  inputSchema: z.object({
    action: z.enum(['switch', 'delete', 'load_demo']).default('switch'),
    orgId: z.string().optional(),
    orgName: z.string().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['switch', 'delete', 'load_demo'] },
      orgId: { type: 'string' },
      orgName: { type: 'string' },
    },
    required: ['action'],
  },
  summarize: (args) => `Workspace ${String(args.action)}${args.orgName ? `: ${String(args.orgName)}` : ''}`,
  async execute(args, ctx) {
    const state = readAppState(ctx);
    const role = getRole(state);
    if (args.action === 'load_demo') {
      return {
        ok: true,
        summary: 'Reloaded the **Islahul Uloom (Demo)** campus workspace.',
        data: { action: 'load_demo' },
        uiAction: {
          action: 'refresh',
          appCommand: { command: 'NAVIGATE', payload: { route: '/admin', role: 'admin', loadDemo: true } },
          label: 'Loaded Demo Workspace',
        },
      };
    }

    if (ctx.scope?.role !== 'SUPER_ADMIN') {
      return {
        ok: false,
        summary: "I can't switch or delete other organizations with your account. Organization management is restricted to Platform Super Admins.",
        data: { denied: true, role: ctx.scope?.role || role, action: args.action },
      };
    }

    const orgs = Array.isArray(state.organizations)
      ? (state.organizations as Array<Record<string, unknown>>)
      : [];
    const qId = typeof args.orgId === 'string' ? args.orgId.trim().toLowerCase() : '';
    const qName = typeof args.orgName === 'string' ? args.orgName.trim().toLowerCase() : '';
    const match =
      (qId ? orgs.find((o) => String(o.id || '').toLowerCase() === qId) : undefined) ||
      (qName ? orgs.find((o) => String(o.name || '').toLowerCase().includes(qName)) : undefined) ||
      orgs[0];

    if (!match) {
      return { ok: false, summary: 'No matching workspace found.', data: { found: false } };
    }

    const targetId = String(match.id);
    const targetName = String(match.name || targetId);

    if (args.action === 'delete') {
      return {
        ok: true,
        summary: `Deleted workspace **${targetName}**.`,
        data: { id: targetId },
        uiAction: {
          action: 'refresh',
          appCommand: { command: 'DELETE_ORG', payload: { id: targetId } },
          label: `Deleted ${targetName}`,
        },
      };
    }

    return {
      ok: true,
      summary: `Switched active workspace to **${targetName}**.`,
      data: { id: targetId, name: targetName },
      uiAction: {
        action: 'refresh',
        appCommand: { command: 'SWITCH_ORG', payload: { id: targetId } },
        label: `Switched to ${targetName}`,
      },
    };
  },
};

export const KHAZNA_BUILTIN_TOOLS: Record<string, ToolDefinition> = {
  khaznaGetOverview: khaznaGetOverviewTool,
  khaznaGetStudentAccount: khaznaGetStudentAccountTool,
  khaznaListStudents: khaznaListStudentsTool,
  khaznaListTransactions: khaznaListTransactionsTool,
  khaznaCreateCollegeAccount: khaznaCreateCollegeAccountTool,
  khaznaNavigate: khaznaNavigateTool,
  khaznaCreateEntry: khaznaCreateEntryTool,
  khaznaCollectDues: khaznaCollectDuesTool,
  khaznaEditEntry: khaznaEditEntryTool,
  khaznaVoidEntry: khaznaVoidEntryTool,
  khaznaUnvoidEntry: khaznaUnvoidEntryTool,
  khaznaAddStudent: khaznaAddStudentTool,
  khaznaEditStudent: khaznaEditStudentTool,
  khaznaDeleteStudent: khaznaDeleteStudentTool,
  khaznaCreateSector: khaznaCreateSectorTool,
  khaznaUpdateSector: khaznaUpdateSectorTool,
  khaznaDeleteSector: khaznaDeleteSectorTool,
  khaznaManageClass: khaznaManageClassTool,
  khaznaPostBatch: khaznaPostBatchTool,
  khaznaVoidBatch: khaznaVoidBatchTool,
  khaznaDeleteBatch: khaznaDeleteBatchTool,
  khaznaImportStudents: khaznaImportStudentsTool,
  khaznaImportManagers: khaznaImportManagersTool,
  khaznaImportBulkEntries: khaznaImportBulkEntriesTool,
  khaznaImportSectors: khaznaImportSectorsTool,
  khaznaDownloadReport: khaznaDownloadReportTool,
  khaznaDownloadStudentStatement: khaznaDownloadStudentStatementTool,
  khaznaDownloadAuditCsv: khaznaDownloadAuditCsvTool,
  khaznaDownloadTemplateCsv: khaznaDownloadTemplateCsvTool,
  khaznaPrintPage: khaznaPrintPageTool,
  khaznaManageManager: khaznaManageManagerTool,
  khaznaUpdateInstitution: khaznaUpdateInstitutionTool,
  khaznaManageSignatory: khaznaManageSignatoryTool,
  khaznaManageIssuedReport: khaznaManageIssuedReportTool,
  khaznaUpdatePhone: khaznaUpdatePhoneTool,
  khaznaMarkNoticeRead: khaznaMarkNoticeReadTool,
  khaznaSetTheme: khaznaSetThemeTool,
  khaznaManageWorkspace: khaznaManageWorkspaceTool,
  khaznaOpenInteractiveForm: khaznaOpenInteractiveFormTool,
};
