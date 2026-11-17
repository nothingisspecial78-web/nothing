# Importing Students from Excel or CSV

## Overview
You can bulk-import student records, sector assignments, union memberships, and funding selections from `.xlsx`, `.xls`, or `.csv` spreadsheets. The maximum file size limit for Excel and CSV uploads is **5 MB**, with a maximum row limit of **5,000 rows** per upload.

## Step-by-Step Import Workflow
1. Open the **Import** tab in the College Finance workspace (or drag-and-drop a spreadsheet directly into the AI Assistant panel).
2. Download the official template via **Download Excel Template** (`students-template.xlsx`) to guarantee exact column headers.
3. Upload your filled spreadsheet. The system automatically parses headers (tolerating case and spacing variations like `Admission No` or `admission_no`) and suggests mappings when headers differ.
4. Review the **Import Preview** table:
   - **Valid Rows** are ready to be committed.
   - **Invalid Rows** display exact row numbers and validation reasons (for example, invalid email format or negative fee amount).
   - You can download an **Error Report CSV** to fix problematic rows offline.
5. Click **Confirm** to execute the import. Records are submitted in batches of 50 to the College Finance `/students/import` endpoint using your authenticated session.
6. If needed, click **Undo Import** right after confirmation to roll back all records created during that import batch.

## Required Template Columns
- `Admission No` (3-24 alphanumeric characters, e.g., `CF-2026-101`)
- `Full Name` (2-100 characters)
- `Email` (valid email address)
- `Sector Code` (e.g., `ENG`, `SCI`, `COM`, `ART`)
- `Union Name` (e.g., `Tech Union`, `Arts Guild`)
- `Funding Option` (`Student Fees`, `Charity`, `Government Grant`, or `Endowment`)
- `Fee Amount` (numeric value between `0` and `500000`)
