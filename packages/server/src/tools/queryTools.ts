import { z } from 'zod';
import type { ExportColumn } from '@ai-assistant/core';
import { getRegisteredEntityConfig } from '../entityRegistry/searchEngine.ts';
import { MAX_EXPORT_ROWS, queryEntitiesForExport } from '../entityRegistry/queryEngine.ts';
import {
  buildExportFilePayloadFromDataset,
  getConversationDataset,
  recordUserDatasetView,
  saveConversationDataset,
  type NumericFilter,
  type QuerySortSpec,
} from './datasetState.ts';
import { resolveCollectionsForApp } from './entityTools.ts';
import type { ToolDefinition, ToolExecutionContext } from './types.ts';

function fmtCell(val: unknown, col: ExportColumn): string {
  if (val === undefined || val === null || val === '') return '—';
  if (col.format === 'currency' && typeof val === 'number') {
    const rounded = Math.round(val);
    return rounded < 0
      ? `-₹${Math.abs(rounded).toLocaleString('en-IN')}`
      : `₹${rounded.toLocaleString('en-IN')}`;
  }
  if (Array.isArray(val)) return val.join(', ');
  return String(val).replace(/\|/g, '/');
}

function buildCompactMarkdownTable(
  columns: ExportColumn[],
  rows: Array<Record<string, unknown>>,
  maxPreview = 15
): string {
  if (rows.length === 0) return '_No matching records found._';
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .slice(0, maxPreview)
    .map((r) => `| ${columns.map((c) => fmtCell(r[c.key], c)).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

export const queryEntitiesTool: ToolDefinition = {
  name: 'query_entities',
  description:
    'Filter, sort, limit, and project ONLY the requested rows and columns from live registered entities (supports comparative numeric filters like balance < 0 / net worth minus, pendingFee > 0, sorting, top-N limits, and follow-up refinements). Also stores the dataset in conversation state and prepares a downloadable multi-format card.',
  risk: 'read',
  inputSchema: z.object({
    entityType: z.string().optional(),
    filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    numericFilters: z
      .array(
        z.object({
          field: z.string().min(1),
          op: z.enum(['<', '<=', '>', '>=', '=', '!=']),
          value: z.number(),
        })
      )
      .optional(),
    pendingOnly: z.boolean().optional(),
    sort: z
      .object({
        field: z.string().min(1),
        dir: z.enum(['asc', 'desc']).default('desc'),
      })
      .optional(),
    limit: z.coerce.number().int().min(1).max(MAX_EXPORT_ROWS).optional(),
    columns: z.array(z.string()).optional(),
    addColumns: z.array(z.string()).optional(),
    removeColumns: z.array(z.string()).optional(),
    query: z.string().optional(),
    title: z.string().optional(),
    assumption: z.string().optional(),
    usePrevious: z.boolean().optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      entityType: { type: 'string' },
      filters: { type: 'object' },
      numericFilters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            op: { type: 'string', enum: ['<', '<=', '>', '>=', '=', '!='] },
            value: { type: 'number' },
          },
          required: ['field', 'op', 'value'],
        },
      },
      pendingOnly: { type: 'boolean' },
      sort: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          dir: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      limit: { type: 'number' },
      columns: { type: 'array', items: { type: 'string' } },
      addColumns: { type: 'array', items: { type: 'string' } },
      removeColumns: { type: 'array', items: { type: 'string' } },
      query: { type: 'string' },
      title: { type: 'string' },
      assumption: { type: 'string' },
      usePrevious: { type: 'boolean' },
    },
  },
  summarize: (args) =>
    args.title ? `Query ${String(args.title)}` : `Query live ${String(args.entityType || 'records')}`,
  async execute(args, ctx: ToolExecutionContext) {
    const config = getRegisteredEntityConfig(ctx.appId);
    if (!config) {
      return {
        ok: false,
        summary: `No entity registry config found for app "${ctx.appId}".`,
        data: { count: 0 },
      };
    }

    const prevDataset = args.usePrevious
      ? getConversationDataset(ctx.conversationId, ctx.scope, ctx.appId)
      : undefined;

    if (args.usePrevious && !prevDataset) {
      return {
        ok: false,
        summary:
          'There is no previous list or query result in this conversation to refine yet. Please ask your initial question first (for example, "give the list of net worth minus").',
        data: { missingPrevious: true, count: 0 },
      };
    }

    const collections = await resolveCollectionsForApp(ctx);
    const filters = {
      ...(prevDataset?.filters || {}),
      ...(args.filters && typeof args.filters === 'object'
        ? (args.filters as Record<string, string | number | boolean>)
        : {}),
    };
    const numericFilters = Array.isArray(args.numericFilters)
      ? (args.numericFilters as NumericFilter[])
      : prevDataset?.numericFilters || [];
    const pendingOnly =
      typeof args.pendingOnly === 'boolean' ? args.pendingOnly : Boolean(prevDataset?.pendingOnly);
    const sort = (args.sort as QuerySortSpec | undefined) || prevDataset?.sort;
    const maxRows =
      typeof args.limit === 'number'
        ? Math.min(args.limit, MAX_EXPORT_ROWS)
        : prevDataset?.limit || MAX_EXPORT_ROWS;

    let requestedColumns: string[] | undefined = Array.isArray(args.columns)
      ? args.columns.map(String)
      : prevDataset?.columns.map((c) => c.key);

    if (Array.isArray(args.addColumns) && args.addColumns.length > 0) {
      const baseCols = requestedColumns || ['id', 'name', 'className', 'pendingFee'];
      const additions = args.addColumns.map(String);
      requestedColumns = Array.from(new Set([...baseCols, ...additions]));
    }
    if (Array.isArray(args.removeColumns) && args.removeColumns.length > 0 && requestedColumns) {
      const removals = new Set(args.removeColumns.map((s) => String(s).toLowerCase()));
      requestedColumns = requestedColumns.filter((c) => !removals.has(c.toLowerCase()));
    }

    const res = queryEntitiesForExport({
      config,
      collections,
      entityType: (typeof args.entityType === 'string' && args.entityType) || prevDataset?.entityType,
      filters,
      numericFilters,
      pendingOnly,
      sort,
      query: typeof args.query === 'string' ? args.query : prevDataset?.query,
      requestedColumns,
      bulkRequest: true,
      scope: ctx.scope,
      maxRows,
    });

    if (!res.ok) {
      return {
        ok: false,
        summary: res.reason || "You don't have access to those records.",
        data: { denied: Boolean(res.denied) },
      };
    }

    const entityDef = res.entityDef;
    const entityLabelPlural = entityDef?.pluralLabel || `${entityDef?.label || 'record'}s`;
    const filterTitleBits: string[] = [];
    if (filters.className) filterTitleBits.push(String(filters.className));
    if (filters.sectorId || filters.sector) filterTitleBits.push(String(filters.sectorId || filters.sector));

    const title =
      (typeof args.title === 'string' && args.title.trim()) ||
      (prevDataset?.title && filterTitleBits.length === 0 ? prevDataset.title : undefined) ||
      `${filterTitleBits.length > 0 ? `${filterTitleBits.join(' ')} ` : ''}${entityLabelPlural.replace(/^\w/, (c) => c.toUpperCase())}`;

    if (res.rows.length === 0) {
      return {
        ok: true,
        summary: `No matching ${entityLabelPlural} found for **${title}** within your scope.`,
        data: { count: 0, title },
      };
    }

    // Save exact filtered/projected dataset for follow-ups & exports
    const entityNoun =
      res.rows.length === 1
        ? (entityDef?.label || 'record').toLowerCase()
        : entityLabelPlural.toLowerCase();

    const exportFile = buildExportFilePayloadFromDataset({
      title,
      columns: res.columns,
      rows: res.rows,
      format: 'xlsx',
      entityType: entityDef?.type,
      entityNoun,
      totalRows: res.totalRows,
      truncated: res.truncated,
    });

    saveConversationDataset(
      { appId: ctx.appId, conversationId: ctx.conversationId, scope: ctx.scope },
      {
        entityType: entityDef?.type,
        entityDef,
        title,
        filters,
        numericFilters,
        pendingOnly,
        sort,
        limit: typeof args.limit === 'number' ? args.limit : prevDataset?.limit,
        query: typeof args.query === 'string' ? args.query : prevDataset?.query,
        columns: res.columns,
        rows: res.rows,
        rawRows: res.rawMatches,
        totalRows: res.totalRows,
        truncated: res.truncated,
        summaryLine: exportFile.summaryLine,
      }
    );

    recordUserDatasetView({
      appId: ctx.appId,
      scope: ctx.scope,
      userId: ctx.userId,
      title,
      entityType: entityDef?.type,
      rowCount: res.rows.length,
    });

    // Compute concise 1-line summary (with total pending/negative balance if relevant)
    const totalPending = res.rawMatches.reduce(
      (sum, r) => sum + Number(r.pendingFee ?? (Number(r.balance ?? 0) < 0 ? Math.abs(Number(r.balance)) : 0)),
      0
    );
    const totalBalance = res.rawMatches.reduce((sum, r) => sum + Number(r.balance ?? 0), 0);

    const hasNegBalanceFilter = numericFilters.some(
      (nf) => nf.field === 'balance' && nf.op === '<' && nf.value === 0
    );

    let headline: string;
    if (hasNegBalanceFilter) {
      headline = `**${res.rows.length}** ${entityNoun} have a negative balance${
        filterTitleBits.length > 0 ? ` in **${filterTitleBits.join(' · ')}**` : ''
      }, total **₹${Math.round(totalPending).toLocaleString('en-IN')}**.`;
    } else if (res.columns.some((c) => c.key === 'pendingFee') && totalPending > 0) {
      headline = `**${res.rows.length}** ${entityNoun} (${title}) · Total due: **₹${Math.round(totalPending).toLocaleString('en-IN')}**.`;
    } else if (res.columns.some((c) => c.key === 'balance')) {
      const sign = totalBalance < 0 ? '-' : '';
      headline = `**${res.rows.length}** ${entityNoun} (${title}) · Net total: **${sign}₹${Math.round(Math.abs(totalBalance)).toLocaleString('en-IN')}**.`;
    } else {
      headline = `**${res.rows.length}** ${entityNoun} (${title}).`;
    }

    const previewTable = buildCompactMarkdownTable(res.columns, res.rows, 15);
    const shownCount = Math.min(15, res.rows.length);
    const truncationNote =
      res.rows.length > shownCount
        ? `\n_Showing first ${shownCount} of ${res.rows.length} rows below (full ${res.rows.length}-row file in export card)._`
        : '';
    const assumptionNote =
      typeof args.assumption === 'string' && args.assumption.trim()
        ? `\n_${args.assumption.trim()}_`
        : '';

    const summary = `${headline}\n\n${previewTable}${truncationNote}${assumptionNote}`;

    return {
      ok: true,
      summary,
      data: {
        title,
        totalRows: res.totalRows,
        returnedRows: res.rows.length,
        columns: res.columns,
        rows: res.rows,
      },
      exportFile,
      followUpChips: [
        ...(res.columns.every((c) => c.key !== 'phone')
          ? [{ id: 'followup-add-phone', label: 'Add phone column', prompt: 'add phone number' }]
          : []),
        ...(!res.columns.some((c) => c.key === 'debitTotal') && entityDef?.type === 'student'
          ? [{ id: 'followup-debit-credit', label: 'Include debit & credit', prompt: 'debit and credit too' }]
          : []),
        { id: 'followup-export-excel', label: 'Download as Excel', prompt: 'Same as Excel' },
      ],
    };
  },
};

export const QUERY_TOOLS: Record<string, ToolDefinition> = {
  query_entities: queryEntitiesTool,
};
