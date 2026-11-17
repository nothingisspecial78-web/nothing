import React, { useEffect, useState } from 'react';
import { Crosshair, X } from 'lucide-react';
import type { RightClickContext } from '@ai-assistant/core';
import { useContextCapture } from '../hooks/useContextCapture.ts';

export interface CursorInspectorProps {
  active: boolean;
  onCancel: () => void;
  onSelectElement: (context: RightClickContext) => void;
}

interface HoverBox {
  top: number;
  left: number;
  width: number;
  height: number;
  tag: string;
  label?: string;
}

function isReasonableCuboidSize(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 72 || rect.height < 44) return false;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  if (rect.width > vw * 0.92 && rect.height > vh * 0.85) return false;
  return true;
}

function hasCardAppearance(el: Element): boolean {
  if (el.matches('.glass, .glass-inset, .tile-glossy, [data-card], [data-cuboid], article, tr, nav')) {
    return true;
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'section' || tag === 'form' || tag === 'aside' || tag === 'header' || tag === 'footer') {
    return true;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'grid' && el.children.length > 1) {
    // Grid wrappers hold sibling cuboids; keep walking or pick the direct grid child instead
    return false;
  }
  const radius = parseFloat(style.borderTopLeftRadius || '0');
  const hasBorder = parseFloat(style.borderTopWidth || '0') > 0 && style.borderTopColor !== 'rgba(0, 0, 0, 0)';
  const hasShadow = style.boxShadow && style.boxShadow !== 'none';
  const hasBg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
  return radius >= 8 && (hasBorder || Boolean(hasShadow) || Boolean(hasBg));
}

export function resolveInspectTarget(rawTarget: EventTarget | null): Element | null {
  if (!(rawTarget instanceof Element)) return null;
  if (rawTarget.closest('.aia-root, .aia-inspector-overlay')) return null;

  // Priority 1: Snap directly to the closest enclosing Khazna cuboid/card container
  const explicitCard = rawTarget.closest(
    '.glass, .glass-inset, .tile-glossy, [data-card], [data-cuboid], article, tr, form, nav'
  );
  if (explicitCard && explicitCard !== document.body && isReasonableCuboidSize(explicitCard)) {
    return explicitCard;
  }

  // Priority 2: Walk upward to find nearest parent container with cuboid/card styling
  let cur: Element | null = rawTarget;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase();
    if (
      tag !== 'span' &&
      tag !== 'strong' &&
      tag !== 'em' &&
      tag !== 'svg' &&
      tag !== 'path' &&
      tag !== 'circle' &&
      tag !== 'rect' &&
      tag !== 'line' &&
      tag !== 'p' &&
      tag !== 'h1' &&
      tag !== 'h2' &&
      tag !== 'h3' &&
      tag !== 'h4' &&
      isReasonableCuboidSize(cur) &&
      hasCardAppearance(cur)
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }

  // Fallback: closest non-inline parent div/section/li/button
  return rawTarget.closest('section, li, button, a, div') || rawTarget;
}

export function CursorInspector({ active, onCancel, onSelectElement }: CursorInspectorProps) {
  const captureContext = useContextCapture();
  const [hoverBox, setHoverBox] = useState<HoverBox | null>(null);

  useEffect(() => {
    if (!active) {
      setHoverBox(null);
      document.body.classList.remove('aia-inspect-cursor');
      return;
    }

    document.body.classList.add('aia-inspect-cursor');

    const updateHighlight = (el: Element | null) => {
      if (!el || el === document.body || el === document.documentElement) {
        setHoverBox(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setHoverBox(null);
        return;
      }
      const previewLabel =
        el.getAttribute('aria-label') ||
        el.querySelector('h1, h2, h3, h4, legend, .uppercase')?.textContent?.trim() ||
        el.textContent?.replace(/\s+/g, ' ').trim();

      setHoverBox({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        tag: el.tagName.toLowerCase(),
        label: previewLabel ? previewLabel.slice(0, 44) : undefined,
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      const target = resolveInspectTarget(e.target);
      updateHighlight(target);
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('.aia-root')) {
        return;
      }
      const resolved = resolveInspectTarget(e.target);
      if (!resolved) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const ctx = captureContext(resolved);
      setHoverBox(null);
      onSelectElement(ctx);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setHoverBox(null);
        onCancel();
      }
    };

    const handleScroll = () => setHoverBox(null);

    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.body.classList.remove('aia-inspect-cursor');
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [active, captureContext, onCancel, onSelectElement]);

  if (!active) return null;

  return (
    <>
      {hoverBox && (
        <div
          aria-hidden="true"
          className="aia-inspector-overlay"
          style={{
            position: 'fixed',
            top: `${hoverBox.top}px`,
            left: `${hoverBox.left}px`,
            width: `${hoverBox.width}px`,
            height: `${hoverBox.height}px`,
            border: '2px solid var(--aia-primary, #f97316)',
            background: 'rgba(249, 115, 22, 0.12)',
            borderRadius: '14px',
            pointerEvents: 'none',
            zIndex: 2147482998,
            transition: 'all 75ms ease-out',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: hoverBox.top > 28 ? '-26px' : '4px',
              left: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 9px',
              borderRadius: '8px',
              background: 'rgba(15, 23, 42, 0.92)',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: 'var(--aia-font-mono)',
              whiteSpace: 'nowrap',
              maxWidth: '280px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              boxShadow: '0 6px 16px rgba(15, 23, 42, 0.25)',
            }}
          >
            <span style={{ color: '#fdba74' }}>Cuboid</span>
            {hoverBox.label && <span>{hoverBox.label}</span>}
          </div>
        </div>
      )}

      <div
        role="status"
        data-testid="cursor-inspector-hud"
        className="aia-inspector-hud"
      >
        <Crosshair size={15} style={{ color: '#fb923c', flexShrink: 0 }} />
        <span>Click any card or cuboid to select it for the AI Assistant</span>
        <button
          type="button"
          data-ai-id="assistant-inspector-esc-btn"
          onClick={onCancel}
          aria-label="Exit cursor inspect mode"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 9px',
            borderRadius: '7px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)',
            color: '#ffffff',
            fontSize: '11.5px',
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={12} />
          Esc
        </button>
      </div>
    </>
  );
}
