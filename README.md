# Universal AI Assistant SDK

A production-ready, app-agnostic **Universal App Integration SDK** that allows developers to add a full-featured AI Assistant (chat, live entity lookup, multi-format export, suggestion chips, attachments, Razorpay payments, theme tokens, and 3D visuals) to **any web application in minutes** purely via configuration.

---

## 🏗 Architecture Layers

The SDK is organized into four clean, decoupled layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          HOST WEB APPLICATION                          │
│     (College Ledger / Campus Library / Staff Leave Log / Shop / Etc.)  │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
                   ▼ (1. Embed UI)                   ▼ (2. Mount Server)
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│  UI & EMBEDDING LAYER                │  │  SERVER KIT                  │
│  - Web Component (<app-assistant>)   │  │  - Express drop-in router    │
│    (Shadow DOM isolated)             │  │  - Next.js / Vercel handler  │
│  - React Package (<AssistantProvider>│  │  - /assistant (SSE stream)   │
│    & useAssistant hook)              │  │  - /health (Doctor check)    │
│  - Plain JS API (Assistant.init)     │  │  - /payments/* (Razorpay)    │
│  - Driven by theme tokens            │  │  - /export & /import         │
└──────────────────┬───────────────────┘  └──────────────┬───────────────┘
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│  CORE SDK (@ai-assistant/core)                                         │
│  - App-Agnostic Engine (Zero Khazna-specific words or logic)          │
│  - Typed, validated config schema (assistant.config.ts with Zod)       │
│  - Entity Registry (searchable fields, display, export columns, RBAC)  │
│  - Universal Event Bus (message_sent, action_requested, etc.)         │
│  - i18n & Accessibility (English, Malayalam, Arabic + RTL)             │
│  - Plugin System (RAG, memory, audit, custom hooks)                    │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ADAPTERS LAYER                                                        │
│  - Contracts: AuthAdapter, DataAdapter, ActionAdapter, BillingAdapter  │
│  - Ready-made helpers: REST, Supabase, Firestore, SQL/ORM, Memory      │
│  - Razorpay Billing Adapter (test & production payment verification)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ 15-Minute Integration

### 1. Generate Configuration & Adapters
```bash
npx ai-assistant init --name "My App" --backend rest
# Available backends: rest | supabase | firebase | sql
```

### 2. Mount Server Kit (Express or Next.js)
```typescript
import express from 'express';
import { createAssistantServerRouter } from '@ai-assistant/server';
import { assistantConfig } from './assistant.config';
import { adapters } from './assistant.adapters';

const app = express();
app.use(express.json());

// Mount the drop-in Universal Assistant SDK router:
app.use('/api', createAssistantServerRouter({
  config: assistantConfig,
  adapters,
}));

app.listen(3000);
```

### 3. Embed in Frontend
Choose any embedding format:

#### A. Web Component (Isolated with Shadow DOM)
```html
<script src="/dist/assistant.js"></script>
<app-assistant app-id="my-app" api-url="/api"></app-assistant>
```

#### B. React Package
```tsx
import { AssistantProvider, AssistantWidget } from '@ai-assistant/widget';
import { assistantConfig } from './assistant.config';

export function Root() {
  return (
    <AssistantProvider config={assistantConfig} apiUrl="/api">
      <YourApp />
      <AssistantWidget />
    </AssistantProvider>
  );
}
```

#### C. Plain JavaScript API
```javascript
import { Assistant } from '@ai-assistant/widget';

Assistant.init(assistantConfig, { apiUrl: '/api' });
Assistant.open();
Assistant.send("Show summary of pending items");
Assistant.on('credits_changed', (evt) => console.log(evt.creditsRemaining));
```

---

## 🩺 Diagnostic Doctor Command

Run the doctor command to verify configuration, environment variables, model connectivity, and adapters:
```bash
npm run doctor
```

---

## 🏢 Three Example Applications Included

1. **Khazna Campus Ledger (`apps/demo-college-finance`)**:
   - Config: Student fees, principal & teacher directories, financial sectors, and funds.
   - Features: Multilingual exports (Excel, PDF with Unicode Noto Malayalam/Arabic fonts), 3D avatar visualizer, Razorpay test payments.
2. **Campus Library Manager (`apps/second-demo-app`)**:
   - Config: Book catalog, shelves, active loans.
   - Features: Search by title/ISBN, loan status lookup, return actions.
3. **Staff Leave Log App (`apps/leave-log-app`)**:
   - Config: Employee leave requests, departments, approvals.
   - Features: Filter pending leaves, approval actions with confirmation-before-write.

Switching between applications requires **only config & adapter changes, with zero core code changes**.

---

## 🧪 Testing & Verification

Run the full Vitest test suite:
```bash
npm test
```
All 9 test suites and 60 test cases validate config parsing, adapter contracts, RBAC isolation, billing, embedding formats, and example apps.

---

## 📦 Building the SDK Bundle

Build the browser standalone bundle:
```bash
npm run build:widget
```
Output:
- `packages/widget/dist/assistant.js`
- Ready for `<script src="...">` or custom element embedding.

---

## 📖 Further Documentation
- [15-Minute Integration Guide](file:///d:/Poomon/poomon/sibaq/ai%20assistant%203.0/INTEGRATION_GUIDE.md)
- [Configuration & Adapter Reference](file:///d:/Poomon/poomon/sibaq/ai%20assistant%203.0/CONFIG_REFERENCE.md)
- [Changelog](file:///d:/Poomon/poomon/sibaq/ai%20assistant%203.0/CHANGELOG.md)
