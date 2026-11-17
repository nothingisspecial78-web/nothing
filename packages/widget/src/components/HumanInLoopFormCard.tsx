import React, { useState } from 'react';
import { CheckCircle2, ClipboardList, XCircle } from 'lucide-react';
import type { FormRequest } from '@ai-assistant/core';

export interface HumanInLoopFormCardProps {
  form: FormRequest;
  status?: 'pending' | 'submitted' | 'cancelled';
  submittedValues?: Record<string, string | number | boolean>;
  onSubmit: (values: Record<string, string | number | boolean>) => void;
  onCancel: () => void;
}

export function HumanInLoopFormCard({
  form,
  status = 'pending',
  submittedValues,
  onSubmit,
  onCancel,
}: HumanInLoopFormCardProps) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const init: Record<string, string | number | boolean> = {};
    for (const f of form.fields) {
      if (f.value !== undefined) {
        init[f.key] = f.value;
      } else if (f.type === 'select' && !f.required && f.options?.length) {
        init[f.key] = f.options[0];
      } else {
        init[f.key] = '';
      }
    }
    return init;
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  if (status === 'submitted') {
    return (
      <div
        data-testid={`hil-form-submitted-${form.formId}`}
        style={{
          padding: '12px 14px',
          borderRadius: '1rem',
          border: '1px solid color-mix(in oklab, var(--aia-credit) 35%, transparent)',
          background: 'color-mix(in oklab, var(--aia-credit) 10%, var(--aia-surface))',
          color: 'var(--aia-text)',
          fontSize: '12.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <CheckCircle2 size={16} style={{ color: 'var(--aia-credit)', flexShrink: 0 }} />
        <div>
          <strong>{form.title}</strong> completed
          {submittedValues?.name ? ` (${String(submittedValues.name)})` : ''}.
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div
        style={{
          padding: '10px 14px',
          borderRadius: '1rem',
          border: '1px solid var(--aia-hairline)',
          background: 'var(--aia-inset)',
          color: 'var(--aia-text-muted)',
          fontSize: '12.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <XCircle size={15} />
        <span>{form.title} cancelled.</span>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    for (const field of form.fields) {
      const val = values[field.key];
      const strVal = val === undefined || val === null ? '' : String(val).trim();
      if (field.required && strVal === '') {
        setValidationError(`Please enter ${field.label}.`);
        return;
      }
      if (field.type === 'email' && strVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
        setValidationError(`Please enter a valid ${field.label}.`);
        return;
      }
      if (field.type === 'password' && strVal && strVal.length < 4) {
        setValidationError(`${field.label} must be at least 4 characters.`);
        return;
      }
    }
    setValidationError(null);
    const normalized: Record<string, string | number | boolean> = {};
    for (const field of form.fields) {
      const val = values[field.key];
      normalized[field.key] = field.type === 'number' ? Number(val || 0) : val;
    }
    onSubmit(normalized);
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid={`hil-form-${form.command}`}
      style={{
        padding: '10px 12px',
        borderRadius: '1rem',
        border: '1px solid color-mix(in oklab, var(--aia-primary) 30%, var(--aia-hairline))',
        background: 'var(--aia-surface-strong)',
        boxShadow: 'var(--aia-shadow-glass)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <ClipboardList size={15} style={{ color: 'var(--aia-primary)', flexShrink: 0 }} />
        <div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 700,
              fontFamily: 'var(--aia-font-display)',
              color: 'var(--aia-text)',
            }}
          >
            {form.title}
          </div>
          {form.description && (
            <div style={{ fontSize: '11.5px', color: 'var(--aia-text-muted)', marginTop: '1px' }}>
              {form.description}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '7px',
        }}
      >
        {form.fields.map((field) => {
          const inputId = `${form.formId}_${field.key}`;
          const val = String(values[field.key] ?? '');
          const commonStyle: React.CSSProperties = {
            width: '100%',
            padding: '6px 8px',
            borderRadius: '0.6rem',
            border: '1px solid var(--aia-hairline)',
            background: 'var(--aia-inset)',
            color: 'var(--aia-text)',
            fontSize: '12px',
            fontFamily: field.type === 'number' ? 'var(--aia-font-mono)' : 'var(--aia-font-sans)',
            outline: 'none',
          };

          return (
            <div
              key={field.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                gridColumn: field.type === 'textarea' ? '1 / -1' : undefined,
              }}
            >
              <label
                htmlFor={inputId}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--aia-text-muted)',
                }}
              >
                {field.label}
                {field.required ? ' *' : ''}
              </label>

              {field.type === 'select' ? (
                <select
                  id={inputId}
                  data-ai-id={`assistant-form-${form.command}-${field.key}`}
                  value={val}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={commonStyle}
                >
                  {(field.required || val === '') && (
                    <option value="">{field.placeholder || `-- Select ${field.label} --`}</option>
                  )}
                  {(field.options || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  id={inputId}
                  data-ai-id={`assistant-form-${form.command}-${field.key}`}
                  rows={2}
                  value={val}
                  placeholder={field.placeholder}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={{ ...commonStyle, resize: 'vertical' }}
                />
              ) : (
                <input
                  id={inputId}
                  data-ai-id={`assistant-form-${form.command}-${field.key}`}
                  data-sensitive={field.type === 'password' ? 'true' : undefined}
                  type={
                    field.type === 'number'
                      ? 'number'
                      : field.type === 'date'
                        ? 'date'
                        : field.type === 'password'
                          ? 'password'
                          : field.type === 'email'
                            ? 'email'
                            : 'text'
                  }
                  value={val}
                  placeholder={field.placeholder}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  style={commonStyle}
                />
              )}
            </div>
          );
        })}
      </div>

      {validationError && (
        <div role="alert" style={{ fontSize: '12px', color: 'var(--aia-debit)', fontWeight: 500 }}>
          {validationError}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '7px' }}>
        <button
          type="button"
          data-ai-id={`assistant-form-cancel-${form.command}`}
          onClick={onCancel}
          style={{
            padding: '6px 11px',
            borderRadius: '0.65rem',
            border: '1px solid var(--aia-hairline)',
            background: 'var(--aia-inset)',
            color: 'var(--aia-text-muted)',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          data-ai-id={`assistant-form-submit-${form.command}`}
          data-sensitive="true"
          style={{
            padding: '6px 13px',
            borderRadius: '0.65rem',
            border: 'none',
            background: 'var(--aia-gradient-primary)',
            color: 'var(--aia-primary-fg)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: 'var(--aia-shadow-glow)',
          }}
        >
          {form.submitLabel}
        </button>
      </div>
    </form>
  );
}
