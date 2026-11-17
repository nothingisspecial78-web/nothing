import React, { useState } from 'react';
import { Upload } from 'lucide-react';

export interface FileDropProps {
  onDropFiles: (files: FileList) => void;
  children: React.ReactNode;
}

export function FileDrop({ onDropFiles, children }: FileDropProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
    >
      {children}
      {dragging && (
        <div
          data-testid="file-drop-overlay"
          style={{
            position: 'absolute',
            inset: '8px',
            borderRadius: '14px',
            border: '2px dashed var(--aia-primary)',
            background: 'color-mix(in oklab, var(--aia-surface-strong) 94%, var(--aia-primary) 6%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            zIndex: 20,
            pointerEvents: 'none',
            color: 'var(--aia-primary)',
            textAlign: 'center',
            padding: '16px',
          }}
        >
          <Upload size={24} />
          <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
            Drop images, PDFs, Word docs, or Excel/CSV to attach
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--aia-text-muted)' }}>
            Files stage in the Composer first (up to 5 files, 10 MB each)
          </div>
        </div>
      )}
    </div>
  );
}
