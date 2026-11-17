# Changelog

All notable changes to the AI Assistant SDK will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-11-16

### Major Refactoring: Universal App Integration SDK
Transformed the existing AI Assistant into an app-agnostic, universal integration SDK capable of embedding into any web application (college ledger, library, leave log, shop, hospital, etc.) via pure configuration.

#### Added
- **Unified Configuration Schema (`assistant.config.ts`)**:
  - Implemented typed Zod validation schema `AssistantConfigSchema` with sections: `app`, `theme`, `auth`, `roles`, `entities`, `pages`, `actions`, `plans`, `ai`, `features`, `knowledge`.
  - Added `defineAssistantConfig` helper and `validateAssistantConfig` with clear, human-readable error messages specifying the exact path of missing or invalid fields.
- **Pluggable Adapter Architecture**:
  - Defined TypeScript contracts: `AuthAdapter`, `DataAdapter`, `ActionAdapter`, `PageContextAdapter`, `BillingAdapter`.
  - Built ready-made backend adapter helpers:
    - `MemoryDataAdapter`: high-speed in-memory search with organization/sector role isolation for testing and sample apps.
    - `RestDataAdapter` & `RestAuthAdapter`: drop-in adapters for HTTP REST APIs and `/me` routes.
    - `SupabaseDataAdapter` & `SupabaseAuthAdapter`: drop-in adapters utilizing `@supabase/supabase-js`.
    - `FirestoreDataAdapter`: drop-in adapter for Firebase Firestore collections.
    - `SqlDataAdapter`: drop-in parameterized SQL adapter for relational databases and Prisma/Drizzle ORMs.
    - `RazorpayBillingAdapter`: drop-in payment provider with HMAC SHA-256 signature verification and credit tracking.
- **Universal Embedding Formats**:
  - **Web Component**: `<app-assistant>` (and backward-compatible `<khazna-assistant>`) isolated with Shadow DOM (`mode: 'open'`) to eliminate host CSS conflicts.
  - **React Package**: `<AssistantProvider>` context provider and `useAssistant()` hook.
  - **Plain JS API**: `Assistant.init()`, `open()`, `close()`, `send()`, `on()`, `setUser()`, `setPageContext()`, `destroy()`.
- **Universal Event Bus**:
  - Implemented `AssistantEventBus` with typed events: `message_sent`, `response_received`, `action_requested`, `action_confirmed`, `action_completed`, `error`, `credits_changed`, `plan_changed`, `file_attached`.
- **Server Kit**:
  - `createAssistantServerRouter`: Drop-in Express router containing `/assistant`, `/health` diagnostic doctor, `/payments/*`, `/export`, and `/import`.
  - `createAssistantNextHandler`: Drop-in handler for Next.js App Router and Pages Router API routes.
  - Multi-tenant tenant isolation scoped to user's organization on the server.
- **Scaffolding & Developer Experience**:
  - Added CLI tool (`scripts/cli.ts`, `npm run cli`, `npm run doctor`):
    - `init`: Generates starter `assistant.config.ts` and adapters for chosen backend.
    - `doctor`: Diagnoses configuration validity, environment variable presence (names only), model reachability, and adapter queries.
    - `zip`: Prepares distribution bundles for hackathons.
- **Example Applications**:
  - Example 1: **Khazna Campus Ledger** (`apps/demo-college-finance`) on pure SDK.
  - Example 2: **Campus Library Manager** (`apps/second-demo-app`) with book catalog search and loan actions.
  - Example 3: **Staff Leave Log App** (`apps/leave-log-app`) with leave request lookup, approval workflows, and seed data.
- **Multi-lingual i18n & Accessibility**:
  - Full translations and typography support for English (`en`), Malayalam (`ml`), and Arabic (`ar`).
  - Automatic RTL layout direction support for Arabic and RTL locales.

#### Changed
- Removed all hardcoded Khazna-specific logic from the core packages (`@ai-assistant/core`), moving application entities and behaviors entirely into configuration.
- Made the entity registry fully declarative and app-agnostic.

#### Backward Compatibility
- Existing Khazna Campus Ledger behaviors, data lookups, exports, suggestion chips, Razorpay test payments, 3D avatar visualizers, and test suites remain 100% functional.
