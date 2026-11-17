# Changes: Guide Skill v2 (Avatar, Voice & Step-by-Step On-Screen Walkthroughs)

## 1. Summary of Upgrades
Added the **Guide Skill v2** to the Khazna Campus Ledger AI Assistant. When users ask "how do I...", "guide me", "show me how", or "help me do X step by step", the assistant minimizes the chat panel and walks the user through the live web application step by step using the project's own procedural 3D avatar, spotlighting, spoken voice narration, and live caption controls.

## 2. Completed Modules & Files

### A. Avatar Inspection & Config
- `scripts/inspectAvatar.ts`: Traverses all 29 Three.js meshes, geometry parameters, bone joints, and PBR materials of the mascot.
- `avatar.config.json`: Articulation points, head gaze clamps, arm pointing angles, mouth speaking shapes, and privacy shielding gesture.
- `AVATAR_REPORT.md` & `AUDIT_GUIDE.md`: Comprehensive technical audits of the mascot and page target elements.

### B. Guide Definitions & Role Scoping
- `packages/core/src/guides/types.ts`: Zod schemas for GuideActionType, GuideCompletionCondition, GuideStepTarget, GuideStep, and GuideDef.
- `packages/core/src/guides/definitions.ts`: 15 authored guides spanning:
  - **Public**: `public.login`, `public.register`, `public.forgot_password`
  - **Student**: `student.view_fees`, `student.profile`
  - **Sector Manager**: `manager.ledger_entry`, `manager.add_deposit`, `manager.bulk_entry`
  - **Admin**: `admin.students.import`, `admin.students.add`, `admin.sectors.create`, `admin.managers.assign`, `admin.reports.issued`, `admin.institution`
  - **Super Admin**: `superadmin.overview`
- `packages/server/src/guides/guideService.ts`: Guide catalog filtering by `AccessScope`, multi-language search (English, Malayalam, Manglish), and user progress analytics.

### C. Live UI Targeting (`data-guide-id`)
Equipped key interactive elements with stable targeting attributes across:
- `src/routes/login.tsx`: Tab switches, role selectors, username, password (`data-guide-sensitive="true"`), and submit.
- `src/components/khazna/AppShell.tsx`: Navigation sidebar items, mobile drawer, quick action buttons.
- `src/routes/admin.students.import.tsx`: Upload dropzone, template download, preview continue, confirm import.
- `src/routes/admin.students.index.tsx`, `src/routes/admin.sectors.tsx`, `src/routes/m.$sectorSlug.ledger.tsx`, `src/routes/app.index.tsx`.

### D. Widget Client Controller Suite
- `packages/widget/src/guide/TargetResolver.ts`: Resolves elements by `data-guide-id` or CSS fallbacks, smooth scroll into view, mobile menu handling.
- `packages/widget/src/guide/VoiceController.ts`: Web Speech API synthesis with English/Malayalam voice selection, mute persistence, server TTS fallback.
- `packages/widget/src/guide/GuideAvatarController.ts`: Viewport-level 3D Three.js mascot animator. Smooth travel, head tracking, arm gestures, and the **privacy gesture** (eyes closed, head turned away during sensitive password typing).
- `packages/widget/src/guide/GuideOverlay.tsx`: Interactive SVG spotlight cutout mask, live subtitle caption bar, and navigation controls (Back, Next, Repeat, Pause/Resume, Mute, Hide Avatar, Ask AI, Exit).
- `packages/widget/src/guide/GuideEngine.ts`: Finite-state walkthrough driver, event-based step advances (`click`, `valueFilled`, `fileSelected`, `routeChanged`), 15s hint / 45s mini-chat stuck timers, and `sessionStorage` caching.

### E. Vercel & UI Bug Fixes
- **Vercel ERESOLVE Error Fix**: Removed conflicting `"esbuild": "^0.25.0"` from `package.json` devDependencies. Added `.npmrc` with `legacy-peer-deps=true`.
- **Vercel Monorepo Deployment Guidance**: Clear instructions to select `app (Vite) /` as root project.
- **Inspect Button Removed**: Floating crosshair inspect button removed from widget dock. Obsolete `global.inspect-hint` chip replaced with `global.guide-tour`.
- **Prompt Chips Persistence**: Fixed race condition in `AssistantWidget.tsx`. Role suggestions and dynamic server chips are merged (`combinedChips`), ensuring role-appropriate prompt chips never vanish.
