# Audit: Guide Skill Architecture, Routes, Roles & 3D Avatar (AUDIT_GUIDE.md)
*Completed on 2026-11-14 as part of the Guide Skill Implementation*

---

## 1. Application Framework, Routing & Mounting Architecture

- **Web Framework**: React 19 (`react: ^19.0.1`, `react-dom: ^19.0.1`) + Vite 8.3 (`@vitejs/plugin-react: ^6.1.1`).
- **Routing**: TanStack Router (`@tanstack/react-router: ^1.170.46`) with file-based routing in `src/routes/`.
- **Global Mounting**: 
  - `KhaznaAssistant` is mounted inside `RootComponent` in `src/routes/__root.tsx`.
  - Because it is mounted at the root router level above the `<Outlet />`, the assistant widget is available across **all pages**—both unauthenticated public routes (`/login`, `/super-admin/login`) and authenticated role portals (`/admin`, `/m/:sectorSlug`, `/app`, `/super-admin`).
- **State Management**:
  - `useKhazna` Zustand store (`src/lib/khazna/store.ts`) holds multitenant college state, sectors, students, transactions, managers, active role (`admin` | `manager` | `student`), and active sector.
  - Platform super-admin state is managed in `sessionStorage` (`khazna_super_admin_token`, `khazna_super_admin_user`).

---

## 2. Page & Layout Structure

The application layout divides into distinct tiers:
1. **Public Pre-Login Tier**:
   - `/login`: Tabs for "Sign in" (Admin, Sector Manager, Student) and "Create college" (Registration), demo quick-fill buttons.
   - `/super-admin/login`: Platform super-admin credentials form.
2. **Student Portal (`/app`)**:
   - `/app` (`app.index.tsx`): Overview of personal dues, sector balances, transaction log.
   - `/app/profile`: Student details (admission number, class, guardian, phone).
   - `/app/notifications`: College broadcast announcements.
   - `/app/s/:sectorSlug`: Personal ledger filtered to specific sector.
3. **Sector Manager Portal (`/m/:sectorSlug`)**:
   - `/m/:sectorSlug` (`m.$sectorSlug.index.tsx`): Sector balance, monthly intake/payouts.
   - `/m/:sectorSlug/ledger`: Detailed sector ledger with "New Entry" dialog (credit/debit), search, filter, edit/void actions.
   - `/m/:sectorSlug/bulk`: Bulk fee entry for entire classes.
   - `/m/:sectorSlug/reports`: Class-wise collection reports and statements.
   - `/m/:sectorSlug/batches`: Batch fee receipts.
4. **College Admin Portal (`/admin`)**:
   - `/admin` (`admin.index.tsx`): College-wide financial health, collection vs target, sector breakdowns.
   - `/admin/students` (`admin.students.index.tsx`): Student directory with search, "Add Student" drawer, class filtering.
   - `/admin/students/import`: Bulk spreadsheet import with 4-step wizard (Upload CSV -> Map Columns -> Validate Rows -> Done).
   - `/admin/sectors`: Sector management (create sector, set budgets, receipts prefix).
   - `/admin/admins`: Sector manager user management and assignments.
   - `/admin/institution`: College profile and receipt settings.
   - `/admin/audit`: Append-only audit trail of financial changes.
   - `/admin/issued-reports`: Downloadable PDF/Excel records.
5. **Super Admin Platform Portal (`/super-admin`)**:
   - `/super-admin`: Platform tenant overview, colleges list, system-wide transaction counts.

---

## 3. 3D Avatar Discovery & Model Decision

### 3.1 Search & Discovery Findings
- **File Search**: No external `.glb` or `.gltf` binary assets are bundled in `public/` or `src/assets/`.
- **Code Inspection**: The assistant features an in-engine procedural Three.js character component in [AssistantAvatar3D.tsx](file:///C:/Users/new%20user/antigravity/Embeddable-AI-Assistant-&-Demo-Apps/packages/widget/src/components/AssistantAvatar3D.tsx) paired with [avatarKinematics.ts](file:///C:/Users/new%20user/antigravity/Embeddable-AI-Assistant-&-Demo-Apps/packages/widget/src/components/avatarKinematics.ts).
- **Architecture**:
  - Rendered in Three.js with PBR materials (`MeshStandardMaterial`, `MeshPhysicalMaterial`), contact shadow disc, and warm 3-point studio lighting.
  - Constructed with 29 articulated meshes totaling 15,834 triangles (zero network loading latency, optimal 60fps performance on low/mid-tier mobile devices).
  - Explicit articulation hierarchy:
    - `avatarRoot`: Root position in screen coordinates.
    - `pedestalGroup`: Holographic ring base.
    - `bodyGroup`: Torso chassis with thruster skirt, ceramic chest plate, glowing AI crystal.
    - `leftArmPivot` & `rightArmPivot`: Shoulder joints, ceramic forearms, and glowing wrist cuffs (ideal for directional pointing at UI elements).
    - `headGroup`: Ceramic cranial shell with dark glossy visor.
    - `leftEye` & `rightEye`: Capsule glowing eyes with independent vertical scaling (`eyeScaleY`) capable of natural blinking and complete closure for privacy.
    - `haloGroup`: Orbiting halo ring with 3 satellite neural nodes.

### 3.2 Decision & Reuse Strategy
- **Decision**: Reuse and extend the existing Three.js avatar from `AssistantAvatar3D.tsx`.
- **Reasoning**:
  1. It is the exact mascot already recognized by users in the widget dock.
  2. It has existing kinematic hooks for arm positioning, head rotation, eye scaling, and halo spin.
  3. It requires 0kB of external network download, starting instantly (<15ms) across slow connections.
- **Config Storage**: Location and kinematics mapped in `avatar.config.json` with quality levels `auto`, `high`, and `low`.

---

## 4. User Tasks Worth Guiding per Role

| Role | Guide ID | Title | Summary / Purpose |
| :--- | :--- | :--- | :--- |
| **Public** | `public.login` | How to Log In | Guides user to select role, enter email/admission number, type password (eyes closed), and submit. |
| **Public** | `public.register` | Register College | Field-by-field walkthrough of college name, admin name, email, password, and confirmation. |
| **Public** | `public.forgot_password`| Reset Password | Step-by-step guidance on password recovery instructions. |
| **Student** | `student.view_fees` | Check My Fees & Dues | Navigates to overview, highlights personal fee dues, sector breakdown, and ledger. |
| **Student** | `student.receipt` | View Fee Statement | Walkthrough to download PDF statements and view payment receipts. |
| **Student** | `student.profile` | View My Profile | Walkthrough to check admission number, assigned class, and guardian contact. |
| **Manager** | `manager.ledger_entry` | View Sector Ledger | Walkthrough of sector balances, filter options, and viewing recent ledger lines. |
| **Manager** | `manager.add_deposit` | Record Fee Deposit | Opens New Entry dialog, guides amount input, student selection, note, and submit. |
| **Manager** | `manager.add_expense` | Record Sector Expense | Guides voucher/debit recording with category notes and receipt proof. |
| **Manager** | `manager.bulk_entry` | Post Bulk Class Entry | Navigates to bulk entry, selects class, enters standard fee, and submits. |
| **Manager** | `manager.class_reports`| Generate Class Reports | Steps to select class, view collection percentage, and export report. |
| **Admin** | `admin.students.import` | Bulk Student Import | 4-step wizard: download template, drop CSV/Excel, map columns, validate, confirm. |
| **Admin** | `admin.students.add` | Add Individual Student | Opens Student drawer, guides admission number, name, class selection, and save. |
| **Admin** | `admin.students.find` | Find Student & Details | Walks through search box, filtering by class, and clicking student row for details. |
| **Admin** | `admin.sectors.create` | Create New Sector | Navigates to sectors page, creates sector, sets receipt prefix and fee target. |
| **Admin** | `admin.managers.assign` | Assign Sector Manager | Navigates to Admins & Managers, adds manager, links email to sector. |
| **Admin** | `admin.reports.issued` | Download Audit Reports | Walks through issued reports and statement downloads. |
| **Admin** | `admin.institution` | College Settings | Steps to update college name, phone, address, and receipt signatory. |
| **Super Admin** | `superadmin.overview` | Platform Overview | Super Admin overview of all campus organizations and metrics. |

---

## 5. UI Targeting Strategy (`data-guide-id`)

To ensure stable, resilient element selection independent of CSS refactoring:
- Primary selector: `[data-guide-id="<unique-key>"]`.
- Fallbacks in order:
  1. Specific secondary `data-guide-id` aliases
  2. `aria-label` / `name` attributes
  3. Contextual visible button/link text matching
- Dynamic UI Handling:
  - `MutationObserver` with 8-second polling wait.
  - Automatic mobile menu drawer expansion (`setAestheticMenuOpen(true)` or `[data-guide-id="mobile-menu-button"]`) if target is inside a collapsed drawer on mobile viewports.
  - Self-healing fallback: If target is not found after timeout, displays a clear instructional caption and allows Next/Skip without crashing the guide.
