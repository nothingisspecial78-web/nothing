import { createFileRoute } from "@tanstack/react-router";
import { FileText, ReceiptText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { Amount, Chip, EmptyState, GlassCard, PageHeader, ScrollLoadFooter, TableShell, useProgressiveSlice } from "@/components/khazna/primitives";
import { formatDate, formatINR } from "@/lib/khazna/format";
import { totals } from "@/lib/khazna/ledger";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/app/s/$sectorSlug")({
  head: () => ({
    meta: [
      { title: "Sector Ledger — Khazna Student" },
      { name: "description", content: "Detailed student fee and receipt history for a specific sector." },
    ],
  }),
  component: StudentSectorPage,
});

function StudentSectorPage() {
  const { sectorSlug } = Route.useParams();
  const meStudentId = useKhazna((s) => s.meStudentId);
  const students = useKhazna((s) => s.students);
  const sectors = useKhazna((s) => s.sectors);
  const txs = useKhazna((s) => s.transactions);
  const college = useKhazna((s) => s.college);
  const institutionProfile = useKhazna((s) => s.institutionProfile);
  const [downloading, setDownloading] = useState(false);

  const sector = sectors.find((s) => s.slug === sectorSlug);
  const me = students.find((s) => s.id === meStudentId);

  const sectorTxs = useMemo(
    () => txs.filter((t) => t.sector === sectorSlug && t.studentId === meStudentId),
    [txs, sectorSlug, meStudentId]
  );
  const summary = useMemo(
    () => totals(txs, { sector: sectorSlug, studentId: meStudentId }),
    [txs, sectorSlug, meStudentId]
  );

  const {
    visibleItems: visibleTxs,
    visibleCount,
    totalCount,
    hasMore,
    loadMore,
    sentinelRef,
  } = useProgressiveSlice(sectorTxs, 15, `${sectorSlug}|${meStudentId}`);

  const exportSectorStatement = async () => {
    if (!me) return;
    setDownloading(true);
    try {
      const { generateStudentStatementPdf } = await import("@/lib/khazna/pdf-report");
      const sectorMap = new Map(sectors.map((s) => [s.slug, s.name]));
      const fname = await generateStudentStatementPdf({
        collegeName: college.name,
        student: me,
        transactions: sectorTxs,
        sectorMap,
        generatedBy: me.name,
        institutionProfile,
      });
      toast.success("Downloaded sector statement PDF", { description: fname });
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate statement PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="My Ledger"
        title={sector?.name ?? sectorSlug}
        description={sector?.description || "Your personal transactions in this sector."}
        actions={
          <Btn variant="primary" disabled={!me || downloading} onClick={() => void exportSectorStatement()}>
            <FileText /> {downloading ? "Preparing…" : "Statement PDF"}
          </Btn>
        }
      />

      <GlassCard className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
        <div className="glass-inset p-3.5">
          <div className="text-xs text-muted-foreground">Sector Balance</div>
          <div className="mt-1 text-xl font-semibold"><Amount value={summary.balance} /></div>
        </div>
        <div className="glass-inset p-3.5">
          <div className="text-xs text-muted-foreground">Paid / Credits</div>
          <div className="mt-1 text-xl font-semibold text-credit num">{formatINR(summary.credit)}</div>
        </div>
        <div className="glass-inset p-3.5">
          <div className="text-xs text-muted-foreground">Assessed / Debits</div>
          <div className="mt-1 text-xl font-semibold text-debit num">{formatINR(summary.debit)}</div>
        </div>
      </GlassCard>

      <TableShell>
        {sectorTxs.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No entries yet" body="No transactions recorded for you in this sector." />
        ) : (
          <div className="overflow-x-auto">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleTxs.map((t) => (
                  <tr key={t.id} className={t.voided ? "opacity-55" : undefined}>
                    <td className="font-mono text-xs">{t.receiptNo}</td>
                    <td className="text-xs text-muted-foreground">{formatDate(t.date)}</td>
                    <td>
                      <span className={t.voided ? "line-through text-muted-foreground" : "text-foreground"}>{t.title}</span>
                      {t.voided && <Chip tone="debit" className="ml-2">Voided</Chip>}
                    </td>
                    <td className="text-right font-semibold">
                      <Amount value={t.amount} type={t.type} className={t.voided ? "line-through" : ""} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ScrollLoadFooter
          idPrefix="student-sector"
          visibleCount={visibleCount}
          totalCount={totalCount}
          hasMore={hasMore}
          onLoadMore={loadMore}
          sentinelRef={sentinelRef}
          label="entries"
        />
      </TableShell>
    </div>
  );
}
