import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { khaznaAssistantConfig, leaveLogAssistantConfig } from '../assistant.config.ts';
import {
  isSensitiveExportField,
  MAX_EXPORT_ROWS,
  queryEntitiesForExport,
  resolveExportColumns,
} from '../packages/server/src/entityRegistry/queryEngine.ts';
import { buildExportSlug, normalizeExportFormat } from '../packages/server/src/tools/exportTools.ts';
import { generateExportArtifact } from '../packages/widget/src/utils/clientExport.ts';
import type { AccessScope } from '../packages/server/src/security/scope.ts';

const adminScope: AccessScope = {
  role: 'ADMIN',
  userId: 'admin-demo',
  organizationId: 'demo',
};

const studentScope: AccessScope = {
  role: 'STUDENT',
  userId: 'S0125',
  studentId: 'S0125',
  organizationId: 'demo',
  sectorId: 'dept-fiqh',
};

test('normalizeExportFormat handles valid, synonym, missing, and unsupported formats', () => {
  assert.equal(normalizeExportFormat('excel').format, 'xlsx');
  assert.equal(normalizeExportFormat('Sheet').format, 'xlsx');
  assert.equal(normalizeExportFormat('pdf').format, 'pdf');
  assert.equal(normalizeExportFormat('csv').format, 'csv');
  assert.equal(normalizeExportFormat('word').format, 'docx');
  assert.equal(normalizeExportFormat('json').format, 'json');
  assert.equal(normalizeExportFormat(undefined).format, null);
  const pages = normalizeExportFormat('Pages');
  assert.equal(pages.format, null);
  assert.equal(pages.closestSuggestion, 'docx');
});

test('buildExportSlug generates deterministic dated filenames', () => {
  const fname = buildExportSlug('Fiqh 2 Pending Fees', 'xlsx');
  assert.match(fname, /^fiqh-2-pending-fees-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('queryEntitiesForExport filters rows/columns, blocks sensitive fields, and enforces RBAC', () => {
  const studentDef = khaznaAssistantConfig.entities.find((e) => e.type === 'student')!;
  const collections = {
    students: [
      {
        id: 'S0125',
        name: 'Safwan K.',
        className: 'Fiqh 2',
        phone: '9847000101',
        pendingFee: 1500,
        balance: -1500,
        sectorId: 'dept-fiqh',
        organizationId: 'demo',
        passwordHash: 'secret-hash',
      },
      {
        id: 'S0126',
        name: 'Ameen T.',
        className: 'Fiqh 2',
        phone: '9847000102',
        pendingFee: 0,
        balance: 0,
        sectorId: 'dept-fiqh',
        organizationId: 'demo',
      },
      {
        id: 'S0201',
        name: 'Bilal P.',
        className: 'Fiqh 1',
        phone: '9847000201',
        pendingFee: 800,
        balance: -800,
        sectorId: 'dept-fiqh',
        organizationId: 'demo',
      },
    ],
  };

  const adminRes = queryEntitiesForExport({
    config: khaznaAssistantConfig,
    collections,
    entityType: 'student',
    filters: { className: 'Fiqh 2' },
    pendingOnly: true,
    requestedColumns: ['name', 'phone', 'passwordHash'],
    bulkRequest: true,
    scope: adminScope,
  });

  assert.equal(adminRes.ok, true);
  assert.equal(adminRes.rows.length, 1);
  assert.equal(adminRes.rows[0].name, 'Safwan K.');
  assert.deepEqual(
    adminRes.columns.map((c) => c.key),
    ['name', 'phone']
  );
  assert.deepEqual(adminRes.blockedSensitive, ['passwordHash']);
  assert.equal(isSensitiveExportField('token', studentDef), true);

  const studentDenied = queryEntitiesForExport({
    config: khaznaAssistantConfig,
    collections,
    entityType: 'student',
    filters: { className: 'Fiqh 2' },
    pendingOnly: true,
    bulkRequest: true,
    scope: studentScope,
  });
  assert.equal(studentDenied.ok, false);
  assert.equal(studentDenied.denied, true);

  // Column resolver respects leave_request config too
  const leaveDef = leaveLogAssistantConfig.entities.find((e) => e.type === 'leave_request')!;
  const leaveCols = resolveExportColumns({ entityDef: leaveDef });
  assert.ok(leaveCols.columns.some((c) => c.key === 'employeeName'));
  assert.equal(MAX_EXPORT_ROWS, 5000);
});

test('generateExportArtifact builds valid xlsx, csv (BOM), pdf (Unicode Noto), and docx in memory', async () => {
  const payload = {
    exportId: 'exp_node_check',
    title: 'Fiqh 2 Pending Fees',
    filename: 'fiqh-2-pending-fees.xlsx',
    format: 'xlsx' as const,
    columns: [
      { key: 'name', label: 'Full Name', format: 'text' as const },
      { key: 'phone', label: 'Phone', format: 'text' as const },
      { key: 'pendingFee', label: 'Pending Fee', format: 'currency' as const },
    ],
    rows: [
      { name: 'അബ്ദുള്ള എം.', phone: '9847000101', pendingFee: 1500 },
      { name: 'عبد الله ك.', phone: '9847000102', pendingFee: 900 },
    ],
    previewRows: [
      { name: 'അബ്ദുള്ള എം.', phone: '9847000101', pendingFee: 1500 },
      { name: 'عبد الله ك.', phone: '9847000102', pendingFee: 900 },
    ],
    totalRows: 2,
    exportedRows: 2,
    truncated: false,
    rowLimit: 5000,
    generatedAt: '2026-11-16T00:00:00.000Z',
    summaryLine: '2 students, 3 columns',
  };

  const xlsxArtifact = await generateExportArtifact(payload);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(xlsxArtifact.uint8) as unknown as ArrayBuffer);
  assert.equal(wb.worksheets[0].getRow(1).getCell(1).font?.bold, true);
  assert.equal((wb.worksheets[0].views[0] as { ySplit?: number })?.ySplit, 1);

  const csvArtifact = await generateExportArtifact({
    ...payload,
    format: 'csv',
    filename: 'fiqh-2-pending-fees.csv',
  });
  const csvStr = new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvArtifact.uint8);
  assert.equal(csvStr.startsWith('\uFEFF'), true);
  const parsedCsv = Papa.parse<string[]>(csvStr.replace(/^\uFEFF/, ''), { skipEmptyLines: true });
  assert.equal(parsedCsv.data.length, 3);

  const pdfArtifact = await generateExportArtifact({
    ...payload,
    format: 'pdf',
    filename: 'fiqh-2-pending-fees.pdf',
  });
  assert.equal(new TextDecoder('latin1').decode(pdfArtifact.uint8.slice(0, 5)), '%PDF-');

  const docxArtifact = await generateExportArtifact({
    ...payload,
    format: 'docx',
    filename: 'fiqh-2-pending-fees.docx',
  });
  assert.equal(docxArtifact.uint8[0], 0x50);
  assert.equal(docxArtifact.uint8[1], 0x4b);
});
