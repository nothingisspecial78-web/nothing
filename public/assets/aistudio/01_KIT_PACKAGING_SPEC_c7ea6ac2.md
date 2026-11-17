# SPEC 1 of 2: AI ASSISTANT KIT - PACKAGING SPECIFICATION

**Audience:** the AI coding agent (Google AI Studio Build) that built the AI assistant inside the reference web app.
**Goal:** extract the assistant, with ALL features, into ONE self-contained, reusable folder and zip called the **AI Assistant Kit**, so that any other web app can adopt it later.
**Companion file:** `02_KIT_INTEGRATION_SPEC.md` (used later, in the NEW app, by a different agent).

---

## 0. HOW YOU MUST READ THIS FILE
1. Read this file word by word, from the first line to the last, BEFORE touching any code.
2. Build a numbered REQUIREMENTS CHECKLIST from it: every F-feature, every folder rule, every README rule, every zip rule, every quality gate. Print the checklist.
3. Implement EVERY item. Do not skip, merge, shorten or "leave for later". If an item is impossible in this environment, say so explicitly in the final report with the reason and the closest alternative.
4. At the end, print the checklist again with each item marked DONE or NOT DONE and the file path that proves it.
5. If this file and the existing code disagree, follow this file, and mention the difference in the report.

## 1. NON-NEGOTIABLE RULES
- The reference app must keep working exactly as before. After the extraction it must consume the assistant FROM the kit. This proves the kit is complete.
- The 3D avatar, its animations and its alignment must not be changed or reduced.
- No secrets (API keys, Razorpay keys, passwords, tokens) inside the kit. Placeholders only.
- The core must never hardcode reference-app words such as "sector", "student", "ledger", "admission number". Those belong in the adapter.
- Use existing open-source libraries first (F16). Write new code only where none exists.
- Match the project's existing stack and language. Do not migrate frameworks.

## 2. WORKFLOW (phases, each ends with a QA pass - F19)
**Phase A - Audit.** Scan the whole project. Produce an INVENTORY: every file, function, component, hook, API route, DB collection/table, security rule, asset (3D model, avatar, icons, fonts), npm dependency and environment variable that belongs to the assistant. Print it before moving any code.
**Phase B - Classify.** Mark each inventory item as CORE (app-independent) or ADAPTER (app-specific). Items that mix both must be split.
**Phase C - Refactor.** Move CORE items into the kit. Move ADAPTER items into a single adapter config, and leave the reference app's values there as a fully worked example. Replace hardcoded app words in core with adapter lookups.
**Phase D - Rewire.** Make the reference app import the assistant from the kit. Fix every import path.
**Phase E - Document.** Write README.md, FEATURES.md, INTEGRATION_CHECKLIST.md, .env.example (see section 5).
**Phase F - Package.** Create the zip (see section 6).
**Phase G - Verify.** Run all QA tests, check that every feature in the catalogue still works in the reference app, then commit and push.

## 3. KIT FOLDER STRUCTURE (adapt names to the stack, but keep these parts and document any change)
```
ai-assistant-kit/
  README.md                  <- master guide (section 5)
  FEATURES.md                <- every feature F01-F20: what, files, config, tests
  INTEGRATION_CHECKLIST.md   <- tick-box list for integrating into a new app
  CHANGELOG.md
  .env.example               <- placeholders for every env var, with comments
  package-deps.json          <- dependencies the kit needs (name, version, purpose, licence)
  core/
    ui/            chat panel, right-click launcher, message list, input, chips, export card, attachment preview, upgrade page, credit badge
    engine/        chat orchestration, conversation state, last-dataset memory, streaming
    providers/     router + OpenRouter, Gemini, Groq clients, timeouts, fallback, vision routing
    tools/         tool registry, schema validation, confirmation flow, built-in tools (query, search, navigate, import, export)
    security/      role/scope enforcement, session -> role resolver, default-deny, injection guards
    guide/         guide engine, 3D avatar controller, highlighter, voice narration, language switch
    credits/       credit meter, plans, monthly reset, atomic decrement
    payments/      Razorpay order + verify + premium activation
    import-export/ parsers, mappers, validators, exporters (CSV/XLSX/PDF/DOCX)
    attachments/   file intake, preview, readers (image/PDF/Excel/CSV), workers
    history/       per-user chat history store and API
    usage/         metering and audit log
    i18n/          English default, Malayalam optional
    theme/         design tokens
  adapter/
    app.config.*          <- reference-app values (fully worked example)
    app.config.TEMPLATE.* <- EMPTY template with comments for a new app
    entities/  pages/  guide-flows/  tools/  export-definitions/  import-templates/
  server/
    routes/        every API endpoint the assistant needs
    middleware/    auth, role/scope, credit check
    (API keys are read here ONLY)
  db/
    schema/        collections/tables for history, credits, subscriptions, usage, audit
    rules/         security rules / policies
    migrations/
  assets/
    3d/            the existing 3D assistant model and textures
    icons/  fonts/ (including a Unicode font for Malayalam PDF output)
  tests/
    role-matrix/  provider-fallback/  import-export/  guide/  credits-payments/
```

## 4. THE ADAPTER CONTRACT (the ONLY thing a new app must fill in)
Define and document, with types, the following. The reference app's values are the worked example; the TEMPLATE file is empty with comments.
- `app`: name, short description, logo, language defaults, theme tokens.
- `auth`: how to read the current session (user id, role, tenant/organization id, sector/scope ids).
- `roles[]`: id, label, level, who may log in how, what scope each can see.
- `entities[]`: name, label, fields, searchable fields, display fields, relations, and for each role a scope predicate plus `query(ctx, filters)` / `get(ctx, id)` / `search(ctx, text)`.
- `pages[]`: route, page name, description, actions possible there, per-role chips, guide anchor ids.
- `guideFlows[]`: id, trigger phrases, role, steps (route, selector or data-guide-id, instruction in EN/ML, completion condition).
- `tools[]`: custom action tools beyond the built-ins (name, schema, permission, handler, needsConfirmation).
- `importTemplates[]` and `exportDefinitions[]`: columns, labels, validations.
- `credits`: free allowance (100/month), cost per action, who the credit owner is (reference app: the Admin).
- `plans`: monthly and annual price, feature list shown on the upgrade page.
- `providers`: order (OpenRouter, Gemini, Groq), model names, timeouts.
- `scopeGuard`: the app-topic description used to refuse off-topic questions.

## 5. README.md REQUIREMENTS (the most important deliverable)
The README must be complete enough that an agent that has never seen the reference app can integrate the kit. It must contain, in this order:
1. **Overview and architecture** (with a diagram in Mermaid or ASCII).
2. **Feature list A to Z.** For EACH of F01-F20: what it does, behaviour rules, the exact file paths inside the kit, the adapter fields it uses, the env vars it needs, how to test it.
3. **Zip layout and extraction.** The exact tree after extracting the zip, and the exact place to put it in a new project (for example the project root, giving `./ai-assistant-kit/`).
4. **Install steps.** Dependencies to install (from `package-deps.json`), build config changes, and how to mount the panel in the host app.
5. **Adapter guide.** The contract from section 4, a step-by-step way to fill it for a new app, and two short worked examples (a library app: "who is X", "which shelf is this book on"; a leave-log app).
6. **Server and database.** Every endpoint (method, path, auth, input, output), every collection/table, every security rule.
7. **Environment variables.** Name, purpose, where to get it, where to set it (local, hosting dashboard).
8. **Security model.** The role-scope rules, default deny, and how to define them for a new app. Include a role x entity test matrix template.
9. **Credits, premium and Razorpay.** Setup and test-mode flow.
10. **Guide mode.** How to add `data-guide-id` anchors and write flows; how the 3D model is loaded.
11. **Performance notes** and the 3D integrity rule.
12. **Libraries used** (name, purpose, licence).
13. **Troubleshooting.** Include at least: works locally but fails on the deployed link; provider fallback not triggering; "no previous dataset" on export; wrong "who is X" answers; Malayalam not rendering in PDF.
14. **Extension points** (the roadmap list at the end of the catalogue).

`FEATURES.md` repeats section 2 in a table: Feature ID | What | Kit paths | Adapter fields | Env vars | Test. `INTEGRATION_CHECKLIST.md` is a tick-box list in the exact order an integrator must follow.

## 6. ZIP REQUIREMENTS
- File name: `ai-assistant-kit.zip`. Extracting it must give ONE root folder `ai-assistant-kit/` containing exactly the structure in section 3.
- Exclude: `node_modules`, `.git`, `.env` and any file with real secrets, build output, caches, logs, OS junk.
- Include: README.md at the root of the kit folder, the 3D assets, and every file the features need.
- Add an npm script `package-kit` (or an equivalent shell script) that builds the zip, and document it.
- If this environment cannot create a zip, leave the finished `ai-assistant-kit/` folder ready to zip, and tell the user to download the project (or push to GitHub) and zip only that folder.
- Print the final zip/folder tree and its total size in the report.

---

## FEATURE CATALOGUE (F01 - F20)

Every feature below is REQUIRED unless explicitly marked optional. Each has: what it does, detailed behaviour rules, and acceptance tests. "Reference app" means the college finance web app in which the assistant was first built (hierarchy: Platform Super Admin > Admin (organization owner) > Sector Managers > Students).

---

### F01. Chat side panel opened by right-click
**What:** The assistant lives in a chat side panel inside the web app. The user opens it from a right-click (context menu) option, e.g. "Ask AI Assistant".

**Behaviour rules**
- Minimal, Gemini-style layout: clean message list, one input bar, attachment button, send button, three suggestion chips (see F10).
- Colours, fonts, radius and spacing come from theme tokens in the adapter config, so the look can be restyled per app without touching core code.
- Desktop: docked side panel that overlays the page and never shifts or breaks the host app layout. Mobile: full-height bottom sheet or full-screen panel.
- Closing and reopening keeps the current conversation. The panel is lazy-loaded (see F15).
- Keyboard: Esc closes, Enter sends, Shift+Enter adds a new line.

**Acceptance tests:** right-click opens it on every page; works on mobile width; changing a theme token changes the look; no layout shift in the host app.

---

### F02. Role hierarchy with strict, server-side data scoping
**What:** The assistant only ever returns data the logged-in user is allowed to see.

**Reference hierarchy**
1. **Platform Super Admin** (separate login/page): sees all organizations, their data and usage. Credentials are stored hashed in the database, never in code.
2. **Admin** (organization owner): sees only their own organization. No organization switching.
3. **Sector Managers**: added manually by the Admin; each sees ONLY the data of their own sector. Example: the Office sector manager asks for Department sector data and gets nothing, and the other way round.
4. **Students**: log in with their admission number; see ONLY their own records (debit, credit, balance, full details), whichever sector those records belong to.

**Behaviour rules**
- DEFAULT DENY. Scope is enforced SERVER-SIDE inside the data/tool layer, not only in the prompt.
- Role and scope come from the authenticated session, never from the user's message. A user saying "I am the admin" changes nothing. Prompt-injection text inside files or data cannot widen scope.
- A refused request gets a polite refusal that does not leak whether the data exists.
- The model is generic: tenant > owner/admin > scoped manager > end user. The adapter defines the roles and the scope predicate for each entity.

**Acceptance tests:** a matrix of every role x every entity x "own scope / other scope / other organization". Every cross-scope cell must return nothing.

---

### F03. Private per-user chat history and personalization
**What:** Each user has their own chat history.

**Behaviour rules**
- The Admin's chat history is visible only to the Admin. Sector managers and students cannot see it, and the reverse holds for every role.
- By default the Platform Super Admin sees usage numbers only, not chat contents (flag this default in the README as a configurable assumption).
- History is stored per user id: list, open, new chat, rename, delete.
- The assistant greets and addresses the user by name and adapts examples to their role.

**Acceptance tests:** log in as two users of different roles and confirm neither can read or request the other's history, including by direct API call.

---

### F04. Universal data retrieval (A to Z)
**What:** The assistant can fetch any data in the app that the user's role may see.

**Behaviour rules**
- Examples (reference app): "details of the student with admission number 1234"; "list of students in the Office sector whose net worth is debit/negative"; class reports; ledger lookups; "open the ledger" navigates to that page.
- Show ONLY what was asked. If the user asks for the "net worth minus" list, return only students with a negative balance and only the relevant columns (e.g. the Due column), not a full dump.
- Tables are readable, sorted sensibly, capped with pagination or "show more"; large results offer export (F08).
- Several matches: ask which one. No match: say so clearly.
- Retrieval uses typed query tools (F06) against the real data, never guesses from memory.

**Acceptance tests:** each example above returns exactly the requested data for the right role, and the same question from a role without access returns a refusal.

---

### F05. Entity identification ("Who is X?")
**What:** Asking "who is <name>" (or a book, shelf, leave record, etc. in other apps) identifies the entity from LIVE app data.

**Behaviour rules**
- Search across ALL entity types the role may see (reference app: students, teachers/sector managers, principal, office, union). Fuzzy name match, ID match, partial match.
- Answer with identity, role/type and the relevant details allowed for the asker.
- It must NEVER fall back to a generic overview of the app or a demo-credentials list.
- Several matches: list them and ask which one is meant.
- Other apps: library app ("who is X", "which shelf is this book on"), leave-log app.

**Acceptance tests:** the name of a real student, a sector manager and an office user each resolve correctly; an unknown name returns "not found", not a generic overview.

---

### F06. App-scoped answers and agent actions (tool-calling engine)
**What:** The assistant answers only about the connected app, and it can also DO things (agent mode).

**Behaviour rules**
- Scope guard: questions unrelated to the app get a short, polite redirect.
- All capabilities are tools registered in the adapter. Each tool has a name, a description, a JSON-schema for parameters, a role permission rule and a handler.
- Read tools run directly. Write/bulk/destructive tools require a confirmation step that shows a preview of what will change.
- Every tool call is logged (F18). Tool errors are explained in plain language.
- Navigation tools open pages ("open the ledger"). Action tools import, export, create and update records where the role allows it.
- Works the same through every provider in F14 (tool-calling format differences are handled in the router).

**Acceptance tests:** a read tool, a navigation tool and a confirmed write tool each work; a write without confirmation never executes; a forbidden tool call is rejected server-side.

---

### F07. Import through the assistant
**What:** The user attaches an Excel/CSV file and says "import all the students in this file", and the assistant does it.

**Behaviour rules**
- Formats: .xlsx, .xls, .csv. Parse with an open-source library (SheetJS / PapaParse), in a web worker for big files.
- Detect headers, map columns to entity fields (match the app's import template when present), validate, and detect duplicates and errors.
- Show a preview summary (rows found, valid, invalid, duplicates, target sector/class) and ask for confirmation. After confirming, import and report the result with the error rows downloadable.
- Role permission applies (reference app: Admin imports students; sector managers cannot).

**Acceptance tests:** a clean file, a file with bad rows and a file with duplicates each behave correctly; an unauthorised role is refused.

---

### F08. Export through the assistant
**What:** The assistant itself produces the requested data as a file. It does NOT tell the user to press the app's own download buttons.

**Behaviour rules**
- Formats: CSV, Excel (.xlsx), PDF, Word (.docx). Use existing open-source libraries (SheetJS, jsPDF + autotable, docx).
- Export ONLY the data asked for (the filtered list, the chosen columns), within the user's role scope.
- Show an export card inside the chat reply with a button per format and the file name.
- "Export the last answer" must work: the last result set of the conversation is kept in conversation state. The error "no previous dataset" must not occur when the previous answer had data.
- If the data contains Malayalam or other non-Latin text, embed a Unicode font in PDF output so the text renders correctly.

**Acceptance tests:** ask for a filtered list, then say "export this as PDF" and "as Excel"; files open correctly and contain only the filtered rows.

---

### F09. Attachments and screenshot diagnosis
**What:** The user can attach files and screenshots to a message.

**Behaviour rules**
- Attach by button, drag-and-drop and paste. Before sending, show a preview in the input: image thumbnail, or a file chip with name, size and a remove button.
- Supported: images, PDF, Excel, CSV. The assistant reads and analyses them (images via a vision-capable model; PDF via text extraction with OCR fallback; Excel/CSV via parsing).
- Files related to the web app: explain what they contain. Student/sector Excel or CSV: offer to import it (F07) and do it on confirmation.
- Screenshots of a problem: diagnose it, give clear solutions, and fix it as an agent where a tool exists.
- Must not lag: heavy work off the main thread, file size limits with a friendly message, progress indicator.
- The provider router (F14) must pick a vision-capable model when an image is attached.

**Acceptance tests:** each file type previews and is analysed; a screenshot of an error gets a diagnosis; a 10 MB file does not freeze the UI.

---

### F10. Role- and page-aware suggestion chips
**What:** Exactly THREE suggestion chips are shown, tappable, and depend on the user's role and the page they are on.

**Behaviour rules**
1. Chip 1: personalised to the user's recent usage, their predicted next action, or where they seem stuck.
2. Chip 2: an action that is possible on the CURRENT page.
3. Chip 3: a general example that is valid across the whole site.
- Chips refresh when the route changes. Tapping a chip sends it as a message.
- Never suggest something the role cannot do. Computed cheaply from rules and a small usage log, without an extra model call on every navigation (cache any model-generated chips).

**Acceptance tests:** different roles on the same page see different chips; the same role on different pages sees different chips; always exactly three.

---

### F11. Guide mode with the 3D avatar
**What:** When a user asks how to do something ("guide me to log in", "how do I register", "how do I import students", "how do I view student details"), the chat closes and the avatar walks them through the REAL screens until the task is done.

**Behaviour rules**
- The avatar is the app's EXISTING 3D assistant model, not a 2D character. It moves around the screen and points at the real options.
- It highlights the target element (ring/spotlight) and speaks a short instruction for each step: click here, type this, press Enter, go to the next section.
- It waits for the user to complete each step (detect click/input/route change), then moves on. Steps can be repeated, skipped or stopped at any time; afterwards the chat returns.
- Voice narration uses speech synthesis with a mute toggle. English is the default language; Malayalam is an optional switch.
- The avatar closes its eyes while the user types in a password field.
- Flows are defined in the adapter as step lists (route, target selector / data-guide-id, instruction text, completion condition) and can also be generated from the page registry.
- Must not reduce the 3D quality, options, animations or alignment (see F15).

**Acceptance tests:** a new user can complete login, register, import students and view student details by following the avatar alone; eyes close on password fields; stop/resume works; works on mobile.

---

### F12. Credit system and plans
**What:** Credits belong to the Admin (organization owner).

**Behaviour rules**
- Free plan: 100 credits per month, refreshing monthly. On the free plan ONLY the Admin can use the assistant. Sector managers and students cannot use it unless the Admin has bought premium.
- Premium: unlimited use for everyone under that Admin.
- Credit cost per message is configurable (default 1; heavier actions such as vision, import and export may cost more).
- Enforced SERVER-SIDE with an atomic decrement. When credits run out the user sees a clear message and an upgrade button, and no model call is made.
- The panel shows remaining credits. Monthly reset is based on a stored reset date, not a client clock.

**Acceptance tests:** exhaust 100 credits and confirm blocking; confirm a manager/student on a free organization is blocked; after premium activation they can use it; reset works after the reset date.

---

### F13. Upgrade page and Razorpay (test mode)
**What:** An upgrade page lets the Admin buy premium.

**Behaviour rules**
- Page layout: a monthly bar and an annual bar, feature details below, and a Subscribe button on each.
- Razorpay TEST mode: create the order on the server, open Razorpay Checkout, VERIFY the payment signature on the server (HMAC), then activate premium (plan, start date, expiry) for the organization. Handle failure, cancel and expiry.
- Key ID and Key Secret are two clearly marked paste slots in `.env` (placeholders in the kit). The secret never reaches the client. No real money moves in test mode.
- Use the official Razorpay SDK and Checkout script. Do not hand-roll the signature code if a library function exists.

**Acceptance tests:** a test payment activates premium; a tampered signature does not; expiry returns the organization to free.

---

### F14. Multi-provider AI router
**What:** One router chooses the model provider.

**Behaviour rules**
- Order: OpenRouter FIRST, then Gemini, then Groq. Fall through to the next provider ONLY on failure (timeout, 429, 5xx, empty or invalid response).
- Per-provider timeouts and retry counts live in config. Stream tokens to the UI for perceived speed.
- Keys live only on the server. Model names are config values.
- Tool-calling and vision formats are normalised so every provider behaves the same for the rest of the system.
- Log which provider answered and why a fallback happened. The user sees a friendly error only when ALL providers fail.

**Acceptance tests:** simulate failure of provider 1, then 1 and 2, then all three; confirm the fallback order and the final error message.

---

### F15. Performance and 3D integrity
**What:** The assistant and the host app must feel fast.

**Behaviour rules**
- Lazy-load and code-split the assistant. It must not slow the first page load or navigation-bar switching.
- Virtualise long lists, debounce inputs, move heavy parsing off the main thread, avoid needless re-renders.
- The 3D rendering, its options, animations and alignment are core to the look and must NEVER be removed, paused or reduced. Existing animations may be re-implemented more efficiently, with the same visual result.
- Verify smooth scrolling and no lag when switching between sidebar and navigation items, on desktop and mobile.

**Acceptance tests:** compare before/after timings for first load, route change and scroll; the 3D visuals look identical.

---

### F16. Open-source-first rule
**What:** Always import free, existing open-source libraries instead of writing features from scratch.

**Behaviour rules**
- Libraries must be seamless drop-ins that need no tokens, API keys or external API connections (examples: SheetJS, PapaParse, jsPDF, docx, pdf.js, three.js).
- Write new code only where no suitable library exists. List every library used (name, purpose, licence) in the README.

---

### F17. Language
**What:** The assistant UI, replies and guide voice are in English by default, with Malayalam as an optional switch.

**Behaviour rules**
- The user may type in English or Malayalam; the reply follows the language the user writes in or has switched to.
- Dictated/voice-style Malayalam input should be understood.

---

### F18. Usage metering and audit log
**What:** Usage is tracked per organization and per user.

**Behaviour rules**
- Store messages, credits used, tool calls, provider used, errors and timestamps.
- The Platform Super Admin page shows usage per organization. The Admin sees usage for their own organization only.
- Audit log entries for write/import/export actions: who, what, when, result.

---

### F19. Quality assurance and delivery
**What:** A QA test agent runs in EVERY phase.

**Behaviour rules**
- Test every role (Platform Super Admin, Admin, Sector Manager, Student, or the equivalents in the target app) across all pages, navigation, sidebars, mobile responsiveness and scroll lag.
- Use many parallel agents (at least 5-6, up to 10-15), then produce a final report.
- Commit and push to the already-linked GitHub repository at the end.

---

### F20. Deployment readiness
**What:** The assistant must work on the deployed link (e.g. Vercel) in Chrome, not only on localhost.

**Behaviour rules**
- All provider/payment calls go through server routes. No localhost URLs, no keys in client bundles.
- Provide the complete list of environment variables with placeholders in `.env.example`, and state exactly where each must be set in the hosting dashboard.
- The production build must pass with no errors.

---

### EXTENSION POINTS (design for them, do NOT build now)
Universal App Integration SDK, Universal Tool Calling Engine (F06 is its base), Smart Page Context Awareness, AI Evaluation and Audit, RAG Knowledge Base, Conversation Memory, AI Workflow Automation, Voice AI, AI Report and Dashboard Generator. Keep module boundaries clean so these can be added later.

---

## 7. FEATURE-TO-KIT MAP (fill this table in the README, with real paths)
| ID | Feature | Main kit location (propose, then document the real one) |
|----|---------|--------------------------------------------------------|
| F01 | Side panel + right-click | core/ui |
| F02 | Role scoping | core/security, server/middleware, adapter/entities |
| F03 | Private chat history | core/history, server/routes, db/schema |
| F04 | Data retrieval | core/tools (query), adapter/entities |
| F05 | Who is X | core/tools (search), adapter/entities |
| F06 | Tools and agent actions | core/tools, adapter/tools |
| F07 | Import | core/import-export, adapter/import-templates |
| F08 | Export | core/import-export, adapter/export-definitions, assets/fonts |
| F09 | Attachments | core/attachments |
| F10 | Chips | core/ui, adapter/pages |
| F11 | Guide + 3D avatar | core/guide, assets/3d, adapter/guide-flows |
| F12 | Credits | core/credits, server/middleware, db/schema |
| F13 | Upgrade + Razorpay | core/payments, core/ui, server/routes |
| F14 | Provider router | core/providers |
| F15 | Performance | all (lazy loading, workers) |
| F16 | Open-source rule | package-deps.json |
| F17 | Language | core/i18n |
| F18 | Usage + audit | core/usage, db/schema |
| F19 | QA | tests/ |
| F20 | Deployment | server/, .env.example, README |

## 8. QUALITY GATES (all must pass before you report done)
1. Every F01-F20 acceptance test passes in the reference app, running FROM the kit.
2. The role x entity matrix shows no cross-scope leakage.
3. Provider fallback order verified: OpenRouter, then Gemini, then Groq.
4. `grep` for secrets, localhost URLs and reference-app words in `core/` returns nothing.
5. A fresh copy of the kit folder, placed in an empty demo project with only the TEMPLATE adapter filled, builds without errors.
6. README covers all 14 required sections, and every file path it mentions exists.
7. Production build passes; the deployed link works in Chrome.
8. QA agents (5-6 minimum, up to 10-15 in parallel) ran in every phase for every role.

## 9. FINAL REPORT FORMAT
1. Inventory (Phase A) and the CORE/ADAPTER split.
2. The kit folder tree and zip size.
3. The requirements checklist with DONE / NOT DONE and proof paths.
4. QA results per role and per phase.
5. Deviations from this file and the reasons.
6. Assumptions made.
7. Exact steps for the user to get the zip out of this environment.
Then commit and push to the linked GitHub repository.

**END OF SPEC 1**
