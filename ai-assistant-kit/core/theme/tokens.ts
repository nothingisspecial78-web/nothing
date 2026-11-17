import type { ThemeConfig } from '../config/schema.ts';

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'auto',
  colors: {
    primary: '#0ea5e9',
    primaryText: '#ffffff',
    accent: '#38bdf8',
    surface: '#ffffff',
    background: '#f8fafc',
    text: '#0f172a',
    textMuted: '#64748b',
    border: '#e2e8f0',
  },
  radii: {
    sm: '6px',
    md: '12px',
    lg: '20px',
    full: '9999px',
  },
  fonts: {
    body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    heading: 'inherit',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  launcher: {
    position: 'bottom-right',
    label: 'Ask AI Assistant',
  },
};

export function resolveThemeTokens(
  theme?: Partial<ThemeConfig>,
  hostColors?: {
    primaryColor?: string;
    accentColor?: string;
    dark?: boolean;
  }
): ThemeConfig {
  const mode = theme?.mode ?? (hostColors?.dark ? 'dark' : DEFAULT_THEME_CONFIG.mode);
  const isDark = mode === 'dark';

  const baseColors = {
    ...DEFAULT_THEME_CONFIG.colors,
    ...(isDark
      ? {
          surface: '#111827',
          background: '#0f172a',
          text: '#f8fafc',
          textMuted: '#94a3b8',
          border: 'rgba(148, 163, 184, 0.2)',
        }
      : {}),
    ...theme?.colors,
  };

  if (hostColors?.primaryColor) {
    baseColors.primary = hostColors.primaryColor;
  }
  if (hostColors?.accentColor) {
    baseColors.accent = hostColors.accentColor;
  }

  return {
    mode,
    colors: baseColors,
    radii: {
      ...DEFAULT_THEME_CONFIG.radii,
      ...theme?.radii,
    },
    fonts: {
      ...DEFAULT_THEME_CONFIG.fonts,
      ...theme?.fonts,
    },
    launcher: {
      ...DEFAULT_THEME_CONFIG.launcher,
      ...theme?.launcher,
    },
  };
}

export function generateThemeCssVars(theme: ThemeConfig): Record<string, string> {
  return {
    '--aia-primary': theme.colors.primary,
    '--aia-primary-text': theme.colors.primaryText,
    '--aia-accent': theme.colors.accent,
    '--aia-surface': theme.colors.surface,
    '--aia-bg': theme.colors.background,
    '--aia-text': theme.colors.text,
    '--aia-muted': theme.colors.textMuted,
    '--aia-border': theme.colors.border,
    '--aia-radius-sm': theme.radii.sm,
    '--aia-radius-md': theme.radii.md,
    '--aia-radius-lg': theme.radii.lg,
    '--aia-radius-full': theme.radii.full,
    '--aia-font-body': theme.fonts.body,
    '--aia-font-heading': theme.fonts.heading,
    '--aia-font-mono': theme.fonts.mono,
  };
}
