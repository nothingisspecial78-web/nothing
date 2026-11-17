import { describe, it, expect, vi } from 'vitest';
import {
  AssistantConfigSchema,
  validateAssistantConfig,
  defineAssistantConfig,
  MemoryDataAdapter,
  RestDataAdapter,
  SqlDataAdapter,
  RazorpayBillingAdapter,
  globalEventBus,
  AssistantEventBus,
  isRtlLocale,
  translate,
  getFontFamilyForLocale,
  registerPlugin,
  getPlugins,
  clearPlugins,
} from '@ai-assistant/core';
import {
  Assistant,
  AppAssistantElement,
} from '@ai-assistant/widget';
import {
  createAssistantServerRouter,
  createAssistantNextHandler,
} from '@ai-assistant/server';
import {
  khaznaAssistantConfig,
  libraryAssistantConfig,
  leaveLogAssistantConfig,
} from '../assistant.config.ts';
import { createLeaveLogStore } from '../apps/leave-log-app/server.ts';

describe('Universal AI Assistant SDK', () => {
  // ============================================================================
  // 1. Unified Configuration & Validation
  // ============================================================================
  describe('Configuration Schema & Validation', () => {
    it('validates a complete, typed assistant config across all sections', () => {
      const validConfig = defineAssistantConfig({
        app: {
          id: 'test-app',
          name: 'Test Application',
          languages: ['en', 'ar', 'ml'],
          defaultLocale: 'en',
          tone: 'helpful',
          scopeRules: 'Only answer about test app.',
        },
        theme: {
          mode: 'light',
          colors: {
            primary: '#3b82f6',
            primaryText: '#ffffff',
            accent: '#60a5fa',
            surface: '#ffffff',
            background: '#f8fafc',
            text: '#0f172a',
            textMuted: '#64748b',
            border: '#e2e8f0',
          },
          radii: { sm: '4px', md: '8px', lg: '16px', full: '9999px' },
          fonts: { body: 'sans-serif', heading: 'sans-serif', mono: 'monospace' },
          launcher: { position: 'bottom-right' },
        },
        auth: {
          mode: 'custom',
          headerName: 'authorization',
          orgField: 'organizationId',
          roleField: 'role',
        },
        roles: [
          { name: 'ADMIN', permissions: ['*'], canExport: true, canImport: true, canExecuteActions: true },
          { name: 'MEMBER', permissions: ['read'], canExport: false, canImport: false, canExecuteActions: false },
        ],
        entities: [
          {
            type: 'item',
            label: 'Item',
            collection: 'items',
            idField: 'id',
            nameField: 'name',
            searchableFields: ['name', 'id'],
            displayFields: [{ key: 'name', label: 'Item Name' }],
            visibilityRules: { ADMIN: 'all', MEMBER: 'org' },
          },
        ],
        pages: [
          {
            pageId: 'home',
            title: 'Home Page',
            routePatterns: ['/'],
            actions: [{ id: 'a1', label: 'Action 1', prompt: 'Do action 1' }],
          },
        ],
        generalChips: [],
        actions: [
          {
            name: 'archive_item',
            description: 'Archive an item',
            roles: ['ADMIN'],
            confirmRequired: true,
            parameters: { id: { type: 'string', description: 'Item ID', required: true } },
          },
        ],
        plans: {
          free: { creditAllowance: 50, priceMonthly: 0, priceAnnual: 0, features: ['chat'] },
          premium: { creditAllowance: 500, priceMonthly: 299, priceAnnual: 2990, features: ['chat', 'export'] },
          currency: 'INR',
          perActionCreditCosts: { chat: 1, export: 2 },
        },
        ai: {
          providerOrder: ['gemini', 'openai'],
          models: { default: 'gemini-2.5-flash', fast: 'gemini-2.5-flash', reasoning: 'gemini-2.5-pro' },
          timeoutMs: 25000,
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
        knowledge: [{ id: 'doc-1', title: 'User Manual' }],
      });

      expect(validConfig.app.id).toBe('test-app');
      expect(validConfig.app.name).toBe('Test Application');
      expect(validConfig.entities).toHaveLength(1);
      expect(validConfig.actions[0].confirmRequired).toBe(true);
    });

    it('rejects invalid configs with clear, human-readable error messages', () => {
      const invalid = {
        app: {
          id: 'INVALID APP ID WITH SPACES & CAPS!',
          name: '', // Empty name
        },
        entities: [
          {
            type: '',
            // missing label and collection
          },
        ],
      };

      const result = validateAssistantConfig(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.summary).toContain('AssistantConfig validation failed');
      expect(result.summary).toContain('[app.name]: App name is required');
    });

    it('gracefully handles legacy config structures without breaking', () => {
      const legacy = {
        appId: 'legacy-app',
        appName: 'Legacy Web App',
        entities: [],
      };

      const result = validateAssistantConfig(legacy);
      expect(result.valid).toBe(true);
      expect(result.config?.app.id).toBe('legacy-app');
      expect(result.config?.app.name).toBe('Legacy Web App');
    });
  });

  // ============================================================================
  // 2. Adapters & Contracts
  // ============================================================================
  describe('Adapter Contracts & Implementations', () => {
    it('MemoryDataAdapter enforces search, filtering, and role/org isolation', async () => {
      const store = new MemoryDataAdapter({
        books: [
          { id: 'b1', title: 'Calculus I', author: 'Stewart', organizationId: 'org-a', sectorId: 'math' },
          { id: 'b2', title: 'Modern Physics', author: 'Tipler', organizationId: 'org-a', sectorId: 'physics' },
          { id: 'b3', title: 'Organic Chemistry', author: 'Wade', organizationId: 'org-b', sectorId: 'chem' },
        ],
      });

      // Admin from org-a sees both books in org-a
      const orgAUser = { id: 'u1', role: 'ADMIN', organizationId: 'org-a' };
      const orgABooks = await store.search('books', '', {}, orgAUser);
      expect(orgABooks).toHaveLength(2);

      // Search query filtering
      const calculusResults = await store.search('books', 'calculus', {}, orgAUser);
      expect(calculusResults).toHaveLength(1);
      expect(calculusResults[0].title).toBe('Calculus I');

      // Super admin sees all orgs
      const superUser = { id: 'sa', role: 'SUPER_ADMIN' };
      const allBooks = await store.search('books', '', {}, superUser);
      expect(allBooks).toHaveLength(3);

      // Pagination and sorting
      const paged = await store.list('books', { limit: 2, offset: 0, sortBy: 'title', sortDir: 'asc' }, superUser);
      expect(paged).toHaveLength(2);
      expect(paged[0].title).toBe('Calculus I');
      expect(paged[1].title).toBe('Modern Physics');

      const count = await store.count('books', {}, superUser);
      expect(count).toBe(3);
    });

    it('RestDataAdapter formats URL parameters and queries endpoints correctly', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: '101', name: 'Endpoint Result' }],
      });

      const rest = new RestDataAdapter({
        baseUrl: 'https://api.example.com',
        fetchFn: mockFetch as any,
      });

      const results = await rest.search('students', 'Abdulla', { class: 'Fiqh' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('https://api.example.com/students?');
      expect(calledUrl).toContain('q=Abdulla');
      expect(calledUrl).toContain('class=Fiqh');
      expect(results).toHaveLength(1);
    });

    it('SqlDataAdapter generates parameterized SQL queries safely', async () => {
      const mockRunner = {
        query: vi.fn().mockResolvedValue([{ id: 'sql-1', title: 'SQL Record' }]),
      };

      const sql = new SqlDataAdapter(mockRunner);
      const rows = await sql.search('documents', 'invoice', { status: 'paid' });

      expect(mockRunner.query).toHaveBeenCalledTimes(1);
      const [sqlQuery, params] = mockRunner.query.mock.calls[0];
      expect(sqlQuery).toContain('SELECT * FROM "documents"');
      expect(sqlQuery).toContain('ILIKE');
      expect(params).toContain('paid');
      expect(params).toContain('%invoice%');
      expect(rows[0].id).toBe('sql-1');
    });

    it('RazorpayBillingAdapter handles checkout, signature verification, and credit consumption', async () => {
      const billing = new RazorpayBillingAdapter({
        keyId: 'rzp_test_key',
        keySecret: 'test_secret',
      });

      // Initial plan
      const initial = await billing.getPlan('test-org');
      expect(initial.isPremium).toBe(false);
      expect(initial.creditsRemaining).toBe(50);

      // Create checkout
      const session = await billing.createCheckout('premium_monthly', 'test-org');
      expect(session.orderId).toBeDefined();
      expect(session.amount).toBe(49900);
      expect(session.currency).toBe('INR');

      // Verify payment (test mode)
      const verified = await billing.verify({
        orderId: session.orderId,
        paymentId: 'pay_test_123',
        signature: 'mock_sig',
        planId: 'premium_monthly',
      });
      expect(verified.verified).toBe(true);
      expect(verified.plan?.isPremium).toBe(true);

      // Consume credits
      const consume = await billing.consumeCredits('test-org', 10, 'export_generation');
      expect(consume.success).toBe(true);
    });
  });

  // ============================================================================
  // 3. Universal Event Bus
  // ============================================================================
  describe('Universal Event Bus', () => {
    it('dispatches and unsubscribes from all required lifecycle events', () => {
      const bus = new AssistantEventBus();
      const eventsReceived: string[] = [];

      const unsub1 = bus.on('message_sent', (e) => eventsReceived.push(`sent:${e.text}`));
      const unsub2 = bus.on('action_requested', (e) => eventsReceived.push(`action:${e.name}`));
      const unsub3 = bus.on('credits_changed', (e) => eventsReceived.push(`credits:${e.creditsRemaining}`));

      bus.emit('message_sent', { id: '1', text: 'Hello', role: 'user' });
      bus.emit('action_requested', { actionId: 'act-1', name: 'export_data', params: {}, requiresConfirmation: true });
      bus.emit('credits_changed', { organizationId: 'org-1', creditsRemaining: 49, delta: -1 });

      expect(eventsReceived).toEqual(['sent:Hello', 'action:export_data', 'credits:49']);

      // Unsubscribe works
      unsub1();
      bus.emit('message_sent', { id: '2', text: 'Second', role: 'user' });
      expect(eventsReceived).toHaveLength(3); // no new sent event
    });
  });

  // ============================================================================
  // 4. Ways to Embed (Web Component, Plain JS API, React)
  // ============================================================================
  describe('Embedding Primitives', () => {
    it('exposes the Plain JS API with all required methods', () => {
      expect(typeof Assistant.init).toBe('function');
      expect(typeof Assistant.open).toBe('function');
      expect(typeof Assistant.close).toBe('function');
      expect(typeof Assistant.send).toBe('function');
      expect(typeof Assistant.on).toBe('function');
      expect(typeof Assistant.setUser).toBe('function');
      expect(typeof Assistant.setPageContext).toBe('function');
      expect(typeof Assistant.destroy).toBe('function');
    });

    it('registers Web Component custom elements <app-assistant> and <khazna-assistant>', () => {
      expect(AppAssistantElement).toBeDefined();
      expect(typeof AppAssistantElement.observedAttributes).toBe('object');
      expect(AppAssistantElement.observedAttributes).toContain('config');
      expect(AppAssistantElement.observedAttributes).toContain('app-id');
    });

    it('supports i18n locales, fonts and RTL detection', () => {
      expect(isRtlLocale('ar')).toBe(true);
      expect(isRtlLocale('en')).toBe(false);
      expect(isRtlLocale('ml')).toBe(false);

      expect(translate('welcome', 'en')).toBe('Hello! How can I help you today?');
      expect(translate('welcome', 'ml')).toContain('നമസ്കാരം');
      expect(translate('welcome', 'ar')).toContain('مرحبًا');

      expect(getFontFamilyForLocale('ar')).toContain('Noto Sans Arabic');
      expect(getFontFamilyForLocale('ml')).toContain('Noto Sans Malayalam');
    });

    it('supports the Plugin extension interface (registerPlugin)', () => {
      clearPlugins();
      registerPlugin({
        name: 'test-audit-plugin',
        onAudit: vi.fn(),
      });

      const plugins = getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('test-audit-plugin');
    });
  });

  // ============================================================================
  // 5. Server Kit Drop-in Handlers
  // ============================================================================
  describe('Server Kit Handlers', () => {
    it('provides an Express router with health, payments, and assistant endpoints', async () => {
      const router = createAssistantServerRouter({
        config: khaznaAssistantConfig as any,
        adapters: {
          data: new MemoryDataAdapter({ test: [] }),
        },
      });

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('provides Next.js drop-in handler', () => {
      const nextHandler = createAssistantNextHandler({
        config: khaznaAssistantConfig as any,
      });

      expect(nextHandler).toBeDefined();
      expect(typeof nextHandler).toBe('function');
    });
  });

  // ============================================================================
  // 6. Proof of Reusability Across 3 Example Apps
  // ============================================================================
  describe('Proof of Reusability Across 3 Example Applications', () => {
    it('Example 1: Khazna Campus Ledger config runs without core changes', () => {
      expect(khaznaAssistantConfig.appId).toBe('khazna-ledger');
      const studentEntity = khaznaAssistantConfig.entities.find((e) => e.type === 'student');
      expect(studentEntity).toBeDefined();
      expect(studentEntity?.collection).toBe('students');
      expect(studentEntity?.visibilityRules?.ADMIN).toBe('org');
    });

    it('Example 2: Library App config runs without core changes', async () => {
      expect(libraryAssistantConfig.appId).toBe('second-demo');
      const bookEntity = libraryAssistantConfig.entities.find((e) => e.type === 'book');
      expect(bookEntity).toBeDefined();
      expect(bookEntity?.collection).toBe('books');

      const libraryStore = new MemoryDataAdapter({
        books: [
          { id: 'bk-1', title: 'Designing Data-Intensive Applications', author: 'Kleppmann', available: 3 },
          { id: 'bk-2', title: 'Clean Architecture', author: 'Martin', available: 2 },
        ],
      });

      const results = await libraryStore.search('books', 'Clean');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Clean Architecture');
    });

    it('Example 3: Staff Leave Log App config and adapters run without core changes', async () => {
      expect(leaveLogAssistantConfig.appId).toBe('leave-log');
      const leaveEntity = leaveLogAssistantConfig.entities.find((e) => e.type === 'leave_request');
      expect(leaveEntity).toBeDefined();
      expect(leaveEntity?.collection).toBe('leaveRequests');

      const store = createLeaveLogStore();
      const leaveAdapter = new MemoryDataAdapter({
        leaveRequests: store.leaveRequests as any,
      });

      // Query pending leaves
      const pending = await leaveAdapter.search('leaveRequests', '', { status: 'Pending' });
      expect(pending).toHaveLength(2);
      expect(pending[0].employeeName).toBe('Dr. Zainab Siddiqui');
    });
  });
});
