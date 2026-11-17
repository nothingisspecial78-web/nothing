import { Link, createFileRoute } from "@tanstack/react-router";
import { Ban, Eye, FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { KDialog, KDrawer } from "@/components/khazna/overlays";
import { Amount, Chip, EmptyState, Field, GlassCard, PageHeader, ScrollLoadFooter, useProgressiveSlice } from "@/components/khazna/primitives";
import { formatDate } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";
import type { Batch } from "@/lib/khazna/types";

export const Route = createFileRoute("/m/$sectorSlug/batches")({
  head: () => ({
    meta: [
      { title: "Batch History — Khazna" },
      { name: "description", content: "Inspect, edit, void, or delete posted bulk entry batches." },
    ],
  }),
  component: SectorBatchesPage,
});

function SectorBatchesPage() {
  const { sectorSlug } = Route.useParams();
  const sector = useKhazna((s) => s.sectors.find((x) => x.slug === sectorSlug));
  const batches = useKhazna((s) => s.batches);
  const txs = useKhazna((s) => s.transactions);
  const students = useKhazna((s) => s.students);
  const editBatch = useKhazna((s) => s.editBatch);
  const voidBatch = useKhazna((s) => s.voidBatch);
  const deleteBatch = useKhazna((s) => s.deleteBatch);

  const [inspecting, setInspecting] = useState<Batch | null>(null);
  const [editing, setEditing] = useState<Batch | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [deleting, setDeleting] = useState<Batch | null>(null);

  useEffect(() => {
    setInspecting(null);
    setEditing(null);
    setDeleting(null);
  }, [sectorSlug]);

  const sectorBatches = useMemo(
    () => batches.filter((b) => b.sector === sectorSlug),
    [batches, sectorSlug]
  );

  const {
    visibleItems: visibleBatches,
    visibleCount,
    totalCount,
    hasMore,
    loadMore,
    sentinelRef,
  } = useProgressiveSlice(sectorBatches, 12, sectorSlug);

  const inspectingTxs = useMemo(
    () => (inspecting ? txs.filter((t) => t.batchId === inspecting.id) : []),
    [inspecting, txs]
  );

  const handleEditSave = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || !editTitle.trim()) return;
    editBatch(editing.id, { title: editTitle.trim(), date: editDate });
    toast.success(`Updated batch ${editing.id}`);
    setEditing(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={sector?.name ?? sectorSlug}
        title="Posted Batches"
        description="Review bulk fee assessments and group receipts posted for classes."
        actions={
          <Btn asChild variant="primary">
            <Link to="/m/$sectorSlug/bulk" params={{ sectorSlug }} data-ai-id="batches-new-bulk-link">
              <Plus /> New bulk entry
            </Link>
          </Btn>
        }
      />

      {sectorBatches.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={FileSpreadsheet}
            title="No bulk batches in this sector"
            body="Use Bulk Entry to post a uniform charge or receipt across an entire class."
          />
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleBatches.map((b) => (
            <GlassCard key={b.id} className="flex flex-col justify-between gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">{b.id}</span>
                    <Chip tone={b.voided ? "debit" : b.type === "credit" ? "credit" : "info"}>
                      {b.voided ? "Voided" : b.type}
                    </Chip>
                  </div>
                  <h3 className={`mt-1 font-semibold ${b.voided ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {b.title}
                  </h3>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(b.date)} · {b.studentIds.length} students · by {b.createdBy}
                  </div>
                </div>
                <div className="text-right">
                  <Amount value={b.amount * b.studentIds.length} type={b.type} className="text-base font-semibold" />
                  <div className="text-[11px] text-muted-foreground num">₹{b.amount.toLocaleString("en-IN")} each</div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-1 border-t border-hairline pt-3">
                <Btn variant="soft" size="sm" data-ai-id={`batch-inspect-${b.id}`} onClick={() => setInspecting(b)}>
                  <Eye className="size-3.5" /> Inspect
                </Btn>
                {!b.voided && (
                  <>
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(b);
                        setEditTitle(b.title);
                        setEditDate(b.date);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Btn>
                    <Btn
                      variant="ghost"
                      size="sm"
                      className="text-debit"
                      onClick={() => {
                        voidBatch(b.id, "Voided by manager");
                        toast.success(`Voided batch ${b.id}`);
                      }}
                    >
                      <Ban className="size-3.5" />
                    </Btn>
                  </>
                )}
                <Btn
                  variant="ghost"
                  size="sm"
                  data-sensitive="true"
                  className="text-debit"
                  onClick={() => setDeleting(b)}
                >
                  <Trash2 className="size-3.5" />
                </Btn>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {sectorBatches.length > 0 && (
        <GlassCard className="overflow-hidden">
          <ScrollLoadFooter
            idPrefix="batches"
            visibleCount={visibleCount}
            totalCount={totalCount}
            hasMore={hasMore}
            onLoadMore={loadMore}
            sentinelRef={sentinelRef}
            label="batches"
          />
        </GlassCard>
      )}

      <KDrawer
        open={!!inspecting}
        onOpenChange={(o) => !o && setInspecting(null)}
        title={inspecting?.title ?? ""}
        description={inspecting ? `${inspecting.id} · ${inspecting.studentIds.length} receipts` : undefined}
        footer={<Btn variant="primary" onClick={() => setInspecting(null)}>Close</Btn>}
      >
        <ul className="divide-y divide-hairline">
          {inspectingTxs.map((t) => {
            const stu = students.find((s) => s.id === t.studentId);
            return (
              <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="font-medium text-foreground">{stu?.name ?? t.studentId}</div>
                  <div className="font-mono text-xs text-muted-foreground">{t.receiptNo}</div>
                </div>
                <Amount value={t.amount} type={t.type} />
              </li>
            );
          })}
        </ul>
      </KDrawer>

      <KDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Edit batch details"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn type="submit" form="edit-batch-form" variant="primary">Save</Btn>
          </>
        }
      >
        <form id="edit-batch-form" onSubmit={handleEditSave} className="space-y-3">
          <Field label="Batch title" required>
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="k-input" />
          </Field>
          <Field label="Posting date" required>
            <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="k-input" />
          </Field>
        </form>
      </KDialog>

      <KDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete batch"
        description={deleting ? `Permanently delete batch ${deleting.id} and its ${deleting.studentIds.length} entries?` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleting(null)}>Cancel</Btn>
            <Btn
              variant="danger"
              onClick={() => {
                if (deleting) {
                  deleteBatch(deleting.id);
                  toast.success(`Deleted batch ${deleting.id}`);
                  setDeleting(null);
                }
              }}
            >
              Delete batch
            </Btn>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This reverses all transactions created by the batch.</p>
      </KDialog>
    </div>
  );
}
