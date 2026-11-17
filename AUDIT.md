# AI Assistant Architecture & Security Audit

**Date:** 2026-11-14  
**Target:** Embedded AI Assistant (`appId="khazna-ledger"`) within Khazna Campus Ledger monorepo  
**Stack:** Express, TypeScript, Vite, React 19, Supabase pgvector / In-Memory Store, OpenRouter / Gemini / Groq

---

## 1. Request Flow Overview Today

```
[Browser / Khazna App]
       │
       ▼ (User Prompt, Clicked Chip, Voice, or Attached Card)
[packages/widget/src/AssistantWidget.tsx]
       │  (Manages open/collapse state, active thread, 3D avatar kinematics)
       ▼
[packages/widget/src/hooks/useChatStream.ts]
       │  (Submits fetch to POST /api/chat with SSE response parsing)
       ▼
[packages/server/src/routes/chat.ts]
       │
       ├─► [auth.ts / createAuthMiddleware]
       │     (Checks Authorization Bearer or x-app-id; validates JWT or /me endpoint)
       │
       ├─► [rag/retriever.ts & embedder.ts]
       │     (Generates embedding, queries VectorStore for top matching chunks)
       │
       ├─► [llm/prompts.ts]
       │     (Builds system prompt including app docs, live appState, tools list)
       │
       ├─► [llm/agentLoop.ts]
       │     (Evaluates intent, runs tool calling loop, executes tools with confirmation)
       │
       ├─► [llm/client.ts]
       │     (Dispatches LLM chat completion/stream across providers)
       │
       ▼
[SSE Event Stream back to Widget]
       (event: status, token, tool_call, confirmation_required, action_executed, done)
```

---

## 2. Authentication, Identity & Scope Extraction Today

- **Where Auth Data Originates:**  
  In `KhaznaAssistant.tsx`, client-side Zustand store (`useKhazna`) tracks:
  - `activeOrgId`: Current college workspace (e.g. `'demo'`)
  - `currentRole`: Active role (`'admin'`, `'manager'`, `'student'`)
  - `meStudentId`: Current student ID if student (e.g. `'S0125'`)
  - `managerSector`: Current manager sector if manager (e.g. `'dept-fiqh'`)
  - `adminEmail`: Super admin email
- **Current Token Transmission:**  
  In `packages/server/src/auth.ts`:
  - Profile auth mode was set to `'none'` for demo mode, which defaulted token verification to `{ userId: 'anonymous', role: 'viewer', rawToken: '' }`.
  - The client passed `appState` containing role details in the request body.
- **Security Gap Identified (Critical):**  
  The backend did not derive `AccessScope` strictly from a cryptographically signed token or verified session on every request. Relying on request-body fields (`appState.currentRole`) allowed client-side tampering where an attacker could send `currentRole: 'admin'` in the JSON body.
- **Remediation in Section 4:**  
  1. Implement a verified server-side `AccessScope` contract:
     ```ts
     export type AccessScope =
       | { role: 'SUPER_ADMIN'; userId: string }
       | { role: 'SECTOR_MANAGER'; userId: string; sectorIds: string[] }
       | { role: 'STUDENT'; userId: string; studentId: string; sectorId: string };
     ```
  2. Mint and verify signed JWT session tokens for all Khazna identities (`SUPER_ADMIN`, `SECTOR_MANAGER`, `STUDENT`). Reject client-supplied role tampering in request bodies or query parameters.

---

## 3. History Storage & Conversation Management Today

- **Current Storage Location:**  
  History is stored entirely in the user's browser `localStorage` via `packages/widget/src/hooks/useChatStorage.ts`.
- **Security & Multi-Tenant Gap:**  
  - If multiple users share the same browser or if a user switches roles, conversations were partitioned by `userKey` string in localStorage, but no backend isolation or database durability existed.
  - A user could not sync history across devices.
  - The server did not enforce per-user read/write boundaries on chat history.
- **Remediation in Section 4.5:**  
  1. Add backend database tables: `assistant_conversations` and `assistant_messages` with foreign keys and index on `(user_id, created_at desc)`.
  2. Implement server-side CRUD endpoints (`/api/assistant/conversations`) where every query enforces `WHERE user_id = :authUserId`.
  3. Implement rolling conversation summaries (under 150 words) to replace unbounded chat history in LLM prompts.

---

## 4. Provider Calling & Latency Bottlenecks Today

- **Current Providers:** OpenRouter, Gemini, Groq.
- **Issues Found:**
  1. **Strict Order Missing:** Providers were ordered based on configuration heuristics without a strict, reliable sequential fallback chain (`openrouter -> gemini -> groq`).
  2. **Timeout Delays:** Dead or slow providers had 25s timeouts. A failing request to OpenRouter took 14 seconds to fail before cascading.
  3. **No Circuit Breaker:** Repeated failures to a down provider penalized every single subsequent user request.
  4. **Mid-stream Breakage:** Streams that dropped midway did not emit a clean `stream_reset` event to reset the client UI before retrying on the next provider.
- **Remediation in Section 2:**  
  Implement `LLMProviderChain` with strict order `openrouter -> gemini -> groq`, 3s connect timeout, 8s TTFT timeout, 3-strike circuit breaker (60s cooldown), and `stream_reset` handling.

---

## 5. Security Gaps Summary & Target Fixes

| Vulnerability / Gap | Location | Fix in Scope |
| :--- | :--- | :--- |
| **Client-controlled Role & Scope** | `packages/server/src/routes/chat.ts` | Derive `AccessScope` strictly from verified JWT token header. Never trust request body `role` or `userId`. |
| **Unscoped Tool Invocations** | `packages/server/src/tools/khaznaTools.ts` | Filter tool definitions exposed to LLM by role; enforce `AccessScope` at execution time for all tool handlers. |
| **Unpartitioned RAG Knowledge** | `packages/server/src/rag/store.ts` | Add `visibility: 'all' \| 'manager' \| 'admin'` to document chunks; pre-filter before vector similarity search. |
| **Shared Answer Cache Leakage** | `packages/server/src/security/limits.ts` | Include full scope hash (`role + sectorIds + studentId`) in cache keys. |
| **Missing Timing Metrics** | `packages/server/src/routes/chat.ts` | Add end-to-end `X-Timing` header and structured server logging for all execution phases. |
