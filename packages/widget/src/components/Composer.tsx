import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Crosshair,
  FileSpreadsheet,
  FileText,
  Layers,
  Mic,
  MicOff,
  Navigation,
  Paperclip,
  Plus,
  RotateCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  ALLOWED_MULTIMODAL_EXTENSIONS,
  MAX_CHAT_ATTACHMENTS,
  type ChatAttachment,
  type RightClickContext,
} from '@ai-assistant/core';
import { useVoiceInput } from '../hooks/useVoiceInput.ts';
import {
  formatBytes,
  prepareFileForUpload,
  uploadFileWithProgress,
  validateClientFile,
} from '../utils/fileProcessor.ts';
import { AttachmentLightbox } from './AttachmentLightbox.tsx';

interface StagedUploadItem {
  localId: string;
  rawFile: File;
  name: string;
  sizeBytes: number;
  mimeType: string;
  isImage: boolean;
  isSpreadsheet: boolean;
  localPreviewUrl?: string;
  localMeta?: string;
  progress: number;
  status: 'uploading' | 'ready' | 'error';
  errorMessage?: string;
  attachment?: ChatAttachment;
}

export interface ComposerProps {
  disabled?: boolean;
  apiUrl?: string;
  appId?: string;
  conversationId?: string;
  viewingLabel?: string | null;
  onDismissViewing?: () => void;
  defaultLanguage?: 'auto' | 'en' | 'ml';
  getAuthToken?: () => string | Promise<string>;
  voiceAutoSend?: boolean;
  pendingContext?: RightClickContext | null;
  pendingContexts?: RightClickContext[];
  queuedDropFiles?: { files: File[]; seq: number } | null;
  onClearContext?: () => void;
  onRemoveContext?: (index: number) => void;
  onAskAboutContext?: (context: RightClickContext) => void;
  onAskAboutContexts?: (contexts: RightClickContext[]) => void;
  onToggleInspect?: () => void;
  onGuideMe?: (goal: string) => void;
  onBillingError?: (
    code: string,
    payload?: { error?: string; resetDate?: string }
  ) => void;
  onBillingRefresh?: () => void;
  onSend: (params: {
    text: string;
    attachments?: ChatAttachment[];
    language?: string;
  }) => void;
  onUploadSpreadsheet: (
    file: File,
    targetArea?: 'auto' | 'students' | 'sectors' | 'managers' | 'bulk-entries'
  ) => void;
}

const SPREADSHEET_EXT_RE = /\.(xlsx|xls|csv|tsv)$/i;
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp|gif|heic)$/i;

export function Composer({
  disabled = false,
  apiUrl = '',
  appId = 'khazna-ledger',
  conversationId,
  viewingLabel,
  onDismissViewing,
  defaultLanguage = 'auto',
  getAuthToken,
  voiceAutoSend = false,
  pendingContext,
  pendingContexts,
  queuedDropFiles,
  onClearContext,
  onRemoveContext,
  onAskAboutContext,
  onAskAboutContexts,
  onToggleInspect,
  onGuideMe,
  onBillingError,
  onBillingRefresh,
  onSend,
  onUploadSpreadsheet,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<'auto' | 'en' | 'ml'>(defaultLanguage);
  const [stagedFiles, setStagedFiles] = useState<StagedUploadItem[]>([]);
  const [stageError, setStageError] = useState<string | null>(null);
  const [lightboxItem, setLightboxItem] = useState<{ src: string; alt: string; subtitle?: string } | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [uploadTargetArea, setUploadTargetArea] = useState<
    'auto' | 'students' | 'sectors' | 'managers' | 'bulk-entries'
  >('auto');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const plusContainerRef = useRef<HTMLDivElement | null>(null);
  const lastQueuedSeqRef = useRef<number>(0);

  useEffect(() => {
    setLanguage(defaultLanguage);
  }, [defaultLanguage]);

  const startUploadForItem = async (localId: string, rawFile: File) => {
    try {
      const { processedFile, localPreviewUrl, localMeta } = await prepareFileForUpload(rawFile);
      setStagedFiles((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? {
                ...item,
                sizeBytes: processedFile.size,
                mimeType: processedFile.type || item.mimeType,
                localPreviewUrl: localPreviewUrl || item.localPreviewUrl,
                localMeta: localMeta || item.localMeta,
                progress: 12,
                status: 'uploading',
                errorMessage: undefined,
              }
            : item
        )
      );

      const headers: Record<string, string> = { 'x-app-id': appId };
      if (getAuthToken) {
        const tok = await getAuthToken();
        if (tok) headers.Authorization = tok.startsWith('Bearer ') ? tok : `Bearer ${tok}`;
      }

      const uploaded = await uploadFileWithProgress({
        url: `${apiUrl.replace(/\/$/, '')}/api/upload/file`,
        file: processedFile,
        appId,
        conversationId,
        headers,
        onProgress: (pct) => {
          setStagedFiles((prev) =>
            prev.map((item) =>
              item.localId === localId ? { ...item, progress: Math.max(12, pct) } : item
            )
          );
        },
      });

      onBillingRefresh?.();
      setStagedFiles((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? {
                ...item,
                progress: 100,
                status: 'ready',
                attachment: {
                  ...uploaded,
                  dataUrl: uploaded.dataUrl || localPreviewUrl,
                },
              }
            : item
        )
      );
    } catch (err) {
      onBillingRefresh?.();
      const typed = err as Error & { errorCode?: string; resetDate?: string };
      if (typed.errorCode === 'UPGRADE_REQUIRED' || typed.errorCode === 'CREDITS_EXHAUSTED') {
        onBillingError?.(typed.errorCode, { error: typed.message, resetDate: typed.resetDate });
      }
      setStagedFiles((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? {
                ...item,
                status: 'error',
                progress: 0,
                errorMessage: typed.message || 'Upload failed.',
              }
            : item
        )
      );
    }
  };

  const enqueueFiles = async (incoming: File[]) => {
    if (disabled || incoming.length === 0) return;
    setStageError(null);

    const availableSlots = MAX_CHAT_ATTACHMENTS - stagedFiles.length;
    if (availableSlots <= 0) {
      setStageError(`Maximum ${MAX_CHAT_ATTACHMENTS} files can be attached per message.`);
      return;
    }

    const candidates = incoming.slice(0, availableSlots);
    if (incoming.length > availableSlots) {
      setStageError(`Only added ${availableSlots} file(s); limit is ${MAX_CHAT_ATTACHMENTS} per message.`);
    }

    for (const file of candidates) {
      const check = await validateClientFile(file);
      if (!check.valid) {
        setStageError(check.reason || `File "${file.name}" rejected.`);
        continue;
      }

      const localId = `st_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const isImage = IMAGE_EXT_RE.test(file.name) || file.type.startsWith('image/');
      const isSpreadsheet = SPREADSHEET_EXT_RE.test(file.name);

      const newItem: StagedUploadItem = {
        localId,
        rawFile: file,
        name: file.name || (isImage ? 'screenshot.png' : 'attachment'),
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        isImage,
        isSpreadsheet,
        localMeta: formatBytes(file.size),
        progress: 5,
        status: 'uploading',
      };

      setStagedFiles((prev) => [...prev, newItem]);
      void startUploadForItem(localId, file);
    }
  };

  // Handle dropped files queued from AssistantWidget FileDrop (stages cleanly without auto-send!)
  useEffect(() => {
    if (queuedDropFiles && queuedDropFiles.seq !== lastQueuedSeqRef.current) {
      lastQueuedSeqRef.current = queuedDropFiles.seq;
      void enqueueFiles(queuedDropFiles.files);
    }
  }, [queuedDropFiles]);

  const applyTranscript = (transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;
    const readyAtts = stagedFiles
      .filter((s) => s.status === 'ready' && s.attachment)
      .map((s) => s.attachment!);
    if (voiceAutoSend) {
      onSend({
        text: clean,
        attachments: readyAtts.length > 0 ? readyAtts : undefined,
        language: language === 'auto' ? undefined : language,
      });
      setText('');
      setStagedFiles([]);
    } else {
      setText((prev) => (prev.trim() ? `${prev.trim()} ${clean}` : clean));
    }
  };

  const { recordingState, micError, toggleVoiceInput } = useVoiceInput({
    apiUrl,
    appId,
    language,
    getAuthToken,
    onTranscript: applyTranscript,
  });

  useEffect(() => {
    if (!plusOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (plusContainerRef.current && !plusContainerRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlusOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [plusOpen]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles: File[] = [];
    if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
      clipboardFiles.push(...Array.from(e.clipboardData.files));
    } else if (e.clipboardData?.items) {
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            const named =
              f.name && f.name !== 'image.png'
                ? f
                : new File([f], `pasted-${Date.now()}.png`, { type: f.type || 'image/png' });
            clipboardFiles.push(named);
          }
        }
      }
    }
    if (clipboardFiles.length > 0) {
      e.preventDefault();
      void enqueueFiles(clipboardFiles);
    }
  };

  const uploadingCount = stagedFiles.filter((f) => f.status === 'uploading').length;
  const readyAttachments = stagedFiles
    .filter((f) => f.status === 'ready' && f.attachment)
    .map((f) => f.attachment!);

  const submit = () => {
    if (disabled || uploadingCount > 0) return;
    if (!text.trim() && readyAttachments.length === 0) return;
    onSend({
      text,
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
      language: language === 'auto' ? undefined : language,
    });
    setText('');
    setStagedFiles([]);
    setStageError(null);
  };

  const canSend =
    !disabled &&
    uploadingCount === 0 &&
    (text.trim().length > 0 || readyAttachments.length > 0);

  const attachedContexts =
    pendingContexts && pendingContexts.length > 0
      ? pendingContexts
      : pendingContext
        ? [pendingContext]
        : [];

  return (
    <div className="aia-composer-wrap">
      {lightboxItem && (
        <AttachmentLightbox
          src={lightboxItem.src}
          alt={lightboxItem.alt}
          subtitle={lightboxItem.subtitle}
          onClose={() => setLightboxItem(null)}
        />
      )}

      {attachedContexts.length > 0 && (
        <div
          data-testid="accessory-context-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px 10px',
            borderRadius: '14px',
            background: 'color-mix(in oklab, var(--aia-primary) 9%, var(--aia-surface))',
            border: '1px solid color-mix(in oklab, var(--aia-primary) 30%, var(--aia-hairline))',
            fontSize: '12px',
            color: 'var(--aia-text)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '11.5px', color: 'var(--aia-primary)' }}>
              <Layers size={14} style={{ flexShrink: 0 }} />
              <span>
                {attachedContexts.length === 1
                  ? 'Selected Card'
                  : `${attachedContexts.length} Selected Cards`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {(onAskAboutContexts || onAskAboutContext) && (
                <button
                  type="button"
                  data-ai-id="assistant-explain-context-btn"
                  onClick={() => {
                    if (onAskAboutContexts) onAskAboutContexts(attachedContexts);
                    else if (onAskAboutContext) onAskAboutContext(attachedContexts[0]);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    borderRadius: '8px',
                    border: '1px solid color-mix(in oklab, var(--aia-primary) 35%, transparent)',
                    background: 'var(--aia-surface-strong)',
                    color: 'var(--aia-primary)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Sparkles size={11} />
                  {attachedContexts.length > 1 ? 'Explain selected cards' : 'Explain what this shows'}
                </button>
              )}
              {onClearContext && (
                <button
                  type="button"
                  data-ai-id="assistant-clear-context-btn"
                  onClick={onClearContext}
                  aria-label="Clear all attached cuboid contexts"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--aia-text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'inline-flex',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {attachedContexts.map((ctx, idx) => {
              const ctxLabel =
                ctx.nearbyLabel ||
                (ctx.text ? ctx.text.replace(/\s+/g, ' ').trim().slice(0, 48) : undefined) ||
                ctx.tag ||
                'Card';
              return (
                <div
                  key={`${ctx.cssSelector || idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    padding: '5px 8px',
                    borderRadius: '10px',
                    background: 'var(--aia-surface-strong)',
                    border: '1px solid var(--aia-hairline)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ctxLabel}
                    </div>
                  </div>
                  {(onRemoveContext || onClearContext) && (
                    <button
                      type="button"
                      data-ai-id="assistant-remove-context-btn"
                      onClick={() => {
                        if (onRemoveContext) onRemoveContext(idx);
                        else onClearContext?.();
                      }}
                      aria-label={`Remove attached cuboid ${ctxLabel}`}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--aia-text-muted)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'inline-flex',
                        flexShrink: 0,
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stageError && (
        <div
          role="alert"
          data-testid="composer-attachment-error"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '6px 10px',
            borderRadius: '10px',
            background: 'color-mix(in oklab, var(--aia-debit) 10%, var(--aia-surface))',
            border: '1px solid color-mix(in oklab, var(--aia-debit) 32%, transparent)',
            color: 'var(--aia-debit)',
            fontSize: '11.5px',
            fontWeight: 500,
          }}
        >
          <span>{stageError}</span>
          <button
            type="button"
            aria-label="Dismiss file error"
            onClick={() => setStageError(null)}
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {stagedFiles.length > 0 && (
        <div className="aia-att-strip" data-testid="composer-attachment-strip">
          {stagedFiles.map((item) => {
            const thumbUrl = item.attachment?.dataUrl || item.localPreviewUrl;
            const metaParts = [item.localMeta || formatBytes(item.sizeBytes)];
            if (item.attachment?.pageCount) {
              metaParts.push(`${item.attachment.pageCount} pg`);
            }
            if (item.attachment?.sheetNames && item.attachment.sheetNames.length > 0) {
              metaParts.push(`${item.attachment.sheetNames.length} sheet${item.attachment.sheetNames.length === 1 ? '' : 's'}`);
            }

            return (
              <div
                key={item.localId}
                data-testid={`staged-attachment-${item.localId}`}
                className={`aia-att-card ${item.status === 'error' ? 'is-error' : ''}`}
              >
                {item.isImage && thumbUrl ? (
                  <button
                    type="button"
                    className="aia-att-thumb-btn"
                    data-testid="staged-thumb-lightbox-btn"
                    aria-label={`Preview ${item.name}`}
                    onClick={() =>
                      setLightboxItem({
                        src: thumbUrl,
                        alt: item.name,
                        subtitle: metaParts.join(' · '),
                      })
                    }
                  >
                    <img src={thumbUrl} alt={item.name} />
                  </button>
                ) : (
                  <div
                    className="aia-att-thumb-btn"
                    style={{
                      cursor: 'default',
                      color: item.status === 'error' ? 'var(--aia-debit)' : 'var(--aia-primary)',
                    }}
                  >
                    {item.status === 'error' ? (
                      <AlertCircle size={16} />
                    ) : item.isSpreadsheet ? (
                      <FileSpreadsheet size={16} />
                    ) : (
                      <FileText size={16} />
                    )}
                  </div>
                )}

                <div style={{ minWidth: 0, maxWidth: '175px' }}>
                  <div
                    style={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </div>
                  <div style={{ fontSize: '10.5px', color: item.status === 'error' ? 'var(--aia-debit)' : 'var(--aia-text-muted)' }}>
                    {item.status === 'error'
                      ? item.errorMessage || 'Upload failed'
                      : item.status === 'uploading'
                        ? `Uploading ${item.progress}%`
                        : metaParts.join(' · ')}
                  </div>
                  {item.status === 'uploading' && (
                    <div className="aia-att-progress" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="aia-att-progress-bar" style={{ width: `${item.progress}%` }} />
                    </div>
                  )}
                </div>

                {item.isSpreadsheet && item.status === 'ready' && (
                  <button
                    type="button"
                    data-testid="staged-import-verify-btn"
                    title="Open interactive spreadsheet mapping & validation preview"
                    onClick={() => {
                      const raw = item.rawFile;
                      setStagedFiles((prev) => prev.filter((x) => x.localId !== item.localId));
                      onUploadSpreadsheet(raw, uploadTargetArea);
                    }}
                    style={{
                      border: '1px solid color-mix(in oklab, var(--aia-primary) 35%, transparent)',
                      background: 'color-mix(in oklab, var(--aia-primary) 10%, transparent)',
                      color: 'var(--aia-primary)',
                      borderRadius: '8px',
                      padding: '3px 7px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Upload size={11} />
                    Import
                  </button>
                )}

                {item.status === 'error' && (
                  <button
                    type="button"
                    aria-label={`Retry ${item.name}`}
                    title="Retry upload"
                    onClick={() => void startUploadForItem(item.localId, item.rawFile)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--aia-primary)',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'inline-flex',
                    }}
                  >
                    <RotateCw size={13} />
                  </button>
                )}

                <button
                  type="button"
                  data-ai-id="assistant-remove-attachment-btn"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => setStagedFiles((prev) => prev.filter((x) => x.localId !== item.localId))}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--aia-text-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'inline-flex',
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {micError && (
        <div role="status" style={{ fontSize: '11.5px', color: 'var(--aia-debit)' }}>
          {micError}
        </div>
      )}

      {recordingState !== 'idle' && (
        <div
          role="status"
          style={{
            fontSize: '11.5px',
            fontWeight: 600,
            color: 'var(--aia-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>{recordingState === 'listening' ? 'Listening… tap mic to stop' : 'Transcribing voice…'}</span>
        </div>
      )}

      <div className="aia-composer-card">
        {viewingLabel && (
          <div className="aia-viewing-row" data-testid="composer-viewing-row">
            <span className="aia-viewing-pill">
              <span data-testid="composer-viewing-text">Viewing: {viewingLabel}</span>
              {onDismissViewing && (
                <button
                  type="button"
                  data-testid="composer-viewing-dismiss"
                  className="aia-viewing-dismiss"
                  onClick={onDismissViewing}
                  aria-label="Hide current page context"
                  title="Dismiss current page context"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          </div>
        )}

        <textarea
          data-ai-id="assistant-composer-input"
          data-testid="composer-textarea"
          aria-label="Ask the assistant a question"
          disabled={disabled}
          placeholder={
            attachedContexts.length > 0
              ? 'Ask about selected card(s)...'
              : stagedFiles.length > 0
                ? 'Ask a question about your attached file(s)...'
                : 'Ask anything, attach files, or import Excel/CSV...'
          }
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: '13.5px',
            lineHeight: 1.5,
            fontFamily: 'inherit',
            color: 'var(--aia-text)',
            background: 'transparent',
            padding: '2px 2px 0',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div ref={plusContainerRef} style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              data-ai-id="assistant-file-input"
              aria-label="Attach images, PDFs, Word docs, or spreadsheets"
              accept={ALLOWED_MULTIMODAL_EXTENSIONS.join(',')}
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void enqueueFiles(Array.from(e.target.files));
                }
                e.target.value = '';
              }}
            />

            <button
              type="button"
              data-testid="composer-plus-btn"
              data-ai-id="assistant-plus-btn"
              disabled={disabled}
              aria-expanded={plusOpen}
              aria-haspopup="menu"
              aria-label="Attach files or select card with cursor"
              title="Attach files or select card"
              onClick={() => setPlusOpen((v) => !v)}
              className="aia-composer-icon-btn"
              style={
                plusOpen
                  ? {
                      background: 'color-mix(in oklab, var(--aia-primary) 16%, transparent)',
                      color: 'var(--aia-primary)',
                    }
                  : undefined
              }
            >
              <Plus size={17} />
            </button>

            {plusOpen && (
              <div
                role="menu"
                data-testid="composer-plus-menu"
                className="aia-ctx-menu"
                style={{
                  position: 'absolute',
                  bottom: '40px',
                  left: 0,
                  minWidth: '250px',
                }}
              >
                <div style={{ padding: '4px 8px 6px', borderBottom: '1px solid var(--aia-hairline)', marginBottom: '4px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      color: 'var(--aia-subtle)',
                      marginBottom: '4px',
                    }}
                  >
                    Import Target (Excel / CSV)
                  </label>
                  <select
                    aria-label="Spreadsheet import target area"
                    data-testid="csv-target-area-select"
                    data-ai-id="assistant-csv-target-select"
                    value={uploadTargetArea}
                    onChange={(e) =>
                      setUploadTargetArea(
                        e.target.value as 'auto' | 'students' | 'sectors' | 'managers' | 'bulk-entries'
                      )
                    }
                    style={{
                      width: '100%',
                      height: '28px',
                      borderRadius: '8px',
                      border: '1px solid var(--aia-hairline)',
                      background: 'var(--aia-inset)',
                      color: 'var(--aia-text)',
                      fontSize: '11.5px',
                      padding: '0 6px',
                    }}
                  >
                    <option value="auto">Auto-detect entity</option>
                    <option value="students">Students Directory</option>
                    <option value="sectors">Sectors</option>
                    <option value="managers">Sector Managers</option>
                    <option value="bulk-entries">Bulk Ledger Entries</option>
                  </select>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="plus-attach-file"
                  data-ai-id="assistant-attach-file-btn"
                  className="aia-ctx-btn"
                  onClick={() => {
                    setPlusOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip size={14} />
                  <span>Attach image, PDF, Word or Excel</span>
                </button>
                {onToggleInspect && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="plus-cursor-inspect"
                    data-ai-id="assistant-cursor-inspect-btn"
                    className="aia-ctx-btn"
                    onClick={() => {
                      setPlusOpen(false);
                      onToggleInspect();
                    }}
                  >
                    <Crosshair size={14} />
                    <span>Select card with cursor</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <select
              aria-label="Response language"
              data-ai-id="assistant-language-select"
              disabled={disabled}
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'auto' | 'en' | 'ml')}
              style={{
                height: '30px',
                minWidth: 0,
                maxWidth: '88px',
                borderRadius: '9999px',
                border: 'none',
                background: 'var(--aia-inset)',
                color: 'var(--aia-text-muted)',
                fontSize: '11.5px',
                fontWeight: 500,
                padding: '0 8px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="auto">Auto</option>
              <option value="en">English</option>
              <option value="ml">മലയാളം</option>
            </select>

            {onGuideMe && (
              <button
                type="button"
                data-ai-id="guide-me-btn"
                data-testid="guide-me-btn"
                disabled={disabled}
                onClick={() => {
                  const goal = text.trim() || 'Show me how to use the main actions on this page';
                  setText('');
                  onGuideMe(goal);
                }}
                aria-label="Start interactive Guide Me co-browsing"
                title="Guide me step by step on screen"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  height: '30px',
                  padding: '0 10px',
                  borderRadius: '9999px',
                  border: '1px solid var(--aia-hairline)',
                  background: 'transparent',
                  color: 'var(--aia-text-muted)',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <Navigation size={12} />
                Guide
              </button>
            )}

            <button
              type="button"
              data-testid="composer-mic-btn"
              data-ai-id="assistant-mic-btn"
              disabled={disabled}
              aria-pressed={recordingState !== 'idle'}
              aria-label={recordingState === 'listening' ? 'Stop voice recording' : 'Voice input'}
              title="Voice input"
              onClick={toggleVoiceInput}
              className="aia-composer-icon-btn"
              style={
                recordingState === 'listening'
                  ? {
                      background: 'color-mix(in oklab, var(--aia-debit) 16%, transparent)',
                      color: 'var(--aia-debit)',
                    }
                  : undefined
              }
            >
              {recordingState === 'listening' ? <MicOff size={15} /> : <Mic size={15} />}
            </button>

            <button
              type="button"
              data-ai-id="assistant-send-btn"
              data-testid="composer-send-btn"
              disabled={!canSend}
              onClick={submit}
              aria-label="Send message"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '9999px',
                border: 'none',
                background: 'var(--aia-gradient-primary)',
                color: 'var(--aia-primary-fg)',
                flexShrink: 0,
                boxShadow: canSend ? 'var(--aia-shadow-glow)' : 'none',
                cursor: canSend ? 'pointer' : 'not-allowed',
                opacity: canSend ? 1 : 0.42,
                transition: 'opacity var(--aia-transition-fast), box-shadow var(--aia-transition-fast)',
              }}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
