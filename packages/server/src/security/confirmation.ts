import crypto from 'node:crypto';
import type { ActionLogEntry, ImportPreviewResult } from '@ai-assistant/core';
import { DEFAULT_CONFIRMATION_TTL_MS } from '@ai-assistant/core';

export interface PendingConfirmationPayload {
  actionId: string;
  appId: string;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsHash: string;
  expiresAt: number;
}

export function hashArgs(args: Record<string, unknown>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function createConfirmationToken(
  payload: Omit<PendingConfirmationPayload, 'argsHash' | 'expiresAt'>,
  secret: string,
  ttlMs = DEFAULT_CONFIRMATION_TTL_MS
): { token: string; expiresAt: string; argsHash: string } {
  const expiresAtMs = Date.now() + ttlMs;
  const argsHash = hashArgs(payload.args);
  const fullPayload = {
    actionId: payload.actionId,
    appId: payload.appId,
    userId: payload.userId,
    toolName: payload.toolName,
    argsHash,
    expiresAt: expiresAtMs,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');

  return {
    token: `${encoded}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    argsHash,
  };
}

export function verifyConfirmationToken(
  token: string,
  expected: { actionId?: string; appId: string; userId: string },
  secret: string
): { valid: true; payload: PendingConfirmationPayload } | { valid: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed confirmation token.' };
  }
  const [encoded, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig, 'utf8');
  const sigBufB = Buffer.from(expectedSig, 'utf8');
  if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
    return { valid: false, reason: 'Invalid confirmation token signature.' };
  }

  let parsed: PendingConfirmationPayload;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PendingConfirmationPayload;
  } catch {
    return { valid: false, reason: 'Unreadable confirmation token payload.' };
  }

  if (Date.now() > parsed.expiresAt) {
    return { valid: false, reason: 'Confirmation token has expired.' };
  }
  if (parsed.appId !== expected.appId) {
    return { valid: false, reason: 'Confirmation token does not match this appId.' };
  }
  if (parsed.userId !== expected.userId) {
    return { valid: false, reason: 'Confirmation token belongs to a different user.' };
  }
  if (expected.actionId && parsed.actionId !== expected.actionId) {
    return { valid: false, reason: 'Confirmation token does not match this actionId.' };
  }

  return { valid: true, payload: parsed };
}

export class ActionLogStore {
  private readonly logs = new Map<string, ActionLogEntry>();
  private readonly pendingArgs = new Map<string, Record<string, unknown>>();
  private readonly pendingUploads = new Map<string, ImportPreviewResult>();
  private readonly pendingUploadFiles = new Map<
    string,
    { appId: string; fileName: string; buffer: Buffer; mimeType: string }
  >();
  private readonly executedIdempotency = new Map<
    string,
    {
      ok: boolean;
      summary: string;
      result: unknown;
      uiAction?: unknown;
      action?: ActionLogEntry;
    }
  >();

  savePendingAction(entry: ActionLogEntry, args: Record<string, unknown>): void {
    this.logs.set(entry.id, entry);
    this.pendingArgs.set(entry.id, args);
  }

  recordImmediateAction(entry: ActionLogEntry): void {
    this.logs.set(entry.id, entry);
  }

  getAction(actionId: string): ActionLogEntry | undefined {
    return this.logs.get(actionId);
  }

  getPendingArgs(actionId: string): Record<string, unknown> | undefined {
    return this.pendingArgs.get(actionId);
  }

  updateAction(actionId: string, patch: Partial<ActionLogEntry>): ActionLogEntry | undefined {
    const existing = this.logs.get(actionId);
    if (!existing) return undefined;
    const updated: ActionLogEntry = { ...existing, ...patch };
    this.logs.set(actionId, updated);
    return updated;
  }

  listActions(appId: string, userId?: string): ActionLogEntry[] {
    const items = Array.from(this.logs.values()).filter(
      (item) => item.appId === appId && (!userId || item.userId === userId)
    );
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  saveUploadPreview(preview: ImportPreviewResult): void {
    this.pendingUploads.set(preview.uploadId, preview);
  }

  getUploadPreview(uploadId: string, appId: string): ImportPreviewResult | undefined {
    const item = this.pendingUploads.get(uploadId);
    if (!item || item.appId !== appId) return undefined;
    return item;
  }

  saveUploadRawFile(
    uploadId: string,
    file: { appId: string; fileName: string; buffer: Buffer; mimeType: string }
  ): void {
    if (this.pendingUploadFiles.size >= 40) {
      const oldest = this.pendingUploadFiles.keys().next().value;
      if (oldest) this.pendingUploadFiles.delete(oldest);
    }
    this.pendingUploadFiles.set(uploadId, file);
  }

  getUploadRawFile(
    uploadId: string,
    appId: string
  ): { appId: string; fileName: string; buffer: Buffer; mimeType: string } | undefined {
    const item = this.pendingUploadFiles.get(uploadId);
    if (!item || item.appId !== appId) return undefined;
    return item;
  }

  getExecutedIdempotencyResult(key: string) {
    return this.executedIdempotency.get(key);
  }

  recordExecutedIdempotencyResult(
    key: string,
    payload: {
      ok: boolean;
      summary: string;
      result: unknown;
      uiAction?: unknown;
      action?: ActionLogEntry;
    }
  ): void {
    if (this.executedIdempotency.size >= 200) {
      const oldest = this.executedIdempotency.keys().next().value;
      if (oldest) this.executedIdempotency.delete(oldest);
    }
    this.executedIdempotency.set(key, payload);
  }
}
