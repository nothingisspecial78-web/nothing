import { createFileRoute } from "@tanstack/react-router";
import { Ban, Pencil, Plus, ReceiptText, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { NewEntryDialog, type EntryPreset } from "@/components/khazna/NewEntryDialog";
import { KDialog } from "@/components/khazna/overlays";
import { Amount, Chip, EmptyState, PageHeader, ScrollLoadFooter, SearchInput, Segmented, TableShell, useProgressiveSlice } from "@/components/khazna/primitives";
import { formatDate } from "@/lib/khazna/format";
import { totals } from "@/lib/khazna/ledger";
import { useKhazna } from "@/lib/khazna/store";
import type { Tx } from "@/lib/khazna/types";

export const Route = createFileRoute("/m/$sectorSlug/ledger")({
  head: () => ({
    meta: [
      { title: "Sector Ledger — Khazna" },
      { name: "description", content: "Inspect, post, edit, and void sector receipts and assessments." },
    ],
  }),
  component: SectorLedgerPage,
});

const PER_PAGE = 12;

function SectorLedgerPage() {
  const { sectorSlug } = Route.useParams();
  const sector = useKhazna((s) => s.sectors.find((x) => x.slug === sectorSlug));
  const txs = useKhazna((s) => s.transactions);
  const students = useKhazna((s) => s.students);
  const voidEntry = useKhazna((s) => s.voidEntry);
  const unvoidEntry = useKhazna((s) => s.unvoidEntry);

  const [filterType, setFilterType] = useState<"all" | "credit" | "debit">("all");
  const [q, setQ] = useState("");

  const [entryOpen, setEntryOpen] = useState(false);
  const [preset, setPreset] = useState<EntryPreset | undefined>(undefined);
  const [voidingTx, setVoidingTx] = useState<Tx | null>(null);
  const [voidReason, setVoidReason] = useState("Posted in error");
  const [receiptTx, setReceiptTx] = useState<Tx | null>(null);

  useEffect(() => {
    setFilterType("all");
    setQ("");
    setEntryOpen(false);
    setPreset(undefined);
    setVoidingTx(null);
    setReceiptTx(null);
  }, [sectorSlug]);

  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return txs.filter((t) => {
      if (t.sector !== sectorSlug) return false;
      if (filterType !== "all" && t.type !== filterType) return false;
      if (!term) return true;
      const stu = studentMap.get(t.studentId);
      return (
        t.receiptNo.toLowerCase().includes(term) ||
        t.title.toLowerCase().includes(term) ||
        t.studentId.toLowerCase().includes(term) ||
        (stu?.name.toLowerCase().includes(term) ?? false)
      );
    });
  }, [txs, sectorSlug, filterType, q, studentMap]);

  const summary = useMemo(() => totals(filtered), [filtered]);
  const {
    visibleItems: rows,
    visibleCount,
    totalCount,
    hasMore,
    loadMore,
    sentinelRef,
  } = useProgressiveSlice(filtered, PER_PAGE, `${sectorSlug}|${filterType}|${q}`);

  const confirmVoid = () => {
    if (!voidingTx) return;
    voidEntry(voidingTx.id, voidReason.trim() || "Voided by manager");
    toast.success(`Voided receipt ${voidingTx.receiptNo}`, {
      action: { label: "Undo", onClick: () => unvoidEntry(voidingTx.id) },
    });
    setVoidingTx(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={sector?.name ?? sectorSlug}
        title="Sector Ledger"
        description={`Net ${summary.balance >= 0 ? "+" : ""}₹${summary.balance.toLocaleString("en-IN")} across ${filtered.length} entries.`}
        actions={
          <Btn
            variant="primary"
            data-ai-id="ledger-new-entry-btn"
            data-guide-id="ledger-new-entry-button"
            onClick={() => {
              setPreset(undefined);
              setEntryOpen(true);
            }}
          >
            <Plus /> New entry
          </Btn>
        }
      />

      <div className="glass flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div data-guide-id="ledger-search-input" className="lg:w-80">
          <SearchInput
            aiId="ledger-search-input"
            value={q}
            onChange={setQ}
            placeholder="Search receipt, student, or title…"
          />
        </div>
        <Segmented
          idPrefix="ledger-filter"
          value={filterType}
          onChange={(v) => setFilterType(v as "all" | "credit" | "debit")}
          options={[
            { value: "all", label: "All entries" },
            { value: "credit", label: "Credit (In)" },
            { value: "debit", label: "Debit (Out)" },
          ]}
        />
      </div>

      <TableShell>
        {rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No matching ledger entries" body="Post a new entry or adjust your search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Student</th>
                  <th>Description</th>
                  <th>Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => {
                  const stu = studentMap.get(tx.studentId);
                  return (
                    <tr
                      key={tx.id}
                      onClick={() => setReceiptTx(tx)}
                      className={tx.voided ? "cursor-pointer opacity-55" : "cursor-pointer"}
                    >
                      <td className="font-mono text-xs font-semibold text-foreground">{tx.receiptNo}</td>
                      <td>
                        <div className="font-medium text-foreground">{stu?.name ?? tx.studentId}</div>
                        <div className="text-xs text-muted-foreground num">{tx.studentId} · {stu?.className ?? ""}</div>
                      </td>
                      <td>
                        <div className={tx.voided ? "line-through text-muted-foreground" : "text-foreground"}>{tx.title}</div>
                        {tx.voided && <Chip tone="debit" className="mt-1">Voided: {tx.voided.reason}</Chip>}
                      </td>
                      <td className="text-xs text-muted-foreground">{formatDate(tx.date)}</td>
                      <td className="text-right font-semibold">
                        <Amount value={tx.amount} type={tx.type} className={tx.voided ? "line-through" : ""} />
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {!tx.voided ? (
                            <>
                              <Btn
                                variant="ghost"
                                size="sm"
                                data-ai-id={`ledger-edit-${tx.id}`}
                                onClick={() => {
                                  setPreset({ entry: tx });
                                  setEntryOpen(true);
                                }}
                              >
                                <Pencil className="size-3.5" />
                              </Btn>
                              <Btn
                                variant="ghost"
                                size="sm"
                                data-ai-id={`ledger-void-${tx.id}`}
                                className="text-debit hover:bg-debit/10"
                                onClick={() => setVoidingTx(tx)}
                              >
                                <Ban className="size-3.5" />
                              </Btn>
                            </>
                          ) : (
                            <Btn
                              variant="ghost"
                              size="sm"
                              data-ai-id={`ledger-restore-${tx.id}`}
                              onClick={() => {
                                unvoidEntry(tx.id);
                                toast.success(`Restored ${tx.receiptNo}`);
                              }}
                            >
                              <RotateCcw className="size-3.5 text-credit" />
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ScrollLoadFooter
          idPrefix="ledger"
          visibleCount={visibleCount}
          totalCount={totalCount}
          hasMore={hasMore}
          onLoadMore={loadMore}
          sentinelRef={sentinelRef}
          label="entries"
        />
      </TableShell>

      <NewEntryDialog open={entryOpen} onOpenChange={setEntryOpen} sector={sectorSlug} preset={preset} />

      <KDialog
        open={!!voidingTx}
        onOpenChange={(o) => !o && setVoidingTx(null)}
        title="Void ledger entry"
        description={voidingTx ? `Receipt ${voidingTx.receiptNo} will remain in the audit log marked as voided.` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setVoidingTx(null)}>Cancel</Btn>
            <Btn variant="danger" data-ai-id="ledger-void-confirm-btn" onClick={confirmVoid}>Void entry</Btn>
          </>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Void reason</span>
          <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="k-input" />
        </label>
      </KDialog>

      <KDialog
        open={!!receiptTx}
        onOpenChange={(o) => !o && setReceiptTx(null)}
        title={receiptTx ? `Receipt ${receiptTx.receiptNo}` : ""}
        description={receiptTx ? formatDate(receiptTx.date) : undefined}
        footer={<Btn variant="primary" onClick={() => setReceiptTx(null)}>Close</Btn>}
      >
        {receiptTx && (
          <div className="space-y-3 text-sm">
            <div className="glass-inset flex items-center justify-between p-4">
              <span className="text-muted-foreground">Amount</span>
              <Amount value={receiptTx.amount} type={receiptTx.type} className="text-lg font-bold" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="glass-inset p-3">
                <div className="text-muted-foreground">Student</div>
                <div className="mt-0.5 font-medium text-foreground">
                  {studentMap.get(receiptTx.studentId)?.name ?? receiptTx.studentId}
                </div>
              </div>
              <div className="glass-inset p-3">
                <div className="text-muted-foreground">Recorded by</div>
                <div className="mt-0.5 font-medium text-foreground">{receiptTx.createdBy}</div>
              </div>
            </div>
            {receiptTx.reason && (
              <div className="glass-inset p-3 text-xs text-muted-foreground">Note: {receiptTx.reason}</div>
            )}
          </div>
        )}
      </KDialog>
    </div>
  );
}
