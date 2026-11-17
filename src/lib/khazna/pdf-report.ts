import { formatDate, formatINR, TODAY } from "./format";
import type {
  InstitutionProfile,
  ReportExport,
  Signatory,
  SignatureSlotConfig,
  Student,
  Tx,
} from "./types";

function fmtPdfInr(n: number): string {
  const rounded = Math.round(Number(n) || 0);
  const abs = Math.abs(rounded).toLocaleString("en-IN");
  return rounded < 0 ? `-Rs. ${abs}` : `Rs. ${abs}`;
}

export async function generateStudentStatementPdf(opts: {
  collegeName: string;
  student: Student;
  transactions: Tx[];
  sectorMap?: Map<string, string> | undefined;
  generatedBy?: string | undefined;
  institutionProfile?: InstitutionProfile | undefined;
}): Promise<string> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const instName = opts.institutionProfile?.name || opts.collegeName || "Islahul Uloom";
  doc.setFillColor(249, 115, 22);
  doc.rect(0, 0, 210, 4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(instName, 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    opts.institutionProfile?.tagline || "Official Student Ledger Statement",
    14,
    22
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`Student Statement: ${opts.student.name} (${opts.student.id})`, 14, 32);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Class: ${opts.student.className} · Guardian: ${opts.student.guardian || "—"} · Generated: ${formatDate(TODAY)}`,
    14,
    38
  );

  const activeTxs = opts.transactions.filter((t) => !t.voided);
  let credit = 0;
  let debit = 0;
  for (const t of activeTxs) {
    if (t.type === "credit") credit += t.amount;
    else debit += t.amount;
  }

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, 43, 182, 16, 2, 2, "F");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Total Credit: ${fmtPdfInr(credit)}`, 18, 53);
  doc.text(`Total Debit: ${fmtPdfInr(debit)}`, 82, 53);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(`Net Balance: ${fmtPdfInr(credit - debit)}`, 144, 53);

  autoTable(doc, {
    startY: 64,
    head: [["Date", "Receipt", "Sector", "Description", "Type", "Amount"]],
    body: activeTxs.map((t) => [
      formatDate(t.date),
      t.receiptNo,
      opts.sectorMap?.get(t.sector) || t.sector,
      t.title,
      t.type.toUpperCase(),
      fmtPdfInr(t.amount),
    ]),
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  const filename = `Statement_${opts.student.id}_${opts.student.name.replace(/\s+/g, "_")}.pdf`;
  doc.save(filename);
  return filename;
}

export interface ClassReportPdfItem {
  studentId: string;
  studentName: string;
  className: string;
  credit: number;
  debit: number;
  balance: number;
}

export async function generateClassWisePdf(opts: {
  collegeName: string;
  sectorName: string;
  sectorId?: string | undefined;
  className: string;
  from: string;
  to: string;
  contentFilter?: "all" | "credit" | "debit" | undefined;
  sortBy?: "adm_asc" | "adm_desc" | "name_asc" | "name_desc" | "bal_desc" | "bal_asc" | undefined;
  showSummaryCards?: boolean | undefined;
  showNetBalance?: boolean | undefined;
  showSignatureLines?: boolean | undefined;
  showPageNumbers?: boolean | undefined;
  orientation?: "portrait" | "landscape" | undefined;
  generatedBy?: string | undefined;
  institutionProfile?: InstitutionProfile | undefined;
  signatories?: Signatory[] | undefined;
  signatureSlots?: SignatureSlotConfig | undefined;
  qrVerification?: boolean | undefined;
  existingReports?: ReportExport[] | undefined;
  onExportRecorded?: ((exp: ReportExport) => void) | undefined;
  items: ClassReportPdfItem[];
}): Promise<string> {
  const [{ jsPDF }, autoTableMod, QRCode] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("qrcode"),
  ]);
  const autoTable = autoTableMod.default;
  const orientation = opts.orientation || "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageWidth = orientation === "landscape" ? 297 : 210;

  const sorted = [...opts.items];
  const sortBy = opts.sortBy || "adm_asc";
  sorted.sort((a, b) => {
    if (sortBy === "adm_desc") return b.studentId.localeCompare(a.studentId);
    if (sortBy === "name_asc") return a.studentName.localeCompare(b.studentName);
    if (sortBy === "name_desc") return b.studentName.localeCompare(a.studentName);
    if (sortBy === "bal_desc") return b.balance - a.balance;
    if (sortBy === "bal_asc") return a.balance - b.balance;
    return a.studentId.localeCompare(b.studentId);
  });

  const totalCredit = sorted.reduce((acc, r) => acc + r.credit, 0);
  const totalDebit = sorted.reduce((acc, r) => acc + r.debit, 0);
  const netBalance = totalCredit - totalDebit;

  const ref = `KZ-RPT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const token = `${ref}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  doc.setFillColor(249, 115, 22);
  doc.rect(0, 0, pageWidth, 4, "F");

  const instName = opts.institutionProfile?.name || opts.collegeName || "Islahul Uloom";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(instName, 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${opts.sectorName} · Class: ${opts.className} · Period: ${formatDate(opts.from)} to ${formatDate(opts.to)}`,
    14,
    22
  );
  doc.text(`Ref: ${ref} · Issued by ${opts.generatedBy || "Khazna"} on ${formatDate(TODAY)}`, 14, 27);

  if (opts.qrVerification !== false && typeof window !== "undefined") {
    try {
      const verifyUrl = `${window.location.origin}/v/${token}`;
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 96, margin: 1 });
      doc.addImage(qrDataUrl, "PNG", pageWidth - 34, 8, 20, 20);
    } catch {
      // ignore QR draw failure in constrained environments
    }
  }

  let startY = 35;
  if (opts.showSummaryCards !== false) {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, startY, pageWidth - 28, 14, 2, 2, "F");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Students: ${sorted.length}`, 18, startY + 9);
    doc.text(`Total Credit: ${fmtPdfInr(totalCredit)}`, 55, startY + 9);
    doc.text(`Total Debit: ${fmtPdfInr(totalDebit)}`, 110, startY + 9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(`Net: ${fmtPdfInr(netBalance)}`, pageWidth - 52, startY + 9);
    startY += 19;
  }

  const includeCredit = opts.contentFilter !== "debit";
  const includeDebit = opts.contentFilter !== "credit";
  const includeBal = opts.showNetBalance !== false;

  const headRow = ["Ad.No", "Student Name", "Class"];
  if (includeCredit) headRow.push("Credit");
  if (includeDebit) headRow.push("Debit");
  if (includeBal) headRow.push("Balance");

  const bodyRows = sorted.map((r) => {
    const cols = [r.studentId, r.studentName, r.className];
    if (includeCredit) cols.push(fmtPdfInr(r.credit));
    if (includeDebit) cols.push(fmtPdfInr(r.debit));
    if (includeBal) cols.push(fmtPdfInr(r.balance));
    return cols;
  });

  autoTable(doc, {
    startY,
    head: [headRow],
    body: bodyRows,
    styles: { fontSize: 8.5, cellPadding: 2.3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  const cleanSector = opts.sectorName.replace(/\s+/g, "");
  const cleanClass = opts.className.replace(/\s+/g, "");
  const filename = `Khazna_${cleanSector}_${cleanClass}_${opts.from}_${opts.to}.pdf`;

  if (opts.onExportRecorded) {
    const pdfBase64 = doc.output("datauristring");
    const expiry = opts.institutionProfile?.verify_expiry;
    const expiresAt =
      expiry === "90d"
        ? new Date(Date.now() + 90 * 86_400_000).toISOString()
        : expiry === "1y"
          ? new Date(Date.now() + 365 * 86_400_000).toISOString()
          : undefined;
    opts.onExportRecorded({
      id: `REP_${Date.now().toString(36).toUpperCase()}`,
      ref,
      token,
      org_id: "demo",
      sector_id: opts.sectorId || cleanSector.toLowerCase(),
      sector_name: opts.sectorName,
      class_name: opts.className,
      mode: "class_report",
      date_from: opts.from,
      date_to: opts.to,
      row_count: sorted.length,
      total_credit: totalCredit,
      total_debit: totalDebit,
      net_balance: netBalance,
      issued_at: new Date().toISOString(),
      issued_by: opts.generatedBy || "Admin",
      expires_at: expiresAt,
      pdf_base64: pdfBase64,
    });
  }

  doc.save(filename);
  return filename;
}

export { formatINR };
