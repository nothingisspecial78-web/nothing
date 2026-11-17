import React, { useState } from 'react';
import { Check, SlidersHorizontal, X } from 'lucide-react';
import type { PersonalizationSettings } from '@ai-assistant/core';

export interface PersonalizationModalProps {
  value: PersonalizationSettings;
  userLabel?: string;
  onSave: (next: PersonalizationSettings) => void;
  onClose: () => void;
}

export function PersonalizationModal({
  value,
  userLabel,
  onSave,
  onClose,
}: PersonalizationModalProps) {
  const [draft, setDraft] = useState<PersonalizationSettings>(() => ({ ...value }));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(draft);
    onClose();
  };

  return (
    <div
      data-testid="personalization-modal"
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
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SlidersHorizontal size={16} style={{ color: 'var(--aia-primary)' }} />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--aia-font-display)' }}>
              AI Personalization
            </div>
            {userLabel && (
              <div style={{ fontSize: '11.5px', color: 'var(--aia-text-muted)' }}>
                Saved separately for {userLabel}
              </div>
            )}
          </div>
        </div>
        <button type="button" data-ai-id="assistant-personalize-close-btn" onClick={onClose} aria-label="Close personalization" className="aia-icon-btn">
          <X size={15} />
        </button>
      </div>

      <form
        onSubmit={handleSave}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label htmlFor="aia-pref-name" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--aia-text)' }}>
            How should Khazna AI address you?
          </label>
          <input
            id="aia-pref-name"
            data-ai-id="assistant-personalize-name-input"
            type="text"
            placeholder="e.g. Usthad Kareem, Amina"
            value={draft.displayName || ''}
            onChange={(e) => setDraft((p) => ({ ...p, displayName: e.target.value }))}
            style={{
              padding: '8px 10px',
              borderRadius: '0.7rem',
              border: '1px solid var(--aia-hairline)',
              background: 'var(--aia-inset)',
              color: 'var(--aia-text)',
              fontSize: '13px',
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label htmlFor="aia-pref-tone" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--aia-text)' }}>
              Response Style
            </label>
            <select
              id="aia-pref-tone"
              data-ai-id="assistant-personalize-tone-select"
              value={draft.tone || 'balanced'}
              onChange={(e) =>
                setDraft((p) => ({ ...p, tone: e.target.value as PersonalizationSettings['tone'] }))
              }
              style={{
                padding: '8px 10px',
                borderRadius: '0.7rem',
                border: '1px solid var(--aia-hairline)',
                background: 'var(--aia-inset)',
                color: 'var(--aia-text)',
                fontSize: '12.5px',
              }}
            >
              <option value="concise">Concise</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label htmlFor="aia-pref-lang" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--aia-text)' }}>
              Default Language
            </label>
            <select
              id="aia-pref-lang"
              data-ai-id="assistant-personalize-lang-select"
              value={draft.preferredLanguage || 'auto'}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  preferredLanguage: e.target.value as PersonalizationSettings['preferredLanguage'],
                }))
              }
              style={{
                padding: '8px 10px',
                borderRadius: '0.7rem',
                border: '1px solid var(--aia-hairline)',
                background: 'var(--aia-inset)',
                color: 'var(--aia-text)',
                fontSize: '12.5px',
              }}
            >
              <option value="auto">Auto (EN / ML)</option>
              <option value="en">English</option>
              <option value="ml">മലയാളം</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label htmlFor="aia-pref-inst" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--aia-text)' }}>
            Custom Instructions
          </label>
          <textarea
            id="aia-pref-inst"
            data-ai-id="assistant-personalize-instructions-textarea"
            rows={4}
            placeholder="e.g. Always summarize sector targets first, show Rupee amounts clearly, or remind me of voided receipts."
            value={draft.customInstructions || ''}
            onChange={(e) => setDraft((p) => ({ ...p, customInstructions: e.target.value }))}
            style={{
              padding: '8px 10px',
              borderRadius: '0.7rem',
              border: '1px solid var(--aia-hairline)',
              background: 'var(--aia-inset)',
              color: 'var(--aia-text)',
              fontSize: '12.5px',
              resize: 'vertical',
            }}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            padding: '9px 11px',
            borderRadius: '0.75rem',
            border: '1px solid var(--aia-hairline)',
            background: 'var(--aia-inset)',
            cursor: 'pointer',
            fontSize: '12.5px',
            color: 'var(--aia-text)',
          }}
        >
          <input
            type="checkbox"
            data-ai-id="assistant-personalize-voice-checkbox"
            checked={Boolean(draft.voiceAutoSend)}
            onChange={(e) => setDraft((p) => ({ ...p, voiceAutoSend: e.target.checked }))}
          />
          <span>Auto-send transcribed voice messages immediately</span>
        </label>

        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px' }}>
          <button
            type="button"
            data-ai-id="assistant-personalize-cancel-btn"
            onClick={onClose}
            style={{
              padding: '8px 12px',
              borderRadius: '0.7rem',
              border: '1px solid var(--aia-hairline)',
              background: 'var(--aia-inset)',
              color: 'var(--aia-text-muted)',
              fontSize: '12.5px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-ai-id="assistant-personalize-save-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '8px 15px',
              borderRadius: '0.7rem',
              border: 'none',
              background: 'var(--aia-gradient-primary)',
              color: 'var(--aia-primary-fg)',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: 'var(--aia-shadow-glow)',
            }}
          >
            <Check size={14} />
            Save Preferences
          </button>
        </div>
      </form>
    </div>
  );
}
