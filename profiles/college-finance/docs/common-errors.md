# Common Errors and Troubleshooting

## Spreadsheet Import Errors
- **Invalid Funding Option**: The `Funding Option` column only accepts `Student Fees`, `Charity`, `Government Grant`, or `Endowment` (case-sensitive match after trimming). Check for typos like `Self Pay` or `Scholarship`.
- **Invalid Email Format**: Rows with missing `@` or malformed domains fail Zod validation and appear in the **Error Rows** list inside the Import Preview.
- **Duplicate Admission No**: Each `admissionNo` must be unique within the student directory. Importing an existing admission number skips or flags the row as a conflict.
- **Fee Amount Out of Range**: `Fee Amount` must be a non-negative number (`0` to `500000`) without currency symbols like `$` or `₹` in raw numeric cells, though commas are stripped during parsing.

## File Upload Rejections
- Only `.xlsx`, `.xls`, and `.csv` files up to **5 MB** and **5,000 rows** are accepted.
- Screenshots must be `.png`, `.jpg`, or `.webp` under **5 MB**.

## Permission & Session Errors
- If you see **401 Unauthorized** when running an action or confirming an import, refresh your session token and try again. The assistant executes all write actions strictly using your own user permissions.
