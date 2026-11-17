# AI Assistant Complete Feature Inventory & Test Plan

**Document:** `ASSISTANT_FEATURE_INVENTORY.md`  
**Generated:** November 15, 2026  
**Status:** Complete (Every feature discovered from code, schemas, routes, tools, and UI)

---

## 1. Feature Catalog

### Category 1: Embeddable Widget & Interaction Shell
| ID | Feature Name | Description | Roles | Entry Point | Expected Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **WIDGET-01** | Floating Mascot Launcher | Interactive 3D avatar button docked at bottom-right | All (Public, Student, Manager, Admin, Super Admin) | Global (all pages except `/v/*`) | Renders animated 3D mascot; clicks open assistant drawer/sheet. |
| **WIDGET-02** | Right-Click "Ask AI" Context Menu | Context menu on right-click anywhere on the host page | All Roles | Any page element | Captures clicked text, DOM tag, selector, nearby label, route, and appends context badge to assistant composer. |
| **WIDGET-03** | Visual Cursor Inspector | Element inspection mode ("Crosshair" icon in header/plus menu) | All Roles | Assistant Composer (`[data-testid="plus-cursor-inspect"]`) | Activates purple hover bounding box; clicking element attaches DOM snapshot context to chat. |
| **WIDGET-04** | Streaming Chat & Markdown | Real-time SSE token streaming with formatted Markdown, tables, chips | All Roles | Assistant Panel (`[data-testid="assistant-messages"]`) | Streams tokens smoothly without layout shifts; renders Markdown tables, bold text, links, and code blocks. |
| **WIDGET-05** | Adaptive Mobile Bottom Sheet | Responsive bottom sheet with drag handle on mobile viewports (<=640px) | All Roles | Mobile screens | Converts side drawer to draggable bottom sheet with compact/full toggle. |
| **WIDGET-06** | Conversation History Drawer | Multi-conversation list with title, preview, delete, switch | All Roles | Panel Header (`[data-testid="history-btn"]`) | Loads historical sessions; switching loads conversation messages without cross-user leakage. |
| **WIDGET-07** | Personalization & Language Modal | Settings for assistant persona tone and primary language (EN / ML) | All Roles | Panel Header (`[data-testid="personalize-btn"]`) | Toggles English / Malayalam; updates prompt guidelines; persists in client storage. |
| **WIDGET-08** | Memory Management ("Clear Memory") | Command / button to wipe personalization and session memory | All Roles | Composer / Personalization | Wipes stored assistant preferences and conversation history upon user request. |

---

### Category 2: Role-Based Scoping & Multi-Tenant Access
| ID | Feature Name | Description | Roles | Enforced Layer | Expected Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SCOPE-01** | Platform Super Admin Access | Platform-wide stats, all organizations, cross-tenant audit log | Super Admin | Backend `AccessScope` | Returns cross-tenant college summaries; strictly blocks lower roles from accessing `/super-admin` tools. |
| **SCOPE-02** | Admin Organization Isolation | College owner access across all sectors, classes, students of own org | Admin | Backend `ScopedDataRepository` | Returns all data within the admin's organization; strictly blocks access to records of other organizations. |
| **SCOPE-03** | Sector Manager Scoped Ledger | Sector manager access restricted strictly to assigned sector(s) | Sector Manager | Backend `ScopedDataRepository` | Queries for other sectors or unassigned students are refused: *"I can't access that with your account."* |
| **SCOPE-04** | Student Personal Record Isolation | Student access restricted strictly to own admission number/fees | Student | Backend `ScopedDataRepository` | Queries for other students' fees or administrative data are refused: *"I can't access that with your account."* |
| **SCOPE-05** | Public / Pre-Login Mode | Public help for college registration and portal login | Public (Unauthenticated) | Public endpoints / routes | Provides guidance for login and college signup; refuses data retrieval. |

---

### Category 3: Data Access & Semantic Resolution (A to Z)
| ID | Feature Name | Description | Tool Name | Scope Check |
| :--- | :--- | :--- | :--- | :--- |
| **DATA-01** | Student Search by Name | Search student by full or partial name with fuzzy tolerance | `find_students` | Scoped to Org/Sector/Student |
| **DATA-02** | Student Lookup by Ad.No / Roll | Direct lookup by admission number (e.g. `S0125`, `CF-2026-001`) | `find_students`, `get_student` | Scoped |
| **DATA-03** | Duplicate Name Disambiguation | Returns numbered choose-one list when multiple matches exist | `find_students` | Scoped |
| **DATA-04** | Conversation Focus & Follow-Up | Maintains entity context across questions ("his fees", "her dues") | `get_student_finances` | Focus store scoped by Org |
| **DATA-05** | Student Financial Summary | Total credits, debits, pending balance, last payment, receipt | `summarize_student_finance` | Scoped |
| **DATA-06** | Class Financial Report | Class breakdown, student count, total collections, net dues | `report_class` | Scoped |
| **DATA-07** | Defaulters / Overdue Report | List of students with unpaid dues filtered by sector and class | `report_defaulters` | Scoped |
| **DATA-08** | Sector Financial Summary | Collection targets, credit/debit balances, sector managers | `summarize_sector_finance` | Scoped |
| **DATA-09** | Fund Utilization & Status | Endowment, charity, government grant pools, allocation & spend | `report_fund_utilization` | Scoped |
| **DATA-10** | Receipt Verification by Number | Lookup transaction by receipt number (e.g. `DF-201`, `OF-1048`) | `get_receipt` | Scoped |
| **DATA-11** | Period Comparisons | Comparison of collections between months or quarters | `compare_periods` | Scoped |
| **DATA-12** | Out-of-Scope App Knowledge RAG | Polite refusal for off-topic queries (e.g. general trivia/news) | Intent Parser / RAG Gate | Evaluated before tool execution |

---

### Category 4: Role-Aware & Page-Aware Suggested Prompt Chips
| ID | Feature Name | Description | Roles | Verification |
| :--- | :--- | :--- | :--- | :--- |
| **CHIP-01** | Student Dashboard Chips | Suggested prompts for student dues, fee receipt, statements | Student | Verified on `/app` |
| **CHIP-02** | Manager Ledger Chips | Suggested prompts for pending dues, recent receipts, batch fee | Sector Manager | Verified on `/m/$sectorSlug/ledger` |
| **CHIP-03** | Admin Student Directory Chips | Suggested prompts for adding student, unassigned sectors, export | Admin | Verified on `/admin/students` |
| **CHIP-04** | Admin Bulk Import Chips | Suggested prompts for downloading template, importing spreadsheets | Admin | Verified on `/admin/students/import` |
| **CHIP-05** | Dynamic Conditional Chips | Chips that appear only when specific data conditions are met | All Roles | Scoped condition evaluation |
| **CHIP-06** | Multilingual Malayalam Chips | Chips localized to Malayalam when Malayalam language is active | All Roles | Localized strings in catalog |
| **CHIP-07** | Post-Answer Follow-Up Chips | Contextual suggestion chips rendered at the end of answers | All Roles | Dynamic response chips |

---

### Category 5: Guide Skill & 3D Avatar Kinematics
| ID | Feature Name | Description | Target Flow | Kinematics & Voice |
| :--- | :--- | :--- | :--- | :--- |
| **GUIDE-01** | Public Login Guide | Step-by-step walkthrough to choose role, enter email, password | `/login` | Points at inputs, closes eyes on password |
| **GUIDE-02** | Public Registration Guide | Walkthrough to register new college and administrator profile | `/login` (Signup tab) | Moves across college name, email, submit |
| **GUIDE-03** | Admin Student Import Guide | Walkthrough to download template, upload spreadsheet, confirm | `/admin/students/import` | Spotlight, step advance on file drop |
| **GUIDE-04** | Admin Add Student Guide | Walkthrough to open modal, fill student details, and save | `/admin/students` | Advances on form field entry |
| **GUIDE-05** | Manager Ledger Entry Guide | Walkthrough to create debit/credit entry in sector ledger | `/m/$sectorSlug/ledger` | Points at "+ New entry", advances on submit |
| **GUIDE-06** | Student View Fees Guide | Walkthrough explaining fee breakdown and balance cards | `/app` | Highlights dues card, speaks balance |
| **GUIDE-07** | 3D Mascot Studio Lighting | Three.js 3-point warm lighting (hemisphere, key light, amber rim) | Global | 100% active, ACESFilmic tone mapping |
| **GUIDE-08** | Pointer & Gaze Kinematics | Head and eye gaze smoothly track user pointer position | Global | Smooth lerp interpolation |
| **GUIDE-09** | Privacy Gesture (Eyes Closed) | Mascot closes eyes and turns head away when typing password | `/login`, sensitive forms | Verified in DOM and 3D mesh scales |
| **GUIDE-10** | Spoken Voice Instructions | Web SpeechSynthesis English / Malayalam voice guidance | All Guides | Rate 1.0, pitch 1.05, mute toggle |

---

### Category 6: Agent Actions, File Uploads & Spreadsheets
| ID | Feature Name | Description | Write Risk | Audit & Undo |
| :--- | :--- | :--- | :--- | :--- |
| **ACT-01** | Student Create / Edit / Delete | Agent tool to add, update, or remove student records | Write | Requires explicit confirmation; audit logged |
| **ACT-02** | Ledger Entry Create / Void | Agent tool to record debit/credit entry or void entry | Write | Requires confirmation; supports undo |
| **ACT-03** | Batch Fee Posting | Agent tool to post fees across an entire class | Write | Requires confirmation; shows affected count |
| **ACT-04** | Spreadsheet Excel/CSV Import | Parses xlsx/csv, validates format, previews errors | Write | Two-stage preview -> confirm flow; undoable |
| **ACT-05** | Screenshot Image Analysis | Uploads screenshot of screen/error; LLM analyzes via vision | Read | Attached to prompt with system docs RAG |
| **ACT-06** | PDF Document Generation | Generates student fee statement PDF, class report PDF | Read | Client & server jsPDF generation |

---

### Category 7: Provider Fallback Chain & Resilience
| ID | Feature Name | Description | Execution Order | Failure Handling |
| :--- | :--- | :--- | :--- | :--- |
| **RESIL-01** | Strict Sequential Fallback | Primary: OpenRouter -> Secondary: Gemini -> Tertiary: Groq | Sequential only | Moves to next only on failure |
| **RESIL-02** | Circuit Breaker | Trips provider to OPEN after 3 consecutive failures | 60s cooldown | Bypasses failing provider while OPEN |
| **RESIL-03** | Mid-Stream Error Recovery | Detects mid-stream network/provider drops | Stream recovery | Sends reset signal and retries cleanly |

---

## 2. Requirements Cross-Check (Section 2A)

| # | Requirement | Status in Codebase | Test Suite |
| :--- | :--- | :--- | :--- |
| 1 | Embeddable widget, floating button, right-click "Ask AI", side panel, streaming | **FOUND & ACTIVE** | Suite D, WIDGET |
| 2 | App-only knowledge (RAG), polite refusal of general queries | **FOUND & ACTIVE** | Suite A, DATA-12 |
| 3 | Full data access (A to Z) for students, classes, sectors, funds, defaulters, exports | **FOUND & ACTIVE** | Suite A, DATA-01 to 11 |
| 4 | Strict roles & scoping (Super Admin, Admin, Sector Manager, Student) | **FOUND & ACTIVE** | Suite A, SCOPE-01 to 05 |
| 5 | Per-user history, personalization, clear-memory, language setting | **FOUND & ACTIVE** | Suite D, WIDGET-06 to 08 |
| 6 | Suggested prompt chips appropriate to role & page, dynamic chips, follow-ups | **FOUND & ACTIVE** | Suite B, CHIP-01 to 07 |
| 7 | Guide skill, 3D avatar movement/pointing/voice, eye-closing on passwords | **FOUND & ACTIVE** | Suite C, GUIDE-01 to 10 |
| 8 | Agent actions with confirmation, undo, audit log, spreadsheet import, screenshot vision | **FOUND & ACTIVE** | Suite E, ACT-01 to 06 |
| 9 | Strict sequential LLM fallback (OpenRouter -> Gemini -> Groq), circuit breaker | **FOUND & ACTIVE** | Suite F, RESIL-01 to 03 |
| 10 | Speed, streaming, bundle splitting, no lag, zero errors | **FOUND & ACTIVE** | Suite G, PERF |
| 11 | Multi-organization platform, Super Admin isolation, Admin org isolation | **FOUND & ACTIVE** | Suite A, H, SCOPE |
| 12 | 3D avatar and animations always present, continuous, never reduced | **FOUND & ACTIVE** | Suite C, G |
