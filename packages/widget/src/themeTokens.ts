/**
 * Single centralized design-token source for the AI Assistant widget.
 * Edit values here to re-theme colors, radii, spacing, fonts, and shadows
 * across both light and dark modes.
 */
export const WIDGET_THEME_TOKENS_CSS = `
  .aia-root {
    /* Brand & accent (inherits host --primary when available) */
    --aia-primary: var(--primary, #f97316);
    --aia-primary-fg: var(--primary-foreground, #ffffff);
    --aia-accent: var(--primary, #f97316);
    --aia-gradient-primary: var(--gradient-primary, linear-gradient(135deg, #f97316, #fb923c));

    /* Surfaces (Light mode - Gemini minimal neutral) */
    --aia-panel-bg: #f8f9fb;
    --aia-panel-glow: radial-gradient(
      95% 40% at 50% 100%,
      color-mix(in oklab, var(--aia-primary) 11%, transparent),
      color-mix(in oklab, var(--aia-info, #2563eb) 4%, transparent) 45%,
      transparent 76%
    );
    --aia-surface: #ffffff;
    --aia-surface-strong: #ffffff;
    --aia-surface-muted: #f3f4f6;
    --aia-inset: rgba(15, 23, 42, 0.04);
    --aia-header-bg: rgba(248, 249, 251, 0.85);

    /* Text & borders */
    --aia-text: #111827;
    --aia-text-muted: #4b5563;
    --aia-subtle: #6b7280;
    --aia-border: rgba(15, 23, 42, 0.08);
    --aia-hairline: rgba(15, 23, 42, 0.08);

    /* Semantic statuses */
    --aia-credit: var(--credit, #059669);
    --aia-debit: var(--debit, #e11d48);
    --aia-info: var(--info, #2563eb);

    /* Suggestion chips */
    --aia-chip-bg: #ffffff;
    --aia-chip-bg-hover: color-mix(in oklab, var(--aia-primary) 8%, #ffffff);
    --aia-chip-border: rgba(15, 23, 42, 0.06);
    --aia-chip-border-hover: color-mix(in oklab, var(--aia-primary) 35%, rgba(15, 23, 42, 0.1));
    --aia-chip-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04);

    /* Bottom Composer input card & Viewing bar */
    --aia-composer-bg: #ffffff;
    --aia-composer-border: rgba(15, 23, 42, 0.1);
    --aia-composer-focus-border: color-mix(in oklab, var(--aia-primary) 50%, rgba(15, 23, 42, 0.14));
    --aia-composer-shadow: 0 4px 20px -6px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04);
    --aia-viewing-bg: rgba(15, 23, 42, 0.045);

    /* Chat bubbles & Export card */
    --aia-bubble-user-bg: var(--aia-gradient-primary);
    --aia-bubble-user-fg: var(--aia-primary-fg);
    --aia-bubble-bot-bg: #ffffff;
    --aia-export-bg: #ffffff;
    --aia-menu-bg: #ffffff;

    /* Shadows */
    --aia-shadow-glass: 0 0 0 1px rgba(15, 23, 42, 0.06), 0 22px 48px -18px rgba(15, 23, 42, 0.18);
    --aia-shadow-glow: 0 8px 22px -10px color-mix(in oklab, var(--aia-primary) 55%, transparent);
    --aia-shadow-menu: 0 14px 36px -10px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(15, 23, 42, 0.06);

    /* Radii (16-24px minimal scale) */
    --aia-radius-panel: 24px;
    --aia-radius-card: 20px;
    --aia-radius-bubble: 18px;
    --aia-radius-md: 16px;
    --aia-radius-sm: 12px;
    --aia-radius-pill: 9999px;

    /* Spacing */
    --aia-space-xs: 4px;
    --aia-space-sm: 8px;
    --aia-space-md: 14px;
    --aia-space-lg: 20px;

    /* Typography */
    --aia-font-sans: "Geist", "Noto Sans", "Noto Sans Malayalam", ui-sans-serif, system-ui, -apple-system, sans-serif;
    --aia-font-display: "Bricolage Grotesque", "Geist", "Noto Sans", ui-sans-serif, system-ui, sans-serif;
    --aia-font-mono: "Geist Mono", ui-monospace, SFMono-Regular, monospace;

    /* Motion */
    --aia-transition-fast: 150ms cubic-bezier(0.22, 1, 0.36, 1);
    --aia-transition-base: 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* Dark theme support */
  .dark .aia-root,
  [data-theme="dark"] .aia-root,
  .aia-root[data-theme="dark"] {
    --aia-panel-bg: #111318;
    --aia-panel-glow: radial-gradient(
      95% 42% at 50% 100%,
      color-mix(in oklab, var(--aia-primary) 16%, transparent),
      color-mix(in oklab, var(--aia-info, #3b82f6) 6%, transparent) 45%,
      transparent 76%
    );
    --aia-surface: #1b1e26;
    --aia-surface-strong: #20242e;
    --aia-surface-muted: #16181f;
    --aia-inset: rgba(255, 255, 255, 0.06);
    --aia-header-bg: rgba(17, 19, 24, 0.85);

    --aia-text: #f3f4f6;
    --aia-text-muted: #9ca3af;
    --aia-subtle: #6b7280;
    --aia-border: rgba(255, 255, 255, 0.09);
    --aia-hairline: rgba(255, 255, 255, 0.09);

    --aia-chip-bg: #1e222b;
    --aia-chip-bg-hover: color-mix(in oklab, var(--aia-primary) 14%, #1e222b);
    --aia-chip-border: rgba(255, 255, 255, 0.08);
    --aia-chip-border-hover: color-mix(in oklab, var(--aia-primary) 45%, rgba(255, 255, 255, 0.14));
    --aia-chip-shadow: 0 2px 10px -2px rgba(0, 0, 0, 0.45);

    --aia-composer-bg: #1c1f27;
    --aia-composer-border: rgba(255, 255, 255, 0.1);
    --aia-composer-focus-border: color-mix(in oklab, var(--aia-primary) 55%, rgba(255, 255, 255, 0.16));
    --aia-composer-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.55);
    --aia-viewing-bg: rgba(255, 255, 255, 0.06);

    --aia-bubble-bot-bg: #1b1e26;
    --aia-export-bg: #1b1e26;
    --aia-menu-bg: #20242e;

    --aia-shadow-glass: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 24px 52px -18px rgba(0, 0, 0, 0.65);
    --aia-shadow-menu: 0 16px 38px -10px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.09);
  }
`;
