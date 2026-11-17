import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { KDialog } from "@/components/khazna/overlays";
import { Amount, Field, FilterChip, GlassCard, PageHeader, TableShell } from "@/components/khazna/primitives";
import { addDays, formatDate, TODAY } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/m/$sectorSlug/reports")({
  head: () => ({
    meta: [
      { title: "Class Reports — Khazna" },
      { name: "description", content: "Generate class-wise financial summaries and export verified PDF, Excel, or CSV reports." },
    ],
  }),
  component: SectorReportsPage,
});

function SectorReportsPage() {
  const { sectorSlug } = Route.useParams();
  const sector = useKhazna((s) => s.sectors.find((x) => x.slug === sectorSlug));
  const classes = useKhazna((s) => s.classes);
  const students = useKhazna((s) => s.students);
  const txs = useKhazna((s) => s.transactions);
  const college = useKhazna((s) => s.college);
  const institutionProfile = useKhazna((s) => s.institutionProfile);
  const signatories = useKhazna((s) => s.signatories);
  const signatureSlots = useKhazna((s) => s.signatureSlots);
  const reportExports = useKhazna((s) => s.reportExports);
  const createReportExport = useKhazna((s) => s.createReportExport);

  const [className, setClassName] = useState("All Classes");
  const [from, setFrom] = useState(addDays(TODAY, -120));
  const [to, setTo] = useState(TODAY);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [qrVerification, setQrVerification] = useState(true);
  const [exporting, setExporting] = useState(false);

  const rows = useMemo(() => {
    const scope =
      className === "All Classes" ? students : students.filter((s) => s.className === className);
    return scope.map((stu) => {
      let credit = 0;
      let debit = 0;
      for (const t of txs) {
        if (t.voided || t.sector !== sectorSlug || t.studentId !== stu.id) continue;
        if (t.date < from || t.date > to) continue;
        if (t.type === "credit") credit += t.amount;
        else debit += t.amount;
      }
      return {
        studentId: stu.id,
        studentName: stu.name,
        className: stu.className,
        credit,
        debit,
        balance: credit - debit,
      };
    });
  }, [students, txs, sectorSlug, className, from, to]);

  const totalsSum = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          credit: acc.credit + r.credit,
          debit: acc.debit + r.debit,
          balance: acc.balance + r.balance,
        }),
        { credit: 0, debit: 0, balance: 0 }
      ),
    [rows]
  );

  const handleExportCsvOrXlsx = async (kind: "csv" | "xlsx") => {
    const mod = await import("@/lib/khazna/export");
    const cleanSector = (sector?.name || sectorSlug).replace(/\s+/g, "");
    const cleanCls = className.replace(/\s+/g, "");
    const params = {
      filename: `Khazna_${cleanSector}_${cleanCls}_${from}_${to}.${kind}`,
      collegeName: college.name,
      sectorName: sector?.name || sectorSlug,
      className,
      dateRangeStr: `${formatDate(from)} – ${formatDate(to)}`,
      rows,
      totals: totalsSum,
      contentFilter: "all" as const,
    };
    if (kind === "xlsx") {
      await mod.downloadExcelReport(params);
      toast.success("Downloaded Excel (.xlsx) report");
    } else {
      mod.downloadCSVReport(params);
      toast.success("Downloaded CSV report");
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const { generateClassWisePdf } = await import("@/lib/khazna/pdf-report");
      const filename = await generateClassWisePdf({
        collegeName: college.name,
        sectorName: sector?.name || sectorSlug,
        className,
        from,
        to,
        contentFilter: "all",
        sortBy: "adm_asc",
        showSummaryCards: true,
        showNetBalance: true,
        showSignatureLines: true,
        showPageNumbers: true,
        orientation,
        generatedBy: college.adminName,
        institutionProfile,
        signatories,
        signatureSlots,
        qrVerification,
        existingReports: reportExports,
        onExportRecorded: (exp) => createReportExport(exp),
        items: rows,
      });
      toast.success(`Downloaded PDF report: ${filename}`);
      setPdfOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate PDF report");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={sector?.name ?? sectorSlug}
        title="Class Reports"
        description="Filter student ledgers by class and date range, then export official PDF or spreadsheet statements."
        actions={
          <>
            <Btn variant="glass" data-ai-id="reports-csv-btn" onClick={() => void handleExportCsvOrXlsx("csv")}>
              <Download /> CSV
            </Btn>
            <Btn variant="glass" data-ai-id="reports-xlsx-btn" onClick={() => void handleExportCsvOrXlsx("xlsx")}>
              <FileSpreadsheet /> Excel
            </Btn>
            <Btn variant="primary" data-ai-id="reports-pdf-modal-btn" onClick={() => setPdfOpen(true)}>
              <FileText /> Export PDF
            </Btn>
          </>
        }
      />

      <GlassCard className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {["All Classes", ...classes].map((c) => (
            <FilterChip key={c} active={className === c} onClick={() => setClassName(c)}>
              {c}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Field label="From">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="k-input h-9 text-xs" />
          </Field>
          <Field label="To">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="k-input h-9 text-xs" />
          </Field>
        </div>
      </GlassCard>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="k-table">
            <thead>
              <tr>
                <th>Ad.No</th>
                <th>Student</th>
                <th>Class</th>
                <th className="text-right">Credit</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Net Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId}>
                  <td className="font-mono text-xs text-muted-foreground">{r.studentId}</td>
                  <td className="font-medium text-foreground">{r.studentName}</td>
                  <td>{r.className}</td>
                  <td className="text-right text-credit num"><Amount value={r.credit} /></td>
                  <td className="text-right text-debit num"><Amount value={r.debit} /></td>
                  <td className="text-right font-semibold"><Amount value={r.balance} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-accent/50 font-semibold">
                <td colSpan={3} className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
                  Total ({rows.length} students)
                </td>
                <td className="px-4 py-3 text-right text-credit num"><Amount value={totalsSum.credit} /></td>
                <td className="px-4 py-3 text-right text-debit num"><Amount value={totalsSum.debit} /></td>
                <td className="px-4 py-3 text-right num"><Amount value={totalsSum.balance} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </TableShell>

      <KDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        title="Export Official PDF Report"
        description={`${sector?.name ?? sectorSlug} · ${className}`}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setPdfOpen(false)}>Cancel</Btn>
            <Btn variant="primary" data-ai-id="reports-confirm-pdf-btn" disabled={exporting} onClick={() => void handleExportPdf()}>
              <FileText /> {exporting ? "Generating…" : "Download PDF"}
            </Btn>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Page Orientation">
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as "portrait" | "landscape")}
              className="k-input"
            >
              <option value="portrait">Portrait (A4)</option>
              <option value="landscape">Landscape (A4)</option>
            </select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={qrVerification}
              onChange={(e) => setQrVerification(e.target.checked)}
              className="size-4 accent-primary"
            />
            Embed QR verification seal & register in Issued Reports
          </label>
        </div>
      </KDialog>
    </div>
  );
}
