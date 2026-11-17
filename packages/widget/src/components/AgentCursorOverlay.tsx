import React, { useEffect, useRef, useState } from 'react';
import type { CursorWaypoint } from '@ai-assistant/core';

interface CursorFrame {
  x: number;
  y: number;
  label: string;
  clicking: boolean;
  highlightRect?: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

function findWaypointElement(wp: CursorWaypoint): Element | null {
  if (wp.selector) {
    const candidates = Array.from(document.querySelectorAll(wp.selector)).filter(
      (el) => !el.closest('.aia-root')
    );
    if (wp.textMatch) {
      const needle = wp.textMatch.toLowerCase();
      const textHit = candidates.find((el) => (el.textContent || '').toLowerCase().includes(needle));
      if (textHit) return textHit;
    }
    const visibleHit = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visibleHit) return visibleHit;
  }

  if (wp.textMatch) {
    const needle = wp.textMatch.toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll('a, button, h1, h2, h3, .glass, tr, td')
    ).filter((el) => !el.closest('.aia-root'));
    const found = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (el.textContent || '').toLowerCase().includes(needle);
    });
    if (found) return found;
  }

  return null;
}

export interface AgentCursorOverlayProps {
  appName?: string;
  onActiveChange?: (active: boolean) => void;
}

export function AgentCursorOverlay({
  appName = 'App',
  onActiveChange,
}: AgentCursorOverlayProps) {
  const [frame, setFrame] = useState<CursorFrame | null>(null);
  const runIdRef = useRef(0);
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;

  useEffect(() => {
    onActiveChangeRef.current?.(Boolean(frame));
  }, [frame]);

  useEffect(() => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const handleWaypoints = (e: Event) => {
      const detail = (e as CustomEvent<{ waypoints?: CursorWaypoint[]; label?: string }>).detail;
      const waypoints = Array.isArray(detail?.waypoints) ? detail.waypoints : [];
      if (waypoints.length === 0) return;

      const myRunId = ++runIdRef.current;

      void (async () => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let curX = Math.max(40, vw - 140);
        let curY = Math.max(40, vh - 140);

        for (let i = 0; i < waypoints.length; i += 1) {
          if (runIdRef.current !== myRunId) return;
          const wp = waypoints[i];

          let el = findWaypointElement(wp);
          if (!el) {
            await sleep(160);
            if (runIdRef.current !== myRunId) return;
            el = findWaypointElement(wp);
          }

          let targetX = curX;
          let targetY = curY;
          let highlightRect: CursorFrame['highlightRect'];

          if (el) {
            const rect = el.getBoundingClientRect();
            targetX = Math.max(24, Math.min(vw - 48, rect.left + rect.width * 0.5));
            targetY = Math.max(24, Math.min(vh - 48, rect.top + rect.height * 0.5));
            highlightRect = {
              top: Math.max(4, rect.top - 3),
              left: Math.max(4, rect.left - 3),
              width: Math.min(vw - 8, rect.width + 6),
              height: Math.min(vh - 8, rect.height + 6),
            };
          } else {
            // Fallback glide toward main content top-center so animation remains legible
            targetX = Math.round(vw * (0.32 + i * 0.08));
            targetY = Math.round(Math.min(vh * 0.42, 180 + i * 48));
          }

          curX = targetX;
          curY = targetY;

          setFrame({
            x: targetX,
            y: targetY,
            label: wp.label || detail.label || 'Acting…',
            clicking: false,
            highlightRect,
          });

          await sleep(240);
          if (runIdRef.current !== myRunId) return;

          setFrame({
            x: targetX,
            y: targetY,
            label: wp.label || detail.label || 'Acting…',
            clicking: true,
            highlightRect,
          });

          await sleep(280);
        }

        await sleep(320);
        if (runIdRef.current === myRunId) {
          setFrame(null);
        }
      })();
    };

    window.addEventListener('aia:cursor-waypoints', handleWaypoints);
    return () => {
      runIdRef.current += 1;
      onActiveChangeRef.current?.(false);
      window.removeEventListener('aia:cursor-waypoints', handleWaypoints);
    };
  }, []);

  if (!frame) return null;

  const displayAppName = appName.trim() || 'App';

  return (
    <div
      aria-hidden="true"
      data-testid="agent-cursor-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2147483009,
      }}
    >
      {frame.highlightRect && (
        <div
          style={{
            position: 'fixed',
            top: `${frame.highlightRect.top}px`,
            left: `${frame.highlightRect.left}px`,
            width: `${frame.highlightRect.width}px`,
            height: `${frame.highlightRect.height}px`,
            borderRadius: '12px',
            border: '2px solid #f97316',
            background: frame.clicking ? 'rgba(249, 115, 22, 0.14)' : 'rgba(249, 115, 22, 0.06)',
            boxShadow: '0 0 0 4px rgba(249, 115, 22, 0.16)',
            transition: 'all 180ms ease-out',
          }}
        />
      )}

      <div
        style={{
          position: 'fixed',
          top: `${frame.y}px`,
          left: `${frame.x}px`,
          transform: 'translate(-4px, -4px)',
          transition: 'top 220ms cubic-bezier(0.22, 1, 0.36, 1), left 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
        }}
      >
        <div style={{ position: 'relative' }}>
          {frame.clicking && (
            <span
              style={{
                position: 'absolute',
                top: '-6px',
                left: '-6px',
                width: '24px',
                height: '24px',
                borderRadius: '999px',
                border: '2px solid #f97316',
                background: 'rgba(249, 115, 22, 0.25)',
                animation: 'aia-ripple 450ms ease-out forwards',
              }}
            />
          )}
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            style={{
              filter: 'drop-shadow(0 4px 8px rgba(15, 23, 42, 0.35))',
              transform: frame.clicking ? 'scale(0.88)' : 'scale(1)',
              transition: 'transform 120ms ease',
            }}
          >
            <path
              d="M4.5 3.5L23.5 11.2L15.1 14.4L11.8 22.8L4.5 3.5Z"
              fill="#f97316"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '4px',
          }}
        >
          <span
            data-testid="agent-cursor-app-pill"
            className="aia-cursor-name-pill aia-cursor-name-pill-agent"
            style={{ position: 'static' }}
          >
            {displayAppName}
          </span>
          {frame.label && (
            <div
              style={{
                padding: '3px 9px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.9)',
                color: '#ffffff',
                border: '1px solid rgba(249, 115, 22, 0.35)',
                fontSize: '11px',
                fontWeight: 600,
                fontFamily: 'var(--aia-font-sans)',
                whiteSpace: 'nowrap',
                boxShadow: '0 8px 20px rgba(15, 23, 42, 0.3)',
              }}
            >
              {frame.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
