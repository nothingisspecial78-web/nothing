import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import multer from 'multer';
import {
  ALLOWED_MULTIMODAL_EXTENSIONS,
  ALLOWED_MULTIMODAL_MIMES,
  ALLOWED_SPREADSHEET_EXTENSIONS,
  ALLOWED_SPREADSHEET_MIMES,
  MAX_CHAT_ATTACHMENTS,
  type ChatAttachment,
  type ImportPreviewResult,
} from '@ai-assistant/core';
import type { AuthedRequest } from '../auth.ts';
import type { OrgCreditStore } from '../billing/creditStore.ts';
import { logger, type ServerConfig } from '../config.ts';
import { inspectFileMagicBytes } from '../files/magicBytes.ts';
import { parseUploadedDocument } from '../files/parseDocument.ts';
import { parseSpreadsheetBuffer } from '../files/parseSheet.ts';
import {
  generateErrorReportCsv,
  generateErrorReportXlsxBuffer,
  validateSpreadsheetRows,
} from '../files/validate.ts';
import type { ProfileRegistry } from '../profiles/loader.ts';
import { createConfirmationToken, type ActionLogStore } from '../security/confirmation.ts';
import { validateExtensionAndMime } from '../security/sanitize.ts';
import { extractAccessScope, type AccessScope } from '../security/scope.ts';

function resolveKhaznaTemplateId(
  profiles: ProfileRegistry,
  appId: string,
  headers: string[],
  rows: Array<Record<string, unknown>>,
  totalRows: number,
  explicitArea: string,
  explicitTemplateId?: string,
  columnOverrides: Record<string, string> = {}
) {
  let templateId = explicitTemplateId;
  if (!templateId && explicitArea && appId === 'khazna-ledger') {
    if (/\b(managers?|admins?|staff)\b/.test(explicitArea)) templateId = 'khazna-managers';
    else if (/\b(sectors?|departments?|wings?)\b/.test(explicitArea)) templateId = 'khazna-sectors';
    else if (/\b(bulk|entry|entries|ledger|transactions?|batch(?:es)?)\b/.test(explicitArea))
      templateId = 'khazna-bulk-entries';
    else if (/\b(students?|directory|roster)\b/.test(explicitArea))
      templateId = 'khazna-students';
  }

  let template = profiles.getTemplate(appId, templateId);
  if (!template) return null;

  if (!templateId && !explicitArea && appId === 'khazna-ledger') {
    const allTemplates = profiles.getTemplates(appId);
    if (allTemplates.length > 1) {
      let bestTpl = template;
      let bestScore = -1;
      for (const cand of allTemplates) {
        const candPreview = validateSpreadsheetRows({
          uploadId: 'probe',
          appId,
          fileName: 'probe.xlsx',
          template: cand,
          headers,
          rows: rows.slice(0, 5),
          totalRows,
          truncated: false,
          columnOverrides,
        });
        const reqCols = cand.columns.filter((c) => c.required);
        const matchedReq = reqCols.filter((rc) =>
          candPreview.columnMapping.some((m) => m.expectedKey === rc.key && m.confidence !== 'missing')
        ).length;
        const matchedAll = candPreview.columnMapping.filter((m) => m.confidence !== 'missing').length;
        const score =
          matchedReq * 10 +
          matchedAll * 2 +
          (reqCols.length > 0 && matchedReq === reqCols.length ? 20 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestTpl = cand;
        }
      }
      template = bestTpl;
    }
  }

  return template;
}

function checkSpreadsheetRolePermission(
  appId: string,
  scope: AccessScope,
  templateId: string
): string | undefined {
  if (appId !== 'khazna-ledger') return undefined;
  if (scope.role === 'STUDENT' || scope.role === 'PUBLIC') {
    return 'Student and guest accounts do not have permission to bulk upload spreadsheets.';
  }
  if (
    scope.role === 'SECTOR_MANAGER' &&
    (templateId === 'khazna-students' ||
      templateId === 'khazna-managers' ||
      templateId === 'khazna-sectors')
  ) {
    return 'Only College Admin can bulk import Students, Sectors, or Sector Managers. Managers can upload Bulk Ledger Entries for their assigned sector.';
  }
  return undefined;
}

function buildPendingImportPreview(params: {
  cfg: ServerConfig;
  actionStore: ActionLogStore;
  appId: string;
  userId: string;
  uploadId: string;
  fileName: string;
  targetArea: string;
  scope: AccessScope;
  template: NonNullable<ReturnType<ProfileRegistry['getTemplate']>>;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  truncated: boolean;
  sheetNames: string[];
  selectedSheet: string;
  headerRowIndex: number;
  columnOverrides: Record<string, string>;
}): ImportPreviewResult {
  const preview = validateSpreadsheetRows({
    uploadId: params.uploadId,
    appId: params.appId,
    fileName: params.fileName,
    template: params.template,
    headers: params.headers,
    rows: params.rows,
    totalRows: params.totalRows,
    truncated: params.truncated,
    columnOverrides: params.columnOverrides,
    sheetNames: params.sheetNames,
    selectedSheet: params.selectedSheet,
    headerRowIndex: params.headerRowIndex,
  });

  const requiredKeys = new Set(
    params.template.columns.filter((c) => c.required).map((c) => c.key)
  );
  const missingRequiredColumns = preview.columnMapping
    .filter((m) => requiredKeys.has(m.expectedKey) && m.confidence === 'missing')
    .map((m) => m.expectedLabel);

  const permissionError = checkSpreadsheetRolePermission(
    params.appId,
    params.scope,
    params.template.templateId
  );

  const formatMatched =
    !permissionError &&
    missingRequiredColumns.length === 0 &&
    preview.totalRows > 0 &&
    preview.validCount > 0;

  preview.formatMatched = formatMatched;
  preview.missingRequiredColumns = missingRequiredColumns;
  if (permissionError) {
    preview.permissionError = permissionError;
  }

  if (formatMatched) {
    const actionId = `act_${crypto.randomUUID()}`;
    const toolArgs = {
      uploadId: params.uploadId,
      fileName: params.fileName,
      validCount: preview.validCount,
      targetArea: params.targetArea || params.template.templateId,
      sheetName: params.selectedSheet,
    };
    const { token } = createConfirmationToken(
      {
        actionId,
        appId: params.appId,
        userId: params.userId,
        toolName: params.template.targetTool,
        args: toolArgs,
      },
      params.cfg.confirmationSecret
    );

    params.actionStore.savePendingAction(
      {
        id: actionId,
        appId: params.appId,
        userId: params.userId,
        toolName: params.template.targetTool,
        risk: 'write',
        status: 'pending',
        summary: `Import ${preview.validCount} valid row(s) via "${params.template.name}" from "${params.fileName}" (${preview.invalidCount} skipped due to validation errors)`,
        args: toolArgs,
        createdIds: [],
        createdAt: new Date().toISOString(),
      },
      toolArgs
    );

    preview.actionId = actionId;
    preview.confirmationToken = token;
  }

  params.actionStore.saveUploadPreview(preview);
  return preview;
}

export function createUploadRouter(params: {
  cfg: ServerConfig;
  profiles: ProfileRegistry;
  actionStore: ActionLogStore;
  creditStore?: OrgCreditStore;
}): Router {
  const router = Router();

  const spreadsheetUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: params.cfg.uploadMaxBytes,
      files: 1,
    },
  });

  const multimodalUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: params.cfg.uploadMaxBytes,
      files: MAX_CHAT_ATTACHMENTS,
    },
  });

  // 1. Spreadsheet Import Preview & Validation (with Admin-only RBAC, magic-byte check, and multi-sheet parsing)
  router.post(
    '/',
    spreadsheetUpload.single('file'),
    async (req: AuthedRequest, res: Response): Promise<void> => {
      const profile = req.appProfile;
      const authUser = req.authUser;
      if (!profile || !authUser) {
        res.status(401).json({ error: 'Unauthorized.' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Missing spreadsheet file under field "file".' });
        return;
      }

      const check = validateExtensionAndMime(
        file.originalname,
        file.mimetype,
        ALLOWED_SPREADSHEET_EXTENSIONS,
        ALLOWED_SPREADSHEET_MIMES
      );
      if (!check.valid) {
        res.status(400).json({ error: check.reason });
        return;
      }

      const magic = inspectFileMagicBytes(file.buffer, file.originalname, file.mimetype);
      if (!magic.valid) {
        res.status(400).json({ error: magic.reason || 'File signature validation failed.' });
        return;
      }

      const scope = await extractAccessScope(req, params.cfg, { defaultUnauthenticatedRole: 'PUBLIC' });
      if (scope.role === 'PUBLIC') {
        res.status(403).json({
          error: 'Please sign in or create an organization before uploading or importing spreadsheets.',
          errorCode: 'AUTH_REQUIRED',
        });
        return;
      }

      // Credit check for 'attachment'
      let creditTxId: string | undefined;
      let creditOrgId = 'demo';
      if (params.creditStore) {
        const orgId =
          'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';
        creditOrgId = orgId;
        const consumption = await params.creditStore.checkAndConsume(
          orgId,
          scope.userId,
          scope.role,
          'attachment',
          { idempotencyKey: req.header('X-Idempotency-Key') || undefined }
        );
        if (!consumption.allowed) {
          res.status(consumption.errorCode === 'UPGRADE_REQUIRED' ? 403 : 402).json({
            error: consumption.message,
            errorCode: consumption.errorCode,
            resetDate: consumption.resetDate,
            creditsRemaining: consumption.creditsRemaining,
          });
          return;
        }
        creditTxId = consumption.consumptionId;
      }

      const targetAreaRaw =
        typeof req.body?.targetArea === 'string' ? req.body.targetArea.trim().toLowerCase() : '';
      const explicitArea = targetAreaRaw && targetAreaRaw !== 'auto' ? targetAreaRaw : '';
      const explicitTemplateId =
        typeof req.body?.templateId === 'string' && req.body.templateId
          ? req.body.templateId
          : undefined;
      const requestedSheet =
        typeof req.body?.sheetName === 'string' && req.body.sheetName.trim()
          ? req.body.sheetName.trim()
          : undefined;

      let columnOverrides: Record<string, string> = {};
      if (typeof req.body?.columnOverrides === 'string' && req.body.columnOverrides.trim()) {
        try {
          columnOverrides = JSON.parse(req.body.columnOverrides) as Record<string, string>;
        } catch {
          if (creditTxId && params.creditStore) {
            await params.creditStore.refundConsumption(creditOrgId, creditTxId, 'Invalid columnOverrides JSON');
          }
          res.status(400).json({ error: 'Invalid JSON in columnOverrides.' });
          return;
        }
      }

      try {
        const parsed = parseSpreadsheetBuffer(file.buffer, file.originalname, params.cfg.uploadMaxRows, {
          sheetName: requestedSheet,
        });

        const template = resolveKhaznaTemplateId(
          params.profiles,
          profile.appId,
          parsed.headers,
          parsed.rows,
          parsed.totalRows,
          explicitArea,
          explicitTemplateId,
          columnOverrides
        );

        if (!template) {
          if (creditTxId && params.creditStore) {
            await params.creditStore.refundConsumption(creditOrgId, creditTxId, 'Template not configured');
          }
          res.status(400).json({
            error: `No spreadsheet import template configured for app "${profile.appId}"${explicitTemplateId ? ` (${explicitTemplateId})` : ''}.`,
          });
          return;
        }

        const uploadId = `upl_${crypto.randomUUID()}`;
        params.actionStore.saveUploadRawFile(uploadId, {
          appId: profile.appId,
          fileName: file.originalname,
          buffer: file.buffer,
          mimeType: file.mimetype,
        });

        const preview = buildPendingImportPreview({
          cfg: params.cfg,
          actionStore: params.actionStore,
          appId: profile.appId,
          userId: authUser.userId,
          uploadId,
          fileName: file.originalname,
          targetArea: targetAreaRaw,
          scope,
          template,
          headers: parsed.headers,
          rows: parsed.rows,
          totalRows: parsed.totalRows,
          truncated: parsed.truncated,
          sheetNames: parsed.sheetNames,
          selectedSheet: parsed.selectedSheet,
          headerRowIndex: parsed.headerRowIndex,
          columnOverrides,
        });

        logger.info(
          {
            appId: profile.appId,
            userId: authUser.userId,
            uploadId,
            templateId: template.templateId,
            selectedSheet: parsed.selectedSheet,
            formatMatched: preview.formatMatched,
            totalRows: preview.totalRows,
            validCount: preview.validCount,
            invalidCount: preview.invalidCount,
          },
          'Spreadsheet parsed and validated for preview'
        );

        res.json(preview);
      } catch (err) {
        if (creditTxId && params.creditStore) {
          await params.creditStore.refundConsumption(
            creditOrgId,
            creditTxId,
            err instanceof Error ? err.message : 'Spreadsheet parsing failed'
          );
        }
        logger.error({ err, appId: profile.appId }, 'Spreadsheet parsing failed');
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to parse spreadsheet file.',
        });
      }
    }
  );

  // 2. Revalidate an uploaded spreadsheet with different sheetName, targetArea, or columnOverrides ("Fix mapping")
  router.post('/:uploadId/revalidate', async (req: AuthedRequest, res: Response): Promise<void> => {
    const profile = req.appProfile;
    const authUser = req.authUser;
    if (!profile || !authUser) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const uploadId = String(req.params.uploadId);
    const rawFile = params.actionStore.getUploadRawFile(uploadId, profile.appId);
    const existingPreview = params.actionStore.getUploadPreview(uploadId, profile.appId);
    if (!rawFile || !existingPreview) {
      res.status(404).json({ error: 'Original upload buffer expired or not found.' });
      return;
    }

    const scope = await extractAccessScope(req, params.cfg, { defaultUnauthenticatedRole: 'PUBLIC' });
    if (scope.role === 'PUBLIC') {
      res.status(403).json({
        error: 'Please sign in or create an organization before revalidating spreadsheet imports.',
        errorCode: 'AUTH_REQUIRED',
      });
      return;
    }
    const body = (req.body || {}) as {
      sheetName?: string;
      columnOverrides?: Record<string, string>;
      targetArea?: string;
    };

    try {
      const parsed = parseSpreadsheetBuffer(
        rawFile.buffer,
        rawFile.fileName,
        params.cfg.uploadMaxRows,
        { sheetName: body.sheetName || existingPreview.selectedSheet }
      );

      const targetAreaRaw = (body.targetArea || '').trim().toLowerCase();
      const explicitArea = targetAreaRaw && targetAreaRaw !== 'auto' ? targetAreaRaw : '';
      const columnOverrides = body.columnOverrides || {};

      const template =
        resolveKhaznaTemplateId(
          params.profiles,
          profile.appId,
          parsed.headers,
          parsed.rows,
          parsed.totalRows,
          explicitArea,
          explicitArea ? undefined : existingPreview.templateId,
          columnOverrides
        ) || params.profiles.getTemplate(profile.appId, existingPreview.templateId);

      if (!template) {
        res.status(400).json({ error: 'Import template not found.' });
        return;
      }

      const preview = buildPendingImportPreview({
        cfg: params.cfg,
        actionStore: params.actionStore,
        appId: profile.appId,
        userId: authUser.userId,
        uploadId,
        fileName: rawFile.fileName,
        targetArea: targetAreaRaw || template.templateId,
        scope,
        template,
        headers: parsed.headers,
        rows: parsed.rows,
        totalRows: parsed.totalRows,
        truncated: parsed.truncated,
        sheetNames: parsed.sheetNames,
        selectedSheet: parsed.selectedSheet,
        headerRowIndex: parsed.headerRowIndex,
        columnOverrides,
      });

      res.json(preview);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Revalidation failed.',
      });
    }
  });

  // 3. Multimodal General File Upload (Images, PDF, DOCX, TXT, JSON, MD, Spreadsheets)
  router.post(
    '/file',
    multimodalUpload.array('files', MAX_CHAT_ATTACHMENTS),
    async (req: AuthedRequest, res: Response): Promise<void> => {
      const profile = req.appProfile;
      const authUser = req.authUser;
      if (!profile || !authUser) {
        res.status(401).json({ error: 'Unauthorized.' });
        return;
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Missing files under field "files".' });
        return;
      }
      if (files.length > MAX_CHAT_ATTACHMENTS) {
        res.status(400).json({ error: `Maximum ${MAX_CHAT_ATTACHMENTS} files per request.` });
        return;
      }

      for (const file of files) {
        const extCheck = validateExtensionAndMime(
          file.originalname,
          file.mimetype,
          ALLOWED_MULTIMODAL_EXTENSIONS,
          ALLOWED_MULTIMODAL_MIMES
        );
        if (!extCheck.valid) {
          res.status(400).json({ error: extCheck.reason });
          return;
        }
        const magic = inspectFileMagicBytes(file.buffer, file.originalname, file.mimetype);
        if (!magic.valid) {
          res.status(400).json({ error: magic.reason || `Invalid file signature for "${file.originalname}".` });
          return;
        }
      }

      const scope = await extractAccessScope(req, params.cfg, { defaultUnauthenticatedRole: 'PUBLIC' });
      if (scope.role === 'PUBLIC') {
        res.status(403).json({
          error: 'Please sign in or create an organization before uploading files or screenshots.',
          errorCode: 'AUTH_REQUIRED',
        });
        return;
      }
      const conversationId =
        typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
          ? req.body.conversationId.trim()
          : 'default';

      let creditTxId: string | undefined;
      let creditOrgId = 'demo';
      if (params.creditStore) {
        const orgId =
          'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';
        creditOrgId = orgId;
        const consumption = await params.creditStore.checkAndConsume(
          orgId,
          scope.userId,
          scope.role,
          'attachment',
          { idempotencyKey: req.header('X-Idempotency-Key') || undefined }
        );
        if (!consumption.allowed) {
          res.status(consumption.errorCode === 'UPGRADE_REQUIRED' ? 403 : 402).json({
            error: consumption.message,
            errorCode: consumption.errorCode,
            resetDate: consumption.resetDate,
            creditsRemaining: consumption.creditsRemaining,
          });
          return;
        }
        creditTxId = consumption.consumptionId;
      }

      try {
        const attachments: ChatAttachment[] = [];

        for (const file of files) {
          const lower = file.originalname.toLowerCase();
          const isSpreadsheet = ALLOWED_SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext));

          if (isSpreadsheet) {
            const parsedSheet = parseSpreadsheetBuffer(
              file.buffer,
              file.originalname,
              Math.min(params.cfg.uploadMaxRows, 500)
            );
            const uploadId = `upl_${crypto.randomUUID()}`;
            params.actionStore.saveUploadRawFile(uploadId, {
              appId: profile.appId,
              fileName: file.originalname,
              buffer: file.buffer,
              mimeType: file.mimetype,
            });

            const template = resolveKhaznaTemplateId(
              params.profiles,
              profile.appId,
              parsedSheet.headers,
              parsedSheet.rows,
              parsedSheet.totalRows,
              '',
              undefined
            );
            if (template) {
              buildPendingImportPreview({
                cfg: params.cfg,
                actionStore: params.actionStore,
                appId: profile.appId,
                userId: authUser.userId,
                uploadId,
                fileName: file.originalname,
                targetArea: '',
                scope,
                template,
                headers: parsedSheet.headers,
                rows: parsedSheet.rows,
                totalRows: parsedSheet.totalRows,
                truncated: parsedSheet.truncated,
                sheetNames: parsedSheet.sheetNames,
                selectedSheet: parsedSheet.selectedSheet,
                headerRowIndex: parsedSheet.headerRowIndex,
                columnOverrides: {},
              });
            }

            const sampleCsvLines = [
              parsedSheet.headers.join(', '),
              ...parsedSheet.rows
                .slice(0, 25)
                .map((r) => parsedSheet.headers.map((h) => String(r[h] ?? '')).join(', ')),
            ].join('\n');

            attachments.push({
              type: 'file',
              name: file.originalname,
              mimeType: file.mimetype || 'text/csv',
              uploadId,
              sizeBytes: file.buffer.length,
              sheetNames: parsedSheet.sheetNames,
              selectedSheet: parsedSheet.selectedSheet,
              previewSummary: `${parsedSheet.selectedSheet || 'Sheet'} · ${parsedSheet.totalRows} row(s), ${parsedSheet.headers.length} columns`,
              extractedText: sampleCsvLines.slice(0, 20000),
            });
            continue;
          }

          const parsedDoc = await parseUploadedDocument({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
            geminiApiKey: params.cfg.geminiApiKey,
            conversationId,
          });

          const isImg = /\.(png|jpg|jpeg|webp|gif|heic)$/i.test(lower) || file.mimetype.startsWith('image/');
          attachments.push({
            type: isImg ? 'image' : 'file',
            name: file.originalname,
            mimeType: file.mimetype || (isImg ? 'image/jpeg' : 'application/octet-stream'),
            dataUrl: isImg ? parsedDoc.dataUrl : undefined,
            sizeBytes: parsedDoc.sizeBytes,
            pageCount: parsedDoc.pageCount,
            geminiFileUri: parsedDoc.geminiFileUri,
            extractedText: parsedDoc.extractedText,
            sha256: parsedDoc.sha256,
            previewSummary: parsedDoc.previewSummary,
          });
        }

        res.json({ ok: true, attachments });
      } catch (err) {
        if (creditTxId && params.creditStore) {
          await params.creditStore.refundConsumption(
            creditOrgId,
            creditTxId,
            err instanceof Error ? err.message : 'Multimodal upload processing failed'
          );
        }
        logger.error({ err, appId: profile.appId }, 'Multimodal upload processing failed');
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to process uploaded file(s).',
        });
      }
    }
  );

  // 4. Error Report Downloads (.csv + .xlsx via exceljs)
  router.get('/:uploadId/errors.csv', (req: AuthedRequest, res: Response) => {
    const profile = req.appProfile;
    if (!profile) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    const uploadId = String(req.params.uploadId);
    const preview = params.actionStore.getUploadPreview(uploadId, profile.appId);
    if (!preview) {
      res.status(404).json({ error: 'Upload preview not found.' });
      return;
    }

    const csv = generateErrorReportCsv(preview.errors);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-errors-${uploadId}.csv"`);
    res.send(csv);
  });

  router.get('/:uploadId/errors.xlsx', async (req: AuthedRequest, res: Response) => {
    const profile = req.appProfile;
    if (!profile) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    const uploadId = String(req.params.uploadId);
    const preview = params.actionStore.getUploadPreview(uploadId, profile.appId);
    if (!preview) {
      res.status(404).json({ error: 'Upload preview not found.' });
      return;
    }

    try {
      const xlsxBuf = await generateErrorReportXlsxBuffer(preview.errors);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="import-errors-${uploadId}.xlsx"`);
      res.send(xlsxBuf);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate Excel error report.',
      });
    }
  });

  return router;
}
