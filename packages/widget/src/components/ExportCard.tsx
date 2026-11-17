import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
} from 'lucide-react';
import type { ExportFormat, ExportFilePayload } from '@ai-assistant/core';
import { downloadExportFile, formatExportCellValue } from '../utils/clientExport.ts';

export interface ExportCardProps {
  exportFile: ExportFilePayload;
  apiUrl?: string;
  onDownloaded?: (exportFile: ExportFilePayload) => void;
}

const EXPORT_BUTTONS: Array<{ format: 'xlsx' | 'pdf' | 'csv' | 'docx'; label: string }> = [
  { format: 'xlsx', label: 'Excel (.xlsx)' },
  { format: 'pdf', label: 'PDF' },
  { format: 'csv', label: 'CSV' },
  { format: 'docx', label: 'Word (.docx)' },
];

function swapFilenameExtension(filename: string, nextFormat: ExportFormat): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, '') || 'export';
  return `${base}.${nextFormat}`;
}

export function ExportCard({ exportFile, apiUrl = '', onDownloaded }: ExportCardProps) {
  const [generatingFormat, setGeneratingFormat] = useState<ExportFormat | null>(null);
  const [downloadedFormats, setDownloadedFormats] = useState<Set<ExportFormat>>(() => new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const previewRows =
    exportFile.previewRows && exportFile.previewRows.length > 0
      ? exportFile.previewRows.slice(0, 5)
      : exportFile.rows.slice(0, 5);

  const handleDownloadFormat = async (format: ExportFormat) => {
    if (generatingFormat) return;
    setGeneratingFormat(format);
    setErrorMsg(null);
    const payload: ExportFilePayload = {
      ...exportFile,
      format,
      filename: swapFilenameExtension(exportFile.filename, format),
    };
    try {
      await downloadExportFile(payload, { apiUrl });
      setDownloadedFormats((prev) => new Set(prev).add(format));
      onDownloaded?.(payload);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate export file.');
    } finally {
      setGeneratingFormat(null);
    }
  };

  const isSpreadsheet = exportFile.format === 'xlsx' || exportFile.format === 'csv';
  const summaryLabel = `${exportFile.exportedRows} ${exportFile.exportedRows === 1 ? 'record' : 'records'} · ${exportFile.columns.length} ${exportFile.columns.length === 1 ? 'column' : 'columns'}`;

  return (
    <div
      role="region"
      aria-label={`Export options for ${exportFile.title}`}
      data-testid="export-file-card"
      className="aia-export-card"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: 'color-mix(in oklab, var(--aia-primary) 13%, var(--aia-inset))',
              color: 'var(--aia-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {isSpreadsheet ? <FileSpreadsheet size={17} /> : <FileText size={17} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              data-testid="export-filename"
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                fontFamily: 'var(--aia-font-display)',
                color: 'var(--aia-text)',
                overflowWrap: 'anywhere',
                lineHeight: 1.3,
              }}
              title={exportFile.filename}
            >
              {exportFile.filename}
            </div>
            <div
              data-testid="export-summary"
              style={{
                fontSize: '11.5px',
                color: 'var(--aia-text-muted)',
                marginTop: '1px',
              }}
            >
              {exportFile.summaryLine || summaryLabel}
            </div>
          </div>
        </div>

        {previewRows.length > 0 && (
          <button
            type="button"
            data-testid="export-toggle-preview-btn"
            onClick={() => setShowPreview((v) => !v)}
            aria-expanded={showPreview}
            aria-label={showPreview ? 'Hide preview' : 'Preview rows'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              border: 'none',
              background: 'transparent',
              color: 'var(--aia-text-muted)',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              flexShrink: 0,
              padding: '3px 6px',
              borderRadius: '8px',
            }}
          >
            <span>Preview</span>
            {showPreview ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      {exportFile.truncated && (
        <div
          data-testid="export-truncation-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 9px',
            borderRadius: '10px',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            color: '#b45309',
            fontSize: '11.5px',
            fontWeight: 500,
          }}
        >
          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
          <span>
            Export capped at first {exportFile.exportedRows.toLocaleString()} of{' '}
            {exportFile.totalRows.toLocaleString()} matching rows.
          </span>
        </div>
      )}

      {showPreview && previewRows.length > 0 && (
        <div
          data-testid="export-preview-table"
          style={{
            borderRadius: '12px',
            border: '1px solid var(--aia-hairline)',
            background: 'var(--aia-inset)',
            overflowX: 'auto',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '11.5px',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr>
                {exportFile.columns.map((col) => (
                  <th
                    key={col.key}
                    style={{
                      padding: '6px 8px',
                      fontWeight: 600,
                      color: 'var(--aia-text)',
                      borderBottom: '1px solid var(--aia-hairline)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {exportFile.columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: '5px 8px',
                        color: 'var(--aia-text-muted)',
                        borderBottom:
                          rIdx < previewRows.length - 1 ? '1px solid var(--aia-hairline)' : 'none',
                        whiteSpace: 'nowrap',
                        maxWidth: '170px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        textAlign: col.format === 'currency' ? 'right' : 'left',
                      }}
                    >
                      {formatExportCellValue(row[col.key], col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errorMsg && (
        <div style={{ fontSize: '11.5px', color: 'var(--aia-debit)', fontWeight: 500 }}>
          {errorMsg}
        </div>
      )}

      {/* 4 one-tap format download buttons */}
      <div
        data-testid="export-format-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        {EXPORT_BUTTONS.map((btn) => {
          const isBusy = generatingFormat === btn.format;
          const isDone = downloadedFormats.has(btn.format);
          const isPreferred = exportFile.format === btn.format;
          return (
            <button
              key={btn.format}
              type="button"
              data-testid={`export-format-btn-${btn.format}`}
              data-preferred={isPreferred ? 'true' : undefined}
              data-format={btn.format}
              data-ai-id={`assistant-export-download-${exportFile.exportId}-${btn.format}`}
              disabled={generatingFormat !== null}
              onClick={() => void handleDownloadFormat(btn.format)}
              aria-label={`Download ${btn.label}`}
              className={`aia-export-format-btn ${isPreferred ? 'is-primary' : ''}`}
            >
              {isBusy ? (
                <Loader2 size={12} className="aia-spin" />
              ) : isDone ? (
                <Check size={12} />
              ) : (
                <Download size={12} />
              )}
              <span>{btn.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
