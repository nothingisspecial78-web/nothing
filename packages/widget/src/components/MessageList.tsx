import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileSpreadsheet,
  FileText,
  Mic,
  MicOff,
  Navigation,
  Pencil,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  ActionLogEntry,
  ExportFilePayload,
  FormRequest,
  GuideClarificationOption,
  ImportPreviewResult,
} from '@ai-assistant/core';
import type { WidgetMessage } from '../hooks/useChatStream.ts';
import { useVoiceInput } from '../hooks/useVoiceInput.ts';
import { formatBytes } from '../utils/fileProcessor.ts';
import { AttachmentLightbox } from './AttachmentLightbox.tsx';
import { ConfirmCard } from './ConfirmCard.tsx';
import { ExportCard } from './ExportCard.tsx';
import { HumanInLoopFormCard } from './HumanInLoopFormCard.tsx';
import { ImportPreview } from './ImportPreview.tsx';

export type SuggestionEntry =
  | string
  | {
      id: string;
      label: string;
      prompt: string;
    };

function ToolDetailsDisclosure({
  toolEvents,
}: {
  toolEvents: NonNullable<WidgetMessage['toolEvents']>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: '6px' }}>
      <button
        type="button"
        data-testid="tool-details-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 7px',
          borderRadius: '9999px',
          border: 'none',
          background: 'var(--aia-inset)',
          color: 'var(--aia-text-muted)',
          fontSize: '11px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Details ({toolEvents.length})</span>
      </button>
      {expanded && (
        <div
          data-testid="tool-details-panel"
          style={{
            marginTop: '6px',
            padding: '6px 9px',
            borderRadius: '10px',
            background: 'var(--aia-inset)',
            border: '1px solid var(--aia-hairline)',
            fontSize: '11px',
            fontFamily: 'var(--aia-font-mono)',
            color: 'var(--aia-text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          {toolEvents.map((t, idx) => (
            <div key={idx}>
              {t.toolName} — {t.status}
              {t.status === 'failed' && t.summary ? ` (${t.summary})` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: '12px',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        background: '#0f172a',
        color: '#e2e8f0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: '#1e293b',
          fontSize: '11px',
          color: '#94a3b8',
          fontFamily: 'var(--aia-font-mono)',
        }}
      >
        <span>{lang || 'code'}</span>
        <button
          type="button"
          data-ai-id="assistant-copy-code-btn"
          onClick={handleCopy}
          aria-label="Copy code block"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: 'transparent',
            border: 'none',
            color: '#e2e8f0',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          overflowX: 'auto',
          fontSize: '12px',
          lineHeight: 1.5,
          fontFamily: 'var(--aia-font-mono)',
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|(?<![A-Za-z0-9])_[^_\n]+?_(?![A-Za-z0-9]))/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          style={{
            padding: '1px 6px',
            borderRadius: '6px',
            background: 'var(--aia-inset)',
            border: '1px solid var(--aia-hairline)',
            fontFamily: 'var(--aia-font-mono)',
            fontSize: '0.86em',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length >= 3) {
      return (
        <em key={idx} style={{ color: 'var(--aia-text-muted)', fontSize: '0.92em' }}>
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function MarkdownContent({ text }: { text: string }) {
  const blocks = text.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ fontSize: '13.5px', lineHeight: 1.6, wordBreak: 'break-word' }}>
      {blocks.map((block, bIdx) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const lines = block.slice(3, -3).split('\n');
          const lang = lines[0]?.trim() || '';
          const code = lines.slice(1).join('\n');
          return <CodeBlock key={bIdx} lang={lang} code={code} />;
        }

        const lines = block.split('\n');
        const elements: React.ReactNode[] = [];
        let idx = 0;

        while (idx < lines.length) {
          const line = lines[idx];
          const trimmed = line.trim();

          if (
            trimmed.startsWith('|') &&
            trimmed.endsWith('|') &&
            idx + 1 < lines.length &&
            /^\|[\s:|-]+\|$/.test(lines[idx + 1].trim())
          ) {
            const parseRow = (rowStr: string) =>
              rowStr
                .trim()
                .slice(1, -1)
                .split('|')
                .map((cell) => cell.trim());

            const headers = parseRow(trimmed);
            idx += 2;
            const bodyRows: string[][] = [];
            while (idx < lines.length) {
              const rowTrimmed = lines[idx].trim();
              if (!rowTrimmed.startsWith('|') || !rowTrimmed.endsWith('|')) break;
              bodyRows.push(parseRow(rowTrimmed));
              idx += 1;
            }

            elements.push(
              <div
                key={`tbl-${idx}`}
                style={{
                  margin: '6px 0',
                  borderRadius: '12px',
                  border: '1px solid var(--aia-hairline)',
                  background: 'var(--aia-inset)',
                  overflowX: 'auto',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(15, 23, 42, 0.04)' }}>
                      {headers.map((h, hIdx) => (
                        <th
                          key={hIdx}
                          style={{
                            padding: '6px 8px',
                            fontWeight: 600,
                            borderBottom: '1px solid var(--aia-hairline)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {headers.map((_, cIdx) => (
                          <td
                            key={cIdx}
                            style={{
                              padding: '5px 8px',
                              borderBottom:
                                rIdx < bodyRows.length - 1 ? '1px solid var(--aia-hairline)' : 'none',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {renderInlineFormatting(row[cIdx] || '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            continue;
          }

          if (!trimmed) {
            elements.push(<div key={`sp-${idx}`} style={{ height: '4px' }} />);
          } else if (trimmed.startsWith('Source:')) {
            elements.push(
              <div
                key={`src-${idx}`}
                style={{
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--aia-hairline)',
                  fontSize: '12px',
                  color: 'var(--aia-text-muted)',
                }}
              >
                {renderInlineFormatting(trimmed)}
              </div>
            );
          } else if (/^#{1,3}\s+/.test(trimmed)) {
            elements.push(
              <div key={`h-${idx}`} style={{ fontWeight: 700, fontFamily: 'var(--aia-font-display)', marginTop: '4px' }}>
                {renderInlineFormatting(trimmed.replace(/^#{1,3}\s+/, ''))}
              </div>
            );
          } else if (/^(\d+\.|-|\*)\s+/.test(trimmed)) {
            elements.push(
              <div key={`li-${idx}`} style={{ paddingLeft: '10px' }}>
                {renderInlineFormatting(trimmed)}
              </div>
            );
          } else {
            elements.push(<div key={`p-${idx}`}>{renderInlineFormatting(trimmed)}</div>);
          }
          idx += 1;
        }

        return (
          <div key={bIdx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {elements}
          </div>
        );
      })}
    </div>
  );
}

export interface MessageListProps {
  messages: WidgetMessage[];
  firstName?: string;
  suggestions?: SuggestionEntry[];
  mobileCompactMode?: boolean;
  apiUrl?: string;
  appId?: string;
  language?: 'auto' | 'en' | 'ml' | string;
  getAuthToken?: () => string | Promise<string>;
  onExpandMobileHistory?: () => void;
  onSuggestionClick?: (text: string) => void;
  onSubmitForm?: (
    messageId: string,
    form: FormRequest,
    values: Record<string, string | number | boolean>
  ) => void;
  onCancelForm?: (messageId: string) => void;
  onConfirmAction: (
    messageId: string,
    actionId: string,
    confirmationToken: string,
    decision: 'confirm' | 'cancel'
  ) => void;
  onUndoAction: (messageId: string, actionId: string) => Promise<{ ok: boolean; summary?: string }>;
  onConfirmImport: (
    messageId: string,
    preview: ImportPreviewResult,
    decision: 'confirm' | 'cancel'
  ) => Promise<{ ok: boolean; summary?: string }>;
  onRevalidateImport?: (
    messageId: string,
    uploadId: string,
    opts: { sheetName?: string; columnOverrides?: Record<string, string>; targetArea?: string }
  ) => Promise<ImportPreviewResult>;
  onDownloadErrorCsv: (uploadId: string) => void;
  onDownloadErrorXlsx?: (uploadId: string) => void;
  onEditMessage?: (messageId: string, nextText: string) => void;
  onSelectGuideOption?: (messageId: string, option: GuideClarificationOption) => void;
  onVoiceClarificationReply?: (transcript: string) => void;
  onActionCompleted?: (action: ActionLogEntry) => void;
  onExportDownloaded?: (exportFile: ExportFilePayload) => void;
}

export function MessageList({
  messages,
  firstName = 'there',
  suggestions = [
    'Students with negative balance',
    'Add a new student',
    'Who is Safwan K and his due?',
  ],
  mobileCompactMode = false,
  apiUrl = '',
  appId = 'khazna-ledger',
  language = 'en',
  getAuthToken,
  onExpandMobileHistory,
  onSuggestionClick,
  onSubmitForm,
  onCancelForm,
  onConfirmAction,
  onUndoAction,
  onConfirmImport,
  onRevalidateImport,
  onDownloadErrorCsv,
  onDownloadErrorXlsx,
  onEditMessage,
  onSelectGuideOption,
  onVoiceClarificationReply,
  onExportDownloaded,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [lightboxImg, setLightboxImg] = useState<{ src: string; alt: string; subtitle?: string } | null>(null);
  const {
    recordingState: clarifyVoiceState,
    micError: clarifyMicError,
    toggleVoiceInput: toggleClarifyVoiceInput,
  } = useVoiceInput({
    apiUrl,
    appId,
    language,
    getAuthToken,
    onTranscript: (transcript) => {
      onVoiceClarificationReply?.(transcript);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, mobileCompactMode]);

  // Gemini-minimal empty state: centered friendly greeting + strictly 3 stacked pill chips above input
  if (messages.length === 0) {
    const normalizedChips = suggestions.slice(0, 3).map((item, idx) =>
      typeof item === 'string'
        ? { id: `sug-${idx}`, label: item, prompt: item }
        : item
    );

    return (
      <div className="aia-empty-stage" data-testid="empty-chat-stage">
        <div className="aia-greeting-center">
          <div className="aia-greeting-sparkle" aria-hidden="true">
            <Sparkles size={16} />
          </div>
          <h3 className="aia-greeting-text" data-testid="empty-greeting-text">
            Hi {firstName || 'there'}, how can I help?
          </h3>
        </div>

        {normalizedChips.length > 0 && (
          <div className="aia-chips-stack" data-testid="suggestion-chips-stack">
            {normalizedChips.map((chip, sIdx) => (
              <button
                key={chip.id || sIdx}
                type="button"
                data-testid={`suggestion-chip-${sIdx}`}
                data-ai-id={`assistant-suggestion-btn-${sIdx}`}
                className="aia-chip-pill"
                onClick={() => onSuggestionClick?.(chip.prompt)}
              >
                <span>{chip.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  let visibleMessages = messages;
  let hiddenCount = 0;
  if (mobileCompactMode && messages.length > 0) {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    const startIdx = lastUserIdx >= 0 ? lastUserIdx : Math.max(0, messages.length - 1);
    visibleMessages = messages.slice(startIdx);
    hiddenCount = startIdx;
  }

  return (
    <div
      data-testid="assistant-messages"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: mobileCompactMode ? '10px 14px' : '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {mobileCompactMode && hiddenCount > 0 && onExpandMobileHistory && (
        <button
          type="button"
          data-testid="mobile-expand-history-btn"
          data-ai-id="assistant-mobile-expand-btn"
          onClick={onExpandMobileHistory}
          style={{
            alignSelf: 'center',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 11px',
            borderRadius: 'var(--aia-radius-pill)',
            border: '1px solid var(--aia-hairline)',
            background: 'var(--aia-surface)',
            color: 'var(--aia-text-muted)',
            fontSize: '11.5px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <ChevronUp size={13} />
          Swipe up for {hiddenCount} earlier message(s)
        </button>
      )}

      {lightboxImg && (
        <AttachmentLightbox
          src={lightboxImg.src}
          alt={lightboxImg.alt}
          subtitle={lightboxImg.subtitle}
          onClose={() => setLightboxImg(null)}
        />
      )}

      {visibleMessages.map((msg) => {
        const isUser = msg.role === 'user';
        const attachedContexts =
          msg.contexts && msg.contexts.length > 0
            ? msg.contexts
            : msg.context
              ? [msg.context]
              : [];
        const isEditingThis = isUser && editingMsgId === msg.id;

        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isUser ? 'flex-end' : 'flex-start',
              gap: '6px',
            }}
          >
            {attachedContexts.length > 0 && (
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                {attachedContexts.map((ctx, cIdx) => (
                  <div
                    key={`${ctx.cssSelector || cIdx}`}
                    style={{
                      fontSize: '11px',
                      fontFamily: 'var(--aia-font-mono)',
                      color: 'var(--aia-subtle)',
                      padding: '2px 8px',
                      borderRadius: '8px',
                      background: 'var(--aia-inset)',
                      border: '1px solid var(--aia-hairline)',
                    }}
                  >
                    Selected card:{' '}
                    {ctx.nearbyLabel ||
                      (ctx.text ? ctx.text.replace(/\s+/g, ' ').trim().slice(0, 36) : undefined) ||
                      ctx.routePath}
                  </div>
                ))}
              </div>
            )}

            {msg.attachments && msg.attachments.length > 0 && (
              <div
                data-testid="message-attachments"
                style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}
              >
                {msg.attachments.map((att, idx) => {
                  const metaParts: string[] = [];
                  if (att.sizeBytes) metaParts.push(formatBytes(att.sizeBytes));
                  if (att.pageCount) metaParts.push(`${att.pageCount} pg`);
                  if (att.sheetNames && att.sheetNames.length > 0) {
                    metaParts.push(`${att.sheetNames.length} sheet${att.sheetNames.length === 1 ? '' : 's'}`);
                  }
                  const sub = metaParts.join(' · ');

                  if (att.type === 'image' && att.dataUrl) {
                    return (
                      <button
                        key={idx}
                        type="button"
                        data-testid="message-image-thumb-btn"
                        aria-label={`Open full preview of ${att.name}`}
                        onClick={() => setLightboxImg({ src: att.dataUrl!, alt: att.name, subtitle: sub })}
                        style={{
                          padding: 0,
                          border: '1px solid var(--aia-hairline)',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          background: 'var(--aia-inset)',
                          cursor: 'pointer',
                        }}
                      >
                        <img
                          src={att.dataUrl}
                          alt={att.name}
                          style={{
                            maxWidth: '180px',
                            maxHeight: '110px',
                            display: 'block',
                            objectFit: 'cover',
                          }}
                        />
                      </button>
                    );
                  }

                  const isSheet = /\.(xlsx|xls|csv|tsv)$/i.test(att.name);
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '7px',
                        fontSize: '12px',
                        color: 'var(--aia-text)',
                        background: 'var(--aia-surface)',
                        border: '1px solid var(--aia-hairline)',
                        borderRadius: '11px',
                        padding: '5px 10px',
                      }}
                    >
                      {isSheet ? (
                        <FileSpreadsheet size={14} style={{ color: 'var(--aia-primary)', flexShrink: 0 }} />
                      ) : (
                        <FileText size={14} style={{ color: 'var(--aia-primary)', flexShrink: 0 }} />
                      )}
                      <div>
                        <div style={{ fontWeight: 600 }}>{att.name}</div>
                        {sub && (
                          <div style={{ fontSize: '10.5px', color: 'var(--aia-text-muted)' }}>{sub}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              style={{
                maxWidth: '94%',
                padding: '10px 14px',
                borderRadius: isUser ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
                background: isUser ? 'var(--aia-bubble-user-bg)' : 'var(--aia-bubble-bot-bg)',
                color: isUser ? 'var(--aia-bubble-user-fg)' : 'var(--aia-text)',
                border: isUser ? '1px solid transparent' : '1px solid var(--aia-hairline)',
                boxShadow: isUser ? 'var(--aia-shadow-glow)' : 'var(--aia-chip-shadow)',
              }}
            >
              {isUser ? (
                isEditingThis ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '210px' }}>
                    <textarea
                      aria-label="Edit message text"
                      data-ai-id={`assistant-msg-edit-input-${msg.id}`}
                      rows={2}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      style={{
                        width: '100%',
                        borderRadius: '10px',
                        border: '1px solid rgba(255,255,255,0.4)',
                        background: 'rgba(15, 23, 42, 0.22)',
                        color: '#ffffff',
                        padding: '6px 8px',
                        fontSize: '13px',
                        fontFamily: 'inherit',
                        outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                      <button
                        type="button"
                        data-ai-id={`assistant-msg-edit-cancel-${msg.id}`}
                        onClick={() => {
                          setEditingMsgId(null);
                          setEditingText('');
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '3px 8px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.35)',
                          background: 'transparent',
                          color: '#ffffff',
                          fontSize: '11.5px',
                          cursor: 'pointer',
                        }}
                      >
                        <X size={12} />
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-ai-id={`assistant-msg-edit-resend-${msg.id}`}
                        onClick={() => {
                          const next = editingText.trim();
                          setEditingMsgId(null);
                          setEditingText('');
                          if (next && onEditMessage) onEditMessage(msg.id, next);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '3px 9px',
                          borderRadius: '8px',
                          border: 'none',
                          background: '#ffffff',
                          color: '#0f172a',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <Check size={12} />
                        Resend
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ fontSize: '13.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', fontWeight: 500 }}>
                      {msg.content}
                    </div>
                    {onEditMessage && !mobileCompactMode && (
                      <button
                        type="button"
                        data-ai-id={`assistant-msg-edit-btn-${msg.id}`}
                        aria-label="Edit and resend message"
                        title="Edit & resend"
                        onClick={() => {
                          setEditingMsgId(msg.id);
                          setEditingText(msg.content);
                        }}
                        style={{
                          border: 'none',
                          background: 'rgba(255,255,255,0.16)',
                          color: 'var(--aia-primary-fg)',
                          borderRadius: '7px',
                          padding: '3px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          flexShrink: 0,
                          opacity: 0.85,
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                )
              ) : (
                <>
                  {msg.isStreaming && msg.statusLabel && (
                    <div
                      data-testid="agent-status-phase"
                      style={{
                        marginBottom: '6px',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: 'var(--aia-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{msg.statusLabel}</span>
                    </div>
                  )}

                  {msg.toolEvents && msg.toolEvents.length > 0 && (
                    <ToolDetailsDisclosure toolEvents={msg.toolEvents} />
                  )}

                  {msg.content ? (
                    <MarkdownContent text={msg.content} />
                  ) : msg.isStreaming ? (
                    <span style={{ fontSize: '13px', color: 'var(--aia-subtle)' }}>
                      {msg.statusLabel || 'Thinking…'}
                    </span>
                  ) : null}
                </>
              )}
            </div>

            {!isUser && !msg.isStreaming && msg.guideClarification && msg.guideClarification.options.length > 0 && (
              <div
                data-testid="guide-clarification-options"
                role="group"
                aria-label="Choose a guide path"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  marginTop: '6px',
                  width: '94%',
                }}
              >
                {msg.guideClarification.options.map((opt, oIdx) => {
                  const isSelected = msg.guideClarification?.selectedOptionId === opt.id;
                  const isResolved = Boolean(msg.guideClarification?.selectedOptionId);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isResolved}
                      data-ai-id={`assistant-clarify-option-${opt.id}`}
                      data-testid={`guide-clarify-option-${opt.id}`}
                      onClick={() => onSelectGuideOption?.(msg.id, opt)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 12px',
                        borderRadius: '14px',
                        border: isSelected
                          ? '1px solid var(--aia-primary)'
                          : '1px solid var(--aia-hairline)',
                        background: isSelected
                          ? 'color-mix(in oklab, var(--aia-primary) 12%, var(--aia-surface))'
                          : 'var(--aia-surface)',
                        color: 'var(--aia-text)',
                        cursor: isResolved ? 'default' : 'pointer',
                        opacity: isResolved && !isSelected ? 0.55 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span
                          style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '7px',
                            background: isSelected
                              ? 'var(--aia-primary)'
                              : 'color-mix(in oklab, var(--aia-primary) 12%, var(--aia-inset))',
                            color: isSelected ? '#ffffff' : 'var(--aia-primary)',
                            fontSize: '11px',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {isSelected ? <Check size={12} /> : oIdx + 1}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12.5px', fontWeight: 600, lineHeight: 1.3 }}>
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div
                              style={{
                                fontSize: '11px',
                                color: 'var(--aia-text-muted)',
                                fontFamily: 'var(--aia-font-mono)',
                                marginTop: '1px',
                              }}
                            >
                              {opt.description}
                            </div>
                          )}
                        </div>
                      </div>
                      {!isResolved && (
                        <Navigation size={13} style={{ color: 'var(--aia-primary)', flexShrink: 0 }} />
                      )}
                    </button>
                  );
                })}
                {!msg.guideClarification.selectedOptionId && onVoiceClarificationReply && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <button
                      type="button"
                      data-testid="clarify-voice-btn"
                      data-ai-id="assistant-clarify-voice-btn"
                      onClick={toggleClarifyVoiceInput}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 10px',
                        borderRadius: '10px',
                        border: '1px solid var(--aia-hairline)',
                        background:
                          clarifyVoiceState === 'listening'
                            ? 'color-mix(in oklab, var(--aia-debit) 14%, transparent)'
                            : 'var(--aia-inset)',
                        color:
                          clarifyVoiceState === 'listening'
                            ? 'var(--aia-debit)'
                            : 'var(--aia-primary)',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {clarifyVoiceState === 'listening' ? <MicOff size={12} /> : <Mic size={12} />}
                      <span>
                        {clarifyVoiceState === 'listening'
                          ? 'Listening… tap to stop'
                          : clarifyVoiceState === 'transcribing'
                            ? 'Transcribing…'
                            : 'Speak choice'}
                      </span>
                    </button>
                    {clarifyMicError && (
                      <span style={{ fontSize: '11px', color: 'var(--aia-debit)' }}>
                        {clarifyMicError}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isUser && msg.exportFile && (
              <div style={{ width: '100%' }}>
                <ExportCard
                  exportFile={msg.exportFile}
                  apiUrl={apiUrl}
                  onDownloaded={onExportDownloaded}
                />
              </div>
            )}

            {!isUser && !msg.isStreaming && msg.followUpChips && msg.followUpChips.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                  marginTop: '4px',
                  maxWidth: '94%',
                }}
              >
                {msg.followUpChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    data-ai-id={`assistant-followup-chip-${chip.id}`}
                    onClick={() => onSuggestionClick?.(chip.prompt)}
                    style={{
                      border: '1px solid var(--aia-hairline)',
                      background: 'var(--aia-surface)',
                      borderRadius: '9999px',
                      padding: '5px 11px',
                      fontSize: '11.5px',
                      fontWeight: 500,
                      color: 'var(--aia-primary)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: 'var(--aia-chip-shadow)',
                    }}
                  >
                    <span>{chip.label}</span>
                    <ArrowUpRight size={11} />
                  </button>
                ))}
              </div>
            )}

            {msg.formRequest && onSubmitForm && onCancelForm && (
              <div style={{ width: '100%' }}>
                <HumanInLoopFormCard
                  form={msg.formRequest}
                  status={msg.formStatus || 'pending'}
                  submittedValues={msg.formValues}
                  onSubmit={(values) => onSubmitForm(msg.id, msg.formRequest!, values)}
                  onCancel={() => onCancelForm(msg.id)}
                />
              </div>
            )}

            {msg.confirmation && (
              <div style={{ width: '100%' }}>
                <ConfirmCard
                  confirmation={msg.confirmation}
                  onConfirm={() =>
                    onConfirmAction(
                      msg.id,
                      msg.confirmation!.actionId,
                      msg.confirmation!.confirmationToken,
                      'confirm'
                    )
                  }
                  onCancel={() =>
                    onConfirmAction(
                      msg.id,
                      msg.confirmation!.actionId,
                      msg.confirmation!.confirmationToken,
                      'cancel'
                    )
                  }
                  onUndo={() => onUndoAction(msg.id, msg.confirmation!.actionId)}
                />
              </div>
            )}

            {msg.importPreview && (
              <div style={{ width: '100%' }}>
                <ImportPreview
                  preview={msg.importPreview}
                  onConfirm={() => onConfirmImport(msg.id, msg.importPreview!, 'confirm')}
                  onCancel={() => onConfirmImport(msg.id, msg.importPreview!, 'cancel')}
                  onUndo={
                    msg.importPreview.actionId
                      ? () => onUndoAction(msg.id, msg.importPreview!.actionId!)
                      : undefined
                  }
                  onRevalidate={
                    onRevalidateImport
                      ? (opts) => onRevalidateImport(msg.id, msg.importPreview!.uploadId, opts)
                      : undefined
                  }
                  onDownloadErrorCsv={() => onDownloadErrorCsv(msg.importPreview!.uploadId)}
                  onDownloadErrorXlsx={
                    onDownloadErrorXlsx
                      ? () => onDownloadErrorXlsx(msg.importPreview!.uploadId)
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
