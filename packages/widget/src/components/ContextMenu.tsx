import React, { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { RightClickContext } from '@ai-assistant/core';
import { useContextCapture } from '../hooks/useContextCapture.ts';

export interface ContextMenuProps {
  enabled: boolean;
  onAskAboutElement: (context: RightClickContext) => void;
}

export function ContextMenu({ enabled, onAskAboutElement }: ContextMenuProps) {
  const captureContext = useContextCapture();
  const [menuState, setMenuState] = useState<{
    x: number;
    y: number;
    context: RightClickContext;
  } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMenuState(null);
      return;
    }

    const handleContextMenu = (e: MouseEvent) => {
      // Hold Shift+RightClick to access native browser menu, or allow native menu inside assistant panel
      if (e.shiftKey) return;
      const target = e.target as Element | null;
      if (target?.closest('[data-testid="assistant-panel"], .aia-ctx-menu')) {
        return;
      }

      e.preventDefault();
      const ctx = captureContext(e.target);
      const maxX = Math.max(8, window.innerWidth - 210);
      const maxY = Math.max(8, window.innerHeight - 60);
      setMenuState({
        x: Math.min(e.clientX, maxX),
        y: Math.min(e.clientY, maxY),
        context: ctx,
      });
    };

    const dismiss = () => setMenuState(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuState(null);
    };

    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('click', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('click', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, captureContext]);

  if (!menuState) return null;

  return (
    <div
      role="menu"
      aria-label="AI Assistant context menu"
      className="aia-ctx-menu"
      style={{ left: `${menuState.x}px`, top: `${menuState.y}px` }}
    >
      <button
        type="button"
        role="menuitem"
        data-ai-id="assistant-context-ask-btn"
        className="aia-ctx-btn"
        onClick={(e) => {
          e.stopPropagation();
          const captured = menuState.context;
          setMenuState(null);
          onAskAboutElement(captured);
        }}
      >
        <MessageSquare size={14} />
        <span>Ask AI about this</span>
      </button>
    </div>
  );
}
