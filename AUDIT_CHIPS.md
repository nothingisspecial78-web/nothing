# Audit: Role-Aware & Page-Aware Prompt Chips

**Date:** 2026-11-14  
**Target:** Suggestion chips in Khazna AI Assistant

---

## 1. Where Chips Come From Today

- **Source Code:**  
  In [KhaznaAssistant.tsx](file:///C:/Users/new%20user/antigravity/Embeddable-AI-Assistant-&-Demo-Apps/src/components/khazna/KhaznaAssistant.tsx#L1331-L1337), suggestion chips are hardcoded as a static string array passed into `<AssistantWidget suggestions={[...]} />`:
  ```tsx
  suggestions={[
    'Download Class Report PDF',
    'Add student',
    'Record ₹1500 credit deposit for Safwan K. in Office',
    'Post ₹500 Study Tour Fee batch for Fiqh 2',
    'Open Super Admin demo dashboard',
  ]}
  ```
- **Display Trigger:**  
  In [MessageList.tsx](file:///C:/Users/new%20user/antigravity/Embeddable-AI-Assistant-&-Demo-Apps/packages/widget/src/components/MessageList.tsx#L271), chips are only displayed when the message list is empty. No follow-up chips are generated after assistant answers.
- **Page Awareness:**  
  **Zero page awareness.** The chips do not change when navigating between `/admin`, `/admin/students`, `/m/dept-fiqh`, `/app`, or `/admin/audit`.
- **Role Awareness:**  
  **Zero role filtering.** A student signed into Safwan K.'s portal sees chips asking to *"Open Super Admin demo dashboard"* and *"Add student"*.

---

## 2. Complete Web App Page & Route Inventory

| Page ID | Route Pattern | Title (EN / ML) | Permitted Roles | Key Operations |
| :--- | :--- | :--- | :--- | :--- |
| `login` | `/login` | Sign In / പ്രവേശിക്കുക | All / Public | Workspace selection, demo sign-in |
| `admin.dashboard` | `/admin` | Campus Overview / കാമ്പസ് അവലോകനം | `SUPER_ADMIN` | Sector overview, total collection, audit stream |
| `admin.sectors` | `/admin/sectors` | Sectors Management / സെക്ടറുകൾ | `SUPER_ADMIN` | Add sector, assign manager, edit budget target |
| `admin.admins` | `/admin/admins` | Sector Managers / മാനേജർമാർ | `SUPER_ADMIN` | Invite manager, assign sectors, revoke access |
| `admin.students` | `/admin/students` | Students Directory / വിദ്യാർത്ഥി ഡയറക്ടറി | `SUPER_ADMIN` | Search all students, view dues, filter by class |
| `admin.students.import` | `/admin/students/import` | Excel Student Import / എക്സൽ ഇംപോർട്ട് | `SUPER_ADMIN` | Upload student xlsx/csv, preview rows, import |
| `admin.audit` | `/admin/audit` | Audit Trail / ഓഡിറ്റ് ലോഗ് | `SUPER_ADMIN` | View append-only logs, filter by user/action |
| `admin.institution` | `/admin/institution` | Institution Settings / സ്ഥാപന ക്രമീകരണങ്ങൾ | `SUPER_ADMIN` | Signatories, logo, receipt numbering, rules |
| `admin.issued-reports`| `/admin/issued-reports`| Issued Reports / നൽകിയ റിപ്പോർട്ടുകൾ | `SUPER_ADMIN` | Review tamper-evident verified PDF reports |
| `manager.dashboard` | `/m/:sectorSlug` | Sector Ledger / സെക്ടർ ലെഡ്ജർ | `SECTOR_MANAGER`, `SUPER_ADMIN` | Sector credit/debit summary, recent entries |
| `manager.ledger` | `/m/:sectorSlug/ledger` | Ledger Entries / എൻട്രികൾ | `SECTOR_MANAGER`, `SUPER_ADMIN` | Post fee/grant, void entry with reason, print |
| `manager.batches` | `/m/:sectorSlug/batches` | Bulk Batches / ബാച്ച് എൻട്രികൾ | `SECTOR_MANAGER`, `SUPER_ADMIN` | View bulk posted fees, void batch |
| `manager.bulk` | `/m/:sectorSlug/bulk` | Post Bulk Entry / ബൾക്ക് എൻട്രി | `SECTOR_MANAGER`, `SUPER_ADMIN` | Charge batch to class or student list |
| `manager.reports` | `/m/:sectorSlug/reports` | Sector Reports / റിപ്പോർട്ടുകൾ | `SECTOR_MANAGER`, `SUPER_ADMIN` | Class-wise statement, export Excel/PDF |
| `student.dashboard` | `/app` | My Finances / എന്റെ അക്കൗണ്ട് | `STUDENT` | Outstanding dues, personal balance, quick pay |
| `student.sector` | `/app/s/:sectorSlug`| Sector Dues / സെക്ടർ കുടിശ്ശിക | `STUDENT` | Breakdown of fees for assigned sector |
| `student.notifications`| `/app/notifications`| Notifications / അറിയിപ്പുകൾ | `STUDENT` | Payment receipts, notice board |
| `student.profile` | `/app/profile` | Student Profile / പ്രൊഫൈൽ | `STUDENT` | Phone number update, class info, admission no |

---

## 3. Required Architecture for Role- & Page-Aware Chips

1. **Page Registry (`packages/server/src/chips/pageRegistry.ts`)**:
   - Single source of truth mapping `pageId` to route patterns, authorized roles, and static `ChipDef` records with English and Malayalam translations.
2. **Dedicated Server Endpoint (`GET /api/assistant/chips`)**:
   - Authenticated with `AccessScope`.
   - Validates `pageId` against role scope.
   - Evaluates dynamic condition rules within an 80ms budget.
   - Ranks top 4–6 chips based on priority, frequency, and recency.
3. **Follow-up Chips**:
   - Dispatches contextual 2–3 follow-up chips after each completed answer via SSE `followup_chips` or response metadata.
4. **Widget Hook & Instant Cache**:
   - In `AssistantWidget`, wire `getPageId={() => router.state.location.pathname}`.
   - Instant in-memory cache per `(pageId, lang)` to render chips in `<10ms`.
