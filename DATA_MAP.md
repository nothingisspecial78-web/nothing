# DATA_MAP.md: Full Application Data & Feature Mapping

This document provides a comprehensive mapping of all database tables, models, UI features, API endpoints, identifiers, and access scopes across the Khazna Campus Ledger and the multi-tenant AI assistant.

---

## 1. Entity & Model Schema

| Entity | Primary Key | Key Fields & Types | Relationships | Role Access |
| :--- | :--- | :--- | :--- | :--- |
| **Organization (College)** | `id: text` | `name: text`, `adminName: text`, `adminEmail: text`, `passwordHash: text`, `demo: boolean`, `createdAt: timestamp` | 1-to-many with Sectors, Students, Classes, Transactions, Users | `SUPER_ADMIN` (all), `ADMIN` (own org only), `SECTOR_MANAGER` (own org), `STUDENT` (own org) |
| **Sector** | `slug: text` | `organizationId: text`, `name: text`, `short: text`, `description: text`, `color: text`, `receiptPrefix: text`, `target: numeric`, `creditTitles: text[]`, `debitTitles: text[]` | Belongs to Org; 1-to-many with Transactions, Batches, Managers | `SUPER_ADMIN` (all orgs), `ADMIN` (own org all sectors), `SECTOR_MANAGER` (assigned sector only) |
| **Class** | `id: text` | `organizationId: text`, `name: text`, `code: text`, `description: text`, `studentCount: integer`, `targetFee: numeric` | Belongs to Org; 1-to-many with Students | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (own sector students), `STUDENT` (own class) |
| **Student** | `id: text` (Ad.No) | `organizationId: text`, `name: text`, `className: text`, `phone: text`, `guardian: text`, `email: text`, `joined: date`, `status: text` ('active'/'inactive') | Belongs to Org; 1-to-many with Transactions | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (own sector only), `STUDENT` (self only) |
| **Transaction (Payment/Fee)** | `id: text` | `organizationId: text`, `sector: text`, `studentId: text`, `type: text` ('credit'/'debit'), `title: text`, `amount: numeric`, `date: date`, `receiptNo: text`, `batchId: text`, `voided: jsonb` | Belongs to Org, Sector, Student | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (own sector only), `STUDENT` (self only) |
| **Batch** | `id: text` | `organizationId: text`, `sector: text`, `studentIds: text[]`, `type: text`, `title: text`, `amount: numeric`, `date: date`, `receiptPrefix: text`, `voided: jsonb` | Belongs to Org, Sector; references Students | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (own sector only) |
| **Manager (User)** | `id: text` | `organizationId: text`, `name: text`, `email: text`, `phone: text`, `sectorSlug: text`, `status: text`, `joinedDate: date`, `lastActive: timestamp` | Belongs to Org; assigned to Sector | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (self only) |
| **Fund** | `id: text` | `organizationId: text`, `sourceName: text`, `fundingType: text` ('Student Fees'/'Charity'/'Government Grant'/'Endowment'), `targetSector: text`, `amount: numeric`, `createdAt: timestamp` | Belongs to Org, Sector | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (assigned sector) |
| **Signatory** | `id: text` | `organizationId: text`, `name: text`, `title: text`, `role: text` ('accounts_officer'/'hod'/'principal'), `signatureUrl: text`, `active: boolean` | Belongs to Org | `SUPER_ADMIN` (all), `ADMIN` (own org) |
| **Notice** | `id: text` | `organizationId: text`, `kind: text` ('debit'/'credit'/'due'/'info'), `title: text`, `body: text`, `sector: text`, `at: timestamp`, `read: boolean` | Belongs to Org, Student/Sector | `SUPER_ADMIN` (all), `ADMIN` (own org), `STUDENT` (self only) |
| **IssuedReport** | `id: text` (Ref) | `organizationId: text`, `type: text`, `title: text`, `generatedAt: timestamp`, `expiresAt: timestamp`, `status: text` ('valid'/'revoked'/'expired'), `downloadUrl: text` | Belongs to Org | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (assigned sector) |
| **AuditEntry** | `id: text` | `organizationId: text`, `at: timestamp`, `actor: text`, `role: text`, `action: text`, `target: text`, `details: text`, `ip: text`, `sector: text` | Belongs to Org | `SUPER_ADMIN` (all), `ADMIN` (own org), `SECTOR_MANAGER` (assigned sector) |
| **PlatformSuperAdmin** | `id: text` | `email: text`, `passwordHash: text` (bcrypt 12), `role: text` ('SUPER_ADMIN'), `organizationId: null`, `status: text`, `createdAt: timestamp` | Global Platform Owner | `SUPER_ADMIN` only |

---

## 2. Lookup Keys & Identifiers

| Entity | Primary & Alternate Lookup Keys | Normalization & Matching Rules |
| :--- | :--- | :--- |
| **Student** | Admission Number (`S0125`, `CF-2026-001`), Full/Partial Name (`Safwan K.`), Phone, Guardian Name, Class + Roll No, Receipt No | Case-insensitive, whitespace trimmed, punctuation stripped, trigram/Levenshtein similarity, Malayalam transliteration tolerant |
| **Sector** | Slug (`dept-fiqh`, `office`), Code/Short (`DF`, `OF`, `IU`, `VW`), Name (`Dept Fiqh`, `Office`) | Lowercase, hyphenated slug resolution, partial word matching |
| **Class** | Class Name (`Fiqh 2`, `Civil 1`, `Hifz`), Code (`FQ2`, `CV1`) | Case-insensitive, number/word normalization |
| **Payment/Receipt** | Receipt Number (`OF-1047`, `KZ-101`, `DF-224`), Transaction ID (`TX100`) | Exact prefix and numeric extraction |
| **Batch** | Batch ID (`B-2610-19`, `B-AI-492`), Title (`Study Tour Fee`) | Prefix extraction (`B-`) |
| **Fund** | Fund Name (`Zakat Fund`, `Charity Pool`), Funding Type | Keyword pattern match |
| **Organization** | Org ID (`demo`, `org_xyz`), College Name (`Islahul Uloom`) | Slug/Name resolution |

---

## 3. UI Features & Backend Function Map

| Page / Route | UI Feature Description | Backend Function / Scoped Repository | Permitted Roles |
| :--- | :--- | :--- | :--- |
| `/super-admin/dashboard` | Platform metrics & aggregate stats | `getPlatformMetrics()` | `SUPER_ADMIN` |
| `/super-admin/organizations` | Organizations list & search | `listOrganizations()` | `SUPER_ADMIN` |
| `/super-admin/organizations/:id` | Organization detail & drill-down | `getOrganizationDetail(orgId)` | `SUPER_ADMIN` |
| `/super-admin/analytics` | AI assistant & platform usage analytics | `getPlatformUsageAnalytics()` | `SUPER_ADMIN` |
| `/super-admin/audit` | Platform audit log viewer | `listPlatformAuditLogs()` | `SUPER_ADMIN` |
| `/admin` | College overview & campus financials | `summarizeCampusFinance(scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/admin/students` | Student directory & search | `findStudents(query, scope)`, `listStudents(scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/admin/students/import` | Bulk student roster CSV import | `khaznaImportStudents(uploadId, scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/admin/sectors` | Sector cards, budgets, managers | `listSectors(scope)`, `summarizeSectorFinance(slug, scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/admin/batches` | Bulk fee batch operations | `listBatches(scope)`, `khaznaPostBatch(args, scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/admin/audit` | College audit logs & CSV export | `listAuditLogs(scope)`, `exportAuditLogs(scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/admin/issued-reports` | Manage verifiable issued reports | `listIssuedReports(scope)`, `revokeReport(id, scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/admin/institution` | Update college details & signatories | `updateInstitution(args, scope)` | `SUPER_ADMIN`, `ADMIN` |
| `/m/:sectorSlug` | Sector overview & target progress | `summarizeSectorFinance(sector, scope)` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned) |
| `/m/:sectorSlug/ledger` | Sector transactions & voiding | `listTransactions(sector, scope)`, `khaznaVoidEntry(args, scope)` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned) |
| `/m/:sectorSlug/bulk` | Post batch fee across class | `khaznaPostBatch(args, scope)` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned) |
| `/m/:sectorSlug/reports` | Sector & class PDF/Excel reports | `reportClass(class, sector, scope)`, `reportDefaulters(sector, scope)` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned) |
| `/app` | Personal fee balance & breakdown | `summarizeStudentFinance(studentId, scope)` | `SUPER_ADMIN`, `ADMIN`, `STUDENT` (self) |
| `/app/s/:sectorSlug` | Personal transactions in sector | `listTransactions(sector, scope)` | `SUPER_ADMIN`, `ADMIN`, `STUDENT` (self) |
| `/app/profile` | View profile & update phone | `getStudent(studentId, scope)`, `updatePhone(phone, scope)` | `SUPER_ADMIN`, `ADMIN`, `STUDENT` (self) |
| `/app/notifications` | View & mark notices as read | `listNotices(scope)`, `markNoticeRead(id, scope)` | `SUPER_ADMIN`, `ADMIN`, `STUDENT` (self) |

---

## 4. Scope Isolation Gaps Resolved

1. **Organization Switcher Removed from Admin:** Admins are now strictly confined to `scope.organizationId`. No cross-tenant switching exists in Admin UI or API.
2. **Platform Super Admin Built:** Dedicated platform owner role at `/super-admin/*` with isolated session cookies, bcrypt-hashed credentials, and audit-logged cross-tenant inspection.
3. **Governed Tool Catalog:** All data queries go through scoped repository functions where `organization_id`, `sector_id`, and `student_id` are injected by server code.
