# Performance Maintenance & Architecture Guide

This guide describes the performance patterns, measurement scripts, and development rules for maintaining high frame rates, fast navigation, and continuous 3D avatar animations in this codebase.

---

## 1. Automated QA & Performance Benchmarking Tooling

Five specialized benchmark scripts are integrated into `package.json`:

```bash
# 1. Run complete automated QA performance suite
npm run qa:all

# 2. Run Route Navigation & Transition Benchmark
npm run perf:nav

# 3. Run Table & List Scrolling Benchmark
npm run perf:scroll

# 4. Run Backend & API Latency Benchmark
npm run perf:api

# 5. Run Bundle Size & Vendor Chunking Analysis
npm run perf:bundle
```

All benchmark artifacts, reports, and visual screenshots are automatically saved to `qa-artifacts/`:
- `qa-artifacts/nav_benchmark_latest.json`
- `qa-artifacts/scroll_benchmark_latest.json`
- `qa-artifacts/api_benchmark_latest.json`
- `qa-artifacts/bundle_analysis_latest.json`
- `qa-artifacts/nav_*.png` (Full visual validation of every route transition)

---

## 2. Core Architectural Rules

### Rule 1: Always Keep the 3D Avatar Continuously Alive & Isolated
- **Never pause or unmount the 3D avatar** to gain speed.
- Wrap avatar and widget containers in `React.memo` with custom prop comparators. Mouse tracking, hover bobbing, and gaze updates should always run directly on refs inside the `requestAnimationFrame` loop without triggering React component re-renders.
- Keep `contain: strict; will-change: transform;` on `.aia-avatar-stage` so WebGL canvas repaints do not invalidate DOM document layout.

### Rule 2: Strictly Compositor-Only Page Animations
- Never animate `filter: blur(...)` or `backdrop-filter` on top-level layout containers or `<main>`. Blur re-rasterizes every child node in the tree and freezes the main thread.
- Only animate compositor-friendly CSS properties: `transform` (e.g. `translateX`, `scale`) and `opacity`.
- Use `willChange: "transform, opacity"` on animated page containers.

### Rule 3: Maintain Vendor Code Splitting in `vite.config.ts`
- Heavy libraries (`three`, `jspdf`, `xlsx`, `recharts`, `framer-motion`) must remain in separate async manual chunks.
- Never import heavy visualization or document generation libraries statically in top-level layout components.

### Rule 4: Table and Long List Optimization
- Long data tables (e.g. Students Directory, Audit Trail, Ledger) must apply:
  ```css
  & tbody tr {
    content-visibility: auto;
    contain-intrinsic-size: 0 49px;
  }
  ```
- Cap Framer Motion entrance animation delay trees to the first 12–15 visible rows (`idx < 12 ? reveal(idx) : {}`).

### Rule 5: Stable Layout References in TanStack Router
- Never assign inline anonymous arrow functions to layout routes (e.g. `component: () => <AppShell ...>`). Always declare a top-level named function (e.g. `component: AdminLayout`) so React and TanStack Router preserve the component fiber across subroute changes.
