# Full-Stack Performance Audit (AUDIT_PERF.md)

## 1. Overview of the Stack & Architecture

### 1.1 Frontend
- **Framework & Core**: React 19 (`react@^19.0.1`, `react-dom@^19.0.1`).
- **Routing**: TanStack Router (`@tanstack/react-router@^1.170.46`) with file-based routing generated into `src/routeTree.gen.ts`.
- **State Management**:
  - Global Application State: Zustand (`zustand@^5.1.0`) in `src/lib/khazna/store.ts` (`useKhazna`).
  - Server Cache & Async State: TanStack Query v5 (`@tanstack/react-query@^5.107.1`).
  - Chat Widget Persistence: `useChatStorage` backed by `localStorage` (per-user / per-thread isolation).
- **UI Components & Styling**:
  - Tailwind CSS v4 (`@tailwindcss/vite@^4.3.3`, `tailwindcss@^4.3.3`) with inline `@theme` in `src/styles.css`.
  - Headless UI: Radix UI primitives (`@radix-ui/react-dialog`, `dropdown-menu`, `popover`, `select`, `tabs`, `tooltip`, etc.).
  - Animations: Framer Motion (`framer-motion@^14.14.0`, `motion@^12.23.24`).
  - Icons: Lucide React (`lucide-react@^0.546.0`).
- **Build Tooling**: Vite 8 (`vite@^8.3.0`, `@vitejs/plugin-react@^6.1.1`).
- **Heavy Client Libraries**:
  - `three` (`^0.187.0`): 3D mascot rendering in `AssistantAvatar3D.tsx` and `GuideAvatarController.ts`.
  - `recharts` (`^3.10.1`): Revenue analytics & sector distribution charts.
  - `jspdf` (`^4.2.1`), `jspdf-autotable` (`^5.0.9`), `pdfjs-dist` (`^6.5.438`): PDF generation and preview.
  - `xlsx` (`^0.18.5`): Excel/CSV spreadsheet parsing and exports.

---

### 1.2 Layout, Navigation Bar & Route Structure

#### Navigation Bar Structure
The primary navigation is handled by `AppShell.tsx`, with responsive variations:
- **Desktop Sidebar (`aside.lg:block`)**: Sticky sidebar (w-60) containing `ContextCard` and `NavList`.
- **Tablet Rail (`TabletNavRail`)**: Slim icon rail (768px – 1023px).
- **Mobile Drawer / Bottom Sheet (`AestheticMenu`)**: Drawer triggered by `mobile-menu-button`.
- **Sticky Glass Header (`header.sticky`)**: Top bar containing `Logo`, college badge, role switcher, sector switcher, notification bell, profile, and quick-action menu.

#### Pages Linked Across Roles
1. **Public / Authentication**:
   - `/login` (Unified Sign-in & College Registration)
   - `/` (Home redirect)
   - `/v/:token` (QR Public Verification)
   - `/super-admin/login` (Platform login)
2. **Platform Super Admin** (`/super-admin`):
   - `/super-admin` (Organizations Directory, Global Analytics, Cross-tenant Inspection)
3. **Admin** (`/admin`):
   - `/admin` (Campus Overview Dashboard)
   - `/admin/audit` (Audit Trail Log)
   - `/admin/issued-reports` (Issued PDF Verification Reports)
   - `/admin/students` (Student Directory)
   - `/admin/students/import` (Excel/CSV Bulk Import)
   - `/admin/admins` (Admin Accounts)
   - `/admin/institution` (Campus Profile & Settings)
   - `/admin/sectors` (Sectors & Classes)
4. **Sector Manager** (`/m/:sectorSlug`):
   - `/m/:sectorSlug` (Sector Overview Dashboard)
   - `/m/:sectorSlug/ledger` (Transaction Ledger & Receipts)
   - `/m/:sectorSlug/bulk` (Bulk Class Fee Entry)
   - `/m/:sectorSlug/reports` (Class Financial Reports)
   - `/m/:sectorSlug/batches` (Batch Operations History)
5. **Student** (`/app`):
   - `/app` (Student Dues & Sector Cards)
   - `/app/s/:sectorSlug` (Sector-specific Student Ledger)
   - `/app/notifications` (Notices & Fee Alerts)
   - `/app/profile` (Student Details & Guardian Info)

---

### 1.3 Backend, API & Database
- **Framework**: Node.js v24 + Express 4 (`express@^4.21.2`), run via `tsx` (`server.ts`).
- **Database & Storage**:
  - Primary Vector Database: Supabase PostgreSQL + `pgvector` (`@supabase/supabase-js@^2.119.0`).
  - Fallback / Test Store: In-memory vector store & repository (`AssistantRepository`).
  - Seed Data: Multitenant seed fixtures in `src/lib/khazna/data.ts` and `scripts/seedDataAccessTest.ts`.
- **AI Engine & Fallback Chain**:
  - Strict sequential fallback chain: **OpenRouter (primary) -> Gemini (secondary) -> Groq (tertiary)**.
  - Streaming SSE via `/api/assistant/chat`.

---

### 1.4 Assistant Widget & 3D Avatar Architecture
- **Widget Mounting**: Root level in `src/routes/__root.tsx` via `<KhaznaAssistant />` wrapping `<AssistantWidget />`.
- **3D Mascot (`AssistantAvatar3D.tsx`)**:
  - Procedural Three.js scene containing 29 meshes (15,834 triangles, 6 PBR materials).
  - Main-thread render loop running via `requestAnimationFrame(tick)`.
  - Animates body hover, breathing, head gaze following pointer, arm gestures, eye blinking, visor glow, and halo spin.
  - **Guide Mode (`GuideAvatarController.ts`)**: Mascot travels beside screen elements, points at interactive targets, speaks instructions via Web Speech API / TTS, and shields eyes during password input.

---

### 1.5 Identified Bottlenecks & Lag Root Causes

1. **Monolithic Bundle (Lack of Route-Level Code Splitting)**:
   - `src/routeTree.gen.ts` statically imported all 26 route components at the top level.
   - Production bundle output was **2,875 kB JS (835 kB gzipped)** in a single file (`index-*.js`), forcing the browser to download, parse, and compile the entire application (including Three.js, jsPDF, SheetJS, Recharts) before the first navigation could occur.
2. **Expensive Main-Content Route Transition Animation**:
   - `AppShell.tsx` wrapped `{children}` in `<motion.div key={pathname}>` with:
     `initial={{ opacity: 0, x: 36, filter: "blur(6px)" }}` -> `animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}` over 450 ms.
   - Applying `filter: blur(6px)` to the entire `<main>` container on every navigation click forced the GPU/CPU to re-rasterize nested glass cards, text elements, and backdrop filters, causing 120–250 ms long tasks and dropped frames.
3. **Layout & Header Remount Churn**:
   - `src/routes/admin.tsx` and other layouts defined components as inline anonymous arrow functions (`component: () => <AppShell ...>`), causing TanStack Router to recreate the layout instance on sub-route transitions.
4. **Disabled Route & Link Prefetching**:
   - `src/router.tsx` had `defaultPreloadStaleTime: 0` without `defaultPreload: 'intent'`, meaning hover/touch on navigation items did not prefetch page code or data.
5. **Main-Thread 3D Avatar Canvas Repaint Collisions**:
   - The Three.js canvas in `AssistantAvatar3D.tsx` lacked `will-change: transform` and `contain: strict`. During route changes, the browser re-composited the canvas on the main thread alongside the host page layout changes.
   - `AssistantAvatar3D` was not memoized (`React.memo`), causing it to re-evaluate when `AssistantWidget` received transient prop updates from `KhaznaAssistant` (such as inline `getPageId={() => pathname}`).
6. **Backend Transmission Overhead**:
   - `server.ts` had no HTTP response compression middleware (gzip/brotli).
   - Static assets in `dist/assets/` lacked explicit 1-year immutable `Cache-Control` headers.
