import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, FileText, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { SectorTile } from "@/components/khazna/SectorTile";
import { Amount, GlassCard, PageHeader } from "@/components/khazna/primitives";
import { formatDate, formatINR } from "@/lib/khazna/format";
import { totals } from "@/lib/khazna/ledger";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Student Overview — Khazna" },
      { name: "description", content: "Personal fee balance, sector breakdown, and statement download." },
    ],
  }),
  component: StudentOverviewPage,
});

function StudentOverviewPage() {
  const meStudentId = useKhazna((s) => s.meStudentId);
  const students = useKhazna((s) => s.students);
  const sectors = useKhazna((s) => s.sectors);
  const txs = useKhazna((s) => s.transactions);
  const college = useKhazna((s) => s.college);
  const institutionProfile = useKhazna((s) => s.institutionProfile);
  const [downloading, setDownloading] = useState(false);

  const me = useMemo(() => students.find((s) => s.id === meStudentId), [students, meStudentId]);
  const summary = useMemo(() => totals(txs, { studentId: meStudentId }), [txs, meStudentId]);
  const recent = useMemo(
    () => txs.filter((t) => t.studentId === meStudentId).slice(0, 8),
    [txs, meStudentId]
  );

  const handleDownloadStatement = async () => {
    if (!me) return;
    setDownloading(true);
    try {
      const { generateStudentStatementPdf } = await import("@/lib/khazna/pdf-report");
      const sectorMap = new Map(sectors.map((s) => [s.slug, s.name]));
      const fname = await generateStudentStatementPdf({
        collegeName: college.name,
        student: me,
        transactions: txs.filter((t) => t.studentId === me.id),
        sectorMap,
        generatedBy: me.name,
        institutionProfile,
      });
      toast.success("Downloaded statement PDF", { description: fname });
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate statement PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Student · ${me?.id ?? meStudentId}`}
        title={me ? `Hello, ${me.name}` : "My Finance Overview"}
        description={me ? `${me.className} · ${college.name}` : college.name}
        actions={
          <Btn
            variant="primary"
            data-ai-id="student-download-statement-btn"
            disabled={!me || downloading}
            onClick={() => void handleDownloadStatement()}
          >
            <FileText /> {downloading ? "Preparing…" : "Download Statement PDF"}
          </Btn>
        }
      />

      <GlassCard data-guide-id="student-dues-card" className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Wallet className="size-4 text-primary" /> Combined Balance
            </div>
            <div className="mt-2 font-display text-3xl font-semibold sm:text-4xl">
              <Amount value={summary.balance} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.balance < 0
                ? `Total Outstanding: ${formatINR(Math.abs(summary.balance))}`
                : "Your combined campus ledger is in good standing."}
            </p>
          </div>
          <div className="flex gap-3">
            <div className="glass-inset px-4 py-3">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ArrowDownLeft className="size-3.5 text-credit" /> Paid / Credits
              </div>
              <div className="mt-0.5 text-sm font-semibold text-credit num">{formatINR(summary.credit)}</div>
            </div>
            <div className="glass-inset px-4 py-3">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ArrowUpRight className="size-3.5 text-debit" /> Charges / Debits
              </div>
              <div className="mt-0.5 text-sm font-semibold text-debit num">{formatINR(summary.debit)}</div>
            </div>
          </div>
        </div>
      </GlassCard>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Sector Breakdown</h2>
        <div
          data-guide-id="student-sectors-list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
        >
          {sectors.map((s) => {
            const t = totals(txs, { sector: s.slug, studentId: meStudentId });
            return (
              <Link
                key={s.slug}
                to="/app/s/$sectorSlug"
                params={{ sectorSlug: s.slug }}
                data-ai-id={`student-sector-card-${s.slug}`}
              >
                <SectorTile sector={s} value={t.balance}>
                  <div className="flex justify-between num">
                    <span className="text-credit">+{formatINR(t.credit)}</span>
                    <span className="text-debit">−{formatINR(t.debit)}</span>
                  </div>
                  <div className="mt-1">{t.count} transactions</div>
                </SectorTile>
              </Link>
            );
          })}
        </div>
      </div>

      <GlassCard className="p-5">
        <h2 className="font-semibold text-foreground">Recent Transactions</h2>
        <ul className="mt-3 divide-y divide-hairline">
          {recent.map((tx) => {
            const sec = sectors.find((s) => s.slug === tx.sector);
            return (
              <li key={tx.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className={tx.voided ? "text-muted-foreground line-through" : "font-medium text-foreground"}>
                    {tx.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {sec?.name ?? tx.sector} · {tx.receiptNo} · {formatDate(tx.date)}
                  </div>
                </div>
                <Amount value={tx.amount} type={tx.type} className={tx.voided ? "opacity-40 line-through" : "font-semibold"} />
              </li>
            );
          })}
        </ul>
      </GlassCard>
    </div>
  );
}
