import path from 'node:path';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedSheetData {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  truncated: boolean;
  sheetNames: string[];
  selectedSheet: string;
  headerRowIndex: number; // 1-based row index of detected header row
}

function excelSerialToIsoDate(serial: number): string {
  // Excel epoch is Dec 30, 1899 (with leap-year bug handled by XLSX.SSF.parse_date_code)
  const parsed = XLSX.SSF?.parse_date_code?.(serial);
  if (parsed && parsed.y && parsed.m && parsed.d) {
    const yyyy = String(parsed.y).padStart(4, '0');
    const mm = String(parsed.m).padStart(2, '0');
    const dd = String(parsed.d).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400 * 1000;
  return new Date(utcValue).toISOString().slice(0, 10);
}

function formatDateObjToIso(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatCellValue(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';

  // Preserve leading zeros & exact formatted text for string cells or text-formatted (@) cells
  if (cell.t === 's') {
    return String(cell.v).trim();
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    return formatDateObjToIso(cell.v);
  }
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const numFmt = typeof cell.z === 'string' ? cell.z : '';
    const w = typeof cell.w === 'string' ? cell.w.trim() : '';
    const looksLikeDateFmt =
      numFmt &&
      numFmt !== 'General' &&
      /[dmy]/i.test(numFmt.replace(/\\./g, '').replace(/"[^"]*"/g, ''));
    if (looksLikeDateFmt && cell.v > 20000 && cell.v < 90000) {
      return excelSerialToIsoDate(cell.v);
    }
    // Preserve leading zeros if Excel stored a zero-padded format or cell.w has leading zeroes (e.g. "00123")
    if (w && /^0\d+$/.test(w)) {
      return w;
    }
    if (numFmt && /^0+$/.test(numFmt.replace(/"/g, ''))) {
      return w || String(cell.v);
    }
    return String(cell.v);
  }
  if (cell.t === 'b') {
    return cell.v ? 'true' : 'false';
  }
  return (cell.w ?? String(cell.v)).trim();
}

/**
 * Expands merged cell ranges across the 2D sheet matrix so top-left values fill
 * merged regions cleanly instead of creating blanks/misaligned headers.
 */
function extractExpandedMatrix(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);

  const rowCount = Math.min(range.e.r - range.s.r + 1, 5200);
  const colCount = Math.min(range.e.c - range.s.c + 1, 120);

  const matrix: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => '')
  );

  for (let r = 0; r < rowCount; r += 1) {
    for (let c = 0; c < colCount; c += 1) {
      const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      matrix[r][c] = formatCellValue(sheet[addr] as XLSX.CellObject | undefined);
    }
  }

  const merges = (sheet['!merges'] || []) as XLSX.Range[];
  for (const merge of merges) {
    const topLeftR = merge.s.r - range.s.r;
    const topLeftC = merge.s.c - range.s.c;
    if (topLeftR < 0 || topLeftR >= rowCount || topLeftC < 0 || topLeftC >= colCount) continue;
    const topVal = matrix[topLeftR][topLeftC];
    if (!topVal) continue;
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        const mr = r - range.s.r;
        const mc = c - range.s.c;
        if (mr >= 0 && mr < rowCount && mc >= 0 && mc < colCount && !matrix[mr][mc]) {
          matrix[mr][mc] = topVal;
        }
      }
    }
  }

  return matrix;
}

/**
 * Auto-detects the header row (handling spreadsheets with title banners, empty rows,
 * or metadata headers above the table). Scans up to the top 15 non-empty rows.
 */
function detectHeaderRowIndex(matrix: string[][]): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  const maxScan = Math.min(matrix.length, 15);

  for (let r = 0; r < maxScan; r += 1) {
    const cells = matrix[r].map((c) => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    const unique = new Set(cells.map((c) => c.toLowerCase()));
    const textLabelCount = cells.filter((c) => /[\p{L}]/u.test(c) && !/^\d+(\.\d+)?$/.test(c)).length;
    const pureNumberCount = cells.filter((c) => /^\d+(\.\d+)?$/.test(c)).length;

    // Prefer rows with multiple distinct text labels and at least 2 columns
    let score = textLabelCount * 3 + unique.size * 2 - pureNumberCount * 2;
    if (cells.length === 1) score -= 8; // likely a merged title banner row
    if (r + 1 < matrix.length) {
      const nextCells = matrix[r + 1].map((c) => c.trim()).filter(Boolean);
      if (nextCells.length >= cells.length - 1 && nextCells.length >= 2) {
        score += 3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }

  return bestIdx;
}

function matrixToObjects(
  matrix: string[][],
  maxRows: number
): {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  truncated: boolean;
  headerRowIndex: number;
} {
  if (matrix.length === 0) {
    return { headers: [], rows: [], totalRows: 0, truncated: false, headerRowIndex: 1 };
  }

  const headerIdx = detectHeaderRowIndex(matrix);
  const rawHeaderRow = matrix[headerIdx] || [];
  const usedNames = new Map<string, number>();

  const colHeaders = rawHeaderRow.map((cell, cIdx) => {
    const clean = cell.trim();
    if (!clean) return '';
    const count = usedNames.get(clean) || 0;
    usedNames.set(clean, count + 1);
    return count === 0 ? clean : `${clean}_${count + 1}`;
  });

  // Include any trailing non-empty columns if header row had blanks
  const maxCols = Math.max(colHeaders.length, ...matrix.slice(headerIdx).map((r) => r.length));
  for (let c = 0; c < maxCols; c += 1) {
    if (!colHeaders[c]) {
      const hasDataBelow = matrix.slice(headerIdx + 1, headerIdx + 20).some((r) => Boolean(r[c]?.trim()));
      if (hasDataBelow) {
        colHeaders[c] = `Column ${c + 1}`;
      }
    }
  }

  const activeHeaders = colHeaders.filter(Boolean);
  const nonEmptyRows: Array<Record<string, unknown>> = [];

  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const rowArr = matrix[r];
    const hasAnyValue = rowArr.some((v) => v.trim().length > 0);
    if (!hasAnyValue) continue;

    const record: Record<string, unknown> = {};
    for (let c = 0; c < colHeaders.length; c += 1) {
      const h = colHeaders[c];
      if (!h) continue;
      record[h] = rowArr[c] ?? '';
    }
    nonEmptyRows.push(record);
  }

  const totalRows = nonEmptyRows.length;
  const truncated = totalRows > maxRows;
  const slicedRows = truncated ? nonEmptyRows.slice(0, maxRows) : nonEmptyRows;

  return {
    headers: activeHeaders,
    rows: slicedRows,
    totalRows,
    truncated,
    headerRowIndex: headerIdx + 1,
  };
}

export function parseSpreadsheetBuffer(
  buffer: Buffer,
  filename: string,
  maxRows = 5000,
  options?: { sheetName?: string }
): ParsedSheetData {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.csv' || ext === '.tsv') {
    const csvText = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const parsed = Papa.parse<string[]>(csvText, {
      header: false,
      delimiter: ext === '.tsv' ? '\t' : '',
      skipEmptyLines: 'greedy',
    });
    const matrix = (parsed.data || []).map((row) =>
      Array.isArray(row) ? row.map((v) => String(v ?? '').trim()) : []
    );
    const out = matrixToObjects(matrix, maxRows);
    return {
      ...out,
      sheetNames: [ext === '.tsv' ? 'TSV' : 'CSV'],
      selectedSheet: ext === '.tsv' ? 'TSV' : 'CSV',
    };
  }

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: true });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      truncated: false,
      sheetNames: [],
      selectedSheet: '',
      headerRowIndex: 1,
    };
  }

  const selectedSheet =
    options?.sheetName && sheetNames.includes(options.sheetName)
      ? options.sheetName
      : sheetNames[0];

  const sheet = workbook.Sheets[selectedSheet];
  const matrix = extractExpandedMatrix(sheet);
  const out = matrixToObjects(matrix, maxRows);

  return {
    ...out,
    sheetNames,
    selectedSheet,
  };
}
