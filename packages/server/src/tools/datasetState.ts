import crypto from 'node:crypto';
import {
  ExportFormatSchema,
  type EntityTypeDefinition,
  type ExportColumn,
  type ExportFilePayload,
  type ExportFormat,
} from '@ai-assistant/core';
import type { AccessScope } from '../security/scope.ts';
import { MAX_EXPORT_ROWS } from '../entityRegistry/queryEngine.ts';

export type NumericFilterOp = '<' | '<=' | '>' | '>=' | '=' | '!=';

export interface NumericFilter {
  field: string;
  op: NumericFilterOp;
  value: number;
}

export interface QuerySortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export interface StoredDatasetEntry {
  appId: string;
  entityType?: string;
  entityDef?: EntityTypeDefinition;
  title: string;
  filters?: Record<string, string | number | boolean>;
  numericFilters?: NumericFilter[];
  pendingOnly?: boolean;
  sort?: QuerySortSpec;
  limit?: number;
  query?: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  rawRows: Array<Record<string, unknown>>;
  totalRows: number;
  truncated: boolean;
  summaryLine?: string;
  savedAt: number;
}

export interface UserRecentActivity {
  lastDataset?: {
    title: string;
    entityType?: string;
    rowCount: number;
    exported: boolean;
    savedAt: number;
  };
  lastFailedRequest?: {
    prompt: string;
    label: string;
    reason?: string;
    failedAt: number;
  };
  lastSuccessfulQuery?: {
    prompt: string;
    label: string;
    at: number;
  };
  lastAbandonedForm?: {
    formType: string;
    title: string;
    prompt: string;
    abandonedAt: number;
  };
  history: Array<{
    type: 'query' | 'export' | 'error' | 'abandoned';
    prompt: string;
    label: string;
    ok: boolean;
    at: number;
  }>;
}

const CONVERSATION_DATASET_CONTEXT = new Map<string, StoredDatasetEntry>();
const USER_LATEST_DATASET = new Map<string, StoredDatasetEntry>();
const USER_RECENT_ACTIVITY = new Map<string, UserRecentActivity>();

export function makeDatasetContextKey(
  conversationId: string | undefined,
  scope: AccessScope | undefined,
  appId: string
): string {
  const conv = conversationId || 'default';
  const role = scope?.role || 'PUBLIC';
  const uid = scope?.userId || 'anon';
  const org = scope && 'organizationId' in scope ? scope.organizationId || '' : '';
  return `${appId}::${conv}::${role}::${uid}::${org}`;
}

export function makeUserActivityKey(appId: string, scope?: AccessScope, userIdFallback?: string): string {
  const role = scope?.role || 'PUBLIC';
  const uid = scope?.userId || userIdFallback || 'anon';
  const org = scope && 'organizationId' in scope ? scope.organizationId || '' : '';
  return `${appId}::${role}::${uid}::${org}`;
}

export function saveConversationDataset(
  params: {
    appId: string;
    conversationId?: string;
    scope?: AccessScope;
  },
  entry: Omit<StoredDatasetEntry, 'appId' | 'savedAt'>
): StoredDatasetEntry {
  const fullEntry: StoredDatasetEntry = {
    ...entry,
    appId: params.appId,
    savedAt: Date.now(),
  };
  const key = makeDatasetContextKey(params.conversationId, params.scope, params.appId);
  CONVERSATION_DATASET_CONTEXT.set(key, fullEntry);
  const userKey = makeUserActivityKey(params.appId, params.scope);
  USER_LATEST_DATASET.set(userKey, fullEntry);
  return fullEntry;
}

export function getConversationDataset(
  conversationId: string | undefined,
  scope: AccessScope | undefined,
  appId: string
): StoredDatasetEntry | undefined {
  const exact = CONVERSATION_DATASET_CONTEXT.get(
    makeDatasetContextKey(conversationId, scope, appId)
  );
  if (exact) return exact;
  return USER_LATEST_DATASET.get(makeUserActivityKey(appId, scope));
}

export function clearConversationDatasetMemory(): void {
  CONVERSATION_DATASET_CONTEXT.clear();
  USER_LATEST_DATASET.clear();
  USER_RECENT_ACTIVITY.clear();
}

export function recordUserDatasetView(params: {
  appId: string;
  scope?: AccessScope;
  userId?: string;
  title: string;
  entityType?: string;
  rowCount: number;
  prompt?: string;
}): void {
  const key = makeUserActivityKey(params.appId, params.scope, params.userId);
  const existing = USER_RECENT_ACTIVITY.get(key) || { history: [] };
  existing.lastDataset = {
    title: params.title,
    entityType: params.entityType,
    rowCount: params.rowCount,
    exported: false,
    savedAt: Date.now(),
  };
  if (params.prompt) {
    existing.lastSuccessfulQuery = {
      prompt: params.prompt,
      label: params.title,
      at: Date.now(),
    };
    existing.history = [
      {
        type: 'query' as const,
        prompt: params.prompt,
        label: params.title,
        ok: true,
        at: Date.now(),
      },
      ...existing.history,
    ].slice(0, 12);
  }
  USER_RECENT_ACTIVITY.set(key, existing);
}

export function recordUserExportSuccess(params: {
  appId: string;
  scope?: AccessScope;
  userId?: string;
  title: string;
  prompt?: string;
}): void {
  const key = makeUserActivityKey(params.appId, params.scope, params.userId);
  const existing = USER_RECENT_ACTIVITY.get(key) || { history: [] };
  if (existing.lastDataset) {
    existing.lastDataset.exported = true;
  }
  // Clear a prior failed export notice once the user succeeded
  if (
    existing.lastFailedRequest &&
    /\b(export|download|excel|xlsx|pdf|csv|word|docx)\b/i.test(existing.lastFailedRequest.prompt)
  ) {
    existing.lastFailedRequest = undefined;
  }
  existing.history = [
    {
      type: 'export' as const,
      prompt: params.prompt || `Export ${params.title}`,
      label: params.title,
      ok: true,
      at: Date.now(),
    },
    ...existing.history,
  ].slice(0, 12);
  USER_RECENT_ACTIVITY.set(key, existing);
}

export function recordUserFailedRequest(params: {
  appId: string;
  scope?: AccessScope;
  userId?: string;
  prompt: string;
  label?: string;
  reason?: string;
}): void {
  const key = makeUserActivityKey(params.appId, params.scope, params.userId);
  const existing = USER_RECENT_ACTIVITY.get(key) || { history: [] };
  const cleanPrompt = params.prompt.trim();
  if (!cleanPrompt) return;
  const shortLabel =
    params.label ||
    (cleanPrompt.length > 42 ? `Retry: ${cleanPrompt.slice(0, 39)}…` : `Retry: ${cleanPrompt}`);
  existing.lastFailedRequest = {
    prompt: cleanPrompt,
    label: shortLabel,
    reason: params.reason,
    failedAt: Date.now(),
  };
  existing.history = [
    {
      type: 'error' as const,
      prompt: cleanPrompt,
      label: shortLabel,
      ok: false,
      at: Date.now(),
    },
    ...existing.history,
  ].slice(0, 12);
  USER_RECENT_ACTIVITY.set(key, existing);
}

export function recordUserAbandonedForm(params: {
  appId: string;
  scope?: AccessScope;
  userId?: string;
  formType: string;
  title: string;
  prompt?: string;
}): void {
  const key = makeUserActivityKey(params.appId, params.scope, params.userId);
  const existing = USER_RECENT_ACTIVITY.get(key) || { history: [] };
  const resumePrompt = params.prompt || `Open ${params.title} form`;
  existing.lastAbandonedForm = {
    formType: params.formType,
    title: params.title,
    prompt: resumePrompt,
    abandonedAt: Date.now(),
  };
  existing.history = [
    {
      type: 'abandoned' as const,
      prompt: resumePrompt,
      label: `Resume ${params.title}`,
      ok: false,
      at: Date.now(),
    },
    ...existing.history,
  ].slice(0, 12);
  USER_RECENT_ACTIVITY.set(key, existing);
}

export function clearUserAbandonedForm(params: {
  appId: string;
  scope?: AccessScope;
  userId?: string;
}): void {
  const key = makeUserActivityKey(params.appId, params.scope, params.userId);
  const existing = USER_RECENT_ACTIVITY.get(key);
  if (existing) {
    existing.lastAbandonedForm = undefined;
    USER_RECENT_ACTIVITY.set(key, existing);
  }
}

export function getUserRecentActivity(
  appId: string,
  scope?: AccessScope,
  userIdFallback?: string
): UserRecentActivity | undefined {
  return USER_RECENT_ACTIVITY.get(makeUserActivityKey(appId, scope, userIdFallback));
}

export function buildExportSlugForDataset(title: string, format: ExportFormat): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const datePart = new Date().toISOString().slice(0, 10);
  return `${slug || 'export'}-${datePart}.${format}`;
}

export function buildExportFilePayloadFromDataset(params: {
  title: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  format?: ExportFormat;
  entityType?: string;
  entityNoun?: string;
  totalRows?: number;
  truncated?: boolean;
}): ExportFilePayload {
  const format = ExportFormatSchema.parse(params.format || 'xlsx');
  const totalRows = params.totalRows ?? params.rows.length;
  const truncated = Boolean(params.truncated);
  const noun = params.entityNoun || (params.rows.length === 1 ? 'record' : 'records');
  const summaryLine = `${params.rows.length} ${noun} · ${params.columns.length} column${
    params.columns.length === 1 ? '' : 's'
  }`;

  return {
    exportId: `exp_${crypto.randomUUID().slice(0, 10)}`,
    title: params.title,
    filename: buildExportSlugForDataset(params.title, format),
    format,
    columns: params.columns,
    rows: params.rows,
    previewRows: params.rows.slice(0, 5),
    totalRows,
    exportedRows: params.rows.length,
    truncated,
    rowLimit: MAX_EXPORT_ROWS,
    generatedAt: new Date().toISOString(),
    entityType: params.entityType,
    summaryLine,
  };
}

export function saveAndBuildDatasetExport(params: {
  appId: string;
  conversationId?: string;
  scope?: AccessScope;
  userId?: string;
  title: string;
  entityType?: string;
  entityNoun?: string;
  entityDef?: EntityTypeDefinition;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  rawRows?: Array<Record<string, unknown>>;
  filters?: Record<string, string | number | boolean>;
  numericFilters?: NumericFilter[];
  pendingOnly?: boolean;
  sort?: QuerySortSpec;
  limit?: number;
  totalRows?: number;
  format?: ExportFormat;
}): ExportFilePayload | undefined {
  if (params.rows.length === 0 || params.columns.length === 0) return undefined;

  const totalRows = params.totalRows ?? params.rows.length;
  const truncated = totalRows > params.rows.length;
  const exportFile = buildExportFilePayloadFromDataset({
    title: params.title,
    columns: params.columns,
    rows: params.rows,
    format: params.format || 'xlsx',
    entityType: params.entityType,
    entityNoun: params.entityNoun,
    totalRows,
    truncated,
  });

  saveConversationDataset(
    {
      appId: params.appId,
      conversationId: params.conversationId,
      scope: params.scope,
    },
    {
      entityType: params.entityType,
      entityDef: params.entityDef,
      title: params.title,
      filters: params.filters,
      numericFilters: params.numericFilters,
      pendingOnly: params.pendingOnly,
      sort: params.sort,
      limit: params.limit,
      columns: params.columns,
      rows: params.rows,
      rawRows: params.rawRows || params.rows,
      totalRows,
      truncated,
      summaryLine: exportFile.summaryLine,
    }
  );

  recordUserDatasetView({
    appId: params.appId,
    scope: params.scope,
    userId: params.userId,
    title: params.title,
    entityType: params.entityType,
    rowCount: params.rows.length,
  });

  return exportFile;
}
