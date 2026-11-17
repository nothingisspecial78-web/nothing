# QA AI Assistant Assumptions

1. **LLM Provider Fallback Chain:**
   - Production provider order is `openrouter -> gemini -> groq` with fast-fail 3s connection / 8s TTFT timeouts and a 3-strike circuit breaker.
   - When external API keys are absent or offline in automated CI/QA runs, deterministic tool routing (`intentParser`) and the server's built-in governed tool handlers (`agentLoop` + `scopedDataRepository` + `khaznaTools`) execute end-to-end against real seeded data without calling external paid endpoints.

2. **Server-Side AccessScope Trust Boundary:**
   - `AccessScope` (`PUBLIC`, `STUDENT`, `SECTOR_MANAGER`, `ADMIN`, `SUPER_ADMIN`) is resolved server-side from verified tokens (`Bearer` JWT for `SUPER_ADMIN`, scoped tokens for tenant roles). Client-sent `appState` or prompt text cannot widen scope or access cross-sector / cross-student / cross-org data.
   - Any attempt by `ADMIN`, `SECTOR_MANAGER`, or `STUDENT` to switch/delete organizations or read out-of-scope entities is rejected server-side and guarded client-side.

3. **Zero-Privacy Leakage During Guides:**
   - Password fields (`[data-guide-sensitive="true"]`, `input[type="password"]`) trigger the 3D avatar eye-closing privacy state purely in browser DOM state; password characters are never read, stored in guide progress, or transmitted in `/api/assistant/*` network payloads.

4. **Suggested Actions & Chat State:**
   - Opening the AI Assistant starts a clean new chat where role-aware suggested actions are visible. Once a conversation begins (`messages.length > 0`), the welcome suggestion list disappears cleanly.

5. **Spreadsheet Uploads:**
   - Uploads go through `POST /api/assistant/upload` with role checks (`STUDENT` and `PUBLIC` blocked), column-header validation, and two-step confirmation before modifying workspace state.
