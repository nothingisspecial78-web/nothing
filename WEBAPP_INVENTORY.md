# Khazna Campus Ledger — Complete Web App Inventory

Generated during full-application QA preparation. Covers every route, navigation shell, interactive surface, form, table, modal, export, API endpoint, and security invariant across all 5 roles (`SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER`, `STUDENT`, `PUBLIC`).

---

## 1. Navigation Shells & Responsive Controls

| Surface | Desktop (>=1024px) | Tablet (768px–1023px) | Mobile (<768px) |
|---|---|---|---|
| **Top Header (`AppShell`)** | Logo, College Workspace badge (`demo` badge or live green indicator), `Preview as` role menu, Manager sector switcher (`manager` only), Student notifications bell + profile (`student` only), Account menu (`Sign out`) | Same + Mobile/Tablet menu button (`data-guide-id="mobile-menu-button"`) | Same; compact spacing + `MoreVertical` menu button opening `AestheticMenu` bottom sheet |
| **Left Sidebar (`NavList`)** | Sticky `w-60` glass sidebar (`ContextCard` + grouped links) | Hidden (replaced by `TabletNavRail`) | Hidden (replaced by `MobileBottomNav` + `AestheticMenu`) |
| **Tablet Slim Rail (`TabletNavRail`)** | Hidden | Sticky `w-20` icon + short label rail | Hidden |
| **Mobile Bottom Nav (`MobileBottomNav`)** | Hidden | Hidden | Fixed bottom glass bar with active pill animation + floating `+` Quick Action button (`admin` / `manager`) opening `QuickActionSheet` |
| **Aesthetic Menu (`AestheticMenu`)** | Triggerable on smaller breakpoints | Floating top-left card (`md:w-96`) | Bottom sheet (`rounded-t-[28px]`) with Role Context Card, full role nav, Dark/Light theme switch, Sign out + `Dialog` confirmation |
| **Embedded 3D AI Assistant (`KhaznaAssistant`)** | Bottom-right 3D avatar launcher + floating glass chat panel (`400px–440px` wide) + Guide Spotlight Overlay | Same | Full-width mobile compact / expandable bottom-sheet + 3D avatar launcher + Guide Overlay (hidden on `/v/$token`) |

> **Critical Invariant (Admin Organization Boundary):** Tenant `ADMIN` shell (`AppShell`, `AestheticMenu`, header, sidebar) contains **zero** organization switchers, organization lists, or "New College Organisation" creation modals. Organization management belongs exclusively to Platform `SUPER_ADMIN` (`/super-admin`).

---

## 2. Route & Page Inventory by Role

### A. Public & Auth Routes
| Route | Page Title | Key Interactive Features & Guards |
|---|---|---|
| `/` | Redirect | `beforeLoad` redirects to `/login` |
| `/login` | Sign in or create your college | `Sign in` / `Create college` tabs; Role selector (`admin`, `manager`, `student`); Email + Password (with Show/Hide toggle) or Admission No; `"Forgot password?"` button & help `KDialog`; Form validation; Animated sign-in transition; 3 `"Try the demo"` one-click role cards |
| `/super-admin/login` | Super Admin Portal | Email + Password authentication against `POST /api/super-admin/login`; rate-limit / lockout handling; stores `khazna_super_admin_token` in `sessionStorage` |
| `/v/$token` | Public QR Report Verification | Clean print/audit view (AI Assistant hidden); validates token, expiration, revocation; renders PDF via `pdfjs-dist` canvas or fallback `<iframe>`; shows `"This document is not available."` on invalid/expired/revoked tokens |
| `*` (unknown URL) | 404 Not Found | Renders `NotFoundComponent` with `"404"`, `"Page not found"`, and `"Go home"` link |

### B. Platform Super Admin (`/super-admin`)
- **Route Guard:** `beforeLoad` in `/src/routes/super-admin.index.tsx` redirects unauthenticated requests (no `khazna_super_admin_token`) immediately to `/super-admin/login`.
- **Features:**
  - Platform KPI cards (`Organizations`, `Total Students`, `Total Sectors`, `Total Volume`, `Transactions`, `System Health`).
  - Tabs: **Tenant Organizations**, **Platform Audit Logs**.
  - Organization Drill-down modal (`GET /api/super-admin/organizations/:id`) showing tenant sector breakdown; inline error banner on failure (no `alert()`).
  - Change Password modal (`POST /api/super-admin/change-password`, 12+ character policy).
  - Refresh data & Sign out (`POST /api/super-admin/logout`).

### C. College Admin (`/admin/*`, guarded by `/src/routes/admin.tsx`)
- **Route Guard:** `beforeLoad` redirects `manager` -> `/m/$sectorSlug` and `student` -> `/app`.
- **Pages:**
  1. `/admin`: College overview KPIs (Net Balance, Collections, Expenses, Collection Progress Ring), clickable Sector cards grid, Top Student Balances, Pending Dues list, Recent Activity feed.
  2. `/admin/audit`: Searchable/filterable Audit Log table (`role`, `action`, text query), CSV export (`khazna-audit-log.csv`).
  3. `/admin/issued-reports`: Registry of issued QR-verified PDF reports, search, status filter (`All`, `Active`, `Revoked`, `Expired`), Re-download PDF, Copy verify link, Extend expiry, Revoke report dialog.
  4. `/admin/students`: Student Directory (`table` on desktop, cards on mobile), Search (`name`/`id`/`phone`), Class filter chips, Pagination (`12/page`), Export CSV, Add/Edit `StudentFormDrawer`, View `StudentDrawer` (sector breakdown, recent entries, Statement PDF download), Delete confirmation `KDialog` with Undo toast.
  5. `/admin/students/import`: 3-step Spreadsheet Import wizard (`Upload CSV/XLSX or Try sample file` -> `Map Columns` -> `Validate & Import`), Download CSV template.
  6. `/admin/admins`: Sector Managers directory, Invite Manager drawer, Edit manager, Assign sectors checkboxes, Toggle Active/Suspended, Remove manager.
  7. `/admin/institution`: 7 tabs (`Identity`, `Contact`, `Logo`, `Seal`, `Signatories`, `QR Verify`, `Live Preview`), Image upload/crop/clean-up pipeline (`processLogoImage`, `processSealImage`, `processSignatureImage`), `SignatoryModal` with HTML5 Canvas signature draw pad + uploaded signature threshold/ink cleanup, Delete Signatory `KDialog`, Sticky unsaved changes save bar.
  8. `/admin/sectors`: Sectors & Classes CRUD — Create/Edit/Delete sector drawer (name, description, receipt prefix, target, color token), Add/Rename/Remove academic classes.

### D. Sector Manager (`/m/$sectorSlug/*`, guarded by `/src/routes/m.$sectorSlug.tsx`)
- **Route Guard:** `beforeLoad` redirects `admin` -> `/admin`, `student` -> `/app`, and throws `notFound()` if `$sectorSlug` does not exist.
- **Pages:**
  1. `/m/$sectorSlug`: Sector KPIs, collection progress, class breakdown bars, Pending Dues list with quick `"Collect"` prefill into `NewEntryDialog`, Recent sector entries, quick navigation links.
  2. `/m/$sectorSlug/ledger`: Full sector transactions ledger (`Credit` / `Debit` / `All` segmented filter, search, date filters, status badges), `NewEntryDialog` (credit/debit), Edit entry drawer, Void/Unvoid entry, View receipt modal.
  3. `/m/$sectorSlug/bulk`: 4-step Bulk Entry wizard (`Select students` with class/search/select-all -> `Entry details` with 8 quick templates & amount presets -> `Preview` before/after balance & negative-balance warning -> `Confirm` animated `ProgressRing` + burst).
  4. `/m/$sectorSlug/reports`: Class-wise financial report table, date range selector, `ExportPdfModal` (orientation, sort order, signature mode, QR verification toggle, seal/cards/distribution toggles), direct CSV & Excel (`.xlsx`) downloads.
  5. `/m/$sectorSlug/batches`: Bulk batch history list, inspect batch students/receipts, Edit batch, Void batch, Delete batch.

### E. Student (`/app/*`, guarded by `/src/routes/app.tsx`)
- **Route Guard:** `beforeLoad` redirects `admin` -> `/admin` and `manager` -> `/m/$sectorSlug`.
- **Pages:**
  1. `/app`: Student overview (`Total Outstanding / Combined Balance`, In/Out totals, Sector Breakdown clickable cards, Recent Transactions, Download Personal Statement PDF).
  2. `/app/s/$sectorSlug`: Student's transactions in a single sector + Statement PDF export.
  3. `/app/notifications`: Unread/Read notices feed (`debit`, `due`, `credit`, `info`), Mark single read, Mark all read.
  4. `/app/profile`: Admission number, class, joined date, guardian details, editable Phone Number form, Sign out.

---

## 3. Server API Inventory (`/api/*`)

| Endpoint | Method | Auth / Scope | Purpose |
|---|---|---|---|
| `/health` | GET | Public | Server health + vector store & provider status |
| `/api/profiles` | GET | Public | Registered app profiles |
| `/api/assistant/debug/providers` | GET | Public | Provider chain circuit-breaker diagnostics |
| `/api/assistant/chips` | GET | Scoped token | Role & page-aware ranked prompt chips (`<80ms` SLA) |
| `/api/assistant/chips/click` | POST | Scoped token | Fatigue/click telemetry ranking update |
| `/api/assistant/guides` | GET | Scoped by role | Authored interactive walkthrough guides (`16` guides across 5 roles) |
| `/api/assistant/guides/progress` | POST | Scoped | Persist user walkthrough progress |
| `/api/chat` | POST | Scoped token | Streaming SSE chat + governed tool execution + confirmation previews |
| `/api/actions/:id/confirm` | POST | Scoped + single-use HMAC token | Confirm/cancel staged write action |
| `/api/actions/:id/undo` | POST | Scoped | Undo executed write action |
| `/api/upload` | POST | Scoped + role checked | Spreadsheet CSV/XLSX parsing, validation, preview |
| `/api/upload/:id/errors.csv` | GET | Scoped | Download invalid rows CSV |
| `/api/transcribe` | POST | Scoped | Server audio transcription fallback |
| `/api/ingest` | POST | Admin/Dev | Vector RAG document ingestion |
| `/api/super-admin/login` | POST | Password + rate limit (5/15m) | Issue signed `SUPER_ADMIN` JWT (`8h`) |
| `/api/super-admin/logout` | POST | `SUPER_ADMIN` Bearer JWT | Audit logout |
| `/api/super-admin/me` | GET | `SUPER_ADMIN` Bearer JWT | Current super admin identity |
| `/api/super-admin/organizations` | GET | `SUPER_ADMIN` Bearer JWT | Cross-tenant organization list |
| `/api/super-admin/organizations/:id` | GET | `SUPER_ADMIN` Bearer JWT | Organization sector drill-down |
| `/api/super-admin/analytics` | GET | `SUPER_ADMIN` Bearer JWT | Global platform analytics |
| `/api/super-admin/audit-logs` | GET | `SUPER_ADMIN` Bearer JWT | Platform-level audit log |
| `/api/super-admin/change-password` | POST | `SUPER_ADMIN` Bearer JWT | Rotate super admin password (12+ chars) |
