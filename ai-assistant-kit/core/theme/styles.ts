export const WIDGET_CSS = `
:host {
  all: initial;
  font-family: var(--aia-font-body, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
}

.aia-root {
  --aia-bg: #ffffff;
  --aia-surface: #f8fafc;
  --aia-surface-2: #f1f5f9;
  --aia-border: #e2e8f0;
  --aia-text: #0f172a;
  --aia-muted: #64748b;
  --aia-primary: #2563eb;
  --aia-primary-hover: #1d4ed8;
  --aia-primary-text: #ffffff;
  --aia-danger: #dc2626;
  --aia-success: #16a34a;
  --aia-warning: #d97706;
  --aia-radius-sm: 6px;
  --aia-radius-md: 12px;
  --aia-radius-lg: 20px;
  --aia-radius-full: 9999px;
  --aia-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
  font-family: var(--aia-font-body, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  color: var(--aia-text);
  box-sizing: border-box;
}

.aia-root[data-theme="dark"] {
  --aia-bg: #0f172a;
  --aia-surface: #1e293b;
  --aia-surface-2: #334155;
  --aia-border: #334155;
  --aia-text: #f8fafc;
  --aia-muted: #94a3b8;
  --aia-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}

.aia-root *, .aia-root *::before, .aia-root *::after {
  box-sizing: border-box;
}

/* Custom Context Menu */
.aia-ctx-menu {
  position: fixed;
  z-index: 2147483645;
  min-width: 224px;
  background: var(--aia-bg);
  border: 1px solid var(--aia-border);
  border-radius: 12px;
  box-shadow: var(--aia-shadow);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: aiaPopIn 120ms ease-out;
}

.aia-ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--aia-text);
  font-size: 13px;
  font-weight: 500;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}

.aia-ctx-item:hover {
  background: var(--aia-surface-2);
}

.aia-ctx-divider {
  height: 1px;
  background: var(--aia-border);
  margin: 4px 6px;
}

/* Backdrop & Docked Side Panel */
.aia-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.25);
  z-index: 2147483640;
  opacity: 0;
  pointer-events: none;
  transition: opacity 220ms ease;
}

.aia-backdrop[data-open="true"] {
  opacity: 1;
  pointer-events: auto;
}

.aia-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(440px, 100vw);
  z-index: 2147483641;
  background: var(--aia-bg);
  border-left: 1px solid var(--aia-border);
  box-shadow: var(--aia-shadow);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.aia-panel[data-open="true"] {
  transform: translateX(0);
}

/* Header */
.aia-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--aia-border);
  background: var(--aia-surface);
  gap: 8px;
}

.aia-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.aia-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--aia-primary), #7c3aed);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.aia-title-wrap {
  min-width: 0;
}

.aia-title {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aia-subtitle {
  font-size: 11px;
  color: var(--aia-muted);
  margin: 1px 0 0;
}

.aia-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.aia-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--aia-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 140ms ease;
}

.aia-icon-btn:hover {
  background: var(--aia-surface-2);
  color: var(--aia-text);
}

.aia-icon-btn[data-active="true"] {
  background: color-mix(in srgb, var(--aia-primary) 16%, transparent);
  color: var(--aia-primary);
  border-color: color-mix(in srgb, var(--aia-primary) 40%, transparent);
}

/* Status Banner */
.aia-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--aia-surface);
  border-bottom: 1px solid var(--aia-border);
  font-size: 12px;
  color: var(--aia-primary);
  font-weight: 500;
}

.aia-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--aia-primary);
  animation: aiaPulse 1.1s infinite ease-in-out;
}

/* Messages */
.aia-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.aia-empty {
  margin: auto 0;
  text-align: center;
  padding: 24px 12px;
  color: var(--aia-muted);
}

.aia-empty h4 {
  margin: 0 0 6px;
  font-size: 15px;
  color: var(--aia-text);
}

.aia-empty p {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
}

.aia-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 92%;
}

.aia-msg[data-role="user"] {
  align-self: flex-end;
  align-items: flex-end;
}

.aia-msg[data-role="assistant"] {
  align-self: flex-start;
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
}

.aia-bubble {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.55;
  word-break: break-word;
}

.aia-msg[data-role="user"] .aia-bubble {
  background: var(--aia-primary);
  color: var(--aia-primary-text);
  border-bottom-right-radius: 4px;
}

.aia-msg[data-role="assistant"] .aia-bubble {
  background: var(--aia-surface);
  border: 1px solid var(--aia-border);
  border-bottom-left-radius: 4px;
  width: 100%;
}

.aia-md p { margin: 0 0 8px; }
.aia-md p:last-child { margin-bottom: 0; }
.aia-md ul, .aia-md ol { margin: 6px 0; padding-left: 18px; }
.aia-md code {
  background: var(--aia-surface-2);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}

/* Tool Badge */
.aia-tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--aia-surface-2);
  color: var(--aia-text);
  border: 1px solid var(--aia-border);
}

/* Confirmation Card */
.aia-card {
  width: 100%;
  background: var(--aia-surface);
  border: 1px solid var(--aia-border);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.aia-card-title {
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.aia-card-meta {
  font-size: 12px;
  color: var(--aia-muted);
}

.aia-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.aia-btn {
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  border: 1px solid var(--aia-border);
  background: var(--aia-bg);
  color: var(--aia-text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 140ms ease;
}

.aia-btn:hover { background: var(--aia-surface-2); }

.aia-btn-primary {
  background: var(--aia-primary);
  color: var(--aia-primary-text);
  border-color: var(--aia-primary);
}

.aia-btn-primary:hover {
  background: var(--aia-primary-hover);
}

.aia-btn-danger {
  background: color-mix(in srgb, var(--aia-danger) 12%, transparent);
  color: var(--aia-danger);
  border-color: color-mix(in srgb, var(--aia-danger) 35%, transparent);
}

/* Context Pill & File Chip */
.aia-context-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  background: color-mix(in srgb, var(--aia-primary) 12%, transparent);
  color: var(--aia-primary);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--aia-primary) 30%, transparent);
  max-width: 100%;
}

.aia-context-pill span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aia-pill-remove {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}

/* Sources */
.aia-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.aia-source-tag {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--aia-surface-2);
  color: var(--aia-muted);
  border: 1px solid var(--aia-border);
}

/* Footer Composer */
.aia-composer {
  padding: 12px 14px;
  border-top: 1px solid var(--aia-border);
  background: var(--aia-surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.aia-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.aia-chip {
  font-size: 11.5px;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--aia-bg);
  border: 1px solid var(--aia-border);
  color: var(--aia-text);
  cursor: pointer;
  transition: all 120ms ease;
}

.aia-chip:hover {
  border-color: var(--aia-primary);
  color: var(--aia-primary);
}

.aia-input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--aia-bg);
  border: 1px solid var(--aia-border);
  border-radius: 12px;
  padding: 6px 8px;
}

.aia-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--aia-text);
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.45;
  max-height: 120px;
  padding: 4px;
}

/* Modals / Drawers inside panel */
.aia-subpanel {
  position: absolute;
  inset: 58px 0 0 0;
  background: var(--aia-bg);
  z-index: 10;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow-y: auto;
  gap: 12px;
}

.aia-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
}

.aia-field label {
  font-weight: 600;
  color: var(--aia-text);
}

.aia-field input, .aia-field select, .aia-field textarea {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--aia-border);
  background: var(--aia-surface);
  color: var(--aia-text);
  font-family: inherit;
  font-size: 13px;
}

/* Cursor Inspector Highlight & Screen Share Glow */
.aia-inspector-box {
  position: fixed;
  z-index: 2147483644;
  pointer-events: none;
  border: 2px solid var(--aia-primary);
  background: color-mix(in srgb, var(--aia-primary) 12%, transparent);
  border-radius: 6px;
  transition: all 60ms ease-out;
}

.aia-inspector-badge {
  position: fixed;
  z-index: 2147483645;
  pointer-events: none;
  background: var(--aia-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.aia-screen-glow {
  position: fixed;
  inset: 0;
  z-index: 2147483639;
  pointer-events: none;
  box-shadow: inset 0 0 0 3px var(--aia-primary), inset 0 0 28px color-mix(in srgb, var(--aia-primary) 35%, transparent);
  animation: aiaGlowPulse 2.4s infinite ease-in-out;
}

/* Import mapping table */
.aia-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.aia-table th, .aia-table td {
  border-bottom: 1px solid var(--aia-border);
  padding: 6px 8px;
  text-align: left;
}

.aia-badge-ok {
  color: var(--aia-success);
  font-weight: 600;
}

.aia-badge-err {
  color: var(--aia-danger);
  font-weight: 600;
}

@keyframes aiaPopIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes aiaPulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}

@keyframes aiaGlowPulse {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
}

/* Guide Mode Spotlight & Animated Pointer Cursor */
.aia-guide-spotlight {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  border-radius: 10px;
  border: 2.5px solid #2563eb;
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.42), 0 0 0 6px rgba(37, 99, 235, 0.24);
  transition: top 260ms cubic-bezier(0.22, 1, 0.36, 1), left 260ms cubic-bezier(0.22, 1, 0.36, 1), width 260ms cubic-bezier(0.22, 1, 0.36, 1), height 260ms cubic-bezier(0.22, 1, 0.36, 1);
  animation: aiaGuidePulse 1.7s infinite ease-in-out;
}

.aia-guide-cursor {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  width: 28px;
  height: 28px;
  transform: translate(-4px, -4px);
  transition: top 520ms cubic-bezier(0.22, 1, 0.36, 1), left 520ms cubic-bezier(0.22, 1, 0.36, 1);
  filter: drop-shadow(0 4px 10px rgba(37, 99, 235, 0.45));
}

.aia-guide-ring {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid #2563eb;
  transform: translate(-50%, -50%) scale(0.7);
  opacity: 0;
  transition: top 520ms cubic-bezier(0.22, 1, 0.36, 1), left 520ms cubic-bezier(0.22, 1, 0.36, 1);
  animation: aiaGuideRing 1.5s infinite ease-out;
}

.aia-guide-tooltip {
  position: fixed;
  z-index: 2147483647;
  width: min(340px, calc(100vw - 24px));
  background: var(--aia-bg, #ffffff);
  color: var(--aia-text, #0f172a);
  border: 1px solid rgba(37, 99, 235, 0.35);
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.28);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: aiaPopIn 180ms ease-out;
}

.aia-guide-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  color: #2563eb;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.aia-guide-title {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
  color: var(--aia-text, #0f172a);
}

.aia-guide-desc {
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0;
  color: var(--aia-muted, #475569);
}

.aia-guide-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
}

@keyframes aiaGuidePulse {
  0%, 100% { box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.42), 0 0 0 4px rgba(37, 99, 235, 0.26); }
  50% { box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.42), 0 0 0 9px rgba(37, 99, 235, 0.14); }
}

@keyframes aiaGuideRing {
  0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.9; }
  100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
}

/* Mobile Responsive Reflow */
@media (max-width: 640px) {
  .aia-panel {
    width: 100vw;
    border-left: none;
  }
}
`;
