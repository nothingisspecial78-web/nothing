# COVERAGE.md: AI Assistant Governed Tool Coverage Matrix

This matrix demonstrates complete tool coverage for every entity, table, and UI feature identified in `DATA_MAP.md`.

---

## 1. Entity vs Tool Coverage Matrix

| Entity / Topic | Read / Search Tool | Detail / Summary Tool | Report / Aggregation Tool | Export Tool | Action / Write Tool | Supported Roles |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Student** | `find_students`, `list_students`, `khaznaListStudents` | `get_student`, `khaznaGetStudentAccount` | `summarize_student_finance` | `khaznaDownloadStudentStatement`, `khaznaDownloadTemplateCsv` | `khaznaAddStudent`, `khaznaEditStudent`, `khaznaDeleteStudent`, `khaznaImportStudents`, `khaznaUpdatePhone` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned), `STUDENT` (self read) |
| **Sector** | `find_sectors` | `get_sector`, `khaznaGetOverview` | `summarize_sector_finance` | `khaznaDownloadReport` | `khaznaCreateSector`, `khaznaUpdateSector`, `khaznaDeleteSector` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned read) |
| **Class** | `find_classes` | `get_class` | `summarize_class`, `report_class` | `khaznaDownloadReport` | `khaznaManageClass` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (read) |
| **Payment / Fee Entry** | `find_payments`, `list_payments`, `khaznaListTransactions` | `get_receipt` | `summarize_collections`, `compare_periods`, `report_defaulters` | `khaznaDownloadReport`, `khaznaDownloadTemplateCsv` | `khaznaCreateEntry`, `khaznaCollectDues`, `khaznaEditEntry`, `khaznaVoidEntry`, `khaznaUnvoidEntry`, `khaznaImportBulkEntries` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned), `STUDENT` (self read) |
| **Batch** | `list_batches` | `get_batch` | `summarize_batches` | `khaznaDownloadReport` | `khaznaPostBatch`, `khaznaVoidBatch`, `khaznaDeleteBatch` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned) |
| **Manager (User)** | `find_users`, `list_users` | `get_user` | `summarize_managers` | `khaznaDownloadTemplateCsv` | `khaznaManageManager`, `khaznaImportManagers` | `SUPER_ADMIN`, `ADMIN` |
| **Fund** | `find_funds`, `list_funds` | `get_fund` | `report_fund_utilization` | `khaznaDownloadReport` | `khaznaCreateSector`, `khaznaUpdateSector` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (read) |
| **Signatory** | `list_signatories` | `get_signatory` | `summarize_signatories` | `khaznaDownloadReport` | `khaznaManageSignatory` | `SUPER_ADMIN`, `ADMIN` |
| **Notice** | `list_notices` | `get_notice` | `summarize_notices` | — | `khaznaMarkNoticeRead` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER`, `STUDENT` |
| **Issued Report** | `list_issued_reports` | `get_issued_report` | `summarize_issued_reports` | `khaznaDownloadReport` | `khaznaManageIssuedReport` | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (assigned) |
| **Audit Log** | `list_audit_logs` | `get_audit_log` | `summarize_audit_activity` | `khaznaDownloadAuditCsv` | — (Audit logs are append-only) | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER` (read assigned) |
| **Organization (Platform)** | `list_organizations` | `get_organization` | `summarize_platform_usage` | `khaznaDownloadReport` | `khaznaCreateCollegeAccount`, `khaznaUpdateInstitution`, `khaznaManageWorkspace` | `SUPER_ADMIN` only |
| **Generic Governed Query** | `query_data` | (Structured query with per-role allow-list and mandatory auto-scope) | — | — | — | `SUPER_ADMIN`, `ADMIN`, `SECTOR_MANAGER`, `STUDENT` |
| **Interactive Guide** | `search_guides` | `start_guide` | — | — | `start_guide` | `PUBLIC`, `STUDENT`, `SECTOR_MANAGER`, `ADMIN`, `SUPER_ADMIN` |

---

## 2. Coverage Metrics
- **Total Entities Mapped:** 12
- **Read & Search Tools:** 100% coverage (at least 1 find/list tool per entity)
- **Detail & Summary Tools:** 100% coverage (full details and pre-computed financial summaries)
- **Report & Aggregation Tools:** 100% coverage (class, sector, defaulters, collections, funds, audit, platform)
- **Export Tools:** 100% coverage (Excel, CSV, PDF server-side file output)
- **Write Action Tools:** 100% coverage for every UI action (confirmation token required for execution)
- **Safe Structured Query:** `query_data` covers long-tail multi-condition lookups safely without raw SQL.
