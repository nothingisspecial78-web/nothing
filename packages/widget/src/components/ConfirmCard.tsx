import React from 'react';
import { CheckCircle2, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import type { WidgetConfirmationState } from '../hooks/useChatStream.ts';

export interface ConfirmCardProps {
  confirmation: WidgetConfirmationState;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo?: () => void;
}

export function ConfirmCard({ confirmation, onConfirm, onCancel, onUndo }: ConfirmCardProps) {
  const isPending = confirmation.status === 'pending';
  const isConfirming = confirmation.status === 'confirming';
  const isExecuted = confirmation.status === 'executed';
  const isUndone = confirmation.status === 'undone';

  return (
    <div
      data-testid="confirm-action-card"
      style={{
        borderRadius: '1rem',
        border: isExecuted
          ? '1px solid color-mix(in oklab, var(--aia-credit) 35%, transparent)'
          : '1px solid var(--aia-hairline)',
        background: isExecuted
          ? 'color-mix(in oklab, var(--aia-credit) 8%, var(--aia-surface))'
          : 'var(--aia-surface)',
        padding: '11px 13px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontWeight: 600,
          fontSize: '12.5px',
          fontFamily: 'var(--aia-font-display)',
          color: 'var(--aia-text)',
        }}
      >
        {isExecuted ? (
          <CheckCircle2 size={15} style={{ color: 'var(--aia-credit)' }} />
        ) : isUndone ? (
          <RotateCcw size={15} style={{ color: 'var(--aia-text-muted)' }} />
        ) : (
          <ShieldAlert size={15} style={{ color: 'var(--aia-primary)' }} />
        )}
        <span>
          {isExecuted
            ? `Executed: ${confirmation.toolName}`
            : isUndone
              ? `Undone: ${confirmation.toolName}`
              : `Confirmation Required: ${confirmation.toolName}`}
        </span>
      </div>

      {(isPending || isConfirming) && (
        <>
          <div style={{ fontSize: '13px', color: 'var(--aia-text-muted)', lineHeight: 1.5 }}>
            {confirmation.summary}
          </div>
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              borderRadius: '0.75rem',
              background: 'var(--aia-inset)',
              border: '1px solid var(--aia-hairline)',
              fontSize: '11.5px',
              fontFamily: 'var(--aia-font-mono)',
              overflowX: 'auto',
              color: 'var(--aia-text)',
            }}
          >
            {JSON.stringify(confirmation.details, null, 2)}
          </pre>
        </>
      )}

      {confirmation.resultMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12.5px',
            fontWeight: 500,
            color:
              confirmation.status === 'executed'
                ? 'var(--aia-credit)'
                : confirmation.status === 'error'
                  ? 'var(--aia-debit)'
                  : 'var(--aia-text-muted)',
          }}
        >
          {confirmation.status === 'executed' ? (
            <CheckCircle2 size={15} />
          ) : confirmation.status === 'cancelled' || confirmation.status === 'error' ? (
            <XCircle size={15} />
          ) : null}
          <span>{confirmation.resultMessage}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {(isPending || isConfirming) && (
          <>
            <button
              type="button"
              data-ai-id="assistant-confirm-action-btn"
              data-sensitive="true"
              disabled={isConfirming}
              onClick={onConfirm}
              style={{
                padding: '7px 14px',
                borderRadius: '0.75rem',
                border: 'none',
                background: 'var(--aia-gradient-primary)',
                color: 'var(--aia-primary-fg)',
                fontSize: '12.5px',
                fontWeight: 600,
                boxShadow: 'var(--aia-shadow-glow)',
                cursor: isConfirming ? 'wait' : 'pointer',
              }}
            >
              {isConfirming ? 'Executing…' : 'Confirm'}
            </button>
            <button
              type="button"
              data-ai-id="assistant-cancel-action-btn"
              disabled={isConfirming}
              onClick={onCancel}
              style={{
                padding: '7px 14px',
                borderRadius: '0.75rem',
                border: '1px solid var(--aia-hairline)',
                background: 'var(--aia-inset)',
                color: 'var(--aia-text)',
                fontSize: '12.5px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </>
        )}

        {confirmation.status === 'executed' && confirmation.canUndo && onUndo && (
          <button
            type="button"
            data-ai-id="assistant-undo-action-btn"
            data-sensitive="true"
            onClick={onUndo}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '0.75rem',
              border: '1px solid var(--aia-hairline)',
              background: 'var(--aia-inset)',
              color: 'var(--aia-text)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={13} />
            Undo Action
          </button>
        )}
      </div>
    </div>
  );
}
