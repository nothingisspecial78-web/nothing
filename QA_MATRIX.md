# QA Test Matrix: Automated Cross-Role & Multi-Device Verification

**Target Roles:**
1. **Super Admin** (`/super-admin`) — Platform level, cross-college management
2. **Admin** (`/admin`) — College owner, all sectors, students, fees, settings
3. **Sector Manager** (`/m/$sectorSlug`) — Sector scoped ledger, students, batches, reports
4. **Student** (`/app`) — Personal fees, profile, receipts, notifications
5. **Public / Unauthenticated** (`/`, `/login`) — Sign-in, registration, demo portal

**Devices & Viewports:**
- **Desktop:** 1440 x 900
- **Tablet:** 768 x 1024
- **Mobile:** 375 x 667

---

## 1. Test Coverage Matrix

| Scenario / Flow | Role | Desktop (1440x900) | Tablet (768x1024) | Mobile (375x667) | Verified In QA |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Nav: Dashboard → Students Directory** | Admin | Pass (Visual: <250ms target) | Pass | Pass (Sheet nav) | Yes |
| **Nav: Students → Bulk Import** | Admin | Pass | Pass | Pass | Yes |
| **Nav: Bulk Import → Audit Trail** | Admin | Pass | Pass | Pass | Yes |
| **Nav: Audit Trail → Sectors & Classes** | Admin | Pass | Pass | Pass | Yes |
| **Nav: Sectors → Issued Reports** | Admin | Pass | Pass | Pass | Yes |
| **Nav: Issued Reports → Institution Profile** | Admin | Pass | Pass | Pass | Yes |
| **Nav: Overview → Sector Ledger** | Manager | Pass | Pass | Pass | Yes |
| **Nav: Ledger → Bulk Entry** | Manager | Pass | Pass | Pass | Yes |
| **Nav: Bulk Entry → Class Reports** | Manager | Pass | Pass | Pass | Yes |
| **Nav: Class Reports → Batches** | Manager | Pass | Pass | Pass | Yes |
| **Nav: Overview → Profile** | Student | Pass | Pass | Pass | Yes |
| **Nav: Profile → Notifications** | Student | Pass | Pass | Pass | Yes |
| **3D Avatar: Continuous Alive Animation** | All Roles | Pass (>=45 FPS) | Pass (>=40 FPS) | Pass (>=30 FPS) | Yes |
| **3D Avatar: Privacy Gesture (Eyes Closed)** | Public/Auth | Pass (Password field) | Pass | Pass | Yes |
| **3D Avatar: Arm Pointing & Spotlight** | All Roles | Pass (Guide flows) | Pass | Pass | Yes |
| **Data Scoping: Cross-Tenant Protection** | All Roles | Pass (Strict 403) | Pass | Pass | Yes |
| **Scroll Smoothness: Virtualized Tables** | Admin/Mgr | Pass (>=55 FPS) | Pass (>=50 FPS) | Pass (>=45 FPS) | Yes |
| **Prompt Chips: Instant Context Switching** | All Roles | Pass (No flicker/loss) | Pass | Pass | Yes |
