# Changes: A-to-Z Governed Data Access Layer

## 1. Overview
Upgraded the Khazna Campus embedded AI assistant to enable full data access (from A to Z) across all entities and features of the web application, strictly governed by server-side `AccessScope`. The model never writes raw SQL or queries unrestricted endpoints. All mathematical calculations (fees, totals, balances, defaulters) are computed in TypeScript/SQL code—never calculated through model arithmetic.

## 2. Key Components Added

### 2.1 Entity Map & Coverage Matrix
- **`DATA_MAP.md`**: Complete inventory of all 12 system entities (Student, Sector, Class, Transaction/Receipt, Fund, Audit Log, User/Auth, Notice, Issued Report, Institution Profile, Import Batch, Organization), lookup keys, and role access rules.
- **`COVERAGE.md`**: Direct mapping matrix proving 100% read/write/report/export coverage across all UI pages and tools.

### 2.2 Scoped Repository Layer (`packages/server/src/db/scopedDataRepository.ts`)
- **`ScopedDataRepository`**: Governed data repository requiring an `AccessScope` on every method call. Automatically injects tenant filters (`organizationId`), sector filters (`sectorIds`), and student filters (`studentId`).
- **Multi-Key Entity Resolver**: Resolves students and sectors by:
  - Exact or partial name, case-insensitively.
  - Admission number (`S0125`, `CF-2026-001`).
  - Phone number (normalized to digits).
  - Trigram / Bigram Dice coefficient string similarity with multi-word discount.
- **Disambiguation System**: When multiple entities match (e.g. searching "Rahul" matches both "Rahul Sharma" and "Rahul Varma"), returns structured disambiguation choices with IDs and classes instead of guessing.
- **Conversation Focus Memory (`setConversationFocus`, `getConversationFocus`)**: Remembers the active entity (student/sector) per conversation thread so follow-up queries (e.g. "what are their pending fees?") resolve automatically.
- **Pre-computed Financial Calculations**:
  - `summarizeStudentFinance`: computes total debit, total credit, and net balance in code, excluding voided entries.
  - `reportClass`: calculates class-level totals and defaulters count.
  - `reportDefaulters`: aggregates all students with balance > 0.
  - `reportFundUtilization`: tracks allocation vs spent amounts.
- **Governed Structured Query (`executeStructuredQuery`)**: Safely executes dynamic queries on allowed tables with pagination, column projection, and mandatory scope injection.

### 2.3 Governed Tool Catalog (`packages/server/src/tools/dataAccessTools.ts` & `registry.ts`)
- Registered 12 typed data access tools:
  - `find_students`
  - `get_student`
  - `summarize_student_finance`
  - `find_sectors`
  - `summarize_sector_finance`
  - `report_class`
  - `report_defaulters`
  - `report_fund_utilization`
  - `get_receipt`
  - `list_organizations` (Super Admin only)
  - `summarize_platform_usage` (Super Admin only)
  - `query_data`
- Registered tools in `profiles/khazna-ledger/profile.json` and merged into `BUILTIN_TOOLS`.
- Updated role allow-lists in `ToolRegistry` to enforce role scoping before execution.

## 3. Assumptions Recorded
1. Voided transactions (`isVoid: true` / `voided`) are permanently retained for audit integrity but excluded from balance and fee totals.
2. If a student search yields ambiguous candidates, the assistant returns a numbered disambiguation list and prompts the user to select.
3. All currency amounts are formatted consistently in Indian Rupees (`₹`).
4. Tenant College Admins (`ADMIN`, `/admin/*`) and Platform Owners (`SUPER_ADMIN`, `/super-admin/*`) are strictly separated: College Admins are scoped to `organizationId`, while `SUPER_ADMIN` retains cross-tenant platform access (`/superadmin` and `/superadmin/login` redirect cleanly via HTTP 302 to `/super-admin` and `/super-admin/login`).
5. `compare_periods` computes scoped date-range deltas (`period1` vs `period2`) in TypeScript and obeys `AccessScope` for `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER`, and `STUDENT`, while denying `PUBLIC`.
6. Pronoun follow-ups (`his`, `her`, `their`, `that student`) resolve the active `FocusEntity` from `getConversationFocus(conversationId, scope)` in the deterministic intent router as well as live tool loops.

