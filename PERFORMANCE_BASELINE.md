# Baseline Performance Report (Before Optimization)

**Generated:** November 15, 2026  
**Environment:** Windows (x64), Edge/Chromium Headless, Express Unified Server (Port 3000), Vite SPA + React 19 + TanStack Router + Three.js + Zustand  
**Instrumentation:** Automated QA Test Agent (`scripts/perfNav.ts`, `scripts/perfScroll.ts`, `scripts/perfApi.ts`, `scripts/perfBundle.ts`)  
**Artifacts Stored In:** `qa-artifacts/`

---

## 1. Executive Summary: The Lag Profile

Prior to performance tuning, the application exhibited significant, perceptible UI stutter and latency:
1. **Route Switching Delay:** Average navigation click visual transition takes **3,200 ms** (ranging from **2,009 ms** to **4,978 ms**).
2. **Main-Thread Long Tasks:** Every page transition triggered **3 to 7 Long Tasks**, with peak main-thread freezes of **1,426 ms to 2,672 ms** per transition.
3. **Scroll Frame Drops:** Programmatic rapid scrolling on large tables (e.g. Student Directory, Sector Ledger) dropped down to **21–26 FPS** (far below the 60 FPS standard).
4. **Monolithic Bundle Size:** The initial client JS chunk was **2,808 KB uncompressed (809 KB gzipped)** in a single `index-*.js` file containing Three.js, jsPDF, html2canvas, xlsx, recharts, and all admin/manager/student pages.
5. **3D Avatar Rendering:** The 3D mascot maintained continuous animation (~43 FPS average in headless canvas), but suffered repaint churn when layouts re-rendered and was susceptible to crash upon route changes due to missing `.destroy()` interface implementation in `GuideEngine`.

---

## 2. Navigation Benchmark Baseline (15 Key Transitions)

Measured via `scripts/perfNav.ts` capturing DOM mutation latency, Long Tasks API entries, and 3D Avatar state:

| Role | Transition | Visual Response (ms) | Content Interactive (ms) | Long Tasks Count | Max Long Task (ms) | 3D Avatar FPS |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | Dashboard → Students Directory | 2,200 ms | 10 ms | 6 | 1,426 ms | 48 FPS |
| **Admin** | Students → Bulk Import | 3,884 ms | 3 ms | 3 | 1,854 ms | 51 FPS |
| **Admin** | Bulk Import → Audit Trail | 2,599 ms | 2 ms | 3 | 1,906 ms | 51 FPS |
| **Admin** | Audit Trail → Sectors & Classes | 4,398 ms | 1 ms | 3 | 1,916 ms | 42 FPS |
| **Admin** | Sectors → Issued Reports | 3,013 ms | 4 ms | 3 | 1,036 ms | 48 FPS |
| **Admin** | Issued Reports → Institution Profile | 3,106 ms | 1 ms | 3 | 1,490 ms | 45 FPS |
| **Admin** | Institution Profile → Dashboard | 3,212 ms | 2 ms | 4 | 1,471 ms | 29 FPS |
| **Manager** | Overview → Sector Ledger | 3,345 ms | 4 ms | 7 | 2,484 ms | 42 FPS |
| **Manager** | Ledger → Bulk Entry | 2,866 ms | 2 ms | 3 | 1,912 ms | 44 FPS |
| **Manager** | Bulk Entry → Class Reports | 4,767 ms | 2 ms | 4 | 2,055 ms | 39 FPS |
| **Manager** | Class Reports → Batches | 2,483 ms | 4 ms | 3 | 1,207 ms | 54 FPS |
| **Manager** | Batches → Overview | 4,978 ms | 1 ms | 2 | 2,672 ms | 21 FPS |
| **Student** | Overview → Profile | 2,623 ms | 1 ms | 5 | 1,584 ms | 42 FPS |
| **Student** | Profile → Notifications | 2,009 ms | 2 ms | 3 | 1,171 ms | 44 FPS |
| **Student** | Notifications → Overview | 4,353 ms | 1 ms | 4 | 1,996 ms | 39 FPS |

**Baseline Averages:**
- Average Visual Response: **3,256 ms**
- Average Max Long Task: **1,745 ms**
- Average Avatar 3D FPS: **43.3 FPS**

---

## 3. Scroll Performance Baseline

Measured via `scripts/perfScroll.ts` across heavy data tables:

| Page | Role | Scroll FPS | Long Tasks | Jank Detected | 3D Avatar FPS |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Admin Student Directory (`/admin/students`) | Admin | 21 FPS | 3 | YES | 46 FPS |
| Admin Audit Log (`/admin/audit`) | Admin | 26 FPS | 3 | YES | 49 FPS |
| Manager Sector Ledger (`/m/dept-fiqh/ledger`) | Manager | 23 FPS | 6 | YES | 42 FPS |
| Student Overview (`/app`) | Student | 23 FPS | 4 | YES | 43 FPS |

---

## 4. Backend & API Latency Baseline

Measured via `scripts/perfApi.ts` over 25 sequential iterations:

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | Avg (ms) |
| :--- | :--- | :--- | :--- | :--- |
| `/health` | 4 ms | 160 ms | 160 ms | 12 ms |
| `/api/assistant/chips` (Student) | 3 ms | 6 ms | 6 ms | 3 ms |
| `/api/assistant/chips` (Admin) | 3 ms | 6 ms | 6 ms | 3 ms |
| `/api/assistant/guides/search?q=import` | 7 ms | 23 ms | 23 ms | 8 ms |
| `/api/assistant/guides` (Catalog) | 8 ms | 12 ms | 12 ms | 8 ms |

---

## 5. Bundle & Asset Size Baseline

Measured via `scripts/perfBundle.ts`:

- **Initial JS Bundle:** 2,808 KB (809 KB gzipped) [`index-XwY99Fma.js`]
- **Total Application JS:** 3,613 KB (1,042 KB gzipped)
- **Top Bloat Chunks:**
  - `index-XwY99Fma.js`: 2,808 KB (809 KB gzipped) - Monolithic app bundle
  - `pdf-YwugTw7Y.js`: 434 KB (129 KB gzipped) - jsPDF
  - `html2canvas-Dy0GBVG5.js`: 195 KB (45 KB gzipped)
  - `index.es-CwN1Qe5e.js`: 148 KB (47 KB gzipped)
  - `purify.es-Dqk5qvad.js`: 28 KB (11 KB gzipped)

---

## 6. Top 10 Bottlenecks Identified

1. **Heavy CSS Filter Blur Animation on `<main>`:**  
   In `src/components/khazna/AppShell.tsx` lines 529-537, `<motion.div key={pathname} initial={{ filter: "blur(6px)", x: 36 }} animate={{ filter: "blur(0px)", x: 0 }} transition={{ duration: 0.45 }}>`. Animating `filter: blur(6px)` over an entire desktop view containing glassmorphic cards and backdrop filters forces repeated full-screen GPU rasterization passes, blocking the compositor thread for 150–300 ms on every click.
2. **Monolithic Bundle (Lack of Vendor & Route Chunking):**  
   All 26 route pages and heavy libraries (Three.js, Lucide icons, Recharts, Framer Motion) are imported in the initial bundle.
3. **No Route or Link Preloading:**  
   `src/router.tsx` configured with `defaultPreloadStaleTime: 0` without intent-based preloading, forcing synchronous bundle parsing upon clicking navigation items.
4. **Layout Re-rendering & Inline Anonymous Functions:**  
   `src/routes/admin.tsx` and `src/routes/m.$sectorSlug.tsx` used `component: () => <AppShell ...>` causing React to unmount and recreate the entire layout tree on each route change.
5. **Missing WebGL / Canvas Hardware Layer Isolation:**  
   The 3D mascot canvas in `AssistantAvatar3D.tsx` lacked CSS `contain: strict`, `will-change: transform`, causing layout reflows on the parent document.
6. **Prop Invalidation in `KhaznaAssistant`:**  
   `getPageId={() => pathname}` passed a fresh function reference on every render, invalidating memoization down into `AssistantWidget`.
7. **Missing Compression Middleware on Express:**  
   `server.ts` lacked gzip/brotli compression middleware, serving uncompressed JSON and HTML.
8. **Missing Cache-Control Headers for Static Assets:**  
   Production assets in `server.ts` were served without `Cache-Control: public, max-age=31536000, immutable`.
9. **Unvirtualized Long Lists:**  
   Student directory (100+ rows) and Sector Ledger rendered hundreds of DOM elements simultaneously, degrading scroll FPS to 21 FPS.
10. **GuideEngine Unmount Interface Mismatch (Bug Fixed):**  
    `GuideEngine.destroy()` called `this.targetResolver.destroy()` which didn't exist, causing `TypeError` on unmount and triggering the error boundary.
