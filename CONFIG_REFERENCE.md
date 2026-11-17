# Universal AI Assistant SDK — Configuration & Adapter Reference

This document provides a comprehensive reference of all configuration options, adapter contracts, and lifecycle events available in the **Universal AI Assistant SDK**.

---

## 1. The One Config File (`assistant.config.ts`)

Configurations are defined using `defineAssistantConfig(config)` which validates the schema using Zod at runtime and provides compile-time TypeScript autocomplete.

```typescript
import { defineAssistantConfig } from '@ai-assistant/core';

export const assistantConfig = defineAssistantConfig({
  app: { /* ... */ },
  theme: { /* ... */ },
  auth: { /* ... */ },
  roles: [ /* ... */ ],
  entities: [ /* ... */ ],
  pages: [ /* ... */ ],
  actions: [ /* ... */ ],
  plans: { /* ... */ },
  ai: { /* ... */ },
  features: { /* ... */ },
  knowledge: [ /* ... */ ],
});
```

### Configuration Sections Reference

| Section | Key | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`app`** | `id` | `string` | *required* | Unique identifier for the app (`^[a-z0-9-_]+$`). |
| | `name` | `string` | *required* | Human-readable app name displayed in headers and dialogs. |
| | `logo` | `string?` | `undefined` | URL or base64 SVG logo for the assistant panel. |
| | `languages` | `string[]` | `['en']` | Supported languages (e.g. `['en', 'ml', 'ar']`). |
| | `defaultLocale` | `string` | `'en'` | Default locale code (`'en'`, `'ml'`, `'ar'`). |
| | `tone` | `string` | `'helpful...'` | System personality tone. |
| | `scopeRules` | `string` | *standard* | App boundaries ("Answer only questions about this app"). |
| **`theme`** | `mode` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Visual color mode. |
| | `colors.primary` | `string` | `'#0ea5e9'` | Primary brand color. |
| | `colors.accent` | `string` | `'#38bdf8'` | Accent / highlight color. |
| | `colors.surface` | `string` | `'#ffffff'` | Panel background color. |
| | `colors.text` | `string` | `'#0f172a'` | Primary text color. |
| | `radii.sm/md/lg` | `string` | `'4px'/'8px'/'16px'` | Border corner radius tokens. |
| | `launcher.position` | `string` | `'bottom-right'` | `'bottom-right'`, `'bottom-left'`, `'top-right'`, `'top-left'`. |
| **`auth`** | `mode` | `'jwt' \| 'session' \| 'custom'` | `'custom'` | Host authentication mode. |
| | `orgField` | `string` | `'organizationId'` | Tenant identifier field on user records. |
| | `roleField` | `string` | `'role'` | Role identifier field on user records. |
| **`roles`** | `roles[]` | `RoleDefinition[]` | `[]` | List of system roles with permission flags (`canExport`, `canImport`, `canExecuteActions`). |
| **`entities`**| `entities[]` | `EntityDefinition[]` | `[]` | The Entity Registry declaring searchable models, export columns, sensitive fields, and RBAC rules. |
| **`pages`** | `pages[]` | `PageConfig[]` | `[]` | Route patterns mapping pages to suggested prompts and contextual chips. |
| **`actions`** | `actions[]` | `ActionDefinition[]` | `[]` | Declarative tools with input schemas and confirmation requirements. |
| **`plans`** | `free.creditAllowance` | `number` | `50` | Monthly free credit allocation. |
| | `premium.creditAllowance` | `number` | `1000` | Monthly premium credit allocation. |
| | `perActionCreditCosts` | `Record<string, number>` | `{ chat: 1, export: 2, ... }` | Credit charge per operation type. |
| **`ai`** | `providerOrder` | `string[]` | `['gemini', 'openai']` | Fallback order of LLM providers. |
| | `models.default` | `string` | `'gemini-2.5-flash'` | Standard model used for chat and chips. |
| | `models.reasoning` | `string` | `'gemini-2.5-pro'` | Strong model used for complex queries and tools. |
| **`features`**| `chips` | `boolean` | `true` | Enable dynamic suggestion chips. |
| | `export` | `boolean` | `true` | Enable client/server data exports (Excel, PDF, DOCX, CSV). |
| | `attachments` | `boolean` | `true` | Enable multi-modal document & image uploads. |
| | `payments` | `boolean` | `true` | Enable Razorpay billing and upgrades. |
| | `avatar3d` | `boolean` | `true` | Enable Three.js 3D animated assistant visualizer. |
| | `coBrowserGuide` | `boolean` | `true` | Enable interactive DOM co-browsing and highlight guides. |
| **`knowledge`**| `knowledge[]` | `KnowledgeDoc[]` | `[]` | Extension point for RAG documentation chunks. |

---

## 2. Adapter Contracts & Methods

The host application supplies implementations of the adapter interfaces.

### `AuthAdapter`
Resolves the active user, tenant organization, and permission privileges:
```typescript
export interface AuthAdapter {
  getCurrentUser(req?: unknown): Promise<UserContext | null>;
  getOrganizationId(req?: unknown): Promise<string | null>;
  hasPermission(permission: string, user?: UserContext): Promise<boolean>;
}
```

### `DataAdapter`
Searches and retrieves application records strictly under the user's role and organization scope:
```typescript
export interface DataAdapter {
  search(entityType: string, query: string, filters?: Record<string, unknown>, user?: UserContext): Promise<Record<string, unknown>[]>;
  getById(entityType: string, id: string, user?: UserContext): Promise<Record<string, unknown> | null>;
  list(entityType: string, options?: SearchOptions, user?: UserContext): Promise<Record<string, unknown>[]>;
  count(entityType: string, filters?: Record<string, unknown>, user?: UserContext): Promise<number>;
}
```

### `ActionAdapter`
Executes data modifications with a mandatory confirmation step for destructive operations:
```typescript
export interface ActionAdapter {
  requiresConfirmation(actionName: string, params: Record<string, unknown>): boolean;
  executeAction(actionName: string, params: Record<string, unknown>, user?: UserContext): Promise<ActionResult>;
}
```

### `PageContextAdapter`
Observes and synchronizes current browser route and selected items:
```typescript
export interface PageContextAdapter {
  getCurrentPage(): PageContext;
  subscribe(listener: (context: PageContext) => void): () => void;
}
```

### `BillingAdapter`
Manages credit balances, Razorpay checkout orders, and signature verifications:
```typescript
export interface BillingAdapter {
  getPlan(orgId: string): Promise<PlanStatus>;
  createCheckout(planId: string, orgId: string, user?: UserContext): Promise<CheckoutSession>;
  verify(payload: PaymentVerificationPayload): Promise<{ verified: boolean; plan?: PlanStatus }>;
  consumeCredits(orgId: string, amount: number, reason: string): Promise<{ success: boolean; remaining: number }>;
}
```

---

## 3. Ready-Made Adapter Helpers

| Adapter Class | Backend Supported | Description |
| :--- | :--- | :--- |
| `RestDataAdapter` | Any REST API | Queries standard `/api/{entity}` endpoints with query params and headers. |
| `RestAuthAdapter` | Any `/me` API | Fetches user identity and permissions from host `/me` route. |
| `SupabaseDataAdapter`| Supabase / PostgreSQL | Uses `@supabase/supabase-js` client with RLS and schema queries. |
| `SupabaseAuthAdapter`| Supabase Auth | Extracts user context directly from `supabase.auth.getUser()`. |
| `FirestoreDataAdapter`| Firebase Firestore | Queries Google Cloud / Firebase Firestore collections. |
| `SqlDataAdapter` | Prisma / Drizzle / SQL | Executes parameterized queries safely across PostgreSQL, MySQL, SQLite. |
| `MemoryDataAdapter` | In-memory Object / Mock | High-performance in-memory search for tests, prototypes, and sample apps. |
| `RazorpayBillingAdapter`| Razorpay Payments | Built-in test and live payment gateway with HMAC verification. |

---

## 4. Universal Lifecycle Events

The SDK emits typed lifecycle events accessible via `Assistant.on(event, handler)` or `useAssistant().on`:

| Event Name | Payload Attributes | Description |
| :--- | :--- | :--- |
| `message_sent` | `id, text, role, attachments, timestamp` | Triggered when user submits a query. |
| `response_received` | `id, text, role, actions, timestamp` | Triggered when model response stream finishes. |
| `action_requested` | `actionId, name, params, requiresConfirmation` | Emitted when assistant invokes a tool. |
| `action_confirmed` | `actionId, name, params, timestamp` | Emitted when user approves a pending write action. |
| `action_completed` | `actionId, name, result, success, timestamp` | Emitted when action handler concludes. |
| `credits_changed` | `organizationId, creditsRemaining, delta, reason` | Emitted on credit deduction or plan top-up. |
| `plan_changed` | `organizationId, planId, isPremium, timestamp` | Emitted after successful subscription upgrade. |
| `file_attached` | `name, size, mimeType, timestamp` | Emitted when a document or image is uploaded. |
| `error` | `code, message, details, timestamp` | Emitted on network or runtime failures. |
