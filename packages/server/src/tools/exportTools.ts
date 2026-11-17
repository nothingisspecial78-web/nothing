import crypto from 'node:crypto';
import { z } from 'zod';
import {
  ExportFormatSchema,
  type EntityTypeDefinition,
  type ExportColumn,
  type ExportFilePayload,
  type ExportFormat,
} from '@ai-assistant/core';
import { getRegisteredEntityConfig } from '../entityRegistry/searchEngine.ts';
import {
  isSensitiveExportField,
  MAX_EXPORT_ROWS,
  projectExportRow,
  queryEntitiesForExport,
  resolveExportColumns,
} from '../entityRegistry/queryEngine.ts';
import type { AccessScope } from '../security/scope.ts';
import {
  clearConversationDatasetMemory,
  getConversationDataset,
  recordUserExportSuccess,
  recordUserFailedRequest,
  saveConversationDataset,
  type StoredDatasetEntry,
} from './datasetState.ts';
import { resolveCollectionsForApp } from './entityTools.ts';
import type { ToolDefinition, ToolExecutionContext } from './types.ts';

export function clearExportContextMemory(): void {
  clearConversationDatasetMemory();
}

export function getLastExportContext(
  conversationId: string | undefined,
  scope: AccessScope | undefined,
  appId: string
): StoredDatasetEntry | undefined {
  return getConversationDataset(conversationId, scope, appId);
}

export function normalizeExportFormat(raw?: string | null): {
  format: ExportFormat | null;
  unsupportedRequested?: string;
  closestSuggestion?: ExportFormat;
} {
  if (!raw || !raw.trim()) return { format: null };
  const clean = raw.trim().toLowerCase().replace(/^\./, '');

  if (/^(xlsx?|excel|spreadsheet|sheet|sheets)$/.test(clean)) return { format: 'xlsx' };
  if (/^pdf$/.test(clean)) return { format: 'pdf' };
  if (/^csv$/.test(clean)) return { format: 'csv' };
  if (/^(docx?|word|ms\s*word)$/.test(clean)) return { format: 'docx' };
  if (/^json$/.test(clean)) return { format: 'json' };
  if (/^(txt|text|plain\s*text)$/.test(clean)) return { format: 'txt' };

  if (/^(numbers|ods|tsv)$/.test(clean)) {
    return { format: null, unsupportedRequested: raw.trim(), closestSuggestion: 'xlsx' };
  }
  if (/^(pages|odt|rtf)$/.test(clean)) {
    return { format: null, unsupportedRequested: raw.trim(), closestSuggestion: 'docx' };
  }
  if (/^(xml|yaml|yml)$/.test(clean)) {
    return { format: null, unsupportedRequested: raw.trim(), closestSuggestion: 'json' };
  }
  return { format: null, unsupportedRequested: raw.trim(), closestSuggestion: 'xlsx' };
}

export function buildExportSlug(title: string, format: ExportFormat): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const datePart = new Date().toISOString().slice(0, 10);
  return `${slug || 'export'}-${datePart}.${format}`;
}

function formatPreviewCell(val: unknown, col: ExportColumn): string {
  if (val === undefined || val === null || val === '') return '—';
  if (col.format === 'currency' && typeof val === 'number') {
    return `₹${Math.round(val).toLocaleString('en-IN')}`;
  }
  if (Array.isArray(val)) return val.join(', ');
  return String(val).replace(/\|/g, '/');
}

function buildMarkdownPreviewTable(columns: ExportColumn[], previewRows: Array<Record<string, unknown>>): string {
  if (previewRows.length === 0) return '_No matching rows._';
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = previewRows
    .slice(0, 5)
    .map((r) => `| ${columns.map((c) => formatPreviewCell(r[c.key], c)).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  xlsx: 'Excel (.xlsx)',
  pdf: 'PDF (.pdf)',
  csv: 'CSV (.csv)',
  docx: 'Word (.docx)',
  json: 'JSON (.json)',
  txt: 'Text (.txt)',
};

const ColumnInputSchema = z.union([
  z.string(),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    format: z.enum(['text', 'currency', 'date', 'array', 'boolean']).optional(),
  }),
]);

export const exportDataTool: ToolDefinition = {
  name: 'export_data',
  description:
    'Generic downloadable file generator (Excel .xlsx, PDF, CSV, Word .docx, JSON, TXT) for filtered live data or explicit rows/columns. Never points to existing app download buttons; generates a standalone file in-memory containing ONLY the requested filtered rows and columns.',
  risk: 'read',
  inputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    columns: z.array(ColumnInputSchema).optional(),
    format: z.string().optional(),
    title: z.string().optional(),
    entityType: z.string().optional(),
    filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    pendingOnly: z.boolean().optional(),
    query: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    bulkRequest: z.boolean().optional(),
    usePrevious: z.boolean().optional(),
    maxRows: z.coerce.number().int().min(1).max(MAX_EXPORT_ROWS).optional(),
  }),
  jsonParameters: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional explicit rows array (if already fetched via search/query tools).',
      },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Requested column names/keys ONLY (e.g. ["name", "phone"]). Omit to use entity defaults.',
      },
      format: {
        type: 'string',
        description: 'Target export format: xlsx, pdf, csv, docx, json, txt (or leave empty to ask user once).',
      },
      title: {
        type: 'string',
        description: 'Descriptive export title (e.g. "Fiqh 2 Students with Pending Fees").',
      },
      entityType: {
        type: 'string',
        description: 'Entity type from assistant.config.ts (e.g. student, teacher, book, leave_request).',
      },
      filters: {
        type: 'object',
        description: 'Exact filters (e.g. {"className": "Fiqh 2", "status": "available"}).',
      },
      pendingOnly: {
        type: 'boolean',
        description: 'Set true to filter only records with pending fees / dues.',
      },
      query: {
        type: 'string',
        description: 'Optional text filter across searchable fields.',
      },
      usePrevious: {
        type: 'boolean',
        description: 'Set true for follow-ups like "Same as CSV" or "export this list as PDF".',
      },
    },
  },
  summarize: (args) => {
    const fmt = typeof args.format === 'string' && args.format ? args.format.toUpperCase() : 'file';
    return `Generate ${fmt} export${args.title ? ` (${String(args.title)})` : ''}`;
  },
  async execute(args, ctx: ToolExecutionContext) {
    const formatCheck = normalizeExportFormat(typeof args.format === 'string' ? args.format : undefined);

    // 1. Handle unsupported format cleanly without losing context
    if (formatCheck.unsupportedRequested) {
      const suggested = formatCheck.closestSuggestion || 'xlsx';
      return {
        ok: true,
        summary: `Format **${formatCheck.unsupportedRequested}** is not supported directly. Closest supported format is **${FORMAT_LABELS[suggested]}** (we also support Excel \`.xlsx\`, PDF, CSV, Word \`.docx\`, and JSON). Would you like me to export it as ${FORMAT_LABELS[suggested]}?`,
        data: { unsupportedFormat: formatCheck.unsupportedRequested, suggestedFormat: suggested },
        followUpChips: [
          {
            id: `export-closest-${suggested}`,
            label: `Export as ${FORMAT_LABELS[suggested]}`,
            prompt: `Same as ${suggested.toUpperCase()}`,
          },
          { id: 'export-csv', label: 'Export as CSV', prompt: 'Same as CSV' },
          { id: 'export-pdf', label: 'Export as PDF', prompt: 'Same as PDF' },
        ],
      };
    }

    const requestedCols: string[] | undefined = Array.isArray(args.columns)
      ? args.columns.map((c) => (typeof c === 'string' ? c : c.key))
      : undefined;

    const prevContext = getConversationDataset(ctx.conversationId, ctx.scope, ctx.appId);

    let resolvedTitle = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : '';
    let resolvedEntityType = typeof args.entityType === 'string' ? args.entityType : undefined;
    let resolvedEntityDef: EntityTypeDefinition | undefined;
    let finalColumns: ExportColumn[] = [];
    let finalRows: Array<Record<string, unknown>> = [];
    let rawSourceRows: Array<Record<string, unknown>> = [];
    let totalRows = 0;
    let truncated = false;
    let blockedSensitive: string[] = [];
    const effectiveLimit =
      typeof args.maxRows === 'number' ? Math.min(args.maxRows, MAX_EXPORT_ROWS) : MAX_EXPORT_ROWS;

    // 2A. Explicit rows provided directly by tool caller / LLM
    if (Array.isArray(args.rows) && args.rows.length > 0 && !args.usePrevious) {
      if (ctx.scope?.role === 'PUBLIC') {
        return {
          ok: false,
          summary: 'Access denied: Please sign in before exporting live records.',
          data: { denied: true },
        };
      }
      const config = getRegisteredEntityConfig(ctx.appId);
      resolvedEntityDef =
        config && resolvedEntityType
          ? config.entities.find((e) => e.type.toLowerCase() === resolvedEntityType!.toLowerCase())
          : config?.entities[0];

      const explicitObjects = args.rows as Array<Record<string, unknown>>;
      totalRows = explicitObjects.length;
      truncated = totalRows > effectiveLimit;
      rawSourceRows = explicitObjects.slice(0, effectiveLimit);

      if (
        Array.isArray(args.columns) &&
        args.columns.length > 0 &&
        typeof args.columns[0] === 'object'
      ) {
        const objCols = args.columns as Array<ExportColumn>;
        finalColumns = objCols.filter((c) => {
          if (isSensitiveExportField(c.key, resolvedEntityDef)) {
            blockedSensitive.push(c.key);
            return false;
          }
          return true;
        });
      } else {
        const colRes = resolveExportColumns({
          entityDef: resolvedEntityDef,
          requestedColumns: requestedCols,
          sampleRows: rawSourceRows,
        });
        finalColumns = colRes.columns;
        blockedSensitive = colRes.blockedSensitive;
      }

      if (finalColumns.length === 0) {
        return {
          ok: false,
          summary: 'No non-sensitive columns are available to export.',
          data: { blockedSensitive },
        };
      }

      finalRows = rawSourceRows.map((r) => projectExportRow(r, finalColumns, resolvedEntityDef));
      resolvedTitle = resolvedTitle || `${resolvedEntityDef?.label || 'Data'} Export`;
      resolvedEntityType = resolvedEntityType || resolvedEntityDef?.type;
    }
    // 2B. Follow-up referencing previous query/export in conversation (e.g. "Same as CSV", "export this list as PDF")
    else if (args.usePrevious && prevContext) {
      resolvedEntityType = prevContext.entityType;
      resolvedEntityDef = prevContext.entityDef;
      resolvedTitle = resolvedTitle || prevContext.title;
      rawSourceRows = prevContext.rawRows;
      totalRows = prevContext.totalRows;
      truncated = prevContext.truncated;

      if (requestedCols && requestedCols.length > 0) {
        const colRes = resolveExportColumns({
          entityDef: resolvedEntityDef,
          requestedColumns: requestedCols,
          sampleRows: rawSourceRows,
        });
        finalColumns = colRes.columns;
        blockedSensitive = colRes.blockedSensitive;
        finalRows = rawSourceRows.map((r) => projectExportRow(r, finalColumns, resolvedEntityDef));
      } else {
        finalColumns = prevContext.columns;
        finalRows = prevContext.rows;
      }
    }
    // 2C. Query live collections from entity registry with strict RBAC scoping
    else {
      if (args.usePrevious && !prevContext) {
        recordUserFailedRequest({
          appId: ctx.appId,
          scope: ctx.scope,
          userId: ctx.userId,
          prompt: `Export last result as ${(formatCheck.format || 'Excel').toUpperCase()}`,
          label: 'Retry failed export',
          reason: 'No previous dataset in conversation',
        });
        return {
          ok: false,
          summary:
            'There is no previous dataset in this conversation to re-export yet. Please specify what records you want to export (for example, "give me all Fiqh 2 students with pending fees as Excel").',
          data: { missingPrevious: true },
        };
      }

      const config = getRegisteredEntityConfig(ctx.appId);
      if (!config) {
        return {
          ok: false,
          summary: `No entity registry config found for app "${ctx.appId}".`,
          data: {},
        };
      }

      const collections = await resolveCollectionsForApp(ctx);
      const filters =
        args.filters && typeof args.filters === 'object'
          ? (args.filters as Record<string, string | number | boolean>)
          : {};
      const pendingOnly = Boolean(args.pendingOnly);

      const qRes = queryEntitiesForExport({
        config,
        collections,
        entityType: resolvedEntityType,
        filters,
        pendingOnly,
        query: typeof args.query === 'string' ? args.query : undefined,
        dateFrom: typeof args.dateFrom === 'string' ? args.dateFrom : undefined,
        dateTo: typeof args.dateTo === 'string' ? args.dateTo : undefined,
        requestedColumns: requestedCols,
        bulkRequest:
          typeof args.bulkRequest === 'boolean'
            ? args.bulkRequest
            : Boolean(filters.className || filters.class || !args.query),
        scope: ctx.scope,
        maxRows: effectiveLimit,
      });

      if (!qRes.ok) {
        return {
          ok: false,
          summary: qRes.reason || "You don't have access to export those records.",
          data: { denied: Boolean(qRes.denied) },
        };
      }

      resolvedEntityDef = qRes.entityDef;
      resolvedEntityType = qRes.entityDef?.type;
      finalColumns = qRes.columns;
      finalRows = qRes.rows;
      rawSourceRows = qRes.rawMatches;
      totalRows = qRes.totalRows;
      truncated = qRes.truncated;
      blockedSensitive = qRes.blockedSensitive;

      if (!resolvedTitle) {
        const parts: string[] = [];
        if (filters.className || filters.class) {
          parts.push(String(filters.className || filters.class));
        }
        if (filters.sector || filters.sectorId || filters.department) {
          parts.push(String(filters.sector || filters.sectorId || filters.department));
        }
        const entityPlural =
          resolvedEntityDef?.pluralLabel || `${resolvedEntityDef?.label || 'Record'}s`;
        parts.push(entityPlural.replace(/^\w/, (c) => c.toUpperCase()));
        if (pendingOnly) parts.push('with Pending Fees');
        resolvedTitle = parts.join(' ');
      }
    }

    if (finalRows.length === 0) {
      return {
        ok: true,
        summary: `No matching records found for **${resolvedTitle}** within your access scope, so no file was generated.`,
        data: { count: 0, title: resolvedTitle },
      };
    }

    // Save filtered dataset to conversation context for follow-ups ("Same as CSV", format reply)
    saveConversationDataset(
      { appId: ctx.appId, conversationId: ctx.conversationId, scope: ctx.scope },
      {
        entityType: resolvedEntityType,
        entityDef: resolvedEntityDef,
        title: resolvedTitle,
        filters: prevContext?.filters,
        numericFilters: prevContext?.numericFilters,
        pendingOnly: prevContext?.pendingOnly,
        sort: prevContext?.sort,
        limit: prevContext?.limit,
        columns: finalColumns,
        rows: finalRows,
        rawRows: rawSourceRows,
        totalRows,
        truncated,
      }
    );

    const entityNoun =
      finalRows.length === 1
        ? (resolvedEntityDef?.label || 'record').toLowerCase()
        : (resolvedEntityDef?.pluralLabel || 'records').toLowerCase();
    const summaryLine = `${finalRows.length} ${entityNoun}, ${finalColumns.length} column${finalColumns.length === 1 ? '' : 's'}`;
    const previewTable = buildMarkdownPreviewTable(finalColumns, finalRows.slice(0, 5));
    const truncationNote = truncated
      ? `\n\n> Note: Showing the first **${finalRows.length.toLocaleString()}** of **${totalRows.toLocaleString()}** matching rows (maximum ${MAX_EXPORT_ROWS.toLocaleString()} rows per export).`
      : '';
    const sensitiveNote =
      blockedSensitive.length > 0
        ? `\n\n_Restricted/sensitive fields omitted: ${blockedSensitive.join(', ')}._`
        : '';

    // 3. No format specified -> show 5-row preview in chat and ask ONCE which format they want
    if (!formatCheck.format) {
      return {
        ok: true,
        summary: `Found **${summaryLine}** for **${resolvedTitle}** (preview of first ${Math.min(5, finalRows.length)} rows):\n\n${previewTable}${truncationNote}${sensitiveNote}\n\nWhich file format would you like me to generate (**Excel (.xlsx)**, **PDF**, **CSV**, **Word (.docx)**, or **JSON**)?`,
        data: {
          awaitingFormat: true,
          title: resolvedTitle,
          summaryLine,
          totalRows,
          exportedRows: finalRows.length,
          columns: finalColumns,
          previewRows: finalRows.slice(0, 5),
        },
        followUpChips: [
          { id: 'fmt-xlsx', label: 'Excel (.xlsx)', prompt: 'Same as Excel' },
          { id: 'fmt-pdf', label: 'PDF', prompt: 'Same as PDF' },
          { id: 'fmt-csv', label: 'CSV', prompt: 'Same as CSV' },
          { id: 'fmt-docx', label: 'Word (.docx)', prompt: 'Same as Word' },
          { id: 'fmt-json', label: 'JSON', prompt: 'Same as JSON' },
        ],
      };
    }

    // 4. Validate and emit ExportFilePayload for in-memory client generation
    const format = ExportFormatSchema.parse(formatCheck.format);
    const filename = buildExportSlug(resolvedTitle, format);
    const exportPayload: ExportFilePayload = {
      exportId: `exp_${crypto.randomUUID().slice(0, 10)}`,
      title: resolvedTitle,
      filename,
      format,
      columns: finalColumns,
      rows: finalRows,
      previewRows: finalRows.slice(0, 5),
      totalRows,
      exportedRows: finalRows.length,
      truncated,
      rowLimit: MAX_EXPORT_ROWS,
      generatedAt: new Date().toISOString(),
      entityType: resolvedEntityType,
      summaryLine,
    };

    recordUserExportSuccess({
      appId: ctx.appId,
      scope: ctx.scope,
      userId: ctx.userId,
      title: resolvedTitle,
    });

    const summary = `Generated **${FORMAT_LABELS[format]}** file \`${filename}\` (**${summaryLine}**). Review the preview and click **Download** below.${truncationNote}${sensitiveNote}`;

    return {
      ok: true,
      summary,
      data: {
        exportId: exportPayload.exportId,
        filename,
        format,
        summaryLine,
        totalRows,
        exportedRows: finalRows.length,
        truncated,
        columns: finalColumns,
        previewRows: exportPayload.previewRows,
      },
      exportFile: exportPayload,
      followUpChips: [
        ...(format !== 'csv' ? [{ id: 'also-csv', label: 'Same as CSV', prompt: 'Same as CSV' }] : []),
        ...(format !== 'pdf' ? [{ id: 'also-pdf', label: 'Same as PDF', prompt: 'Same as PDF' }] : []),
        ...(format !== 'xlsx' ? [{ id: 'also-xlsx', label: 'Same as Excel', prompt: 'Same as Excel' }] : []),
      ],
    };
  },
};

export const EXPORT_TOOLS: Record<string, ToolDefinition> = {
  export_data: exportDataTool,
};
