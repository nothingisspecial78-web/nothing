import type {
  AssistantEntityConfig,
  EntityFieldSpec,
  EntityScopeRole,
  EntityTypeDefinition,
  ExportColumn,
} from '@ai-assistant/core';
import type { AccessScope } from '../security/scope.ts';
import type { NumericFilter, QuerySortSpec } from '../tools/datasetState.ts';
import { isRecordVisibleToScope } from './searchEngine.ts';

export const MAX_EXPORT_ROWS = 5000;

const GLOBAL_SENSITIVE_FIELD_RE =
  /^(?:password|passwordhash|passcode|pin|secret|secretkey|token|authtoken|refreshtoken|apikey|privatekey|internalid|_id|__v)$/i;

export function isSensitiveExportField(fieldKey: string, entityDef?: EntityTypeDefinition): boolean {
  const clean = fieldKey.trim();
  if (!clean) return false;
  if (GLOBAL_SENSITIVE_FIELD_RE.test(clean.replace(/[\s_-]/g, ''))) {
    return true;
  }
  if (/password|passcode|secret|token|apikey|privatekey|internalid/i.test(clean)) {
    return true;
  }
  if (entityDef?.sensitiveFields?.some((s) => s.toLowerCase() === clean.toLowerCase())) {
    return true;
  }
  return false;
}

function buildFieldSpecsMap(entityDef: EntityTypeDefinition): Map<string, EntityFieldSpec> {
  const map = new Map<string, EntityFieldSpec>();
  map.set(entityDef.idField, {
    key: entityDef.idField,
    label:
      entityDef.displayFields.find((f) => f.key === entityDef.idField)?.label ||
      (entityDef.idField === 'id' ? 'ID' : entityDef.idField),
  });
  map.set(entityDef.nameField, {
    key: entityDef.nameField,
    label: entityDef.nameLabel || (entityDef.nameField === 'title' ? 'Title' : 'Name'),
  });
  for (const spec of [...entityDef.displayFields, ...(entityDef.detailFields || [])]) {
    map.set(spec.key, spec);
  }
  return map;
}

const COLUMN_SYNONYMS: Record<string, string[]> = {
  id: ['id', 'ad no', 'ad.no', 'admission no', 'admission number', 'student id', 'staff id', 'book id', 'leave id', 'slug'],
  name: ['name', 'full name', 'student name', 'employee name', 'teacher name', 'manager name'],
  title: ['title', 'book title', 'name'],
  className: ['class', 'classname', 'class name', 'grade'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'telephone'],
  email: ['email', 'mail', 'e-mail', 'email address'],
  guardian: ['guardian', 'parent', 'father'],
  pendingFee: ['pending', 'pending fee', 'pending fees', 'dues', 'due', 'owed', 'unpaid', 'pending amount', 'balance due'],
  balance: ['balance', 'net balance', 'net', 'net worth', 'closing balance'],
  paidTotal: ['paid', 'total paid', 'credit', 'credits', 'credit total'],
  debitTotal: ['billed', 'debit', 'debits', 'debit total', 'total billed', 'fees billed'],
  sectorId: ['sector', 'sector id', 'dept', 'department'],
  sectors: ['sectors', 'assigned sectors'],
  department: ['department', 'dept'],
  subject: ['subject', 'course'],
  designation: ['designation', 'role', 'position'],
  office: ['office', 'room'],
  unionName: ['union', 'union name'],
  author: ['author', 'writer'],
  isbn: ['isbn'],
  shelf: ['shelf', 'rack'],
  location: ['location', 'floor', 'section'],
  status: ['status', 'state'],
  leaveType: ['leave type', 'type'],
  fromDate: ['from', 'from date', 'start date'],
  toDate: ['to', 'to date', 'end date'],
  reason: ['reason', 'notes', 'remarks'],
  joined: ['joined', 'join date', 'enrolled'],
  receiptPrefix: ['prefix', 'receipt prefix'],
  managerName: ['manager', 'manager name'],
};

function normalizeColToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveExportColumns(params: {
  entityDef?: EntityTypeDefinition;
  requestedColumns?: string[];
  sampleRows?: Array<Record<string, unknown>>;
}): { columns: ExportColumn[]; blockedSensitive: string[] } {
  const { entityDef, requestedColumns, sampleRows = [] } = params;
  const blockedSensitive: string[] = [];

  if (!entityDef) {
    const inferredKeys = new Set<string>();
    for (const r of sampleRows.slice(0, 10)) {
      for (const k of Object.keys(r)) {
        if (!isSensitiveExportField(k)) inferredKeys.add(k);
      }
    }
    const keys =
      requestedColumns && requestedColumns.length > 0
        ? requestedColumns.filter((k) => {
            if (isSensitiveExportField(k)) {
              blockedSensitive.push(k);
              return false;
            }
            return true;
          })
        : Array.from(inferredKeys);
    return {
      columns: keys.map((k) => ({ key: k, label: k })),
      blockedSensitive,
    };
  }

  const specMap = buildFieldSpecsMap(entityDef);

  if (requestedColumns && requestedColumns.length > 0) {
    const resolved: ExportColumn[] = [];
    const seen = new Set<string>();

    for (const rawReq of requestedColumns) {
      const reqTrim = rawReq.trim();
      if (!reqTrim) continue;
      if (isSensitiveExportField(reqTrim, entityDef)) {
        blockedSensitive.push(reqTrim);
        continue;
      }

      const normReq = normalizeColToken(reqTrim);
      let matchedKey: string | undefined;

      for (const [k, spec] of specMap.entries()) {
        if (
          normalizeColToken(k) === normReq ||
          normalizeColToken(spec.label) === normReq
        ) {
          matchedKey = k;
          break;
        }
      }

      if (!matchedKey) {
        for (const [key, aliases] of Object.entries(COLUMN_SYNONYMS)) {
          if (aliases.includes(normReq) && (specMap.has(key) || sampleRows.some((r) => key in r))) {
            matchedKey = key;
            break;
          }
        }
      }

      if (!matchedKey) {
        for (const [k, spec] of specMap.entries()) {
          const nk = normalizeColToken(k);
          const nl = normalizeColToken(spec.label);
          if (nl.includes(normReq) || nk.includes(normReq)) {
            matchedKey = k;
            break;
          }
        }
      }

      if (!matchedKey) {
        for (const r of sampleRows.slice(0, 5)) {
          const found = Object.keys(r).find((rk) => normalizeColToken(rk) === normReq);
          if (found) {
            matchedKey = found;
            break;
          }
        }
      }

      if (matchedKey && !isSensitiveExportField(matchedKey, entityDef) && !seen.has(matchedKey)) {
        seen.add(matchedKey);
        const spec = specMap.get(matchedKey);
        resolved.push({
          key: matchedKey,
          label: spec?.label || matchedKey,
          format: spec?.format,
        });
      }
    }

    if (resolved.length > 0) {
      return { columns: resolved, blockedSensitive };
    }
  }

  // Default columns from entity config
  const defaultKeys =
    entityDef.defaultExportColumns && entityDef.defaultExportColumns.length > 0
      ? entityDef.defaultExportColumns
      : [entityDef.idField, entityDef.nameField, ...entityDef.displayFields.map((f) => f.key)];

  const deduped: ExportColumn[] = [];
  const seenDefaults = new Set<string>();
  for (const key of defaultKeys) {
    if (seenDefaults.has(key) || isSensitiveExportField(key, entityDef)) continue;
    seenDefaults.add(key);
    const spec = specMap.get(key);
    deduped.push({
      key,
      label: spec?.label || key,
      format: spec?.format,
    });
  }

  return { columns: deduped, blockedSensitive };
}

export function projectExportRow(
  record: Record<string, unknown>,
  columns: ExportColumn[],
  entityDef?: EntityTypeDefinition
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (isSensitiveExportField(col.key, entityDef)) continue;
    let val = record[col.key];
    if (col.format === 'array' && Array.isArray(val)) {
      val = val.join(', ');
    } else if (col.format === 'date' && typeof val === 'string') {
      val = val.slice(0, 10);
    } else if (col.format === 'boolean' && typeof val === 'boolean') {
      val = val ? 'Yes' : 'No';
    }
    out[col.key] = val ?? '';
  }
  return out;
}

export interface QueryExportEntitiesParams {
  config: AssistantEntityConfig;
  collections: Record<string, Array<Record<string, unknown>>>;
  entityType?: string;
  filters?: Record<string, string | number | boolean>;
  numericFilters?: NumericFilter[];
  pendingOnly?: boolean;
  sort?: QuerySortSpec;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  requestedColumns?: string[];
  bulkRequest?: boolean;
  scope?: AccessScope;
  maxRows?: number;
}

export interface QueryExportEntitiesResult {
  ok: boolean;
  denied?: boolean;
  reason?: string;
  entityDef?: EntityTypeDefinition;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
  rawMatches: Array<Record<string, unknown>>;
  totalRows: number;
  exportedRows: number;
  truncated: boolean;
  blockedSensitive: string[];
}

function resolveEntityDefinition(
  config: AssistantEntityConfig,
  entityType?: string,
  collections?: Record<string, Array<Record<string, unknown>>>
): EntityTypeDefinition | undefined {
  if (entityType) {
    const lower = entityType.trim().toLowerCase().replace(/s$/, '');
    const exact = config.entities.find(
      (e) =>
        e.type.toLowerCase() === entityType.trim().toLowerCase() ||
        e.collection.toLowerCase() === entityType.trim().toLowerCase() ||
        e.label.toLowerCase() === lower ||
        (e.pluralLabel && e.pluralLabel.toLowerCase() === entityType.trim().toLowerCase())
    );
    if (exact) return exact;
  }
  if (collections) {
    for (const def of config.entities) {
      if ((collections[def.collection] || []).length > 0) return def;
    }
  }
  return config.entities[0];
}

function matchesTextFilter(actual: unknown, expected: string | number | boolean): boolean {
  if (typeof expected === 'boolean') return Boolean(actual) === expected;
  if (typeof expected === 'number') return Number(actual) === expected;

  const expNorm = String(expected)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!expNorm) return true;

  if (Array.isArray(actual)) {
    return actual.some((item) => matchesTextFilter(item, expNorm));
  }
  const actNorm = String(actual ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!actNorm) return false;
  if (actNorm === expNorm) return true;
  if (actNorm.includes(expNorm)) return true;

  // Handle "Fiqh 2" vs "Fiqh2" or "dept-fiqh" vs "fiqh"
  const expCompact = expNorm.replace(/[^a-z0-9]/g, '');
  const actCompact = actNorm.replace(/[^a-z0-9]/g, '');
  if (expCompact && (actCompact === expCompact || actCompact.includes(expCompact))) {
    return true;
  }
  return false;
}

export function queryEntitiesForExport(
  params: QueryExportEntitiesParams
): QueryExportEntitiesResult {
  const {
    config,
    collections,
    entityType,
    filters = {},
    numericFilters = [],
    pendingOnly = false,
    sort,
    query,
    dateFrom,
    dateTo,
    requestedColumns,
    bulkRequest = false,
    scope,
    maxRows = MAX_EXPORT_ROWS,
  } = params;

  const entityDef = resolveEntityDefinition(config, entityType, collections);
  if (!entityDef) {
    return {
      ok: false,
      reason: `No entity definitions found for ${config.appName}.`,
      columns: [],
      rows: [],
      rawMatches: [],
      totalRows: 0,
      exportedRows: 0,
      truncated: false,
      blockedSensitive: [],
    };
  }

  const role: EntityScopeRole = scope?.role || 'PUBLIC';
  const visibility = entityDef.visibilityRules[role] || 'none';
  if (role === 'PUBLIC' || visibility === 'none') {
    return {
      ok: false,
      denied: true,
      reason:
        role === 'PUBLIC'
          ? 'Access denied: Please sign in before exporting live records.'
          : `You don't have access to export ${entityDef.pluralLabel || entityDef.label} records.`,
      entityDef,
      columns: [],
      rows: [],
      rawMatches: [],
      totalRows: 0,
      exportedRows: 0,
      truncated: false,
      blockedSensitive: [],
    };
  }

  // Student role is strictly self-only; block class/bulk/all-student exports
  if (visibility === 'self' && bulkRequest) {
    return {
      ok: false,
      denied: true,
      reason:
        "You don't have access to export other students' or class records. As a student, you can only export your own record or fee statement.",
      entityDef,
      columns: [],
      rows: [],
      rawMatches: [],
      totalRows: 0,
      exportedRows: 0,
      truncated: false,
      blockedSensitive: [],
    };
  }

  // Sector manager attempting to filter explicitly by another sector/department
  if (visibility === 'sector' && scope?.role === 'SECTOR_MANAGER') {
    const requestedSector = String(
      filters.sector || filters.sectorId || filters.department || ''
    ).trim();
    if (requestedSector) {
      const normReq = requestedSector.toLowerCase();
      const allowed = scope.sectorIds.some(
        (s) =>
          s.toLowerCase() === normReq ||
          s.toLowerCase().replace(/^dept-/, '') === normReq.replace(/^dept-/, '')
      );
      if (!allowed) {
        return {
          ok: false,
          denied: true,
          reason: `You don't have access to records in "${requestedSector}". You can only export data for your assigned sector (${scope.sectorIds.join(', ')}).`,
          entityDef,
          columns: [],
          rows: [],
          rawMatches: [],
          totalRows: 0,
          exportedRows: 0,
          truncated: false,
          blockedSensitive: [],
        };
      }
    }
  }

  const normalizeFinancialRecord = (rec: Record<string, unknown>): Record<string, unknown> => {
    if (entityDef.type !== 'student' && entityDef.type !== 'sector') return rec;
    const credit = Number(rec.paidTotal ?? rec.credit ?? 0);
    const debit = Number(rec.debitTotal ?? rec.debit ?? 0);
    const balance = rec.balance !== undefined && rec.balance !== '' ? Number(rec.balance) : credit - debit;
    const pendingFee =
      rec.pendingFee !== undefined && rec.pendingFee !== ''
        ? Number(rec.pendingFee)
        : balance < 0
          ? Math.abs(balance)
          : 0;
    return {
      ...rec,
      paidTotal: Number.isFinite(credit) ? credit : 0,
      debitTotal: Number.isFinite(debit) ? debit : 0,
      balance: Number.isFinite(balance) ? balance : 0,
      pendingFee: Number.isFinite(pendingFee) ? pendingFee : 0,
    };
  };

  const allRecords = (
    Array.isArray(collections[entityDef.collection]) ? collections[entityDef.collection]! : []
  ).map(normalizeFinancialRecord);

  // 1. Apply strict role/org/sector/self visibility filter
  const visibleRecords = allRecords.filter((rec) =>
    isRecordVisibleToScope(rec, entityDef, scope)
  );

  const resolveNumericValue = (rec: Record<string, unknown>, field: string): number => {
    const direct = rec[field];
    if (direct !== undefined && direct !== null && direct !== '') {
      const n = Number(direct);
      if (Number.isFinite(n)) return n;
    }
    if (field === 'paidTotal') return Number(rec.credit ?? 0);
    if (field === 'debitTotal') return Number(rec.debit ?? 0);
    if (field === 'pendingFee') {
      const b = Number(rec.balance ?? 0);
      return b < 0 ? Math.abs(b) : 0;
    }
    return Number(direct ?? 0);
  };

  // If records existed matching the filter outside user's scope and none inside scope, report access denied
  const applyBusinessFilters = (records: Array<Record<string, unknown>>) =>
    records.filter((rec) => {
      // Explicit key filters
      for (const [fKey, fVal] of Object.entries(filters)) {
        if (fVal === undefined || fVal === null || String(fVal).trim() === '') continue;
        if (fKey === 'sector' || fKey === 'sectorId') {
          const secVal = rec[entityDef.sectorField || 'sectorId'] ?? rec.sectorId ?? rec.sector ?? rec.department;
          const reqSec = String(fVal).toLowerCase();
          if (secVal) {
            if (!matchesTextFilter(secVal, reqSec)) return false;
          } else if (rec.bySector && typeof rec.bySector === 'object') {
            const keys = Object.keys(rec.bySector as Record<string, unknown>);
            if (!keys.some((k) => matchesTextFilter(k, reqSec))) return false;
          } else {
            return false;
          }
          continue;
        }

        if (fKey === 'className' || fKey === 'class') {
          const val = rec.className ?? rec.class;
          if (!matchesTextFilter(val, fVal)) return false;
          continue;
        }

        if (!matchesTextFilter(rec[fKey], fVal)) return false;
      }

      if (numericFilters.length > 0) {
        for (const nf of numericFilters) {
          const actual = resolveNumericValue(rec, nf.field);
          if (!Number.isFinite(actual)) return false;
          if (nf.op === '<' && !(actual < nf.value)) return false;
          if (nf.op === '<=' && !(actual <= nf.value)) return false;
          if (nf.op === '>' && !(actual > nf.value)) return false;
          if (nf.op === '>=' && !(actual >= nf.value)) return false;
          if (nf.op === '=' && !(actual === nf.value)) return false;
          if (nf.op === '!=' && !(actual !== nf.value)) return false;
        }
      }

      if (pendingOnly) {
        const pending = Number(rec.pendingFee ?? 0);
        const bal = Number(rec.balance ?? 0);
        const statusStr = String(rec.status ?? '').toLowerCase();
        const hasPendingFee = pending > 0 || bal < 0 || statusStr === 'pending' || statusStr === 'unpaid';
        if (!hasPendingFee) return false;
      }

      if (dateFrom || dateTo) {
        const dateRaw = String(rec.joined ?? rec.fromDate ?? rec.date ?? rec.createdAt ?? '').slice(0, 10);
        if (dateRaw) {
          if (dateFrom && dateRaw < dateFrom) return false;
          if (dateTo && dateRaw > dateTo) return false;
        }
      }

      if (query && query.trim()) {
        const q = query.trim().toLowerCase();
        const hit = entityDef.searchableFields.some((sf) => matchesTextFilter(rec[sf], q));
        if (!hit) return false;
      }

      return true;
    });

  const filtered = applyBusinessFilters(visibleRecords);

  if (sort?.field) {
    filtered.sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const an = typeof av === 'number' ? av : Number(av);
      const bn = typeof bv === 'number' ? bv : Number(bv);
      let cmp = 0;
      if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) {
        cmp = an - bn;
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      }
      return sort.dir === 'desc' ? -cmp : cmp;
    });
  }

  if (filtered.length === 0) {
    const outOfScopeFiltered = applyBusinessFilters(
      allRecords.filter((rec) => !isRecordVisibleToScope(rec, entityDef, scope))
    );
    if (outOfScopeFiltered.length > 0) {
      return {
        ok: false,
        denied: true,
        reason: "You don't have access to those records.",
        entityDef,
        columns: [],
        rows: [],
        rawMatches: [],
        totalRows: 0,
        exportedRows: 0,
        truncated: false,
        blockedSensitive: [],
      };
    }
  }

  const totalRows = filtered.length;
  const effectiveLimit = Math.min(Math.max(1, maxRows), MAX_EXPORT_ROWS);
  const truncated = totalRows > effectiveLimit;
  const capped = filtered.slice(0, effectiveLimit);

  const { columns, blockedSensitive } = resolveExportColumns({
    entityDef,
    requestedColumns,
    sampleRows: capped.length > 0 ? capped : visibleRecords.slice(0, 5),
  });

  const projectedRows = capped.map((r) => projectExportRow(r, columns, entityDef));

  return {
    ok: true,
    entityDef,
    columns,
    rows: projectedRows,
    rawMatches: capped,
    totalRows,
    exportedRows: projectedRows.length,
    truncated,
    blockedSensitive,
  };
}
