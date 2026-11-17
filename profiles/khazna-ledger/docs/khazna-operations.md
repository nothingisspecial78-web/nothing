# Khazna Sectors, Ledger Entries, Bulk Batches & Reports

## Default College Sectors
1. **Office (`office`, prefix `OF-`)**: Central college office — tuition, admission, exam fees, library fines, and ID card fees.
2. **Ihsan Union (`ihsan-union`, prefix `IU-`)**: Students' union — arts fest contribution, union membership, magazine fund, and sports meet fees.
3. **Velitcham Welfare (`velitcham-welfare`, prefix `VW-`)**: Welfare wing — hostel mess bills, welfare fund, medical aid recovery, and relief contributions.
4. **Dept Fiqh (`dept-fiqh`, prefix `DF-`)**: Department of Fiqh — study tour fees, kitab purchases, seminar fees, and study material.
5. **Dept Civil (`dept-civil`, prefix `DC-`)**: Department of Civil — lab fees, field visits, drawing kits, and workshop fees.

## Posting, Collecting Dues & Voiding Transactions
- A **Credit** entry records money paid/deposited by a student (e.g., `Cash Deposit`, `Fee Payment`, `Advance Deposit`, `Scholarship Credit`).
- A **Debit** entry records a fee or charge billed to a student (e.g., `Tuition Fee – Term 2`, `Hostel Mess Bill`, `Study Tour Fee`, `Exam Fee`).
- **Collect / Settle Pending Dues**: When a student has negative dues in a sector (e.g., in Dept Fiqh or Office), Super Admin or that sector's Manager can ask the AI Assistant to `collect dues for <Student Name> in <Sector>` or `mark <Student Name> paid` to post the exact Cash Deposit settlement.
- **Individual Student Account Status**: Super Admin can ask for any student's account status or balance in any sector (`give me the current account status of Siraj Usman in department fiqh`). Sector Managers can query students strictly within their assigned sector. Students can only inspect their own account and transactions.
- To void an entry, select the transaction and provide a clear **void reason**. Voided entries stay visible in the audit log and dimmed in the ledger while being excluded from balance math.

## Bulk Student Import, Bulk Entry & CSV Verification
- **Bulk Student Import (`/admin/students/import`)**: Accepts `.xlsx`, `.xls`, or `.csv` spreadsheets with columns `Ad.No` (`id`), `Full Name` (`name`), `Class` (`className`), `Phone` (`phone`), and `Guardian` (`guardian`). You can also drop a spreadsheet or pick a CSV Target Area (`Students Directory`, `Sector Managers`, `Bulk Ledger Entries`) from the AI Assistant `+` menu. Both schema columns, duplicate row IDs/emails/receipt numbers, and active role permissions are verified before import is enabled.
- **Bulk Entry (`/m/:sectorSlug/bulk`)**: Charges or credits an entire class or selected group of students in one batch (for example, `Study Tour Fee` for `Fiqh 2`).

## Verified PDF Reports, Workspaces & Multi-Card Inspection
- Class and sector reports exported via the PDF modal register a verifiable QR token stored in **Issued Reports** (`/admin/issued-reports`). Anyone scanning the QR code opens `/v/:token` to confirm report authenticity, institution details, and totals unless revoked by an admin.
- Super Admin can create college workspaces (`SIGNUP_COLLEGE`), switch between workspaces (`SWITCH_ORG`), delete workspaces, or reload the demo workspace (`Islahul Uloom (Demo)`).
- All appearance settings (Light Appearance / Dark Appearance) and workspace switching live in the top-right **Menu** (`AestheticMenu`) drawer or via AI Assistant commands.
- Use the **Cursor Inspector** (`+ -> Select cuboid with cursor` or `Inspect`) to attach one or multiple parent cards/cuboids as an Accessory View above the chat composer before asking questions.

## Signing Out & Opening Demo Mode
- **Signing Out**: Any signed-in user (Admin, Sector Manager, Student, or Super Admin) can ask the AI Assistant to `log out`, `sign out`, or `log out this session`, or click **Sign out** in the top navigation bar (inside the profile menu for Admins/Managers or the top-right logout button for Students) to return to `/login`.
- **Opening Demo Mode**: From `/login` (or by asking `open demo mode` / `try demo`), choose **Admin**, **Sector Manager**, or **Student** under **Try the demo** to load sample Khazna campus data immediately.

## മലയാളം സഹായം (Malayalam Guide)
- ഖസ്ന (Khazna) കോളേജ് ഫിനാൻസ് പോർട്ടലിൽ വിദ്യാർത്ഥികളുടെ ഫീസ്, ഡെപ്പോസിറ്റ് (Credit), ചാർജുകൾ (Debit), ബാക്കി തുക (Balance) എന്നിവ സെക്ടർ അടിസ്ഥാനത്തിൽ കാണാം.
- തെറ്റായി ചേർത്ത എൻട്രികൾ ഡിലീറ്റ് ചെയ്യാതെ **Void** (കാരണം രേഖപ്പെടുത്തി റദ്ദാക്കൽ) ചെയ്യുകയാണ് ചെയ്യുന്നത്.
- പുതിയ വിദ്യാർത്ഥികളെ ചേർക്കാനും, എക്സൽ/CSV ഫയൽ വഴി ബൾക്ക് ഇംപോർട്ട് ചെയ്യാനും, റസീപ്റ്റുകൾ പോസ്റ്റ് ചെയ്യാനും, സ്റ്റുഡന്റ് ബാലൻസ് പരിശോധിക്കാനും AI അസിസ്റ്റന്റിനോട് നേരിട്ട് ആവശ്യപ്പെടാം.
