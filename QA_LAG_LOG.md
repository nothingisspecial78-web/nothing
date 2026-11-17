# QA Lag Log: Root Causes & Remediation Plan

This log catalogs all identified performance bottlenecks, observed lag symptoms, technical root causes, and planned fixes across frontend, backend, 3D avatar, and build pipeline.

---

## Issue 1: Main Container Filter Blur Animation Lag
- **Symptom:** Every navigation bar item click exhibits a 150–350 ms stutter/freeze where the entire page contents appear sluggish and dropped frames occur.
- **Root Cause:** In `src/components/khazna/AppShell.tsx` lines 529-537, `<motion.div key={pathname} initial={{ filter: "blur(6px)", x: 36 }} animate={{ filter: "blur(0px)", x: 0 }} transition={{ duration: 0.45 }}>`. `filter: blur()` applied to the entire page layout forces the browser compositor to drop hardware-accelerated layers and re-rasterize nested CSS glassmorphism cards and backdrop filters.
- **Fix:** Replace non-composited `filter: "blur(6px)"` with pure compositor-only properties: `opacity` (0 to 1) and subtle `transform: translateX(8px) -> translateX(0px)` with a snappy 150ms spring/ease curve.

---

## Issue 2: Monolithic Initial JavaScript Bundle (2.88 MB / 809 KB Gzip)
- **Symptom:** Initial page load takes significant time to parse and execute JS; all 26 routes are bundled together with Three.js, jsPDF, html2canvas, sheetjs (xlsx), and recharts.
- **Root Cause:** In `vite.config.ts`, default Rollup bundling packages all application code into a single `index-*.js` chunk.
- **Fix:** Configure `vite.config.ts` with explicit `build.rollupOptions.output.manualChunks` splitting:
  - `vendor-three`: `three`
  - `vendor-react`: `react`, `react-dom`, `@tanstack/react-router`, `zustand`
  - `vendor-motion`: `framer-motion`
  - `vendor-charts`: `recharts`
  - `vendor-docs`: `jspdf`, `html2canvas`, `xlsx`, `dompurify`
  - `vendor-icons`: `lucide-react`

---

## Issue 3: Absence of Route & Link Preloading
- **Symptom:** Clicking navigation bar items incurs full network/parse latency before the next screen renders.
- **Root Cause:** In `src/router.tsx`, `createRouter` has `defaultPreloadStaleTime: 0` without `defaultPreload: 'intent'`.
- **Fix:** Enable `defaultPreload: 'intent'` with `defaultPreloadDelay: 50ms` in `src/router.tsx` so that hovering or touching navigation bar links preloads the route code and loaders ahead of click.

---

## Issue 4: Layout Unmounting Churn in TanStack Router
- **Symptom:** Navigating between sibling routes (e.g., `/admin/students` to `/admin/audit`) completely remounts the layout header and sidebar.
- **Root Cause:** Route definition in `src/routes/admin.tsx` used `component: () => <AppShell ...>` (an inline anonymous function returning JSX), which React treats as a brand-new component type on every render.
- **Fix:** Use stable, memoized component references: `function AdminLayout() { return <AppShell role="admin"><Outlet /></AppShell>; }` and `component: AdminLayout`.

---

## Issue 5: GuideEngine Destroy Method Incompatibility (CRITICAL BUG)
- **Symptom:** Navigating away from pages caused the AI assistant widget to crash and be replaced by "AI Assistant Paused - Encountered a recoverable issue" error boundary.
- **Root Cause:** `GuideEngine.destroy()` called `this.targetResolver.destroy()` which was undefined on `TargetResolver` (which implemented `cancel()`).
- **Fix:** (RESOLVED) Implemented safe cleanup in `GuideEngine.ts` and added alias methods `destroy()` across `TargetResolver.ts`, `VoiceController.ts`, and `GuideAvatarController.ts`.

---

## Issue 6: 3D Mascot Canvas Repaint Reflows
- **Symptom:** During route transitions or typing, 3D avatar re-renders cause minor layout shifts.
- **Root Cause:** Canvas container lacked CSS containment (`contain: strict`) and GPU compositing hint (`will-change: transform`).
- **Fix:** Add `contain: strict`, `will-change: transform` to the 3D canvas host container and wrap `AssistantAvatar3D` in `React.memo` with custom prop comparator.

---

## Issue 7: Backend Missing Compression & Cache-Control Headers
- **Symptom:** Every asset request transmits full uncompressed payloads with zero browser caching.
- **Root Cause:** `server.ts` lacked `compression()` middleware and static assets were served without immutable cache headers.
- **Fix:** Install and register `compression` middleware in `server.ts`; add `Cache-Control: public, max-age=31536000, immutable` for `/assets/` and `no-cache` for `index.html`.

---

## Issue 8: Scroll Jitter on Long Data Tables (Students Directory & Ledger)
- **Symptom:** Scroll FPS drops to 21–23 FPS when rapidly scrolling through the 100+ student directory or transactions list.
- **Root Cause:** Rendering 100+ full table rows with complex nested badges, actions, and formatting.
- **Fix:** Add windowing / virtualization or chunked rendering for long lists, using CSS `content-visibility: auto` and `contain-intrinsic-size` to let the browser skip offscreen row layout and painting.
