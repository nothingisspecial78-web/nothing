import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface AttachmentLightboxProps {
  src: string;
  alt: string;
  subtitle?: string;
  onClose: () => void;
}

export function AttachmentLightbox({ src, alt, subtitle, onClose }: AttachmentLightboxProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="aia-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${alt}`}
      data-testid="attachment-lightbox"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="aia-lightbox-dialog">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--aia-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {alt}
            </div>
            {subtitle && (
              <div style={{ fontSize: '11px', color: 'var(--aia-text-muted)' }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            data-testid="attachment-lightbox-close"
            aria-label="Close image preview"
            onClick={onClose}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '9999px',
              border: '1px solid var(--aia-hairline)',
              background: 'var(--aia-inset)',
              color: 'var(--aia-text)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div
          style={{
            overflow: 'auto',
            borderRadius: '12px',
            background: 'var(--aia-inset)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxHeight: '72dvh',
          }}
        >
          <img
            src={src}
            alt={alt}
            style={{
              maxWidth: '100%',
              maxHeight: '72dvh',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>
      </div>
    </div>
  );
}
