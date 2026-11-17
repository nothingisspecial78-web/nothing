import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { ALLOWED_MULTIMODAL_EXTENSIONS, BLOCKED_DANGEROUS_EXTENSIONS } from '@ai-assistant/core';
import { inspectFileMagicBytes } from '../packages/server/src/files/magicBytes.ts';
import { parseSpreadsheetBuffer } from '../packages/server/src/files/parseSheet.ts';
import { generateErrorReportXlsxBuffer, validateSpreadsheetRows } from '../packages/server/src/files/validate.ts';
import { loadConfig } from '../packages/server/src/config.ts';
import { ProfileRegistry } from '../packages/server/src/profiles/loader.ts';
import { ActionLogStore } from '../packages/server/src/security/confirmation.ts';
import { KHAZNA_BUILTIN_TOOLS } from '../packages/server/src/tools/khaznaTools.ts';

test('Magic-byte inspector blocks dangerous extensions, PE executables renamed as .png, and macro OOXML files', () => {
  for (const ext of BLOCKED_DANGEROUS_EXTENSIONS) {
    const res = inspectFileMagicBytes(Buffer.from('hello world'), `payload${ext}`);
    assert.equal(res.valid, false, `Expected blocked extension ${ext} to be rejected`);
  }

  // PE executable ("MZ...") disguised as PNG
  const peDisguised = inspectFileMagicBytes(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), 'receipt.png', 'image/png');
  assert.equal(peDisguised.valid, false);

  // Macro-containing ZIP disguised as .xlsx
  const macroZip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('xl/workbook.xml xl/vbaProject.bin'),
  ]);
  const macroRes = inspectFileMagicBytes(macroZip, 'students.xlsx');
  assert.equal(macroRes.valid, false);
});

test('Magic-byte inspector accepts genuine PNG, PDF, XLSX, DOCX, CSV, TSV, and JSON', () => {
  assert.equal(
    inspectFileMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), 'photo.png').valid,
    true
  );
  assert.equal(inspectFileMagicBytes(Buffer.from('%PDF-1.7\n1 0 obj\n'), 'statement.pdf').valid, true);
  assert.equal(
    inspectFileMagicBytes(
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/worksheets/sheet1.xml')]),
      'roster.xlsx'
    ).valid,
    true
  );
  assert.equal(
    inspectFileMagicBytes(
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml')]),
      'letter.docx'
    ).valid,
    true
  );
  assert.equal(inspectFileMagicBytes(Buffer.from('Admission No,Student Name\nS0125,Safwan\n', 'utf8'), 'students.csv').valid, true);
  assert.equal(inspectFileMagicBytes(Buffer.from('Admission No\tStudent Name\nS0125\tSafwan\n', 'utf8'), 'students.tsv').valid, true);
  assert.equal(inspectFileMagicBytes(Buffer.from('{"ok":true}'), 'config.json').valid, true);
  assert.ok(ALLOWED_MULTIMODAL_EXTENSIONS.includes('.heic'));
});

test('parseSpreadsheetBuffer supports multi-sheet selection, !merges title banners, non-row-1 headers, leading zeros, Excel dates, and skips blanks', () => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Title banner on row 1 (merged), blank row 2, headers on row 3, data + blank row below
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['Islahul Uloom — Student Register 2026', '', '', ''],
    ['', '', '', ''],
    ['Admission No', 'Student Name', 'Class', 'Joined Date'],
    ['00123', 'Safwan K.', 'Fiqh 2', 45366],
    ['', '', '', ''],
    ['S0126', 'Ameen T.', 'Fiqh 1', '2026-01-10'],
  ]);
  ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  // Preserve text / date formats as Excel produces
  ws1['A4'] = { t: 'n', v: 123, w: '00123', z: '00000' };
  ws1['D4'] = { t: 'n', v: 45366, z: 'yyyy-mm-dd' };

  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Slug', 'Sector Name', 'Receipt Prefix'],
    ['dept-fiqh', 'Department of Fiqh', 'DF-'],
  ]);

  XLSX.utils.book_append_sheet(wb, ws1, 'Students');
  XLSX.utils.book_append_sheet(wb, ws2, 'Sectors');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const parsed1 = parseSpreadsheetBuffer(buf, 'multi.xlsx', 500);
  assert.deepEqual(parsed1.sheetNames, ['Students', 'Sectors']);
  assert.equal(parsed1.selectedSheet, 'Students');
  assert.equal(parsed1.headerRowIndex, 3);
  assert.equal(parsed1.totalRows, 2);
  assert.equal(parsed1.rows[0]['Admission No'], '00123');
  assert.equal(parsed1.rows[0]['Joined Date'], '2024-03-15');

  const parsed2 = parseSpreadsheetBuffer(buf, 'multi.xlsx', 500, { sheetName: 'Sectors' });
  assert.equal(parsed2.selectedSheet, 'Sectors');
  assert.equal(parsed2.rows[0]['Slug'], 'dept-fiqh');
});

test('validateSpreadsheetRows matches Malayalam (UTF-8) + English column aliases, catches duplicates, populates normalizedPreview, and generates Excel error report', async () => {
  const cfg = loadConfig();
  const registry = new ProfileRegistry();
  await registry.loadAll(cfg.profilesDir);
  const stuTpl = registry.getTemplate('khazna-ledger', 'khazna-students')!;

  const rows = [
    { 'അഡ്മിഷൻ നമ്പർ': 'S0501', 'പേര്': 'Muhammed R.', 'ക്ലാസ്': 'Fiqh 2', 'ഫോൺ': '9847000501' },
    { 'അഡ്മിഷൻ നമ്പർ': 'S0501', 'പേര്': 'Duplicate Entry', 'ക്ലാസ്': 'Fiqh 2', 'ഫോൺ': '9847000502' },
    { 'അഡ്മിഷൻ നമ്പർ': '', 'പേര്': 'Missing Id Student', 'ക്ലാസ്': 'Fiqh 1', 'ഫോൺ': '9847000503' },
  ];

  const preview = validateSpreadsheetRows({
    uploadId: 'upl_test_ml',
    appId: 'khazna-ledger',
    fileName: 'students-ml.xlsx',
    template: stuTpl,
    headers: ['അഡ്മിഷൻ നമ്പർ', 'പേര്', 'ക്ലാസ്', 'ഫോൺ'],
    rows,
    totalRows: rows.length,
    truncated: false,
    sheetNames: ['Students'],
    selectedSheet: 'Students',
    headerRowIndex: 1,
  });

  assert.equal(preview.validCount, 1);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.invalidCount, 2);
  assert.equal(preview.normalizedPreview?.length, 1);
  assert.equal(preview.normalizedPreview?.[0].id, 'S0501');

  const xlsxBuf = await generateErrorReportXlsxBuffer(preview.errors);
  assert.equal(xlsxBuf[0], 0x50);
  assert.equal(xlsxBuf[1], 0x4b);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength) as ArrayBuffer
  );
  const sheet = wb.getWorksheet('Import Validation Errors');
  assert.ok(sheet);
  assert.ok((sheet?.rowCount || 0) >= 3);
});

test('khaznaImportSectors enforces Admin-only RBAC and provides undo command', async () => {
  const cfg = loadConfig();
  const registry = new ProfileRegistry();
  await registry.loadAll(cfg.profilesDir);
  const profile = registry.getProfile('khazna-ledger')!;

  const managerCtx = {
    appId: 'khazna-ledger',
    profile,
    userId: 'mgr-fiqh',
    authToken: '',
    cfg,
    actionStore: new ActionLogStore(),
    appState: { role: 'manager', managerSector: 'dept-fiqh' },
  };
  const denied = await KHAZNA_BUILTIN_TOOLS.khaznaImportSectors.execute(
    {
      uploadId: 'upl_sec_1',
      rows: [{ name: 'New Wing', receiptPrefix: 'NW-' }],
    },
    managerCtx
  );
  assert.equal(denied.ok, false);

  const adminCtx = { ...managerCtx, userId: 'admin', appState: { role: 'admin' } };
  const okRes = await KHAZNA_BUILTIN_TOOLS.khaznaImportSectors.execute(
    {
      uploadId: 'upl_sec_1',
      rows: [{ name: 'New Wing', receiptPrefix: 'NW-' }],
    },
    adminCtx
  );
  assert.equal(okRes.ok, true);
  assert.equal(okRes.uiAction?.appCommand?.command, 'IMPORT_SECTORS');

  const undone = await KHAZNA_BUILTIN_TOOLS.khaznaImportSectors.undo!(['new-wing'], {}, adminCtx);
  assert.equal(undone.ok, true);
  assert.equal(undone.uiAction?.appCommand?.command, 'DELETE_SECTORS');
});
