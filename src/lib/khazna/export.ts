import { downloadCSV } from "./download";

export interface ReportExportRow {
  studentId: string;
  studentName: string;
  className: string;
  credit: number;
  debit: number;
  balance: number;
}

export interface TabularReportInput {
  filename: string;
  collegeName: string;
  sectorName: string;
  className: string;
  dateRangeStr: string;
  rows: ReportExportRow[];
  totals: { credit: number; debit: number; balance: number };
  contentFilter?: "all" | "credit" | "debit" | undefined;
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadCSVReport(input: TabularReportInput): void {
  const includeCredit = input.contentFilter !== "debit";
  const includeDebit = input.contentFilter !== "credit";
  const headers = ["Ad.No", "Student Name", "Class"];
  if (includeCredit) headers.push("Credits (INR)");
  if (includeDebit) headers.push("Debits (INR)");
  headers.push("Net Balance (INR)");

  const rows: Array<Array<string | number>> = [
    [`${input.collegeName} — ${input.sectorName}`],
    [`Class: ${input.className}`, `Period: ${input.dateRangeStr}`],
    [],
    headers,
    ...input.rows.map((r) => {
      const cols: Array<string | number> = [r.studentId, r.studentName, r.className];
      if (includeCredit) cols.push(r.credit);
      if (includeDebit) cols.push(r.debit);
      cols.push(r.balance);
      return cols;
    }),
    [],
    [
      "TOTAL",
      "",
      "",
      ...(includeCredit ? [input.totals.credit] : []),
      ...(includeDebit ? [input.totals.debit] : []),
      input.totals.balance,
    ],
  ];

  downloadCSV(input.filename, rows);
}

export async function downloadExcelReport(input: TabularReportInput): Promise<void> {
  const XLSX = await import("xlsx");
  const includeCredit = input.contentFilter !== "debit";
  const includeDebit = input.contentFilter !== "credit";

  const sheetData = input.rows.map((r) => {
    const row: Record<string, string | number> = {
      "Ad.No": r.studentId,
      "Student Name": r.studentName,
      Class: r.className,
    };
    if (includeCredit) row["Credits (INR)"] = r.credit;
    if (includeDebit) row["Debits (INR)"] = r.debit;
    row["Net Balance (INR)"] = r.balance;
    return row;
  });

  const summaryRow: Record<string, string | number> = {
    "Ad.No": "TOTAL",
    "Student Name": `${input.rows.length} students`,
    Class: input.className,
  };
  if (includeCredit) summaryRow["Credits (INR)"] = input.totals.credit;
  if (includeDebit) summaryRow["Debits (INR)"] = input.totals.debit;
  summaryRow["Net Balance (INR)"] = input.totals.balance;
  sheetData.push(summaryRow);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, "Class Report");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerBrowserDownload(blob, input.filename);
}
