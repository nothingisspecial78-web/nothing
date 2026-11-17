# Changes: Multi-Tenant Platform Super Admin & Organization Isolation

## 1. Overview
Introduced a platform-level `SUPER_ADMIN` role that oversees all tenant organizations and platform usage analytics, renamed the existing organization-level "Super Admin" to `ADMIN`, and strictly isolated tenant organizations so an Organization Admin cannot see, query, or switch to other colleges.

## 2. Role Hierarchy
```
Platform Super Admin (NEW)
  └── Organization Admin (RENAMED from old "Super Admin", strictly scoped to own organization)
        └── Sector Manager (strictly scoped to assigned sectors within organization)
              └── Student (strictly scoped to own student record)
```

## 3. Key Components Implemented

### 3.1 Migration Safety & Bootstrap Scripts
- **`AUDIT_SUPERADMIN.md`**: Complete role inventory, organization data modeling, and remediation roadmap.
- **`scripts/backup-before-superadmin.ts`**: Pre-migration state backup snapshot stored in `backups/`.
- **`scripts/preflight-superadmin.ts`**: Preflight verification ensuring zero orphaned records or unlinked admins.
- **`scripts/bootstrap-super-admin.ts`**: Idempotent bootstrap creating `data/platform_admins.json`. Validates email format, requires password length >= 12, hashes with `bcrypt` (cost 12), and sets `mustChangePassword`.
- **`scripts/rollback-superadmin.ts`**: Safe rollback script restoring state from timestamped backup manifests.

### 3.2 Backend Platform Endpoints (`packages/server/src/routes/superAdmin.ts`)
- Mounted under `/api/super-admin`:
  - `POST /api/super-admin/login`: Rate-limited authentication (lockout after 5 failed attempts for 15 mins). Generates JWT with audience claim `aud: 'super-admin'`.
  - `POST /api/super-admin/logout`: Terminate session and audit log.
  - `GET /api/super-admin/me`: Current Super Admin identity.
  - `GET /api/super-admin/organizations`: List all tenant colleges with student/sector counts and balance summaries.
  - `GET /api/super-admin/organizations/:id`: Drill down into specific organization's sectors and statistics.
  - `GET /api/super-admin/analytics`: Platform-wide metrics (total organizations, students, volume in INR, system health).
  - `GET /api/super-admin/audit-logs`: Immutable log of platform administrative actions.
  - `POST /api/super-admin/change-password`: Verified password change with bcrypt rehashing.

### 3.3 UI & Role Renaming
- Renamed all occurrences of "Super Admin" for college owners to "Admin" across `AppShell.tsx`, `AestheticMenu.tsx`, `login.tsx`, `admin.index.tsx`, `admin.audit.tsx`, `admin.admins.tsx`, and `KhaznaAssistant.tsx`.
- Removed Organization Switcher dropdown menu from the Organization Admin header in `AppShell.tsx`. Replaced with a static college workspace badge.
- Built dedicated Platform Super Admin web application at `/super-admin/*`:
  - Login at `/super-admin/login`.
  - Dashboard at `/super-admin` with KPI cards, organizations table with drill-down modal, audit logs, and password change modal.

### 3.4 Multi-Tenant Scoping Layer (`packages/server/src/security/scope.ts`)
- Added `SUPER_ADMIN` (platform-level, `organizationId: null`) and `ADMIN` (org-scoped).
- Added `isAllowedOrganization(scope, orgId)` check.
- Added audience distinction (`aud: 'super-admin'`) for platform tokens.
