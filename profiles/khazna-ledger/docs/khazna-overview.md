# Khazna Campus Ledger Overview

## What is Khazna?
Khazna is a multi-sector campus cash ledger and finance portal designed for Islahul Uloom Arabic College and other educational institutions. It tracks what every student owes and has paid across college offices, unions, welfare wings, and academic departments.

## Balance Math & Append-Only Ledger Rules
- **Balance Formula**: `Net Balance = Total Credits - Total Debits`, excluding all entries that have been **voided**.
- Positive balance means the student has advance credit on file; negative balance indicates pending dues owed by the student.
- **Append-Only Integrity**: Posted ledger entries are permanent and never silently edited or overwritten in audit history. Mistakes are corrected by **Voiding** the entry with a written reason (`VOID_ENTRY`), which restores the student's balance automatically.

## Creating a New Khazna Campus / College Account
- Users can create a brand-new isolated college workspace from the Login page (**Create Campus Account**) OR directly via the AI Assistant by providing **College Name**, **Full Name** (Super Admin), **Email**, and **Password** (minimum 6 characters).
- Creating a new campus account starts a completely clean workspace with zero demo data and signs in as the Super Admin of that college.

## Three User Roles & Strict Data Isolation
1. **Super Admin (`/admin`)**: Sees and manages ALL sectors, students, bulk imports (`students`, `managers`, `bulk-entries`), managers, signatories, institution profile, audit logs, and issued reports strictly within their own active college workspace.
2. **Sector Manager (`/m/:sectorSlug`)**: Only sees and accesses their own assigned sector (`office`, `ihsan-union`, `velitcham-welfare`, `dept-fiqh`, `dept-civil`). Can view sector KPIs, post individual credits/debits, void entries, run **Bulk Entry** across a class (`/m/:sectorSlug/bulk`), bulk upload ledger CSVs for their own sector, and export sector/class PDF, Excel, or CSV reports. Sector managers never see or access other sectors' data.
3. **Student Portal (`/app`)**: Students only see and access their own balance, own sector breakdown, own transactions, own PDF/CSV statement, notifications, and profile. Students cannot view other students' records, campus totals, or admin/manager tools.
