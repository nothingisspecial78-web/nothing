# Universal AI Assistant SDK — Integrate in 15 Minutes

The **Universal App Integration SDK** turns the AI Assistant into a drop-in integration library that can be embedded into **any web application** (college ledger, campus library, staff leave log, e-commerce shop, hospital clinic, etc.) in minutes purely by configuration.

---

## ⚡ 3-Step Quickstart

### Step 1: Scaffold Configuration & Adapters
Run the scaffolding CLI:
```bash
npx ai-assistant init --name "My Web App" --backend rest
# Or for other backends:
# npx ai-assistant init --name "Clinic Portal" --backend supabase
# npx ai-assistant init --name "School Hub" --backend firebase
# npx ai-assistant init --name "Shop Manager" --backend sql
```
This generates:
- `assistant.config.ts`: The typed, validated configuration file.
- `assistant.adapters.ts`: The pluggable backend adapters (Auth, Data, Actions, Billing).

---

### Step 2: Mount Server Kit Routes
In your backend (Express or Next.js / Vercel):

#### Express Backend
```typescript
import express from 'express';
import { createAssistantServerRouter } from '@ai-assistant/server';
import { assistantConfig } from './assistant.config.ts';
import { adapters } from './assistant.adapters.ts';

const app = express();
app.use(express.json());

// Mount the drop-in Universal Assistant SDK router:
app.use('/api', createAssistantServerRouter({
  config: assistantConfig,
  adapters,
}));

app.listen(3000, () => console.log('Server running on port 3000'));
```

#### Next.js / Vercel API Route (`app/api/assistant/[...route]/route.ts`)
```typescript
import { createAssistantNextHandler } from '@ai-assistant/server';
import { assistantConfig } from '@/assistant.config';
import { adapters } from '@/assistant.adapters';

const handler = createAssistantNextHandler({
  config: assistantConfig,
  adapters,
});

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
```

---

### Step 3: Embed in Your Frontend

Choose whichever embedding option fits your frontend stack:

#### Option A: Script Tag & Web Component (Isolated with Shadow DOM)
Works with plain HTML, WordPress, PHP, Django, Rails, Vue, Angular, or Svelte:
```html
<!-- Include the bundled script -->
<script src="/dist/assistant.js"></script>

<!-- Drop the web component anywhere in your page -->
<app-assistant app-id="my-web-app" api-url="/api"></app-assistant>
```
*Note: The Web Component uses Shadow DOM (`mode: 'open'`) to guarantee that host styles never clash with assistant styles.*

#### Option B: React Package (`<AssistantProvider>` & Hook)
```tsx
import React from 'react';
import { AssistantProvider, AssistantWidget, useAssistant } from '@ai-assistant/widget';
import { assistantConfig } from './assistant.config';
import { adapters } from './assistant.adapters';

export function App() {
  return (
    <AssistantProvider config={assistantConfig} adapters={adapters} apiUrl="/api">
      <YourAppContent />
      <AssistantWidget />
    </AssistantProvider>
  );
}

// In any child component:
export function CustomHeaderButton() {
  const { open, credits, user } = useAssistant();
  return (
    <button onClick={open}>
      Ask AI ({credits} credits remaining)
    </button>
  );
}
```

#### Option C: Plain JavaScript API (`Assistant`)
```javascript
import { Assistant } from '@ai-assistant/widget';
import { assistantConfig } from './assistant.config';

// 1. Initialize
Assistant.init(assistantConfig, { apiUrl: '/api' });

// 2. Control panel
Assistant.open();
Assistant.close();

// 3. Send message programmatically
Assistant.send("Show me students with pending fees");

// 4. Listen to lifecycle events
Assistant.on('action_requested', (event) => {
  console.log(`Action requested: ${event.name}`, event.params);
});

Assistant.on('credits_changed', (event) => {
  console.log(`Credits remaining: ${event.creditsRemaining}`);
});

// 5. Update user or page context on route changes
Assistant.setUser({ id: 'usr-12', role: 'ADMIN', organizationId: 'org-main' });
Assistant.setPageContext({ route: '/ledger', pageName: 'General Ledger' });
```

---

## 🩺 Verifying Your Setup with the Doctor Command
Run the diagnostic command:
```bash
npm run doctor
# Or: node scripts/cli.ts doctor
```
The Doctor checks:
1. Config validity (`assistant.config.ts` validated with Zod)
2. Environment variables present (names only, secrets never exposed)
3. Model gateway reachability
4. Core adapters readiness
5. Theme tokens loaded

---

## 🏢 Proof of Reusability: 3 Example Apps
Switching between completely different domains requires **only config & adapter changes**, with **zero core changes**:

1. **Khazna Campus Ledger (`apps/demo-college-finance`)**:
   - Entities: Students, Principals, Teachers, Sectors, Funds.
   - Financial ledger lookup, Excel/PDF exports with Malayalam & Arabic fonts, 3D avatar.
2. **Campus Library App (`apps/second-demo-app`)**:
   - Entities: Books, Shelves, Members, Loans.
   - Catalog search, loan checkout, return actions.
3. **Staff Leave Log App (`apps/leave-log-app`)**:
   - Entities: Leave Requests, Teachers, Staff.
   - Pending leave review, approval workflows with human-in-the-loop confirmation.
