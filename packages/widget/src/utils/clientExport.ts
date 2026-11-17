import type { ExportColumn, ExportFilePayload } from '@ai-assistant/core';

export interface GeneratedExportArtifact {
  blob: Blob;
  uint8: Uint8Array;
  filename: string;
  mimeType: string;
}

const MIME_TYPES: Record<ExportFilePayload['format'], string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};

const FONT_FILE_CACHE = new Map<string, string>();

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function loadFontBase64(fileName: string, apiUrl = ''): Promise<string | null> {
  const cacheKey = `${apiUrl}::${fileName}`;
  if (FONT_FILE_CACHE.has(cacheKey)) {
    return FONT_FILE_CACHE.get(cacheKey)!;
  }

  // Browser environment: fetch from /fonts/ (or apiUrl/fonts/ for embedded cross-origin widgets)
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const cleanBase = apiUrl.replace(/\/$/, '');
    const candidates = cleanBase
      ? [`${cleanBase}/fonts/${fileName}`, `/fonts/${fileName}`]
      : [`/fonts/${fileName}`];
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 1000) {
            const b64 = arrayBufferToBase64(buf);
            FONT_FILE_CACHE.set(cacheKey, b64);
            return b64;
          }
        }
      } catch {
        // try next URL
      }
    }
  }

  // Node / unit test fallback: load directly from public/fonts/ without bundling node:* into browser
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fsSpecifier = ['node', 'fs/promises'].join(':');
      const pathSpecifier = ['node', 'path'].join(':');
      const fs = (await import(/* @vite-ignore */ fsSpecifier)) as typeof import('node:fs/promises');
      const path = (await import(/* @vite-ignore */ pathSpecifier)) as typeof import('node:path');
      const fontPath = path.resolve(process.cwd(), 'public', 'fonts', fileName);
      const buf = await fs.readFile(fontPath);
      if (buf.byteLength > 1000) {
        const b64 = buf.toString('base64');
        FONT_FILE_CACHE.set(cacheKey, b64);
        return b64;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function containsMalayalam(text: string): boolean {
  return /[\u0D00-\u0D7F]/.test(text);
}

function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export function formatExportCellValue(
  raw: unknown,
  col: ExportColumn,
  options?: { emptyPlaceholder?: string; asciiCurrency?: boolean }
): string {
  const empty = options?.emptyPlaceholder ?? '—';
  if (raw === undefined || raw === null || raw === '') return empty;
  if (col.format === 'currency') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isNaN(num)) {
      const rounded = Math.round(num);
      const formatted = Math.abs(rounded).toLocaleString('en-IN');
      const prefix = options?.asciiCurrency ? 'Rs. ' : '₹';
      return rounded < 0 ? `-${prefix}${formatted}` : `${prefix}${formatted}`;
    }
  }
  if (col.format === 'boolean' && typeof raw === 'boolean') {
    return raw ? 'Yes' : 'No';
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? '')).filter(Boolean).join(', ') || empty;
  }
  return String(raw);
}

async function buildExcelArtifact(exportFile: ExportFilePayload): Promise<GeneratedExportArtifact> {
  const excelMod = await import('exceljs');
  const WorkbookCtor =
    excelMod.Workbook ||
    (excelMod as unknown as { default?: { Workbook?: typeof excelMod.Workbook } }).default?.Workbook;
  if (!WorkbookCtor) {
    throw new Error('ExcelJS Workbook constructor is unavailable');
  }

  const workbook = new WorkbookCtor();
  workbook.creator = 'AI Assistant';
  workbook.created = new Date(exportFile.generatedAt || Date.now());

  const safeSheetName =
    exportFile.title
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || 'Export';

  const sheet = workbook.addWorksheet(safeSheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Compute auto column widths from header + cell contents
  const colWidths = exportFile.columns.map((col) => {
    let maxLen = col.label.length;
    for (const row of exportFile.rows) {
      const display = formatExportCellValue(row[col.key], col, { emptyPlaceholder: '' });
      if (display.length > maxLen) {
        maxLen = display.length;
      }
    }
    return Math.min(44, Math.max(12, maxLen + 4));
  });

  sheet.columns = exportFile.columns.map((col, idx) => ({
    header: col.label,
    key: col.key,
    width: colWidths[idx],
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });

  for (let rIdx = 0; rIdx < exportFile.rows.length; rIdx += 1) {
    const rawRow = exportFile.rows[rIdx];
    const rowValues: Record<string, string | number | boolean> = {};
    for (const col of exportFile.columns) {
      const val = rawRow[col.key];
      if (col.format === 'currency' && typeof val === 'number' && !Number.isNaN(val)) {
        rowValues[col.key] = Math.round(val);
      } else if (typeof val === 'number' && !Number.isNaN(val)) {
        rowValues[col.key] = val;
      } else {
        rowValues[col.key] = formatExportCellValue(val, col, { emptyPlaceholder: '' });
      }
    }

    const excelRow = sheet.addRow(rowValues);
    excelRow.eachCell((cell, colNumber) => {
      const col = exportFile.columns[colNumber - 1];
      cell.alignment = {
        vertical: 'middle',
        horizontal: col?.format === 'currency' ? 'right' : 'left',
        wrapText: true,
      };
      if (col?.format === 'currency' && typeof cell.value === 'number') {
        cell.numFmt = '"₹"#,##0';
      }
      if (rIdx % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }
    });
  }

  const rawBuf = await workbook.xlsx.writeBuffer();
  const uint8 = rawBuf instanceof Uint8Array ? rawBuf : new Uint8Array(rawBuf);
  const mimeType = MIME_TYPES.xlsx;
  return {
    uint8,
    blob: new Blob([uint8], { type: mimeType }),
    filename: exportFile.filename,
    mimeType,
  };
}

async function buildPdfArtifact(
  exportFile: ExportFilePayload,
  apiUrl = ''
): Promise<GeneratedExportArtifact> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableMod.default;
  const orientation = exportFile.columns.length > 5 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageWidth = orientation === 'landscape' ? 297 : 210;

  // Embed Unicode fonts (Latin + ₹, Malayalam, Arabic)
  const [notoRegular, notoBold, notoMalayalam, notoArabic] = await Promise.all([
    loadFontBase64('NotoSans-Regular.ttf', apiUrl),
    loadFontBase64('NotoSans-Bold.ttf', apiUrl),
    loadFontBase64('NotoSansMalayalam-Regular.ttf', apiUrl),
    loadFontBase64('NotoNaskhArabic-Regular.ttf', apiUrl),
  ]);

  let baseFont = 'helvetica';
  let hasNotoLatin = false;
  let hasMalayalamFont = false;
  let hasArabicFont = false;

  if (notoRegular) {
    doc.addFileToVFS('NotoSans-Regular.ttf', notoRegular);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal', 'Identity-H');
    baseFont = 'NotoSans';
    hasNotoLatin = true;
  }
  if (notoBold) {
    doc.addFileToVFS('NotoSans-Bold.ttf', notoBold);
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold', 'Identity-H');
  } else if (notoRegular) {
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'bold', 'Identity-H');
  }
  if (notoMalayalam) {
    doc.addFileToVFS('NotoSansMalayalam-Regular.ttf', notoMalayalam);
    doc.addFont('NotoSansMalayalam-Regular.ttf', 'NotoSansMalayalam', 'normal', 'Identity-H');
    hasMalayalamFont = true;
  }
  if (notoArabic) {
    doc.addFileToVFS('NotoNaskhArabic-Regular.ttf', notoArabic);
    doc.addFont('NotoNaskhArabic-Regular.ttf', 'NotoNaskhArabic', 'normal', 'Identity-H');
    hasArabicFont = true;
  }

  const shapePdfText = (val: string): string => {
    if (!val) return '';
    if (containsArabic(val)) {
      const apiDoc = doc as unknown as { processArabic?: (txt: string) => string };
      if (typeof apiDoc.processArabic === 'function') {
        try {
          return apiDoc.processArabic(val);
        } catch {
          return val;
        }
      }
    }
    return val;
  };

  // Top accent bar
  doc.setFillColor(249, 115, 22);
  doc.rect(0, 0, pageWidth, 3.5, 'F');

  const generatedDate = (exportFile.generatedAt || new Date().toISOString()).slice(0, 10);
  const titleFont =
    containsMalayalam(exportFile.title) && hasMalayalamFont
      ? 'NotoSansMalayalam'
      : containsArabic(exportFile.title) && hasArabicFont
        ? 'NotoNaskhArabic'
        : baseFont;

  doc.setFont(titleFont, titleFont === baseFont ? 'bold' : 'normal');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(shapePdfText(exportFile.title), 14, 14);

  doc.setFont(baseFont, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Generated: ${generatedDate}  ·  ${exportFile.summaryLine}`, 14, 20.5);

  let startY = 25;
  if (exportFile.truncated) {
    doc.setFontSize(8.5);
    doc.setTextColor(180, 83, 9);
    doc.text(
      `Note: Export capped at ${exportFile.exportedRows.toLocaleString()} of ${exportFile.totalRows.toLocaleString()} matching rows.`,
      14,
      25.5
    );
    startY = 30;
  }

  const head = [exportFile.columns.map((c) => shapePdfText(c.label))];
  const body = exportFile.rows.map((row) =>
    exportFile.columns.map((col) => {
      const formatted = formatExportCellValue(row[col.key], col, {
        asciiCurrency: !hasNotoLatin,
      });
      return shapePdfText(formatted);
    })
  );

  autoTable(doc, {
    startY,
    head,
    body,
    margin: { top: 18, right: 14, bottom: 16, left: 14 },
    styles: {
      font: baseFont,
      fontSize: 8.5,
      cellPadding: 2.6,
      overflow: 'linebreak',
      valign: 'middle',
      textColor: [15, 23, 42],
    },
    headStyles: {
      font: baseFont,
      fontStyle: 'bold',
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell: (data) => {
      const rawText = Array.isArray(data.cell.text) ? data.cell.text.join(' ') : String(data.cell.text || '');
      if (containsMalayalam(rawText) && hasMalayalamFont) {
        data.cell.styles.font = 'NotoSansMalayalam';
        data.cell.styles.fontStyle = 'normal';
      } else if (containsArabic(rawText) && hasArabicFont) {
        data.cell.styles.font = 'NotoNaskhArabic';
        data.cell.styles.fontStyle = 'normal';
        data.cell.styles.halign = 'right';
      } else if (data.section === 'body') {
        const col = exportFile.columns[data.column.index];
        if (col?.format === 'currency') {
          data.cell.styles.halign = 'right';
        }
      }
    },
  });

  // Page numbers across all generated pages
  const totalPages = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    doc.setFont(baseFont, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(exportFile.filename, 14, pageHeight - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
  }

  const arrayBuf = doc.output('arraybuffer');
  const uint8 = new Uint8Array(arrayBuf);
  const mimeType = MIME_TYPES.pdf;
  return {
    uint8,
    blob: new Blob([uint8], { type: mimeType }),
    filename: exportFile.filename,
    mimeType,
  };
}

async function buildCsvArtifact(exportFile: ExportFilePayload): Promise<GeneratedExportArtifact> {
  const papaMod = await import('papaparse');
  const Papa = papaMod.default || papaMod;
  const fields = exportFile.columns.map((c) => c.label);
  const data = exportFile.rows.map((row) =>
    exportFile.columns.map((col) => {
      const val = row[col.key];
      if (val === undefined || val === null) return '';
      if (col.format === 'currency' && typeof val === 'number') {
        return Math.round(val);
      }
      if (Array.isArray(val)) return val.join('; ');
      return String(val);
    })
  );

  const csvBody = Papa.unparse({ fields, data }, { quotes: false, newline: '\r\n' });
  const csvWithBom = `\uFEFF${csvBody}`;
  const uint8 = new TextEncoder().encode(csvWithBom);
  const mimeType = MIME_TYPES.csv;
  return {
    uint8,
    blob: new Blob([uint8], { type: mimeType }),
    filename: exportFile.filename,
    mimeType,
  };
}

async function buildDocxArtifact(exportFile: ExportFilePayload): Promise<GeneratedExportArtifact> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx');

  const headerRow = new TableRow({
    tableHeader: true,
    children: exportFile.columns.map(
      (col) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: '0F172A' },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: col.label,
                  bold: true,
                  color: 'FFFFFF',
                  size: 20,
                }),
              ],
            }),
          ],
        })
    ),
  });

  const dataRows = exportFile.rows.map(
    (row, rIdx) =>
      new TableRow({
        children: exportFile.columns.map((col) => {
          const text = formatExportCellValue(row[col.key], col);
          return new TableCell({
            shading:
              rIdx % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'F8FAFC' } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: col.format === 'currency' ? AlignmentType.RIGHT : AlignmentType.LEFT,
                bidirectional: containsArabic(text),
                children: [new TextRun({ text, size: 19 })],
              }),
            ],
          });
        }),
      })
  );

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: exportFile.title, bold: true, size: 30, color: '0F172A' })],
    }),
    new Paragraph({
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: `Generated: ${(exportFile.generatedAt || new Date().toISOString()).slice(0, 10)} · ${exportFile.summaryLine}`,
          color: '64748B',
          size: 19,
        }),
      ],
    }),
  ];

  if (exportFile.truncated) {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: `Note: Showing first ${exportFile.exportedRows} of ${exportFile.totalRows} matching rows.`,
            italics: true,
            color: 'B45309',
            size: 18,
          }),
        ],
      })
    );
  }

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
      },
      rows: [headerRow, ...dataRows],
    })
  );

  const doc = new Document({
    sections: [{ children }],
  });

  const arrayBuf = await Packer.toArrayBuffer(doc);
  const uint8 = new Uint8Array(arrayBuf);
  const mimeType = MIME_TYPES.docx;
  return {
    uint8,
    blob: new Blob([uint8], { type: mimeType }),
    filename: exportFile.filename,
    mimeType,
  };
}

function buildJsonArtifact(exportFile: ExportFilePayload): GeneratedExportArtifact {
  const labeledRows = exportFile.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of exportFile.columns) {
      out[col.label] = row[col.key] ?? null;
    }
    return out;
  });

  const payload = {
    title: exportFile.title,
    generatedAt: exportFile.generatedAt,
    summary: exportFile.summaryLine,
    totalRows: exportFile.totalRows,
    exportedRows: exportFile.exportedRows,
    truncated: exportFile.truncated,
    columns: exportFile.columns.map((c) => ({ key: c.key, label: c.label })),
    rows: labeledRows,
  };

  const jsonText = JSON.stringify(payload, null, 2);
  const uint8 = new TextEncoder().encode(jsonText);
  const mimeType = MIME_TYPES.json;
  return {
    uint8,
    blob: new Blob([uint8], { type: mimeType }),
    filename: exportFile.filename,
    mimeType,
  };
}

function buildTxtArtifact(exportFile: ExportFilePayload): GeneratedExportArtifact {
  const widths = exportFile.columns.map((col) => {
    let w = col.label.length;
    for (const row of exportFile.rows) {
      const len = formatExportCellValue(row[col.key], col).length;
      if (len > w) w = len;
    }
    return Math.min(40, w);
  });

  const pad = (text: string, width: number) =>
    text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text.padEnd(width, ' ');

  const headerLine = exportFile.columns.map((c, idx) => pad(c.label, widths[idx])).join(' | ');
  const sepLine = widths.map((w) => '-'.repeat(w)).join('-+-');
  const rowLines = exportFile.rows.map((row) =>
    exportFile.columns
      .map((c, idx) => pad(formatExportCellValue(row[c.key], c), widths[idx]))
      .join(' | ')
  );

  const lines = [
    exportFile.title,
    `Generated: ${(exportFile.generatedAt || new Date().toISOString()).slice(0, 10)} · ${exportFile.summaryLine}`,
    ...(exportFile.truncated
      ? [`Note: Showing ${exportFile.exportedRows} of ${exportFile.totalRows} matching rows.`]
      : []),
    '',
    headerLine,
    sepLine,
    ...rowLines,
  ];

  const uint8 = new TextEncoder().encode(lines.join('\n'));
  const mimeType = MIME_TYPES.txt;
  return {
    uint8,
    blob: new Blob([uint8], { type: mimeType }),
    filename: exportFile.filename,
    mimeType,
  };
}

export async function generateExportArtifact(
  exportFile: ExportFilePayload,
  options?: { apiUrl?: string }
): Promise<GeneratedExportArtifact> {
  switch (exportFile.format) {
    case 'xlsx':
      return buildExcelArtifact(exportFile);
    case 'pdf':
      return buildPdfArtifact(exportFile, options?.apiUrl || '');
    case 'csv':
      return buildCsvArtifact(exportFile);
    case 'docx':
      return buildDocxArtifact(exportFile);
    case 'json':
      return buildJsonArtifact(exportFile);
    case 'txt':
      return buildTxtArtifact(exportFile);
    default:
      throw new Error(`Unsupported export format: ${String(exportFile.format)}`);
  }
}

export function triggerInMemoryDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Browser download is unavailable in a non-DOM environment');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadExportFile(
  exportFile: ExportFilePayload,
  options?: { apiUrl?: string }
): Promise<GeneratedExportArtifact> {
  const artifact = await generateExportArtifact(exportFile, options);
  triggerInMemoryDownload(artifact.blob, artifact.filename);
  return artifact;
}
