# Prompt Chips Implementation Changes & Assumptions

---

## 1. Assumptions & Design Decisions for Chips

1. **Route to Page Mapping:**
   - TanStack Router pathname is matched against `PageDef.routePattern`.
   - Dynamic route parameters (e.g. `/m/dept-fiqh/ledger` -> `sectorSlug: 'dept-fiqh'`) are validated against `AccessScope.sectorIds`.
   - If a Student attempts to pass an admin `pageId` (`admin.audit`), the server rejects the hint and serves the default Student dashboard chips.

2. **Multilingual Content:**
   - Every chip provides `{ en: string; ml: string }` for both label (short, <=40 chars) and prompt (natural question).
   - If language is `'ml'`, Malayalam text is served; otherwise English is served.

3. **Performance Budget:**
   - Static registry chips are cached in-memory per `(role, pageId, lang)` for 5 minutes.
   - Dynamic chips are evaluated with a strict 80ms timeout; if an asynchronous DB check takes longer, the endpoint returns static chips immediately to ensure <100ms response times.
   - User chip usage stats are updated asynchronously in the background.

4. **Follow-up Chips:**
   - Fast deterministic path: maps the executed action or answered topic to relevant follow-up chips from the registry.
   - Dispatched immediately via the SSE `followup_chips` event or response headers.
