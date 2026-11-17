# Implementation Changes & Assumptions Log

**Master Project:** Khazna AI Assistant Speed Fix + Role-Based Per-User Assistant + Provider Fallback Chain + Prompt Chips

---

## 1. Assumptions & Design Decisions

1. **Authentication & Token Derivation:**
   - In production or authenticated mode, identity and role are derived strictly from a cryptographically signed JWT token passed in `Authorization: Bearer <token>`.
   - Structured demo token format supported for zero-config role switching: `demo:<role>:<userId>:<sectorId>:<studentId>`.
   - In demo mode without explicit token, defaults securely based on current workspace session while ensuring students cannot perform write actions or inspect other student records.
   - Client requests with untrusted body claims cannot elevate privileges; backend relies solely on the verified `AccessScope`.

2. **Provider Fallback Chain:**
   - Order: `openrouter -> gemini -> groq` strictly sequential.
   - Fast models:
     - OpenRouter: `openai/gpt-4o-mini`
     - Gemini: `gemini-2.5-flash`
     - Groq: `llama-3.3-70b-versatile`
   - Fast timeouts: Connect 3000ms, TTFT 8000ms, Total 45000ms.
   - Circuit breaker: 3 failures within 60s marks provider `OPEN` for 60s cooldown; downstream requests skip the dead provider with 0ms delay.
   - Mid-stream failure handling: Emits `stream_reset` SSE event before hopping to next provider, preventing duplicated response text.

3. **Per-User History & Memory Isolation:**
   - Database schema: `supabase/migrations/002_role_assistant_tables.sql` creates `assistant_conversations`, `assistant_messages`, `assistant_user_profile`, `assistant_chip_usage`, `assistant_audit_logs`.
   - Scoped RAG: Added `visibility: 'all' | 'manager' | 'admin'` to document chunks and `match_assistant_chunks_scoped` function.
   - In-memory resilient dual backend in `packages/server/src/db/assistantRepository.ts` enables 100% offline test execution.

4. **Page & Role-Aware Prompt Chips:**
   - Central page registry in `packages/server/src/chips/pageRegistry.ts`.
   - Route mapping from URL pathname to canonical pageId (`admin.*`, `manager.*`, `student.*`, `global`).
   - Dynamic evaluation for dues > 0, unassigned sectors > 0, and unpaid students.
   - In-memory frequency and fatigue ranking (< 80ms execution, zero LLM in default path).
   - Malayalam (`ml`) and English (`en`) bilingual label & prompt support.

5. **Performance & Vite Fixes:**
   - LRU embedding cache (500 items, 10 min TTL) eliminates repeat vector generation latency.
   - Background conversation summarizer compacts history over 12 messages.
   - Fixed Vite 8 `recharts` / `react-is` pre-bundling issue by configuring `optimizeDeps.include: ['recharts', 'react-is']` in `vite.config.ts` and clearing stale `.vite` cache.
