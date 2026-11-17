import { WIDGET_THEME_TOKENS_CSS } from './themeTokens.ts';

export const WIDGET_STYLE_ID = 'ai-assistant-widget-styles';

export function ensureWidgetStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(WIDGET_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = WIDGET_STYLE_ID;
  style.textContent = `
    ${WIDGET_THEME_TOKENS_CSS}

    @keyframes aia-ripple {
      0% { transform: scale(0.7); opacity: 0.95; }
      100% { transform: scale(2.1); opacity: 0; }
    }
    @keyframes aia-fade-up {
      0% { opacity: 0; transform: translateY(6px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .aia-root {
      font-family: var(--aia-font-sans);
      color: var(--aia-text);
      box-sizing: border-box;
    }
    .aia-root *, .aia-root *::before, .aia-root *::after {
      box-sizing: border-box;
    }
    .aia-root button:focus-visible,
    .aia-root select:focus-visible,
    .aia-root textarea:focus-visible,
    .aia-root input:focus-visible {
      outline: 2px solid var(--aia-primary);
      outline-offset: 2px;
    }

    /* Main airy Gemini-minimal panel */
    .aia-panel {
      position: fixed;
      top: 12px;
      bottom: 12px;
      z-index: 2147483001;
      display: flex;
      flex-direction: column;
      background: var(--aia-panel-bg);
      contain: layout style;
      border: 1px solid var(--aia-border);
      border-radius: var(--aia-radius-panel);
      box-shadow: var(--aia-shadow-glass);
      overflow: hidden;
      transition: transform var(--aia-transition-base), height var(--aia-transition-base);
    }
    .aia-panel::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: var(--aia-panel-glow);
      z-index: 0;
    }
    .aia-panel-body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 1;
      background: transparent;
    }

    /* Slim minimal header */
    .aia-header {
      position: relative;
      z-index: 6;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px 8px;
      background: var(--aia-header-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      flex-shrink: 0;
    }
    .aia-header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .aia-header-logo {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 9999px;
      background: var(--aia-gradient-primary);
      color: var(--aia-primary-fg);
      flex-shrink: 0;
    }
    .aia-header-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      font-family: var(--aia-font-display);
      color: var(--aia-text);
      letter-spacing: -0.015em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .aia-header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
      position: relative;
    }
    .aia-ghost-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      border: none;
      background: transparent;
      color: var(--aia-text-muted);
      cursor: pointer;
      transition: background-color var(--aia-transition-fast), color var(--aia-transition-fast);
    }
    .aia-ghost-btn:hover {
      background: var(--aia-inset);
      color: var(--aia-text);
    }
    .aia-ghost-btn.aia-active {
      background: color-mix(in oklab, var(--aia-primary) 14%, transparent);
      color: var(--aia-primary);
    }

    /* Overflow menu (⋮) */
    .aia-overflow-menu {
      position: absolute;
      top: 38px;
      right: 0;
      z-index: 30;
      min-width: 210px;
      background: var(--aia-menu-bg);
      border: 1px solid var(--aia-border);
      border-radius: var(--aia-radius-md);
      padding: 6px;
      box-shadow: var(--aia-shadow-menu);
      animation: aia-fade-up 140ms ease-out;
    }
    .aia-overflow-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 10px;
      border: none;
      background: transparent;
      color: var(--aia-text);
      font-size: 13px;
      font-weight: 500;
      font-family: var(--aia-font-sans);
      text-align: left;
      border-radius: 10px;
      cursor: pointer;
      transition: background-color var(--aia-transition-fast), color var(--aia-transition-fast);
    }
    .aia-overflow-item:hover {
      background: color-mix(in oklab, var(--aia-primary) 10%, transparent);
      color: var(--aia-primary);
    }

    /* Empty greeting & stacked 3 pill chips */
    .aia-empty-stage {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 12px 16px 6px;
      overflow-y: auto;
      min-height: 0;
    }
    .aia-greeting-center {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24px 12px;
      gap: 10px;
      animation: aia-fade-up 220ms ease-out;
    }
    .aia-greeting-sparkle {
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      display: grid;
      place-items: center;
      background: color-mix(in oklab, var(--aia-primary) 12%, var(--aia-surface));
      color: var(--aia-primary);
      border: 1px solid color-mix(in oklab, var(--aia-primary) 22%, transparent);
    }
    .aia-greeting-text {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -0.02em;
      font-family: var(--aia-font-display);
      color: var(--aia-text);
    }

    /* Exactly 3 stacked left-aligned pill suggestion chips above input */
    .aia-chips-stack {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 4px 0 8px;
      flex-shrink: 0;
    }
    .aia-chip-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      max-width: 100%;
      padding: 8px 14px;
      border-radius: var(--aia-radius-pill);
      border: 1px solid var(--aia-chip-border);
      background: var(--aia-chip-bg);
      color: var(--aia-text);
      font-size: 13px;
      font-weight: 500;
      font-family: var(--aia-font-sans);
      line-height: 1.3;
      text-align: left;
      cursor: pointer;
      box-shadow: var(--aia-chip-shadow);
      transition: transform var(--aia-transition-fast), border-color var(--aia-transition-fast), background-color var(--aia-transition-fast), color var(--aia-transition-fast);
    }
    .aia-chip-pill:hover {
      transform: translateY(-1px);
      background: var(--aia-chip-bg-hover);
      border-color: var(--aia-chip-border-hover);
      color: var(--aia-primary);
    }

    /* Rounded Composer Card */
    .aia-composer-wrap {
      padding: 4px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: relative;
      flex-shrink: 0;
      z-index: 4;
    }
    .aia-composer-card {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--aia-composer-border);
      border-radius: var(--aia-radius-card);
      background: var(--aia-composer-bg);
      padding: 10px 12px 9px;
      gap: 8px;
      box-shadow: var(--aia-composer-shadow);
      transition: border-color var(--aia-transition-fast), box-shadow var(--aia-transition-fast);
    }
    .aia-composer-card:focus-within {
      border-color: var(--aia-composer-focus-border);
    }
    .aia-viewing-row {
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }
    .aia-viewing-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      padding: 3px 9px;
      border-radius: var(--aia-radius-pill);
      background: var(--aia-viewing-bg);
      color: var(--aia-text-muted);
      font-size: 11.5px;
      font-weight: 500;
    }
    .aia-viewing-dismiss {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 9999px;
      border: none;
      background: transparent;
      color: var(--aia-subtle);
      cursor: pointer;
      padding: 0;
    }
    .aia-viewing-dismiss:hover {
      color: var(--aia-text);
      background: var(--aia-inset);
    }
    .aia-composer-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      border: none;
      background: var(--aia-inset);
      color: var(--aia-text-muted);
      cursor: pointer;
      transition: background-color var(--aia-transition-fast), color var(--aia-transition-fast);
      flex-shrink: 0;
    }
    .aia-composer-icon-btn:hover {
      background: color-mix(in oklab, var(--aia-primary) 12%, transparent);
      color: var(--aia-primary);
    }

    /* Legacy / Inspector / Utility Classes */
    .aia-mobile-handle {
      display: none;
      width: 100%;
      padding: 8px 0 2px;
      justify-content: center;
      align-items: center;
      cursor: grab;
      touch-action: none;
      flex-shrink: 0;
      z-index: 6;
    }
    .aia-mobile-handle-bar {
      width: 38px;
      height: 4px;
      border-radius: 999px;
      background: color-mix(in oklab, var(--aia-text-muted) 32%, transparent);
    }
    .aia-resize-handle {
      position: absolute;
      top: 16px;
      bottom: 16px;
      width: 6px;
      cursor: col-resize;
      background: transparent;
      z-index: 10;
      border-radius: 999px;
      transition: background-color 150ms ease;
    }
    .aia-resize-handle:hover {
      background: color-mix(in oklab, var(--aia-primary) 25%, transparent);
    }
    .aia-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 31px;
      height: 31px;
      border-radius: 0.72rem;
      border: 1px solid var(--aia-hairline);
      background: var(--aia-inset);
      color: var(--aia-text-muted);
      cursor: pointer;
      transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    .aia-icon-btn:hover {
      background: color-mix(in oklab, var(--aia-primary) 12%, transparent);
      color: var(--aia-text);
      border-color: color-mix(in oklab, var(--aia-primary) 30%, transparent);
    }
    .aia-icon-btn.aia-active {
      background: color-mix(in oklab, var(--aia-primary) 16%, transparent);
      color: var(--aia-primary);
      border-color: color-mix(in oklab, var(--aia-primary) 45%, transparent);
    }
    .aia-ctx-menu {
      position: fixed;
      z-index: 2147483005;
      min-width: 210px;
      background: var(--aia-menu-bg);
      border: 1px solid var(--aia-border);
      border-radius: var(--aia-radius-md);
      padding: 6px;
      box-shadow: var(--aia-shadow-menu);
    }
    .aia-ctx-btn {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 11px;
      border: none;
      background: transparent;
      color: var(--aia-text);
      font-size: 13px;
      font-weight: 500;
      font-family: var(--aia-font-sans);
      text-align: left;
      border-radius: 10px;
      cursor: pointer;
      transition: background-color 140ms ease, color 140ms ease;
    }
    .aia-ctx-btn:hover {
      background: color-mix(in oklab, var(--aia-primary) 12%, transparent);
      color: var(--aia-primary);
    }

    /* Export Card */
    .aia-export-card {
      border-radius: var(--aia-radius-md);
      border: 1px solid var(--aia-hairline);
      background: var(--aia-export-bg);
      padding: 12px 13px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      box-shadow: var(--aia-chip-shadow);
    }
    .aia-export-format-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 6px 10px;
      border-radius: 9999px;
      border: 1px solid var(--aia-hairline);
      background: var(--aia-inset);
      color: var(--aia-text);
      font-size: 11.5px;
      font-weight: 600;
      font-family: var(--aia-font-sans);
      cursor: pointer;
      transition: background-color var(--aia-transition-fast), border-color var(--aia-transition-fast), color var(--aia-transition-fast);
    }
    .aia-export-format-btn:hover:not(:disabled) {
      border-color: color-mix(in oklab, var(--aia-primary) 45%, transparent);
      background: color-mix(in oklab, var(--aia-primary) 10%, var(--aia-surface));
      color: var(--aia-primary);
    }
    .aia-export-format-btn.is-primary {
      border-color: transparent;
      background: var(--aia-gradient-primary);
      color: var(--aia-primary-fg);
      box-shadow: var(--aia-shadow-glow);
    }
    .aia-export-format-btn.is-primary:hover:not(:disabled) {
      filter: brightness(1.06);
      color: var(--aia-primary-fg);
    }
    .aia-export-format-btn:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .aia-inspector-hud {
      position: fixed;
      bottom: 84px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483006;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      border-radius: 1rem;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(249, 115, 22, 0.35);
      color: #ffffff;
      font-size: 12.5px;
      font-weight: 500;
      font-family: var(--aia-font-sans);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.34);
      max-width: calc(100vw - 24px);
    }
    body.aia-inspect-cursor *:not(.aia-root):not(.aia-root *) {
      cursor: crosshair !important;
    }
    .aia-avatar-dock {
      position: fixed;
      bottom: 20px;
      z-index: 2147483002;
      display: inline-flex;
      align-items: flex-end;
      gap: 8px;
      transition: right 220ms cubic-bezier(0.22, 1, 0.36, 1), left 220ms cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }
    .aia-avatar-dock > * {
      pointer-events: auto;
    }
    .aia-avatar-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 4px 6px 8px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 18px;
      transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .aia-avatar-btn:hover {
      transform: translateY(-3px);
    }
    .aia-avatar-btn:focus-visible {
      outline: 2px solid var(--aia-primary);
      outline-offset: 2px;
    }
    .aia-avatar-stage {
      width: 112px;
      height: 118px;
      min-width: 112px;
      min-height: 118px;
      display: block;
      position: relative;
      contain: layout style;
      will-change: transform;
    }
    .aia-avatar-btn.aia-avatar-open .aia-avatar-stage {
      width: 92px;
      height: 98px;
      min-width: 92px;
      min-height: 98px;
    }
    .aia-avatar-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 12px;
      border-radius: 0.65rem;
      background: var(--aia-gradient-primary);
      color: var(--aia-primary-fg);
      border: 1px solid rgba(255, 255, 255, 0.25);
      font-family: var(--aia-font-display);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
      box-shadow: var(--aia-shadow-glow);
      white-space: nowrap;
    }
    @media (max-width: 767px) {
      .aia-avatar-dock {
        bottom: 96px;
        gap: 6px;
      }
      .aia-avatar-stage {
        width: 66px;
        height: 70px;
        min-width: 66px;
        min-height: 70px;
      }
    }
    @media (max-width: 640px) {
      .aia-panel {
        top: auto !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100% !important;
        border-radius: 22px 22px 0 0;
      }
      .aia-panel.aia-panel-compact {
        height: min(68dvh, 540px) !important;
      }
      .aia-panel.aia-panel-full {
        height: 92dvh !important;
      }
      .aia-empty-stage {
        padding: 8px 14px 4px;
      }
      .aia-greeting-center {
        padding: 10px 8px;
        gap: 6px;
      }
      .aia-greeting-text {
        font-size: 17px;
      }
      .aia-chips-stack {
        gap: 6px;
        padding: 2px 0 6px;
      }
      .aia-chip-pill {
        padding: 6px 12px;
        font-size: 12.5px;
      }
      .aia-mobile-handle {
        display: flex;
      }
      .aia-desktop-only {
        display: none !important;
      }
      .aia-resize-handle { display: none; }
      .aia-avatar-dock.aia-dock-open {
        display: none;
      }
      .aia-avatar-stage {
        width: 66px;
        height: 70px;
      }
    }
    @keyframes aia-guide-pulse {
      0%, 100% { stroke-opacity: 0.95; }
      50% { stroke-opacity: 0.45; }
    }
    .aia-guide-root {
      position: fixed;
      inset: 0;
      z-index: 2147483010;
      pointer-events: none;
      user-select: none;
      font-family: var(--aia-font-sans, ui-sans-serif, system-ui, sans-serif);
    }
    .aia-guide-svg, .aia-guide-canvas {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
    }
    .aia-guide-ring {
      animation: aia-guide-pulse 1.8s ease-in-out infinite;
    }
    .aia-guide-caption-wrap {
      position: fixed;
      bottom: 74px;
      left: 16px;
      right: 16px;
      margin: 0 auto;
      max-width: 580px;
      pointer-events: auto;
    }
    .aia-guide-card {
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(15, 23, 42, 0.96);
      padding: 16px 18px;
      color: #f8fafc;
      box-shadow: 0 24px 48px -14px rgba(15, 23, 42, 0.65);
    }
    .aia-guide-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .aia-guide-step-meta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #fb923c;
    }
    .aia-guide-privacy-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 9999px;
      background: rgba(245, 158, 11, 0.18);
      border: 1px solid rgba(245, 158, 11, 0.42);
      color: #fcd34d;
      font-size: 11px;
      font-weight: 600;
    }
    .aia-guide-instruction {
      font-size: 14.5px;
      font-weight: 500;
      line-height: 1.55;
      color: #f1f5f9;
    }
    .aia-guide-banner {
      margin-top: 9px;
      padding: 8px 11px;
      border-radius: 10px;
      font-size: 12px;
      line-height: 1.4;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .aia-guide-banner-hint {
      background: rgba(249, 115, 22, 0.16);
      border: 1px solid rgba(249, 115, 22, 0.36);
      color: #fed7aa;
    }
    .aia-guide-banner-error {
      background: rgba(225, 29, 72, 0.18);
      border: 1px solid rgba(244, 63, 94, 0.45);
      color: #fecdd3;
    }
    .aia-guide-dock {
      position: fixed;
      bottom: 14px;
      left: 16px;
      right: 16px;
      margin: 0 auto;
      max-width: 580px;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      color: #ffffff;
      box-shadow: 0 18px 40px -12px rgba(15, 23, 42, 0.65);
    }
    .aia-guide-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .aia-guide-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 32px;
      padding: 0 10px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms ease, opacity 150ms ease;
    }
    .aia-guide-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
    }
    .aia-guide-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .aia-guide-btn-primary {
      background: linear-gradient(135deg, #f97316, #f59e0b);
      border-color: rgba(255, 255, 255, 0.25);
      color: #ffffff;
    }
    .aia-guide-btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #ea580c, #d97706);
    }
    .aia-guide-btn-danger:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.24);
      color: #fecaca;
    }
    .aia-guide-resume-bar {
      margin: 10px 14px 0;
      padding: 9px 12px;
      border-radius: 12px;
      background: color-mix(in oklab, var(--aia-primary) 12%, var(--aia-surface));
      border: 1px solid color-mix(in oklab, var(--aia-primary) 35%, transparent);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--aia-text);
    }
    @media (prefers-reduced-motion: reduce) {
      .aia-panel, .aia-chip-pill, .aia-avatar-btn, .aia-guide-ring, .aia-guide-cursor-pointer, .aia-guide-cursor-ring {
        transition: none !important;
        animation: none !important;
      }
    }
    @keyframes aia-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .aia-spin {
      animation: aia-spin 0.9s linear infinite;
    }
    .aia-guide-cursor-root {
      position: fixed;
      inset: 0;
      z-index: 2147483020;
      pointer-events: none;
      font-family: var(--aia-font-sans, ui-sans-serif, system-ui, sans-serif);
    }
    .aia-guide-cursor-ring {
      position: fixed;
      border-radius: 14px;
      border: 2px solid #f97316;
      box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.22), 0 0 24px rgba(249, 115, 22, 0.35);
      pointer-events: none;
      transition: left 260ms cubic-bezier(0.22, 1, 0.36, 1), top 260ms cubic-bezier(0.22, 1, 0.36, 1), width 260ms cubic-bezier(0.22, 1, 0.36, 1), height 260ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .aia-guide-cursor-ring.aia-guide-cursor-ring-sensitive {
      border-color: #ef4444;
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.24), 0 0 26px rgba(239, 68, 68, 0.4);
    }
    .aia-guide-cursor-pointer {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2147483022;
      pointer-events: none;
      will-change: transform;
      filter: drop-shadow(0 6px 12px rgba(15, 23, 42, 0.45));
      transition: transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .aia-guide-cursor-card {
      position: fixed;
      z-index: 2147483021;
      pointer-events: auto;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(15, 23, 42, 0.96);
      padding: 12px 14px;
      color: #f8fafc;
      box-shadow: 0 16px 32px -12px rgba(15, 23, 42, 0.55);
      transition: left 120ms cubic-bezier(0.22, 1, 0.36, 1), top 120ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .aia-guide-cursor-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .aia-guide-cursor-step {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #fb923c;
    }
    .aia-guide-cursor-sensitive-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 6px;
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(248, 113, 113, 0.45);
      color: #fecaca;
      font-size: 10.5px;
      font-weight: 600;
    }
    .aia-guide-cursor-tip {
      margin: 0;
      font-size: 13.5px;
      font-weight: 500;
      line-height: 1.45;
      color: #f8fafc;
    }
    .aia-guide-cursor-hint {
      margin-top: 6px;
      font-size: 11.5px;
      color: #fcd34d;
    }
    .aia-guide-cursor-actions {
      margin-top: 10px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    .aia-guide-cursor-back {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 11px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.09);
      color: #e2e8f0;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms ease, opacity 150ms ease;
    }
    .aia-guide-cursor-back:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }
    .aia-guide-cursor-back:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .aia-guide-cursor-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      cursor: pointer;
      transition: background-color 150ms ease, color 150ms ease;
    }
    .aia-guide-cursor-icon-btn:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }
    .aia-guide-cursor-icon-btn.is-speaking {
      border-color: rgba(249, 115, 22, 0.65);
      background: rgba(249, 115, 22, 0.22);
      color: #fdba74;
    }
    .aia-guide-cursor-error-note {
      margin-bottom: 6px;
      padding: 5px 8px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.16);
      border: 1px solid rgba(248, 113, 113, 0.35);
      color: #fecaca;
      font-size: 11px;
      line-height: 1.35;
    }
    .aia-guide-cursor-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .aia-guide-cursor-reply-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 12px;
      border-radius: 9px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.1);
      color: #f8fafc;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: filter 150ms ease, background-color 150ms ease;
    }
    .aia-guide-cursor-reply-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .aia-guide-cursor-reply-btn.is-primary {
      background: linear-gradient(135deg, #f97316, #ea580c);
      border-color: rgba(255, 255, 255, 0.24);
      color: #ffffff;
    }
    .aia-guide-cursor-reply-btn.is-danger {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(248, 113, 113, 0.45);
      color: #fecaca;
    }
    .aia-guide-cursor-reply-input-row {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .aia-guide-cursor-reply-input {
      flex: 1;
      min-width: 0;
      height: 30px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(2, 6, 23, 0.55);
      color: #f8fafc;
      font-size: 12px;
      padding: 0 9px;
      outline: none;
    }
    .aia-guide-cursor-reply-input:focus {
      border-color: rgba(249, 115, 22, 0.7);
    }
    .aia-guide-cursor-mic-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
      cursor: pointer;
      flex-shrink: 0;
    }
    .aia-guide-cursor-mic-btn.is-listening {
      border-color: rgba(248, 113, 113, 0.7);
      background: rgba(239, 68, 68, 0.25);
      color: #fecaca;
    }
    .aia-guide-cursor-mic-btn.is-send {
      background: linear-gradient(135deg, #f97316, #ea580c);
      border-color: rgba(255, 255, 255, 0.24);
      color: #ffffff;
    }
    .aia-guide-cursor-mic-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .aia-guide-cursor-next {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      background: linear-gradient(135deg, #f97316, #ea580c);
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 6px 18px -6px rgba(249, 115, 22, 0.65);
    }
    .aia-guide-cursor-next:hover {
      filter: brightness(1.08);
    }
    .aia-guide-cursor-stop-dock {
      position: fixed;
      bottom: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483023;
      pointer-events: auto;
    }
    .aia-guide-cursor-stop {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 14px;
      border-radius: 12px;
      border: 1px solid rgba(248, 113, 113, 0.45);
      background: rgba(15, 23, 42, 0.96);
      color: #fecaca;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 10px 24px -8px rgba(15, 23, 42, 0.6);
      transition: background-color 150ms ease, color 150ms ease;
    }
    .aia-guide-cursor-stop:hover {
      background: rgba(220, 38, 38, 0.92);
      color: #ffffff;
    }

    /* Cursor name-tag pills ("You" & Web App Name) */
    .aia-cursor-name-pill {
      position: absolute;
      left: 17px;
      top: 19px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 9px;
      border-radius: 9999px;
      font-family: var(--aia-font-sans, ui-sans-serif, system-ui, sans-serif);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.01em;
      line-height: 1.4;
      white-space: nowrap;
      max-width: 170px;
      overflow: hidden;
      text-overflow: ellipsis;
      border: 1.5px solid rgba(255, 255, 255, 0.92);
      box-shadow: 0 6px 16px -4px rgba(15, 23, 42, 0.45);
      pointer-events: none;
    }
    .aia-cursor-name-pill-agent {
      background: linear-gradient(135deg, #f97316, #ea580c);
      color: #ffffff;
    }
    .aia-cursor-name-pill-sensitive {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #ffffff;
    }
    .aia-cursor-name-pill-you {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #ffffff;
    }

    /* Custom Agent-Style User Mouse Cursor */
    html.aia-custom-user-cursor,
    html.aia-custom-user-cursor * {
      cursor: none !important;
    }
    .aia-user-cursor-root {
      position: fixed;
      inset: 0;
      z-index: 2147483030;
      pointer-events: none;
      overflow: hidden;
    }
    .aia-user-cursor-pointer {
      position: fixed;
      top: 0;
      left: 0;
      pointer-events: none;
      will-change: transform;
      filter: drop-shadow(0 5px 10px rgba(15, 23, 42, 0.38));
      transition: opacity 140ms ease;
    }
    .aia-user-cursor-pointer[data-pressed="true"] svg {
      transform: scale(0.88);
    }
    .aia-user-cursor-pointer svg {
      transition: transform 90ms ease-out;
    }

    /* Screen-Sharing Perimeter Glow & Pill */
    @keyframes aia-gemini-orb-pulse {
      0%, 100% { transform: scale(1); opacity: 0.95; }
      50% { transform: scale(1.18); opacity: 0.72; }
    }
    .aia-live-glow-root {
      position: fixed;
      inset: 0;
      z-index: 2147483008;
      pointer-events: none;
    }
    .aia-live-glow-aura {
      position: fixed;
      inset: 0;
      pointer-events: none;
      box-shadow:
        inset 0 0 0 2px rgba(96, 165, 250, 0.55),
        inset 0 0 24px rgba(59, 130, 246, 0.24);
    }
    .aia-live-glow-border {
      position: fixed;
      inset: 0;
      pointer-events: none;
      border: 3px solid rgba(59, 130, 246, 0.72);
    }
    .aia-live-share-pill {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483019;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(96, 165, 250, 0.55);
      box-shadow:
        0 0 18px rgba(59, 130, 246, 0.28),
        0 8px 20px -8px rgba(15, 23, 42, 0.55);
      color: #f8fafc;
      font-family: var(--aia-font-sans, ui-sans-serif, system-ui, sans-serif);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .aia-live-share-orb {
      width: 9px;
      height: 9px;
      border-radius: 9999px;
      background: radial-gradient(circle at 30% 30%, #67e8f9, #3b82f6 65%, #8b5cf6);
      box-shadow: 0 0 10px rgba(34, 211, 238, 0.85);
      animation: aia-gemini-orb-pulse 1.6s ease-in-out infinite;
    }
    .aia-live-share-tag {
      padding: 1px 7px;
      border-radius: 9999px;
      background: rgba(59, 130, 246, 0.22);
      border: 1px solid rgba(96, 165, 250, 0.4);
      color: #93c5fd;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    @media (prefers-reduced-motion: reduce) {
      .aia-live-glow-aura,
      .aia-live-glow-border,
      .aia-live-share-orb {
        animation: none !important;
      }
    }

    /* Billing Header Pill & Lock States */
    .aia-credit-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: var(--aia-radius-pill);
      border: 1px solid var(--aia-hairline);
      background: var(--aia-inset);
      color: var(--aia-text-muted);
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      cursor: pointer;
      transition: background-color var(--aia-transition-fast), border-color var(--aia-transition-fast), color var(--aia-transition-fast);
    }
    .aia-credit-pill:hover {
      border-color: color-mix(in oklab, var(--aia-primary) 40%, transparent);
      color: var(--aia-primary);
    }
    .aia-credit-pill.is-static {
      cursor: default;
    }
    .aia-credit-pill.is-static:hover {
      border-color: var(--aia-hairline);
      color: var(--aia-text-muted);
    }
    .aia-credit-pill.is-low {
      background: color-mix(in oklab, var(--aia-debit) 10%, var(--aia-surface));
      border-color: color-mix(in oklab, var(--aia-debit) 32%, transparent);
      color: var(--aia-debit);
    }
    .aia-credit-pill.is-premium {
      background: color-mix(in oklab, var(--aia-credit) 10%, var(--aia-surface));
      border-color: color-mix(in oklab, var(--aia-credit) 30%, transparent);
      color: var(--aia-credit);
    }

    .aia-billing-lock {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 28px 22px;
      gap: 12px;
      animation: aia-fade-up 200ms ease-out;
    }
    .aia-billing-lock-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: color-mix(in oklab, var(--aia-primary) 12%, var(--aia-surface));
      border: 1px solid color-mix(in oklab, var(--aia-primary) 26%, transparent);
      color: var(--aia-primary);
    }
    .aia-billing-exhausted {
      margin: 10px 14px 0;
      padding: 11px 13px;
      border-radius: var(--aia-radius-md);
      background: color-mix(in oklab, var(--aia-debit) 8%, var(--aia-surface));
      border: 1px solid color-mix(in oklab, var(--aia-debit) 28%, transparent);
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12.5px;
      color: var(--aia-text);
    }
    .aia-billing-upgrade-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: var(--aia-radius-pill);
      border: none;
      background: var(--aia-gradient-primary);
      color: var(--aia-primary-fg);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      align-self: flex-start;
      box-shadow: var(--aia-shadow-glow);
    }

    /* Multimodal Composer Preview Strip & Lightbox */
    .aia-att-strip {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .aia-att-card {
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 100%;
      padding: 5px 8px;
      border-radius: 12px;
      border: 1px solid var(--aia-hairline);
      background: var(--aia-surface);
      color: var(--aia-text);
      font-size: 11.5px;
      box-shadow: var(--aia-chip-shadow);
    }
    .aia-att-card.is-error {
      border-color: color-mix(in oklab, var(--aia-debit) 45%, transparent);
      background: color-mix(in oklab, var(--aia-debit) 6%, var(--aia-surface));
    }
    .aia-att-thumb-btn {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      overflow: hidden;
      padding: 0;
      border: 1px solid var(--aia-hairline);
      background: var(--aia-inset);
      cursor: pointer;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .aia-att-thumb-btn img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .aia-att-progress {
      height: 3px;
      width: 100%;
      border-radius: 9999px;
      background: var(--aia-inset);
      overflow: hidden;
      margin-top: 3px;
    }
    .aia-att-progress-bar {
      height: 100%;
      background: var(--aia-gradient-primary);
      transition: width 120ms ease;
    }
    .aia-lightbox-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483040;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .aia-lightbox-dialog {
      position: relative;
      max-width: min(92vw, 760px);
      max-height: 88dvh;
      border-radius: 18px;
      background: var(--aia-surface);
      border: 1px solid var(--aia-border);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    }
  `;
  document.head.appendChild(style);
}
