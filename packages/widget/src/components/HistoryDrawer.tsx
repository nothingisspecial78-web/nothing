import React, { useState } from 'react';
import { Check, Edit2, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react';
import type { ChatThread } from '../hooks/useChatStorage.ts';

export interface HistoryDrawerProps {
  threads: ChatThread[];
  activeThreadId: string;
  userLabel?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export function HistoryDrawer({
  threads,
  activeThreadId,
  userLabel,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onClearAll,
  onClose,
}: HistoryDrawerProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = threads.filter((t) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  return (
    <div
      data-testid="history-drawer"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: 'var(--aia-surface-strong)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--aia-hairline)',
          gap: '8px',
        }}
      >
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--aia-font-display)' }}>
            Chat History
          </div>
          {userLabel && (
            <div style={{ fontSize: '11.5px', color: 'var(--aia-text-muted)' }}>
              Isolated workspace: {userLabel}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            data-ai-id="assistant-history-new-chat-btn"
            onClick={() => {
              onCreate();
              onClose();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '0.65rem',
              border: 'none',
              background: 'var(--aia-gradient-primary)',
              color: 'var(--aia-primary-fg)',
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            <Plus size={13} />
            New Chat
          </button>
          <button
            type="button"
            data-ai-id="assistant-history-close-btn"
            onClick={onClose}
            aria-label="Close history"
            className="aia-icon-btn"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--aia-hairline)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            borderRadius: '0.75rem',
            border: '1px solid var(--aia-hairline)',
            background: 'var(--aia-inset)',
          }}
        >
          <Search size={14} style={{ color: 'var(--aia-subtle)' }} />
          <input
            type="text"
            aria-label="Search chat history"
            data-ai-id="assistant-history-search-input"
            placeholder="Search saved conversations..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--aia-text)',
              fontSize: '12.5px',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 12px', fontSize: '13px', color: 'var(--aia-text-muted)' }}>
            No matching conversations found.
          </div>
        ) : (
          filtered.map((thread) => {
            const isActive = thread.id === activeThreadId;
            const isEditing = editingId === thread.id;

            return (
              <div
                key={thread.id}
                style={{
                  padding: '10px 11px',
                  borderRadius: '0.85rem',
                  border: isActive
                    ? '1px solid color-mix(in oklab, var(--aia-primary) 50%, transparent)'
                    : '1px solid var(--aia-hairline)',
                  background: isActive
                    ? 'color-mix(in oklab, var(--aia-primary) 10%, var(--aia-surface))'
                    : 'var(--aia-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                {isEditing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                    <input
                      type="text"
                      aria-label="Rename conversation"
                      data-ai-id={`assistant-history-rename-input-${thread.id}`}
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRename(thread.id, draftTitle);
                          setEditingId(null);
                        }
                      }}
                      autoFocus
                      style={{
                        flex: 1,
                        padding: '5px 8px',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--aia-hairline)',
                        background: 'var(--aia-inset)',
                        color: 'var(--aia-text)',
                        fontSize: '12.5px',
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Save thread title"
                      data-ai-id={`assistant-history-save-btn-${thread.id}`}
                      onClick={() => {
                        onRename(thread.id, draftTitle);
                        setEditingId(null);
                      }}
                      className="aia-icon-btn"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-ai-id={`assistant-history-select-btn-${thread.id}`}
                    onClick={() => {
                      onSelect(thread.id);
                      onClose();
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: 0,
                      color: 'var(--aia-text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <MessageSquare size={14} style={{ color: isActive ? 'var(--aia-primary)' : 'var(--aia-subtle)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {thread.title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--aia-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {thread.messages.length} msg(s) · {new Date(thread.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                )}

                {!isEditing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    <button
                      type="button"
                      aria-label={`Rename ${thread.title}`}
                      data-ai-id={`assistant-history-rename-btn-${thread.id}`}
                      onClick={() => {
                        setEditingId(thread.id);
                        setDraftTitle(thread.title);
                      }}
                      className="aia-icon-btn"
                      style={{ width: '28px', height: '28px' }}
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${thread.title}`}
                      data-ai-id={`assistant-history-delete-btn-${thread.id}`}
                      data-sensitive="true"
                      onClick={() => onDelete(thread.id)}
                      className="aia-icon-btn"
                      style={{ width: '28px', height: '28px', color: 'var(--aia-debit)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--aia-hairline)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '11.5px', color: 'var(--aia-text-muted)' }}>
          {threads.length} saved thread(s)
        </span>
        {confirmClear ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              data-ai-id="assistant-history-confirm-clear-btn"
              data-sensitive="true"
              onClick={() => {
                onClearAll();
                setConfirmClear(false);
              }}
              style={{
                padding: '5px 10px',
                borderRadius: '0.6rem',
                border: 'none',
                background: 'var(--aia-debit)',
                color: '#ffffff',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Confirm Clear All
            </button>
            <button
              type="button"
              data-ai-id="assistant-history-cancel-clear-btn"
              onClick={() => setConfirmClear(false)}
              style={{
                padding: '5px 9px',
                borderRadius: '0.6rem',
                border: '1px solid var(--aia-hairline)',
                background: 'var(--aia-inset)',
                color: 'var(--aia-text-muted)',
                fontSize: '11.5px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-ai-id="assistant-history-clear-all-btn"
            data-sensitive="true"
            onClick={() => setConfirmClear(true)}
            style={{
              padding: '5px 10px',
              borderRadius: '0.6rem',
              border: '1px solid var(--aia-hairline)',
              background: 'var(--aia-inset)',
              color: 'var(--aia-debit)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Clear All History
          </button>
        )}
      </div>
    </div>
  );
}
