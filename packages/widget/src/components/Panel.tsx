import React, { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  History,
  Maximize2,
  Minimize2,
  MoreVertical,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  X,
} from 'lucide-react';
import type { WidgetBillingStatus } from '@ai-assistant/core';

export interface PanelProps {
  open: boolean;
  title: string;
  position?: 'right' | 'left';
  rtl?: boolean;
  inspecting?: boolean;
  mobileMode?: 'compact' | 'full';
  billingStatus?: WidgetBillingStatus | null;
  onUpgradeClick?: () => void;
  onMobileModeChange?: (mode: 'compact' | 'full') => void;
  onToggleInspect?: () => void;
  onOpenHistory?: () => void;
  onOpenPersonalize?: () => void;
  onNewChat?: () => void;
  onEffectiveWidthChange?: (width: number) => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function Panel({
  open,
  title,
  position = 'right',
  rtl = false,
  inspecting = false,
  mobileMode = 'compact',
  billingStatus,
  onUpgradeClick,
  onMobileModeChange,
  onToggleInspect,
  onOpenHistory,
  onOpenPersonalize,
  onNewChat,
  onEffectiveWidthChange,
  onClose,
  children,
}: PanelProps) {
  const [width, setWidth] = useState(420);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const draggingRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchLastYRef = useRef<number | null>(null);
  const effectiveWidth = collapsed ? 344 : width;

  useEffect(() => {
    onEffectiveWidthChange?.(open ? effectiveWidth : 0);
  }, [open, effectiveWidth, onEffectiveWidthChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const raw = position === 'right' ? window.innerWidth - e.clientX : e.clientX;
      setWidth(Math.max(340, Math.min(720, raw)));
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [position]);

  // Close overflow menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
    touchLastYRef.current = touchStartYRef.current;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      touchLastYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = () => {
    if (touchStartYRef.current === null || touchLastYRef.current === null) return;
    const deltaY = touchLastYRef.current - touchStartYRef.current;
    touchStartYRef.current = null;
    touchLastYRef.current = null;

    if (deltaY < -36) {
      onMobileModeChange?.('full');
    } else if (deltaY > 36) {
      if (mobileMode === 'full') {
        onMobileModeChange?.('compact');
      } else {
        onClose();
      }
    }
  };

  if (!open) return null;

  return (
    <aside
      role="dialog"
      aria-label={title}
      dir={rtl ? 'rtl' : 'ltr'}
      data-testid="assistant-panel"
      data-mobile-mode={mobileMode}
      className={`aia-panel ${position === 'left' ? 'aia-left' : ''} ${
        mobileMode === 'compact' ? 'aia-panel-compact' : 'aia-panel-full'
      }`}
      style={{
        width: `${effectiveWidth}px`,
        [position]: '12px',
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant panel"
        className="aia-resize-handle"
        style={{ [position === 'right' ? 'left' : 'right']: 0 }}
        onMouseDown={() => {
          draggingRef.current = true;
        }}
      />

      {/* Mobile swipe handle pill */}
      <div
        data-testid="mobile-sheet-handle"
        className="aia-mobile-handle"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => onMobileModeChange?.(mobileMode === 'compact' ? 'full' : 'compact')}
        title={mobileMode === 'compact' ? 'Swipe up or tap for full chat history' : 'Swipe down to compact'}
      >
        <span className="aia-mobile-handle-bar" />
      </div>

      {/* Slim minimal Gemini-style header */}
      <header
        className="aia-header"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="aia-header-brand">
          <span aria-hidden="true" className="aia-header-logo">
            <Sparkles size={13} />
          </span>
          <h2 className="aia-header-title">{title}</h2>
        </div>

        <div ref={menuRef} className="aia-header-actions">
          {billingStatus && billingStatus.role !== 'PUBLIC' && (
            billingStatus.effectivePlan === 'premium' ? (
              <button
                type="button"
                data-testid="billing-credit-pill"
                data-ai-id="assistant-billing-pill"
                className={`aia-credit-pill is-premium ${!billingStatus.isAdmin ? 'is-static' : ''}`}
                onClick={billingStatus.isAdmin ? onUpgradeClick : undefined}
                title={billingStatus.isAdmin ? 'Manage Premium plan' : 'Organization Premium plan active'}
              >
                <Sparkles size={11} />
                <span>Premium · Unlimited</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="billing-credit-pill"
                data-ai-id="assistant-billing-pill"
                className={`aia-credit-pill ${billingStatus.creditsRemaining <= 15 ? 'is-low' : ''} ${!billingStatus.isAdmin ? 'is-static' : ''}`}
                onClick={billingStatus.isAdmin ? onUpgradeClick : undefined}
                title={
                  billingStatus.isAdmin
                    ? 'Organization AI credits remaining this month — click to upgrade'
                    : 'Free plan is Admin-only'
                }
              >
                <span>
                  {billingStatus.isAdmin
                    ? `${billingStatus.creditsRemaining} / ${billingStatus.creditsMonthlyAllowance} credits`
                    : 'Free · Admin only'}
                </span>
              </button>
            )
          )}

          <button
            type="button"
            data-testid="header-overflow-btn"
            data-ai-id="assistant-overflow-btn"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="More options"
            title="More options"
            className={`aia-ghost-btn ${menuOpen ? 'aia-active' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreVertical size={17} />
          </button>

          {menuOpen && (
            <div role="menu" data-testid="header-overflow-menu" className="aia-overflow-menu">
              {onNewChat && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="new-chat-btn"
                  data-ai-id="assistant-new-chat-btn"
                  className="aia-overflow-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewChat();
                  }}
                >
                  <SquarePen size={14} />
                  <span>New chat</span>
                </button>
              )}
              {onOpenHistory && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="history-btn"
                  data-ai-id="assistant-history-btn"
                  className="aia-overflow-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenHistory();
                  }}
                >
                  <History size={14} />
                  <span>Chat history</span>
                </button>
              )}
              {onOpenPersonalize && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="personalize-btn"
                  data-ai-id="assistant-personalize-btn"
                  className="aia-overflow-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenPersonalize();
                  }}
                >
                  <SlidersHorizontal size={14} />
                  <span>Personalize AI</span>
                </button>
              )}
              {onToggleInspect && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="cursor-denoter-header"
                  data-ai-id="assistant-inspect-btn"
                  aria-pressed={inspecting}
                  className="aia-overflow-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleInspect();
                  }}
                >
                  <Crosshair size={14} />
                  <span>{inspecting ? 'Cancel card selection' : 'Select a card on page'}</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                data-testid="panel-width-btn"
                data-ai-id="assistant-collapse-btn"
                className="aia-overflow-item aia-desktop-only"
                onClick={() => {
                  setMenuOpen(false);
                  setCollapsed((c) => !c);
                }}
              >
                {collapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                <span>{collapsed ? 'Expand panel width' : 'Compact panel width'}</span>
              </button>
            </div>
          )}

          <button
            type="button"
            data-testid="close-panel-btn"
            data-ai-id="assistant-close-btn"
            onClick={onClose}
            aria-label="Close assistant panel"
            title="Close"
            className="aia-ghost-btn"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="aia-panel-body">{children}</div>
    </aside>
  );
}
