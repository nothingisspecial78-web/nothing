import ExcelJS from 'exceljs';
import { z } from 'zod';
import type {
  ColumnMappingSuggestion,
  ImportPreviewResult,
  ImportRowError,
  ImportValidRow,
  SheetColumnRule,
  SheetTemplate,
} from '@ai-assistant/core';
import { sanitizeCsvCell } from '../security/sanitize.ts';

function normalizeHeader(header: string): string {
  return header
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function similarityScore(a: string, b: string): number {
  const tokensA = new Set(normalizeHeader(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeHeader(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap += 1;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

export function mapHeadersToTemplate(
  detectedHeaders: string[],
  template: SheetTemplate,
  overrides: Record<string, string> = {}
): ColumnMappingSuggestion[] {
  const usedHeaders = new Set<string>();

  return template.columns.map((col) => {
    const override = overrides[col.key];
    if (override === '__unmapped__') {
      return {
        expectedKey: col.key,
        expectedLabel: col.label,
        matchedHeader: null,
        confidence: 'missing',
        suggestions: detectedHeaders.slice(0, 3),
      };
    }
    if (override && detectedHeaders.includes(override)) {
      usedHeaders.add(override);
      return {
        expectedKey: col.key,
        expectedLabel: col.label,
        matchedHeader: override,
        confidence: 'exact',
        suggestions: [override],
      };
    }

    const normKey = normalizeHeader(col.key);
    const normLabel = normalizeHeader(col.label);
    const normAliases = col.aliases.map(normalizeHeader);

    // 1. Exact label/key match (Unicode + whitespace tolerant)
    for (const h of detectedHeaders) {
      if (usedHeaders.has(h)) continue;
      const nh = normalizeHeader(h);
      if (nh === normLabel || nh === normKey) {
        usedHeaders.add(h);
        return {
          expectedKey: col.key,
          expectedLabel: col.label,
          matchedHeader: h,
          confidence: 'exact',
          suggestions: [h],
        };
      }
    }

    // 2. Alias match (EN + Malayalam + Arabic)
    for (const h of detectedHeaders) {
      if (usedHeaders.has(h)) continue;
      const nh = normalizeHeader(h);
      if (normAliases.includes(nh)) {
        usedHeaders.add(h);
        return {
          expectedKey: col.key,
          expectedLabel: col.label,
          matchedHeader: h,
          confidence: 'alias',
          suggestions: [h],
        };
      }
    }

    // 3. Fuzzy token match & ranked suggestions
    const ranked = detectedHeaders
      .filter((h) => !usedHeaders.has(h))
      .map((h) => ({
        header: h,
        score: Math.max(
          similarityScore(h, col.label),
          similarityScore(h, col.key),
          ...col.aliases.map((a) => similarityScore(h, a))
        ),
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (best && best.score >= 0.45) {
      usedHeaders.add(best.header);
      return {
        expectedKey: col.key,
        expectedLabel: col.label,
        matchedHeader: best.header,
        confidence: 'fuzzy',
        suggestions: ranked.slice(0, 3).map((r) => r.header),
      };
    }

    return {
      expectedKey: col.key,
      expectedLabel: col.label,
      matchedHeader: null,
      confidence: 'missing',
      suggestions: ranked.slice(0, 3).map((r) => r.header),
    };
  });
}

function buildColumnZodSchema(rule: SheetColumnRule): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (rule.type) {
    case 'number': {
      let numSchema = z.number({ error: `${rule.label} must be a valid number` });
      if (rule.min !== undefined) {
        numSchema = numSchema.min(rule.min, `${rule.label} must be >= ${rule.min}`);
      }
      if (rule.max !== undefined) {
        numSchema = numSchema.max(rule.max, `${rule.label} must be <= ${rule.max}`);
      }
      schema = z.preprocess((val) => {
        if (val === '' || val === null || val === undefined) return undefined;
        if (typeof val === 'number') return val;
        const cleaned = String(val).replace(/[,$₹€£\s]/g, '');
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : val;
      }, numSchema);
      break;
    }
    case 'email': {
      schema = z
        .string({ error: `${rule.label} is required` })
        .trim()
        .email(`${rule.label} must be a valid email address`);
      break;
    }
    case 'date': {
      schema = z
        .string({ error: `${rule.label} is required` })
        .trim()
        .refine((v) => !Number.isNaN(Date.parse(v)), `${rule.label} must be a valid date`);
      break;
    }
    case 'enum': {
      const allowed = rule.enumValues || [];
      schema = z
        .string({ error: `${rule.label} is required` })
        .trim()
        .refine(
          (val) => allowed.some((a) => a.toLowerCase() === val.toLowerCase()),
          `${rule.label} must be one of: ${allowed.join(', ')}`
        )
        .transform((val) => {
          const match = allowed.find((a) => a.toLowerCase() === val.toLowerCase());
          return match ?? val;
        });
      break;
    }
    case 'string':
    default: {
      let strSchema = z.string({ error: `${rule.label} is required` }).trim();
      if (rule.minLength !== undefined) {
        strSchema = strSchema.min(
          rule.minLength,
          `${rule.label} must be at least ${rule.minLength} characters`
        );
      }
      if (rule.maxLength !== undefined) {
        strSchema = strSchema.max(
          rule.maxLength,
          `${rule.label} must be at most ${rule.maxLength} characters`
        );
      }
      if (rule.pattern) {
        const regex = new RegExp(rule.pattern);
        strSchema = strSchema.regex(regex, `${rule.label} has an invalid format`);
      }
      schema = strSchema;
      break;
    }
  }

  if (!rule.required) {
    return z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      schema.optional()
    );
  }
  return z.preprocess((v) => (v === '' || v === null ? undefined : v), schema);
}

export function validateSpreadsheetRows(params: {
  uploadId: string;
  appId: string;
  fileName: string;
  template: SheetTemplate;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  truncated: boolean;
  columnOverrides?: Record<string, string>;
  sheetNames?: string[];
  selectedSheet?: string;
  headerRowIndex?: number;
}): ImportPreviewResult {
  const columnMapping = mapHeadersToTemplate(
    params.headers,
    params.template,
    params.columnOverrides
  );

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const col of params.template.columns) {
    shape[col.key] = buildColumnZodSchema(col);
  }
  const rowSchema = z.object(shape);

  const validRows: ImportValidRow[] = [];
  const errors: ImportRowError[] = [];
  const dedupeKey = ['id', 'email', 'receiptNo'].find((k) =>
    params.template.columns.some((c) => c.key === k)
  );
  const seenKeys = new Map<string, number>();
  let duplicateCount = 0;
  const rowOffset = (params.headerRowIndex || 1) + 1;

  params.rows.forEach((rawRow, index) => {
    const rowNumber = index + rowOffset;
    const mapped: Record<string, unknown> = {};

    for (const mapping of columnMapping) {
      if (mapping.matchedHeader) {
        mapped[mapping.expectedKey] = rawRow[mapping.matchedHeader];
      }
    }

    const parsed = rowSchema.safeParse(mapped);
    if (parsed.success) {
      const keyValRaw = dedupeKey ? parsed.data[dedupeKey] : undefined;
      const keyNorm =
        typeof keyValRaw === 'string' && keyValRaw.trim()
          ? keyValRaw.trim().toLowerCase()
          : '';
      if (keyNorm && seenKeys.has(keyNorm)) {
        const firstRow = seenKeys.get(keyNorm)!;
        duplicateCount += 1;
        errors.push({
          rowNumber,
          raw: rawRow,
          reasons: [`Duplicate ${dedupeKey} "${String(keyValRaw)}" (already in row ${firstRow})`],
        });
      } else {
        if (keyNorm) seenKeys.set(keyNorm, rowNumber);
        validRows.push({
          rowNumber,
          data: parsed.data,
        });
      }
    } else {
      const reasons = parsed.error.issues.map((issue) => {
        const field = issue.path[0] ? String(issue.path[0]) : 'row';
        return issue.message === 'Required' ? `${field} is required` : issue.message;
      });
      errors.push({
        rowNumber,
        raw: rawRow,
        reasons,
      });
    }
  });

  return {
    uploadId: params.uploadId,
    appId: params.appId,
    fileName: params.fileName,
    templateId: params.template.templateId,
    targetTool: params.template.targetTool,
    totalRows: params.totalRows,
    validCount: validRows.length,
    invalidCount: errors.length,
    duplicateCount,
    detectedHeaders: params.headers,
    columnMapping,
    validRows,
    errors,
    truncated: params.truncated,
    sheetNames: params.sheetNames,
    selectedSheet: params.selectedSheet,
    headerRowIndex: params.headerRowIndex,
    normalizedPreview: validRows.slice(0, 10).map((r) => r.data),
  };
}

export function generateErrorReportCsv(errors: ImportRowError[]): string {
  const allKeys = new Set<string>();
  for (const err of errors) {
    for (const k of Object.keys(err.raw)) {
      allKeys.add(k);
    }
  }
  const dataCols = Array.from(allKeys);
  const header = ['Row Number', 'Validation Errors', ...dataCols].map(sanitizeCsvCell).join(',');

  const lines = errors.map((err) => {
    const rowCells = [
      err.rowNumber,
      err.reasons.join('; '),
      ...dataCols.map((k) => err.raw[k] ?? ''),
    ];
    return rowCells.map(sanitizeCsvCell).join(',');
  });

  return [header, ...lines].join('\n');
}

export async function generateErrorReportXlsxBuffer(errors: ImportRowError[]): Promise<Buffer> {
  const allKeys = new Set<string>();
  for (const err of errors) {
    for (const k of Object.keys(err.raw)) {
      allKeys.add(k);
    }
  }
  const dataCols = Array.from(allKeys);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Import Validation Errors');
  ws.addRow(['Row Number', 'Validation Errors', ...dataCols]);

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };

  for (const err of errors) {
    const cells = [
      err.rowNumber,
      err.reasons.join('; '),
      ...dataCols.map((k) => sanitizeCsvCell(err.raw[k] ?? '')),
    ];
    ws.addRow(cells);
  }

  ws.columns.forEach((col) => {
    col.width = 22;
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
