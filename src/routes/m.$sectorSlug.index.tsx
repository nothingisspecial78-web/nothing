import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ListChecks, Plus, ReceiptText, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn } from "@/components/khazna/btn";
import { NewEntryDialog, type EntryPreset } from "@/components/khazna/NewEntryDialog";
import { Amount, Avatar, Chip, CountUp, GlassCard, PageHeader, ProgressRing, StatCard } from "@/components/khazna/primitives";
import { formatDate } from "@/lib/khazna/format";
import { totals } from "@/lib/khazna/ledger";
import { topPendingStudents } from "@/lib/khazna/selectors";
import { managerNameIn, useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/m/$sectorSlug/")({
  head: () => ({
    meta: [
      { title: "Sector Overview — Khazna" },
      { name: "description", content: "Collections, pending dues, and recent ledger entries for this sector." },
    ],
  }),
  component: SectorOverviewPage,
});

function SectorOverviewPage() {
  const { sectorSlug } = Route.useParams();
  const sector = useKhazna((s) => s.sectors.find((x) => x.slug === sectorSlug));
  const txs = useKhazna((s) => s.transactions);
  const students = useKhazna((s) => s.students);
  const classes = useKhazna((s) => s.classes);
  const managerName = useKhazna((s) => managerNameIn(s, sectorSlug));

  const [entryOpen, setEntryOpen] = useState(false);
  const [preset, setPreset] = useState<EntryPreset | undefined>(undefined);

  const summary = useMemo(() => totals(txs, { sector: sectorSlug }), [txs, sectorSlug]);
  const pending = useMemo(
    () => topPendingStudents(txs, students, sectorSlug).slice(0, 6),
    [txs, students, sectorSlug]
  );
  const recent = useMemo(
    () => txs.filter((t) => t.sector === sectorSlug).slice(0, 6),
    [txs, sectorSlug]
  );
  const byClass = useMemo(() => {
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const acc = new Map<string, number>();
    for (const c of classes) acc.set(c, 0);
    for (const t of txs) {
      if (t.voided || t.sector !== sectorSlug || t.type !== "credit") continue;
      const cls = studentMap.get(t.studentId)?.className ?? "Other";
      acc.set(cls, (acc.get(cls) ?? 0) + t.amount);
    }
    const max = Math.max(1, ...acc.values());
    return Array.from(acc.entries()).map(([cls, amt]) => ({ cls, amt, pct: amt / max }));
  }, [txs, students, classes, sectorSlug]);

  const progress = sector && sector.target > 0 ? Math.min(1, summary.credit / sector.target) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Sector · ${sector?.receiptPrefix ?? ""}`}
        title={sector?.name ?? sectorSlug}
        description={`${sector?.description || "Department ledger"} · Managed by ${managerName}`}
        actions={
          <>
            <Btn asChild variant="glass">
              <Link to="/m/$sectorSlug/bulk" params={{ sectorSlug }} data-ai-id="sector-overview-bulk-link">
                <ListChecks /> Bulk entry
              </Link>
            </Btn>
            <Btn
              variant="primary"
              data-ai-id="sector-overview-new-entry-btn"
              onClick={() => {
                setPreset({ type: "credit" });
                setEntryOpen(true);
              }}
            >
              <Plus /> New entry
            </Btn>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net balance" icon={Wallet} value={<CountUp value={summary.balance} />} hint={`${summary.count} active entries`} />
        <StatCard label="Total collected" icon={ArrowDownLeft} tone="credit" value={<CountUp value={summary.credit} />} hint="Receipts posted" />
        <StatCard label="Total debits" icon={ArrowUpRight} tone="debit" value={<CountUp value={summary.debit} />} hint="Dues & payouts" />
        <StatCard label="Pending students" icon={AlertTriangle} tone="info" value={<CountUp value={pending.length} format={(n) => String(Math.round(n))} />} hint="Students owing in sector" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Term Target</h2>
            <Chip tone="info">{Math.round(progress * 100)}%</Chip>
          </div>
          <div className="my-5 flex justify-center">
            <ProgressRing value={progress} size={156} stroke={12} color={sector?.color || "var(--primary)"}>
              <div>
                <div className="font-display text-2xl font-semibold text-foreground num">{Math.round(progress * 100)}%</div>
                <div className="text-[11px] text-muted-foreground">collected</div>
              </div>
            </ProgressRing>
          </div>
          <div className="space-y-2.5">
            {byClass.map((row) => (
              <div key={row.cls}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">{row.cls}</span>
                  <span className="font-medium text-foreground num"><Amount value={row.amt} /></span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-accent">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(row.pct * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Pending Dues</h2>
            <Link to="/m/$sectorSlug/ledger" params={{ sectorSlug }} className="text-xs text-primary hover:underline">
              Full ledger →
            </Link>
          </div>
          {pending.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">All student accounts in this sector are settled.</p>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {pending.map(({ student, owed }) => (
                <li key={student.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={student.name} size={34} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{student.name}</div>
                      <div className="text-xs text-muted-foreground num">{student.id} · {student.className}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Amount value={-owed} className="text-sm font-semibold" />
                    <Btn
                      variant="soft"
                      size="sm"
                      data-ai-id={`collect-due-${student.id}`}
                      onClick={() => {
                        setPreset({
                          type: "credit",
                          studentId: student.id,
                          amount: owed,
                          title: "Due Settlement",
                        });
                        setEntryOpen(true);
                      }}
                    >
                      Collect
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ReceiptText className="size-4 text-primary" />
            <h2 className="font-semibold text-foreground">Recent Sector Entries</h2>
          </div>
          <Link to="/m/$sectorSlug/reports" params={{ sectorSlug }} className="text-xs text-primary hover:underline">
            Class reports →
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-hairline">
          {recent.map((tx) => {
            const stu = students.find((s) => s.id === tx.studentId);
            return (
              <li key={tx.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className={tx.voided ? "text-muted-foreground line-through" : "font-medium text-foreground"}>
                    {tx.title} · <span className="text-muted-foreground font-normal">{stu?.name ?? tx.studentId}</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {tx.receiptNo} · {formatDate(tx.date)}
                  </div>
                </div>
                <Amount value={tx.amount} type={tx.type} className={tx.voided ? "opacity-40 line-through" : "font-semibold"} />
              </li>
            );
          })}
        </ul>
      </GlassCard>

      <NewEntryDialog open={entryOpen} onOpenChange={setEntryOpen} sector={sectorSlug} preset={preset} />
    </div>
  );
}
