import { defineAssistantAdapter } from './contract.ts';

/**
 * ============================================================================
 * AI ASSISTANT KIT — ADAPTER TEMPLATE (NEW APP STARTER)
 * ============================================================================
 * Copy this file to `ai-assistant-kit/adapter/app.config.ts` and fill in your
 * application's 12 configuration keys below. Do NOT modify files inside `core/`.
 */
export const templateAdapter = defineAssistantAdapter({
  // 1. App identity, languages, and visual theme tokens
  app: {
    id: 'my-web-app',
    name: 'My Web App',
    shortDescription: 'Describe what your web application does in 1-2 sentences.',
    logo: '/favicon.svg',
    languages: ['en'],
    defaultLocale: 'en',
    tone: 'helpful, clear, and concise',
    scopeRules:
      'Answer only questions related to My Web App, its data, workflows, and user accounts. Politely decline unrelated topics.',
    theme: {
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
      radii: { sm: '4px', md: '8px', lg: '16px', full: '9999px' },
      fonts: {
        body: 'system-ui, -apple-system, sans-serif',
        heading: 'inherit',
        mono: 'ui-monospace, monospace',
      },
      launcher: {
        position: 'bottom-right',
        label: 'Ask AI Assistant',
      },
    },
    personalizationExamples: {
      displayNamePlaceholder: 'e.g. Alex, Jordan',
      instructionsPlaceholder: 'e.g. always summarize totals first, reply concisely',
    },
  },

  // 2. Authentication & session extractor
  auth: {
    mode: 'custom',
    headerName: 'authorization',
    orgField: 'organizationId',
    roleField: 'role',
    userIdField: 'id',
    extractSession: (_reqOrState) => {
      // TODO: Read your verified user id, role, organizationId, and scope ids from session/JWT
      return null;
    },
  },

  // 3. Role hierarchy (lowest level number = highest privilege)
  roles: [
    {
      id: 'SUPER_ADMIN',
      name: 'SUPER_ADMIN',
      label: 'Platform Super Admin',
      level: 0,
      authMethod: 'platform-login',
      scopeDescription: 'All organizations and aggregate platform usage metrics.',
      permissions: ['*'],
      canExport: true,
      canImport: true,
      canExecuteActions: true,
    },
    {
      id: 'ADMIN',
      name: 'ADMIN',
      label: 'Organization Admin',
      level: 1,
      authMethod: 'email-password',
      scopeDescription: 'Own organization only.',
      permissions: ['org:*'],
      canExport: true,
      canImport: true,
      canExecuteActions: true,
    },
    {
      id: 'MEMBER',
      name: 'MEMBER',
      label: 'Standard Member',
      level: 3,
      authMethod: 'member-id',
      scopeDescription: 'Own records only.',
      permissions: ['self:read'],
      canExport: true,
      canImport: false,
      canExecuteActions: false,
    },
  ],

  // 4. Entities (add each domain object searchable or exportable by the assistant)
  entities: [
    {
      name: 'record',
      label: 'Record',
      pluralLabel: 'records',
      collection: 'records',
      idField: 'id',
      nameField: 'name',
      nameLabel: 'Name',
      orgField: 'organizationId',
      ownerIdField: 'ownerId',
      keywords: ['record', 'records', 'item'],
      fields: [
        { key: 'id', label: 'ID', format: 'text', searchable: true },
        { key: 'name', label: 'Name', format: 'text', searchable: true },
        { key: 'status', label: 'Status', format: 'text', searchable: true },
      ],
      searchableFields: ['id', 'name', 'status'],
      displayFields: [
        { key: 'id', label: 'ID', format: 'text' },
        { key: 'name', label: 'Name', format: 'text' },
        { key: 'status', label: 'Status', format: 'text' },
      ],
      defaultExportColumns: ['id', 'name', 'status'],
      sensitiveFields: ['password', 'passwordHash', 'token', 'secret'],
      visibilityRules: {
        PUBLIC: 'none',
        SUPER_ADMIN: 'all',
        ADMIN: 'org',
        MEMBER: 'self',
      },
      scopePredicates: {
        PUBLIC: () => false,
        SUPER_ADMIN: () => true,
        ADMIN: (ctx, row) => !ctx.organizationId || row.organizationId === ctx.organizationId,
        MEMBER: (ctx, row) => row.ownerId === ctx.userId || row.id === ctx.userId,
      },
      query: async (ctx, _filters) => {
        const list = (ctx.appState?.records as Array<Record<string, unknown>> | undefined) || [];
        return list;
      },
      get: async (ctx, id) => {
        const list = (ctx.appState?.records as Array<Record<string, unknown>> | undefined) || [];
        return list.find((r) => String(r.id) === id) || null;
      },
      search: async (ctx, text) => {
        const q = text.toLowerCase();
        const list = (ctx.appState?.records as Array<Record<string, unknown>> | undefined) || [];
        return list.filter((r) => String(r.name || '').toLowerCase().includes(q));
      },
    },
  ],

  // 5. Pages & per-role suggestion chips
  pages: [
    {
      pageId: 'home',
      route: '/',
      pageName: 'Home',
      title: 'Home Dashboard',
      description: 'Main landing view after sign-in.',
      routePatterns: ['/', '/dashboard'],
      guideAnchorIds: ['nav-home', 'primary-create-btn'],
      actions: [
        {
          id: 'home.summary',
          label: 'Summarize current records',
          prompt: 'Show a summary of my current records',
          roles: ['ADMIN', 'MEMBER'],
          priority: 100,
        },
      ],
    },
  ],

  // 6. Interactive 3D Avatar Guide Mode flows
  guideFlows: [
    {
      id: 'public.login',
      title: 'How to Log In',
      triggerPhrases: ['guide me to log in', 'how do i login', 'how to sign in'],
      roles: ['PUBLIC'],
      steps: [
        {
          id: 'step-email',
          route: '/login',
          selector: '[data-guide-id="login-email"]',
          instructionEn: 'Enter your account email or user ID here.',
          completionCondition: 'input',
        },
        {
          id: 'step-password',
          route: '/login',
          selector: 'input[type="password"]',
          instructionEn: 'Type your password (the assistant closes its eyes for privacy).',
          completionCondition: 'input',
          sensitive: true,
        },
        {
          id: 'step-submit',
          route: '/login',
          selector: '[data-guide-id="login-submit"]',
          instructionEn: 'Click Sign In to open your dashboard.',
          completionCondition: 'click',
        },
      ],
    },
  ],

  // 7. Custom Action Tools (beyond built-in search/query/navigate/export)
  tools: [],

  // 8a. Import templates (.xlsx / .xls / .csv)
  importTemplates: [],

  // 8b. Export file definitions (CSV / XLSX / PDF / DOCX)
  exportDefinitions: [
    {
      id: 'records-export',
      entity: 'record',
      title: 'Records Export',
      filenamePrefix: 'records',
      formats: ['csv', 'xlsx', 'pdf', 'docx'],
      columns: [
        { key: 'id', label: 'ID', format: 'text' },
        { key: 'name', label: 'Name', format: 'text' },
        { key: 'status', label: 'Status', format: 'text' },
      ],
      allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
      supportsUnicodePdf: true,
    },
  ],

  // 9. Credits rules (100/month free owned by Admin)
  credits: {
    freeMonthlyAllowance: 100,
    ownerRole: 'ADMIN',
    resetCycle: 'monthly',
    allowNonAdminOnFree: false,
    costs: {
      chat: 1,
      toolCall: 2,
      attachment: 2,
      export: 2,
      import: 3,
    },
  },

  // 10. Subscription plans (monthly + annual)
  plans: {
    currency: 'INR',
    monthlyPrice: 999,
    annualPrice: 9590,
    freeFeatures: ['100 credits / month (no rollover)', 'Admin-only assistant access'],
    premiumFeatures: [
      'Unlimited monthly credits for entire organization',
      'All team members & end users unlocked',
      'Multimodal vision, PDF/XLSX import & multi-format exports',
    ],
  },

  // 11. Multi-provider AI router order (OpenRouter -> Gemini -> Groq)
  providers: {
    order: ['openrouter', 'gemini', 'groq'],
    models: {
      openrouter: {
        fast: 'openai/gpt-4o-mini',
        strong: 'openai/gpt-4o-mini',
        vision: 'openai/gpt-4o-mini',
      },
      gemini: {
        fast: 'gemini-2.0-flash',
        strong: 'gemini-2.0-pro',
        vision: 'gemini-2.0-flash',
      },
      groq: {
        fast: 'llama-3.3-70b-versatile',
        strong: 'llama-3.3-70b-versatile',
      },
    },
    timeoutMs: 25000,
    retriesPerProvider: 1,
  },

  // 12. Off-topic Scope Guard
  scopeGuard: {
    appTopicDescription: 'My Web App workspace, accounts, records, reports, and troubleshooting.',
    allowedPublicTopics: ['login', 'signup', 'roles', 'features', 'pricing', 'help'],
    publicGuideRoutes: ['/login', '/auth'],
    publicBlockedKeywords: ['export csv', 'database dump'],
    offTopicRefusal:
      'I can only help with questions, data, and workflows inside this application.',
  },

  generalChips: [
    {
      id: 'general.help',
      label: 'What can you help me with?',
      prompt: 'What tasks can you assist me with in this app?',
      roles: ['PUBLIC', 'ADMIN', 'MEMBER'],
    },
  ],
});
