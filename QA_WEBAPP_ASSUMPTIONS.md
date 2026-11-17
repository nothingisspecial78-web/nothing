# QA Webapp Assumptions

1. **Runtime Environment & Browser Engines:**
   - The container ships Playwright's headless Chromium (`chromium_headless_shell-1247`) under `/ms-playwright`. WebKit and Firefox binaries are not pre-installed in this container; cross-engine coverage is executed via Chromium headless with WebGL software rendering (`--enable-webgl --ignore-gpu-blocklist`) plus CPU throttling (`4x`) and slow-3G network simulation where applicable.
   - All QA and performance runs target the compiled **production build** (`npm run build` with `NODE_ENV=production`) backed by `npm run seed:qa`.

2. **Persistence & State Architecture:**
   - Khazna Campus Ledger's tenant workspace data (students, sectors, ledger transactions, batches, institution profile, signatories) is stored client-side in Zustand state (`useKhazna`) scoped by active workspace (`activeOrgId`), while Platform Super Admin accounts, sessions, audit logs, and multi-tenant directory reside server-side (`/api/super-admin/*` + `data/platform_admins.json` + `data/qa_seed_manifest.json`).
   - Tenant switching on the client (`Preview as` role menu in `AppShell`) is an intentional demo-preview switch within the *same* college organization; it must never expose or switch to another college organization.

3. **Non-Blocking Dialog Policy:**
   - Native `window.alert()`, `window.confirm()`, and `window.open()` are prohibited. All confirmations and error notices use in-app Radix `KDialog` modals, inline error banners, or Sonner toasts.

4. **3D & Animation Preservation:**
   - Performance targets (long tasks, FPS, Web Vitals) must be met without disabling, hiding, pausing, or reducing the 3D assistant avatar meshes, materials, lighting, or existing page animations.

5. **Git Repository Availability:**
   - The container workspace `/app/applet` has no `.git` directory or configured remote. Automated QA checks verify `.gitignore` coverage and run secret-pattern scans across all source files without fabricating git commits or push logs.
