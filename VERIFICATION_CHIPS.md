# Prompt Chips Verification Report (Add-on Prompt Section 11)

**Date:** 2026-11-14
**Test Suite:** `tests/promptChips.test.ts` (9 tests passed)
**SLA Status:** Passed (All dynamic rankings evaluate under 80ms; cache hits under 10ms)

---

## 1. Test Verification Matrix (Tests 1–9)

| Test # | Description | Assertions & Verified Output | Status |
| :---: | :--- | :--- | :---: |
| **1** | Student Dashboard Chips | When student context has dues > 0, dynamically generates `"Pay Due (₹15000)"` chip with prompt `"Why do I have pending dues of ₹15000...?"` | PASS |
| **2** | Admin Sectors Page Chips | When `unassignedSectorsCount > 0`, dynamically includes `"2 Sectors Without Manager"` chip (`admin.dashboard.unassigned-sectors`) | PASS |
| **3** | Student on Admin Page | Student scope requesting chips for `/admin/sectors` is strictly sanitized: returns ZERO `admin.*` chips, never leaks campus overview | PASS |
| **4** | Dynamic Chip Ranking Budget | Full evaluation of dynamic rules across all registered chips executes in < 80ms (typical ~2ms in memory) | PASS |
| **5** | Personalization Ranking & Fatigue Penalty | 5 clicks on a lower-priority chip boosts its score by +10 (ranking #1); 5 impressions without clicks penalizes by -3 | PASS |
| **6** | Bilingual Language Support | Querying `lang=ml` returns Malayalam labels (`ക്യാമ്പസ് അവലോകനം`, `സ്റ്റേറ്റ്‌മെന്റ് ഡൗൺലോഡ്`) and Malayalam prompt strings | PASS |
| **7** | Follow-Up Chips | Returns top 3 contextually relevant chips to render directly beneath assistant messages | PASS |
| **8** | Click Logging (`assistant_chip_usage`) | `POST /api/assistant/chips/click` updates clickCount, shownCount, and lastClickedAt in database / repository | PASS |
| **9** | Cross-User Personalization Isolation | User A's frequent clicks on a chip boost ranking only for User A; User B's chip ranking remains unpolluted | PASS |

---

## 2. API Endpoints

### 1. Fetch Chips
- **Endpoint:** `GET /api/assistant/chips`
- **Query Parameters:**
  - `appId`: Application ID (e.g., `khazna-ledger`)
  - `pageId`: Canonical page ID (e.g., `admin.dashboard`, `student.dashboard`, `manager.entries`)
  - `lang`: Language preference (`en` or `ml`, defaults to `en`)
  - `limit`: Max chips to return (default: 4)
- **Headers:**
  - `Authorization: Bearer <scope_token>` or `x-session-token`

### 2. Record Chip Click
- **Endpoint:** `POST /api/assistant/chips/click`
- **Body:**
  ```json
  {
    "appId": "khazna-ledger",
    "chipId": "admin.dashboard.institution-overview"
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "chipId": "admin.dashboard.institution-overview",
    "clickCount": 1
  }
  ```
