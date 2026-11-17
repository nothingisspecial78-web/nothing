import React, { useEffect, useRef, useState } from 'react';

export interface UserCursorOverlayProps {
  enabled?: boolean;
  label?: string;
}

/**
 * Renders the user's own mouse pointer in the exact same vector pointer style
 * as the AI agent cursor, tagged with a "You" name pill.
 * Uses direct DOM transforms on pointermove for zero React re-render overhead.
 */
export function UserCursorOverlay({
  enabled = true,
  label = 'You',
}: UserCursorOverlayProps) {
  const pointerRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<{ x: number; y: number }>({ x: -100, y: -100 });
  const rafRef = useRef<number>(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!enabled) {
      document.documentElement.classList.remove('aia-custom-user-cursor');
      setVisible(false);
      return;
    }

    const isFinePointer =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: fine)').matches || window.innerWidth >= 768
        : true;
    if (!isFinePointer) return;

    document.documentElement.classList.add('aia-custom-user-cursor');

    const flushPosition = () => {
      rafRef.current = 0;
      const el = pointerRef.current;
      if (!el) return;
      el.style.transform = `translate3d(${Math.round(posRef.current.x)}px, ${Math.round(
        posRef.current.y
      )}px, 0)`;
    };

    const updateCoords = (rawX: number, rawY: number) => {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const x = Math.max(4, Math.min(Math.max(4, vw - 76), rawX));
      const y = Math.max(4, Math.min(Math.max(4, vh - 44), rawY));
      posRef.current = { x, y };
      setVisible((prev) => (prev ? prev : true));
      if (!rafRef.current) {
        rafRef.current = window.requestAnimationFrame(flushPosition);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        document.documentElement.classList.remove('aia-custom-user-cursor');
        setVisible(false);
        return;
      }
      document.documentElement.classList.add('aia-custom-user-cursor');
      updateCoords(e.clientX, e.clientY);
    };

    const onMouseMove = (e: MouseEvent) => {
      updateCoords(e.clientX, e.clientY);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointerRef.current?.setAttribute('data-pressed', 'true');
      updateCoords(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      pointerRef.current?.removeAttribute('data-pressed');
    };

    const onMouseLeave = () => {
      setVisible(false);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave);

    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      document.documentElement.classList.remove('aia-custom-user-cursor');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      aria-hidden="true"
      className="aia-user-cursor-root"
      data-testid="user-cursor-overlay"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        ref={pointerRef}
        data-testid="user-svg-pointer"
        className="aia-user-cursor-pointer"
        style={{
          transform: `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)`,
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M4.5 3.5L23.5 11.2L15.1 14.4L11.8 22.8L4.5 3.5Z"
            fill="#2563eb"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <span className="aia-cursor-name-pill aia-cursor-name-pill-you" data-testid="user-cursor-pill">
          {label}
        </span>
      </div>
    </div>
  );
}
