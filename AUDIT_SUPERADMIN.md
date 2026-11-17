# AUDIT_SUPERADMIN.md: Platform Super Admin, Admin Role & Multi-Tenant Isolation Audit

**Date:** 2026-11-14
**Scope:** Khazna Campus Ledger & Reusable AI Assistant Backend

---

## 1. Executive Summary

This audit assesses the current implementation of authentication, user roles, organization modeling, and cross-organization visibility in the Khazna web application.

Currently:
1. The highest user role in the college workspace is labeled `"Super Admin"` in the UI (e.g. Abdulla K., Principal), but logically acts as the **Admin of a single institution**.
2. However, the UI currently exposes an **Organization Switcher** (`AppShell.tsx:393-435`) and `switchOrg` actions in the store, allowing an organization Admin to switch between all colleges on the platform.
3. There is no true platform-level owner role to oversee all organizations, monitor platform-wide analytics, or inspect organization usage across tenants.

**Target Architecture:**
- **`SUPER_ADMIN` (Platform Owner, NEW):** Global access across all organizations. Separate login (`/super-admin/login`), separate routes (`/super-admin/*`), backend namespace (`/api/super-admin/*`), platform usage analytics, audit logs, and drill-down views.
- **`ADMIN` (Organization Admin, RENAMED from old Super Admin):** Top authority *within* a single organization. Organization switcher is completely removed. Access is strictly scoped to `organization_id`.
- **`SECTOR_MANAGER`:** Scoped strictly to assigned sector(s) within the organization.
- **`STUDENT`:** Scoped strictly to personal records within the organization.

---

## 2. Role Definition & Inventory

### 2.1 Role Definitions in Code
- **Frontend Type (`src/lib/khazna/types.ts:4`):**
  ```ts
  export type Role = "admin" | "manager" | "student";
  ```
  *Note:* The internal value was `"admin"`, but UI labels, menus, and badges called it `"Super Admin"`.
- **Backend AccessScope (`packages/server/src/security/scope.ts:9`):**
  ```ts
  export type AccessScopeRole = 'SUPER_ADMIN' | 'SECTOR_MANAGER' | 'STUDENT';
  ```
  *Update Needed:* Introduce `ADMIN` as the organization admin role, and redefine `SUPER_ADMIN` as the platform-level owner role:
  ```ts
  export type AccessScopeRole = 'SUPER_ADMIN' | 'ADMIN' | 'SECTOR_MANAGER' | 'STUDENT';
  ```

### 2.2 Occurrences of "Super Admin" Across the Application
1. **Frontend UI Components:**
   - `src/components/khazna/AppShell.tsx`:
     - Line 53: `admin: { label: "Super Admin", icon: ShieldCheck }` -> Rename to `"Admin"`
     - Line 369: `sub: "Super Admin"` -> Rename to `"Admin"`
     - Lines 644, 655: `<label>Super Admin Name</label>`, `<label>Super Admin Email</label>` -> Rename to `"Admin Name"`, `"Admin Email"`
     - Lines 393–435: Organization Switcher menu `<div className="hidden sm:block"><KMenu label="Switch college workspace"...` -> **Remove for Admin**.
   - `src/components/khazna/AestheticMenu.tsx`:
     - Line 92: `sub: "Super Admin", roleLabel: "Super Admin"` -> Rename to `"Admin"`
   - `src/components/khazna/KhaznaAssistant.tsx`:
     - Default label fallback `'Super Admin'` -> Rename to `'Admin'`
   - `src/lib/khazna/data.ts`:
     - Line 254: `export const SUPER_ADMIN = { name: "Abdulla K.", title: "Principal · Super Admin", ...}` -> Rename to `DEFAULT_ADMIN` or update title to `"Principal · Admin"`.
2. **AI Assistant Prompt Chips (`packages/server/src/chips/pageRegistry.ts`):**
   - Chip definitions currently tagged `role: 'SUPER_ADMIN'` for college features (`admin.dashboard.*`, `admin.students.*`, `admin.sectors.*`) must be changed to `role: 'ADMIN'`.
   - New platform chips will be created for `role: 'SUPER_ADMIN'` (`platform.organizations.*`, `platform.analytics.*`).
3. **Backend Tool Registry (`packages/server/src/tools/registry.ts`):**
   - Tool permissions for college administration tools (`khaznaAddStudent`, `khaznaCreateSector`, `khaznaPostBatch`, etc.) must be accessible by `ADMIN` (and `SUPER_ADMIN` in platform drilldown).

---

## 3. Organization Modeling & Current Leakage Points

### 3.1 Organization Model
- **Definition (`src/lib/khazna/store.ts:53-69`):**
  ```ts
  export interface College {
    id: string; // e.g. "demo" or generated UUID
    name: string;
    adminName: string;
    adminEmail: string;
    password?: string;
    demo: boolean;
  }
  ```
- **State Store (`src/lib/khazna/store.ts`):**
  - Manages `college: College`, `organizations: OrgSummary[]`, and `switchOrg(id: string)`.
  - When `switchOrg` was called, it loaded the target organization's data into the active view without verifying whether the user was authorized for that organization.

### 3.2 Security Gaps & Leakage Identified
1. **Admin Cross-Organization Switching:** Any admin could click the workspace switcher dropdown in `AppShell.tsx` and switch to another college's workspace.
2. **AI Assistant Workspace Switching:** The assistant tool `khaznaManageWorkspace` allowed switching to other college organizations.
3. **Backend Scope Lacked Organization Binding:** `AccessScope` did not enforce `organizationId` on all queries; college admin queries defaulted to global view.

---

## 4. Remediation Plan

1. **Database & Scripts:**
   - Create `scripts/backup-before-superadmin.ts` to create an immutable pre-migration snapshot.
   - Create `scripts/preflight-superadmin.ts` to ensure all existing admin accounts are tied to a valid organization.
   - Create `scripts/bootstrap-super-admin.ts` to securely initialize the platform `SUPER_ADMIN` using bcrypt (cost 12) from `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.
   - Create `scripts/rollback-superadmin.ts` for automated rollback capability.
2. **Remove Organization Switcher from Admin:**
   - Remove workspace switcher UI from `AppShell.tsx` and lock backend switching endpoints for non-platform users.
   - Admin UI displays only the user's assigned organization name.
3. **Build Platform Super Admin (`/super-admin/*` and `/api/super-admin/*`):**
   - Create `/super-admin/login` with hardened security (rate limiting, lockout, constant-time verification).
   - Create Super Admin Dashboard with platform-wide totals, organization list, organization drill-down, and usage analytics.
4. **Update AI Assistant Scope & Tools:**
   - Split roles: `SUPER_ADMIN` (Platform) and `ADMIN` (Organization).
   - Provide full governed data access from A to Z across all entities.
