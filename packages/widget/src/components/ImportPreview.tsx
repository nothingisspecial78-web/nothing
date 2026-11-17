import React, { useEffect, useState } from 'react';
import { Columns3, Download, FileSpreadsheet, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ImportPreviewResult } from '@ai-assistant/core';

export interface ImportPreviewProps {
  preview: ImportPreviewResult;
  onConfirm: () => Promise<{ ok: boolean; summary?: string }>;
  onCancel: () => Promise<{ ok: boolean; summary?: string }>;
  onUndo?: () => Promise<{ ok: boolean; summary?: string }>;
  onRevalidate?: (opts: {
    sheetName?: string;
    columnOverrides?: Record<string, string>;
    targetArea?: string;
  }) => Promise<ImportPreviewResult>;
  onDownloadErrorCsv: () => void;
  onDownloadErrorXlsx?: () => void;
}

function getEntityLabel(templateId: string): string {
  switch (templateId) {
    case 'khazna-students':
      return 'Students';
    case 'khazna-sectors':
      return 'Sectors';
    case 'khazna-managers':
      return 'Managers';
    case 'khazna-bulk-entries':
      return 'Bulk Entries';
    default:
      return templateId;
  }
}

export function ImportPreview({
  preview,
  onConfirm,
  onCancel,
  onUndo,
  onRevalidate,
  onDownloadErrorCsv,
  onDownloadErrorXlsx,
}: ImportPreviewProps) {
  const [tab, setTab] = useState<'valid' | 'normalized' | 'errors'>(
    preview.invalidCount > 0 && preview.validCount === 0 ? 'errors' : 'valid'
  );
  const [status, setStatus] = useState<'pending' | 'submitting' | 'executed' | 'cancelled' | 'undone'>('pending');
  const [importProgress, setImportProgress] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showMapping, setShowMapping] = useState(preview.formatMatched === false);
  const [isRevalidating, setIsRevalidating] = useState(false);

  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const m of preview.columnMapping) {
      if (m.matchedHeader) initial[m.expectedKey] = m.matchedHeader;
    }
    return initial;
  });

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const m of preview.columnMapping) {
      if (m.matchedHeader) next[m.expectedKey] = m.matchedHeader;
    }
    setOverrides(next);
  }, [preview.columnMapping, preview.selectedSheet]);

  const handleConfirm = async () => {
    setStatus('submitting');
    setImportProgress(25);
    const timer = window.setInterval(() => {
      setImportProgress((p) => (p < 88 ? p + 18 : p));
    }, 120);
    try {
      const res = await onConfirm();
      window.clearInterval(timer);
      setImportProgress(res.ok ? 100 : 0);
      setFeedback(res.summary || (res.ok ? 'Import completed.' : 'Import failed.'));
      setStatus(res.ok ? 'executed' : 'pending');
    } catch {
      window.clearInterval(timer);
      setImportProgress(0);
      setStatus('pending');
    }
  };

  const handleCancel = async () => {
    const res = await onCancel();
    setFeedback(res.summary || 'Import cancelled.');
    setStatus('cancelled');
  };

  const handleUndo = async () => {
    if (!onUndo) return;
    const res = await onUndo();
    setFeedback(res.summary || 'Import undone.');
    if (res.ok) setStatus('undone');
  };

  const triggerRevalidate = async (next: {
    sheetName?: string;
    columnOverrides?: Record<string, string>;
    targetArea?: string;
  }) => {
    if (!onRevalidate) return;
    setIsRevalidating(true);
    try {
      await onRevalidate({
        sheetName: next.sheetName ?? preview.selectedSheet,
        columnOverrides: next.columnOverrides ?? overrides,
        targetArea: next.targetArea,
      });
    } finally {
      setIsRevalidating(false);
    }
  };

  const cols = preview.columnMapping.map((m) => m.expectedKey);
  const normalizedRows =
    preview.normalizedPreview && preview.normalizedPreview.length > 0
      ? preview.normalizedPreview
      : preview.validRows.slice(0, 10).map((r) => r.data);

  return (
    <div
      data-testid="import-preview-card"
      style={{
        borderRadius: '1rem',
        border: '1px solid var(--aia-hairline)',
        background: 'var(--aia-surface)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
          <FileSpreadsheet size={15} style={{ color: 'var(--aia-primary)', flexShrink: 0 }} />
          <div
            style={{
              fontSize: '13px',
              fontWeight: 700,
              fontFamily: 'var(--aia-font-display)',
              color: 'var(--aia-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {preview.fileName}
          </div>
          <span
            data-testid="import-entity-badge"
            style={{
              fontSize: '10.5px',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: '9999px',
              background: 'color-mix(in oklab, var(--aia-primary) 12%, var(--aia-inset))',
              color: 'var(--aia-primary)',
            }}
          >
            {getEntityLabel(preview.templateId)}
          </span>
        </div>

        <div
          data-testid="import-summary-counts"
          style={{
            fontSize: '11.5px',
            fontFamily: 'var(--aia-font-mono)',
            fontVariantNumeric: 'tabular-nums',
            color: preview.formatMatched === false ? 'var(--aia-debit)' : 'var(--aia-text-muted)',
          }}
        >
          {preview.totalRows} rows: {preview.validCount} valid, {preview.duplicateCount || 0} duplicates, {preview.invalidCount} errors
        </div>
      </div>

      {/* Multi-sheet selector + Fix mapping toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {preview.sheetNames && preview.sheetNames.length > 1 && onRevalidate && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: 'var(--aia-text-muted)' }}>
              <span>Sheet:</span>
              <select
                data-testid="import-sheet-select"
                aria-label="Select worksheet"
                disabled={isRevalidating}
                value={preview.selectedSheet || preview.sheetNames[0]}
                onChange={(e) => void triggerRevalidate({ sheetName: e.target.value })}
                style={{
                  height: '26px',
                  borderRadius: '8px',
                  border: '1px solid var(--aia-hairline)',
                  background: 'var(--aia-inset)',
                  color: 'var(--aia-text)',
                  fontSize: '11.5px',
                  padding: '0 6px',
                }}
              >
                {preview.sheetNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {preview.headerRowIndex && preview.headerRowIndex > 1 && (
            <span style={{ fontSize: '11px', color: 'var(--aia-text-muted)' }}>
              Header row #{preview.headerRowIndex}
            </span>
          )}
        </div>

        {onRevalidate && (
          <button
            type="button"
            data-testid="import-fix-mapping-toggle"
            onClick={() => setShowMapping((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 9px',
              borderRadius: '8px',
              border: '1px solid var(--aia-hairline)',
              background: showMapping
                ? 'color-mix(in oklab, var(--aia-primary) 12%, var(--aia-surface))'
                : 'var(--aia-inset)',
              color: showMapping ? 'var(--aia-primary)' : 'var(--aia-text-muted)',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <SlidersHorizontal size={12} />
            Fix mapping
          </button>
        )}
      </div>

      {showMapping && (
        <div
          data-testid="import-mapping-panel"
          style={{
            padding: '10px',
            borderRadius: '0.75rem',
            border: '1px solid var(--aia-hairline)',
            background: 'var(--aia-inset)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 600, color: 'var(--aia-text)' }}>
            <Columns3 size={13} />
            <span>Column Mapping ({preview.detectedHeaders.length} detected)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' }}>
            {preview.columnMapping.map((m) => (
              <div key={m.expectedKey} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: m.confidence === 'missing' ? 'var(--aia-debit)' : 'var(--aia-text-muted)',
                  }}
                >
                  {m.expectedLabel}
                </label>
                <select
                  data-testid={`mapping-select-${m.expectedKey}`}
                  aria-label={`Map column for ${m.expectedLabel}`}
                  disabled={isRevalidating || !onRevalidate}
                  value={overrides[m.expectedKey] || '__unmapped__'}
                  onChange={(e) => {
                    const nextOverrides = { ...overrides, [m.expectedKey]: e.target.value };
                    setOverrides(nextOverrides);
                    void triggerRevalidate({ columnOverrides: nextOverrides });
                  }}
                  style={{
                    height: '28px',
                    borderRadius: '8px',
                    border: '1px solid var(--aia-hairline)',
                    background: 'var(--aia-surface)',
                    color: 'var(--aia-text)',
                    fontSize: '11.5px',
                    padding: '0 6px',
                  }}
                >
                  <option value="__unmapped__">— Not mapped —</option>
                  {preview.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.permissionError ? (
        <div
          data-testid="import-permission-error"
          role="alert"
          style={{
            padding: '8px 10px',
            borderRadius: '0.75rem',
            border: '1px solid color-mix(in oklab, var(--aia-debit) 35%, transparent)',
            background: 'color-mix(in oklab, var(--aia-debit) 10%, transparent)',
            color: 'var(--aia-debit)',
            fontSize: '12px',
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {preview.permissionError}
        </div>
      ) : preview.formatMatched === false ? (
        <div
          data-testid="import-format-error"
          role="alert"
          style={{
            padding: '8px 10px',
            borderRadius: '0.75rem',
            border: '1px solid color-mix(in oklab, var(--aia-debit) 35%, transparent)',
            background: 'color-mix(in oklab, var(--aia-debit) 10%, transparent)',
            color: 'var(--aia-debit)',
            fontSize: '12px',
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          Format verification failed for <code>{preview.templateId}</code>.
          {preview.missingRequiredColumns && preview.missingRequiredColumns.length > 0
            ? ` Missing required columns: ${preview.missingRequiredColumns.join(', ')}. Use Fix mapping above.`
            : ' No valid rows matched this format.'}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid var(--aia-hairline)', paddingBottom: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-ai-id="assistant-import-tab-valid"
          onClick={() => setTab('valid')}
          style={{
            padding: '5px 10px',
            borderRadius: '0.65rem',
            border: '1px solid',
            borderColor: tab === 'valid' ? 'transparent' : 'var(--aia-hairline)',
            background: tab === 'valid' ? 'var(--aia-gradient-primary)' : 'var(--aia-inset)',
            color: tab === 'valid' ? 'var(--aia-primary-fg)' : 'var(--aia-text-muted)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Valid ({preview.validCount})
        </button>
        <button
          type="button"
          data-testid="import-tab-normalized"
          onClick={() => setTab('normalized')}
          style={{
            padding: '5px 10px',
            borderRadius: '0.65rem',
            border: '1px solid',
            borderColor: tab === 'normalized' ? 'transparent' : 'var(--aia-hairline)',
            background: tab === 'normalized' ? 'var(--aia-gradient-primary)' : 'var(--aia-inset)',
            color: tab === 'normalized' ? 'var(--aia-primary-fg)' : 'var(--aia-text-muted)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          10-Row Preview
        </button>
        <button
          type="button"
          data-ai-id="assistant-import-tab-errors"
          onClick={() => setTab('errors')}
          style={{
            padding: '5px 10px',
            borderRadius: '0.65rem',
            border: '1px solid',
            borderColor: tab === 'errors' ? 'transparent' : 'var(--aia-hairline)',
            background: tab === 'errors' ? 'var(--aia-debit)' : 'var(--aia-inset)',
            color: tab === 'errors' ? '#ffffff' : 'var(--aia-text-muted)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Errors ({preview.invalidCount})
        </button>
      </div>

      {tab === 'valid' && (
        <div style={{ maxHeight: '180px', overflow: 'auto', border: '1px solid var(--aia-hairline)', borderRadius: '0.75rem' }}>
          {preview.validRows.length === 0 ? (
            <div style={{ padding: '12px', fontSize: '12.5px', color: 'var(--aia-subtle)' }}>
              No valid rows found in this file.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', color: 'var(--aia-text)' }}>
              <thead>
                <tr style={{ background: 'var(--aia-inset)', textAlign: 'left', color: 'var(--aia-text-muted)' }}>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--aia-hairline)' }}>Row</th>
                  {cols.slice(0, 5).map((c) => (
                    <th key={c} style={{ padding: '6px 8px', borderBottom: '1px solid var(--aia-hairline)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.validRows.slice(0, 20).map((r) => (
                  <tr key={r.rowNumber}>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--aia-hairline)', fontFamily: 'var(--aia-font-mono)' }}>
                      {r.rowNumber}
                    </td>
                    {cols.slice(0, 5).map((c) => (
                      <td key={c} style={{ padding: '5px 8px', borderBottom: '1px solid var(--aia-hairline)' }}>
                        {String(r.data[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'normalized' && (
        <div
          data-testid="import-normalized-preview"
          style={{ maxHeight: '180px', overflow: 'auto', border: '1px solid var(--aia-hairline)', borderRadius: '0.75rem' }}
        >
          {normalizedRows.length === 0 ? (
            <div style={{ padding: '12px', fontSize: '12.5px', color: 'var(--aia-subtle)' }}>
              No normalized preview rows available yet.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', color: 'var(--aia-text)' }}>
              <thead>
                <tr style={{ background: 'var(--aia-inset)', textAlign: 'left', color: 'var(--aia-text-muted)' }}>
                  {cols.map((c) => (
                    <th key={c} style={{ padding: '6px 8px', borderBottom: '1px solid var(--aia-hairline)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {normalizedRows.slice(0, 10).map((row, idx) => (
                  <tr key={idx}>
                    {cols.map((c) => (
                      <td key={c} style={{ padding: '5px 8px', borderBottom: '1px solid var(--aia-hairline)' }}>
                        {String(row[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'errors' && (
        <div
          style={{
            maxHeight: '180px',
            overflow: 'auto',
            border: '1px solid color-mix(in oklab, var(--aia-debit) 30%, transparent)',
            borderRadius: '0.75rem',
          }}
        >
          {preview.errors.length === 0 ? (
            <div style={{ padding: '12px', fontSize: '12.5px', color: 'var(--aia-credit)' }}>
              All rows passed validation with zero errors.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr
                  style={{
                    background: 'color-mix(in oklab, var(--aia-debit) 10%, transparent)',
                    textAlign: 'left',
                    color: 'var(--aia-debit)',
                  }}
                >
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--aia-hairline)' }}>Row</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--aia-hairline)' }}>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {preview.errors.map((err) => (
                  <tr key={err.rowNumber}>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--aia-hairline)', fontFamily: 'var(--aia-font-mono)', color: 'var(--aia-text)' }}>
                      {err.rowNumber}
                    </td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--aia-hairline)', color: 'var(--aia-debit)' }}>
                      {err.reasons.join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {status === 'submitting' && (
        <div data-testid="import-progress-wrap" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '11.5px', color: 'var(--aia-text-muted)' }}>
            Importing {preview.validCount} validated rows ({importProgress}%)…
          </div>
          <div className="aia-att-progress" role="progressbar" aria-valuenow={importProgress} aria-valuemin={0} aria-valuemax={100}>
            <div className="aia-att-progress-bar" style={{ width: `${importProgress}%` }} />
          </div>
        </div>
      )}

      {feedback && (
        <div style={{ fontSize: '12.5px', fontWeight: 600, color: status === 'executed' ? 'var(--aia-credit)' : 'var(--aia-text-muted)' }}>
          {feedback.replace(/\*\*/g, '')}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {status === 'pending' && preview.formatMatched !== false && preview.validCount > 0 && (
            <>
              <button
                type="button"
                data-ai-id="assistant-import-confirm-btn"
                data-testid="import-confirm-btn"
                data-sensitive="true"
                disabled={isRevalidating}
                onClick={handleConfirm}
                style={{
                  padding: '7px 14px',
                  borderRadius: '0.75rem',
                  border: 'none',
                  background: 'var(--aia-gradient-primary)',
                  color: 'var(--aia-primary-fg)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  boxShadow: 'var(--aia-shadow-glow)',
                  cursor: isRevalidating ? 'wait' : 'pointer',
                }}
              >
                Confirm Import ({preview.validCount})
              </button>
              <button
                type="button"
                data-ai-id="assistant-import-cancel-btn"
                onClick={handleCancel}
                style={{
                  padding: '7px 12px',
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
          {status === 'executed' && onUndo && (
            <button
              type="button"
              data-ai-id="assistant-import-undo-btn"
              data-testid="import-undo-btn"
              data-sensitive="true"
              onClick={handleUndo}
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
              Undo Import
            </button>
          )}
        </div>

        {preview.invalidCount > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {onDownloadErrorXlsx && (
              <button
                type="button"
                data-testid="import-errors-xlsx-btn"
                onClick={onDownloadErrorXlsx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 10px',
                  borderRadius: '0.75rem',
                  border: '1px solid color-mix(in oklab, var(--aia-debit) 30%, transparent)',
                  background: 'color-mix(in oklab, var(--aia-debit) 10%, transparent)',
                  color: 'var(--aia-debit)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Download size={13} />
                Error Report (.xlsx)
              </button>
            )}
            <button
              type="button"
              data-ai-id="assistant-import-errors-csv-btn"
              onClick={onDownloadErrorCsv}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                borderRadius: '0.75rem',
                border: '1px solid var(--aia-hairline)',
                background: 'var(--aia-inset)',
                color: 'var(--aia-text-muted)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Download size={13} />
              CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
