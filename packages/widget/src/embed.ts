import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  AssistantConfig,
  AssistantAdapters,
  UserContext,
  PageContext,
  AssistantEventMap,
  AssistantEventHandler,
} from '@ai-assistant/core';
import { globalEventBus, validateAssistantConfig } from '@ai-assistant/core';
import { AssistantWidget, type AssistantWidgetProps } from './AssistantWidget.tsx';
import { AssistantProvider } from './context/AssistantContext.tsx';
import { ensureWidgetStyles } from './styles.ts';

export interface EmbedInitOptions {
  config?: AssistantConfig | Record<string, unknown>;
  adapters?: AssistantAdapters;
  appId?: string;
  apiUrl?: string;
  appName?: string;
  authToken?: string;
  getAuthToken?: () => string | Promise<string>;
  title?: string;
  position?: 'right' | 'left' | 'bottom-right' | 'bottom-left';
  rtl?: boolean;
  primaryColor?: string;
  user?: UserContext;
  pageContext?: PageContext;
  target?: HTMLElement | string;
  useShadowDom?: boolean;
}

export interface AssistantInstance {
  open: () => void;
  close: () => void;
  toggle: () => void;
  send: (text: string) => Promise<void>;
  setUser: (user: UserContext | null) => void;
  setPageContext: (ctx: Partial<PageContext>) => void;
  on: <K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>) => () => void;
  off: <K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>) => void;
  destroy: () => void;
}

let activeRoot: Root | null = null;
let activeMountNode: HTMLElement | null = null;
let activeShadowRoot: ShadowRoot | null = null;
let currentUser: UserContext | null = null;
let currentPageContext: PageContext = { route: '/' };

function createDefaultConfig(options: EmbedInitOptions): AssistantConfig {
  const appId = options.appId || 'default-app';
  const appName = options.appName || options.title || 'AI Assistant';

  return {
    appId,
    appName,
    app: {
      id: appId,
      name: appName,
      languages: ['en'],
      defaultLocale: options.rtl ? 'ar' : 'en',
      tone: 'helpful, professional, and concise',
      scopeRules: `Answer questions about ${appName}.`,
    },
    theme: {
      mode: 'auto',
      colors: {
        primary: options.primaryColor || '#0ea5e9',
        primaryText: '#ffffff',
        accent: '#38bdf8',
        surface: '#ffffff',
        background: '#f8fafc',
        text: '#0f172a',
        textMuted: '#64748b',
        border: '#e2e8f0',
      },
      radii: { sm: '4px', md: '8px', lg: '16px', full: '9999px' },
      fonts: { body: 'system-ui, sans-serif', heading: 'inherit', mono: 'ui-monospace, monospace' },
      launcher: {
        position: (options.position as any) || 'bottom-right',
      },
    },
    auth: {
      mode: 'custom',
      headerName: 'authorization',
      orgField: 'organizationId',
      roleField: 'role',
      userIdField: 'id',
    },
    roles: [],
    entities: [],
    pages: [],
    generalChips: [],
    actions: [],
    plans: {
      free: { creditAllowance: 50, priceMonthly: 0, priceAnnual: 0, features: ['basic_chat', 'search'] },
      premium: { creditAllowance: 1000, priceMonthly: 499, priceAnnual: 4990, features: ['all_tools', 'unlimited_export'] },
      currency: 'INR',
      perActionCreditCosts: { chat: 1, export: 2, import: 5, action: 3 },
    },
    ai: {
      providerOrder: ['gemini', 'openai'],
      models: { default: 'gemini-2.5-flash', fast: 'gemini-2.5-flash', reasoning: 'gemini-2.5-pro' },
      timeoutMs: 30000,
    },
    features: {
      chips: true,
      export: true,
      attachments: true,
      import: true,
      voice: false,
      payments: true,
      avatar3d: true,
      coBrowserGuide: true,
    },
    knowledge: [],
  };
}

/**
 * Mounts the Assistant Widget with React Root
 */
export function mountAssistantWidget(options: EmbedInitOptions): AssistantInstance {
  if (typeof document === 'undefined') {
    return {
      open: () => {},
      close: () => {},
      toggle: () => {},
      send: async () => {},
      setUser: () => {},
      setPageContext: () => {},
      on: () => () => {},
      off: () => {},
      destroy: () => {},
    };
  }

  // Clean up any existing instance
  unmountAssistantWidget();

  let targetElement: HTMLElement;
  if (typeof options.target === 'string') {
    targetElement = document.querySelector(options.target) as HTMLElement;
    if (!targetElement) {
      targetElement = document.createElement('div');
      document.body.appendChild(targetElement);
    }
  } else if (options.target instanceof HTMLElement) {
    targetElement = options.target;
  } else {
    targetElement = document.createElement('div');
    targetElement.id = 'ai-assistant-embed-root';
    document.body.appendChild(targetElement);
  }

  activeMountNode = targetElement;

  let renderContainer: HTMLElement | ShadowRoot = targetElement;
  if (options.useShadowDom) {
    activeShadowRoot = targetElement.attachShadow({ mode: 'open' });
    const shadowHostStyle = document.createElement('style');
    shadowHostStyle.textContent = `
      :host { display: block; position: relative; z-index: 999999; }
      * { box-sizing: border-box; }
    `;
    activeShadowRoot.appendChild(shadowHostStyle);
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'shadow-widget-container';
    activeShadowRoot.appendChild(widgetContainer);
    renderContainer = widgetContainer;
  }

  // Process and validate config
  let resolvedConfig: AssistantConfig;
  if (options.config) {
    const validated = validateAssistantConfig(options.config);
    if (!validated.valid) {
      console.warn('[Assistant SDK] Config validation warning:', validated.summary);
    }
    resolvedConfig = (validated.config || options.config) as AssistantConfig;
  } else {
    resolvedConfig = createDefaultConfig(options);
  }

  currentUser = options.user || null;
  currentPageContext = options.pageContext || { route: window.location.pathname || '/' };

  const widgetProps: AssistantWidgetProps = {
    appId: resolvedConfig.app?.id || options.appId || 'default-app',
    apiUrl: options.apiUrl || '',
    appName: resolvedConfig.app?.name || options.appName,
    getAuthToken: options.getAuthToken || (options.authToken ? () => options.authToken! : undefined),
    title: resolvedConfig.app?.name || options.title || 'AI Assistant',
    rtl: options.rtl || resolvedConfig.app?.defaultLocale === 'ar',
    theme: {
      position: (resolvedConfig.theme?.launcher?.position as any) || options.position,
      primaryColor: resolvedConfig.theme?.colors?.primary || options.primaryColor,
    },
  };

  activeRoot = createRoot(renderContainer as HTMLElement);
  activeRoot.render(
    React.createElement(AssistantProvider, {
      config: resolvedConfig,
      adapters: options.adapters,
      apiUrl: options.apiUrl,
      initialUser: currentUser,
      initialPageContext: currentPageContext,
      children: React.createElement(AssistantWidget, widgetProps),
    })
  );

  return {
    open: () => {
      const btn = (renderContainer as HTMLElement).querySelector('button[aria-label*="assistant"], button[aria-label*="Assistant"]') as HTMLButtonElement | null;
      btn?.click();
    },
    close: () => {
      const closeBtn = (renderContainer as HTMLElement).querySelector('button[aria-label="Close assistant"], button[aria-label="Close"]') as HTMLButtonElement | null;
      closeBtn?.click();
    },
    toggle: () => {
      const btn = (renderContainer as HTMLElement).querySelector('button[aria-label*="assistant"]') as HTMLButtonElement | null;
      btn?.click();
    },
    send: async (text: string) => {
      globalEventBus.emit('message_sent', {
        id: `msg_${Date.now()}`,
        text,
        role: 'user',
        timestamp: new Date().toISOString(),
      });
    },
    setUser: (user: UserContext | null) => {
      currentUser = user;
    },
    setPageContext: (ctx: Partial<PageContext>) => {
      currentPageContext = { ...currentPageContext, ...ctx };
    },
    on: <K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>) => {
      return globalEventBus.on(event, handler);
    },
    off: <K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>) => {
      globalEventBus.off(event, handler);
    },
    destroy: unmountAssistantWidget,
  };
}

export function unmountAssistantWidget(): void {
  activeRoot?.unmount();
  activeMountNode?.remove();
  activeRoot = null;
  activeMountNode = null;
  activeShadowRoot = null;
}

// ==============================================================================
// 3. Plain JS API (Assistant)
// ==============================================================================
let globalAssistantInstance: AssistantInstance | null = null;

export const Assistant = {
  init(config?: AssistantConfig | EmbedInitOptions, options: Partial<EmbedInitOptions> = {}): AssistantInstance {
    let mergedOptions: EmbedInitOptions;
    if (config && 'app' in config) {
      mergedOptions = { ...options, config: config as AssistantConfig };
    } else {
      mergedOptions = { ...(config as EmbedInitOptions), ...options };
    }
    globalAssistantInstance = mountAssistantWidget(mergedOptions);
    return globalAssistantInstance;
  },
  open(): void {
    globalAssistantInstance?.open();
  },
  close(): void {
    globalAssistantInstance?.close();
  },
  send(text: string): Promise<void> {
    return globalAssistantInstance?.send(text) || Promise.resolve();
  },
  on<K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>): () => void {
    return globalEventBus.on(event, handler);
  },
  off<K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>): void {
    globalEventBus.off(event, handler);
  },
  setUser(user: UserContext | null): void {
    globalAssistantInstance?.setUser(user);
  },
  setPageContext(ctx: Partial<PageContext>): void {
    globalAssistantInstance?.setPageContext(ctx);
  },
  destroy(): void {
    globalAssistantInstance?.destroy();
    globalAssistantInstance = null;
  },
};

// ==============================================================================
// 1. Web Component Custom Element (<app-assistant> & <khazna-assistant>)
// Isolated with Shadow DOM so host CSS doesn't clash
// ==============================================================================
const CustomElementBase =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

export class AppAssistantElement extends CustomElementBase {
  private instance: AssistantInstance | null = null;


  static get observedAttributes() {
    return ['config', 'config-url', 'app-id', 'api-url', 'auth-token', 'primary-color', 'rtl', 'position'];
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    this.instance?.destroy();
    this.instance = null;
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    const configAttr = this.getAttribute('config');
    let parsedConfig: AssistantConfig | undefined;
    if (configAttr) {
      try {
        parsedConfig = JSON.parse(configAttr);
      } catch (err) {
        console.error('[AppAssistantElement] Failed to parse config JSON attribute:', err);
      }
    }

    const options: EmbedInitOptions = {
      config: parsedConfig,
      appId: this.getAttribute('app-id') || undefined,
      apiUrl: this.getAttribute('api-url') || window.location?.origin || '',
      authToken: this.getAttribute('auth-token') || undefined,
      primaryColor: this.getAttribute('primary-color') || undefined,
      rtl: this.getAttribute('rtl') === 'true',
      position: (this.getAttribute('position') as any) || undefined,
      target: this,
      useShadowDom: true,
    };

    this.instance = mountAssistantWidget(options);
  }
}

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('app-assistant')) {
    customElements.define('app-assistant', AppAssistantElement);
  }
  // Alias for backward compatibility
  if (!customElements.get('khazna-assistant')) {
    customElements.define('khazna-assistant', class extends AppAssistantElement {});
  }
}

// Global script tag auto-initializer
function autoInitFromScriptTag(): void {
  if (typeof document === 'undefined') return;
  const currentScript =
    (document.currentScript as HTMLScriptElement | null) ||
    document.querySelector<HTMLScriptElement>('script[data-app-id]');

  if (!currentScript) return;
  const appId = currentScript.getAttribute('data-app-id');
  const apiUrl = currentScript.getAttribute('data-api-url') || window.location.origin;
  if (!appId) return;

  const init = () =>
    mountAssistantWidget({
      appId,
      apiUrl,
      appName: currentScript.getAttribute('data-app-name') || undefined,
      authToken: currentScript.getAttribute('data-auth-token') || undefined,
      title: currentScript.getAttribute('data-title') || undefined,
      position: (currentScript.getAttribute('data-position') as any) || 'bottom-right',
      rtl: currentScript.getAttribute('data-rtl') === 'true',
      primaryColor: currentScript.getAttribute('data-primary-color') || undefined,
    });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

autoInitFromScriptTag();

declare global {
  interface Window {
    Assistant?: typeof Assistant;
    AIAssistant?: {
      init: typeof mountAssistantWidget;
      destroy: typeof unmountAssistantWidget;
    };
  }
}

if (typeof window !== 'undefined') {
  window.Assistant = Assistant;
  window.AIAssistant = {
    init: mountAssistantWidget,
    destroy: unmountAssistantWidget,
  };
}
