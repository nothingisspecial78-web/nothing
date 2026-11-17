import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { Amount, Chip, Field, FilterChip, GlassCard, PageHeader, ProgressRing, SearchInput, Segmented } from "@/components/khazna/primitives";
import { TODAY } from "@/lib/khazna/format";
import { receiptSeries } from "@/lib/khazna/ledger";
import { useKhazna } from "@/lib/khazna/store";
import type { TxType } from "@/lib/khazna/types";

export const Route = createFileRoute("/m/$sectorSlug/bulk")({
  head: () => ({
    meta: [
      { title: "Bulk Class Entry — Khazna" },
      { name: "description", content: "Post a uniform credit or debit entry to multiple students at once." },
    ],
  }),
  component: BulkEntryPage,
});

const PRESETS = [
  { label: "Tuition Fee", amount: 1500, type: "debit" as TxType },
  { label: "Hostel Mess Due", amount: 2200, type: "debit" as TxType },
  { label: "Exam Fee", amount: 500, type: "debit" as TxType },
  { label: "Study Tour", amount: 1000, type: "debit" as TxType },
  { label: "Scholarship Stipend", amount: 1000, type: "credit" as TxType },
];

function BulkEntryPage() {
  const { sectorSlug } = Route.useParams();
  const navigate = useNavigate();
  const sector = useKhazna((s) => s.sectors.find((x) => x.slug === sectorSlug));
  const students = useKhazna((s) => s.students);
  const classes = useKhazna((s) => s.classes);
  const txs = useKhazna((s) => s.transactions);
  const postBatch = useKhazna((s) => s.postBatch);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [clsFilter, setClsFilter] = useState("All");
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [type, setType] = useState<TxType>("debit");
  const [title, setTitle] = useState("Term Fee Assessment");
  const [amount, setAmount] = useState("500");
  const [date, setDate] = useState(TODAY);
  const [receiptPrefix, setReceiptPrefix] = useState(`${sector?.receiptPrefix || "KZ-"}B-`);
  const [receiptStart, setReceiptStart] = useState("1");
  const [postedBatchId, setPostedBatchId] = useState("");

  const visibleStudents = useMemo(() => {
    const term = q.trim().toLowerCase();
    return students.filter(
      (s) =>
        (clsFilter === "All" || s.className === clsFilter) &&
        (!term || s.name.toLowerCase().includes(term) || s.id.toLowerCase().includes(term))
    );
  }, [students, clsFilter, q]);

  const toggleStudent = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllVisible = () => {
    const ids = visibleStudents.map((s) => s.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  const numAmt = Number(amount) || 0;
  const receiptsPreview = useMemo(
    () => receiptSeries(receiptPrefix || "KZ-", Number(receiptStart) || 1, selectedIds.length),
    [receiptPrefix, receiptStart, selectedIds.length]
  );

  const previewRows = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    const balMap = new Map<string, number>();
    for (const t of txs) {
      if (t.voided || t.sector !== sectorSlug || !selectedSet.has(t.studentId)) continue;
      balMap.set(t.studentId, (balMap.get(t.studentId) ?? 0) + (t.type === "credit" ? t.amount : -t.amount));
    }
    return selectedIds.map((id, i) => {
      const stu = students.find((s) => s.id === id);
      const before = balMap.get(id) ?? 0;
      const after = before + (type === "credit" ? numAmt : -numAmt);
      return { id, name: stu?.name ?? id, className: stu?.className ?? "", before, after, receipt: receiptsPreview[i] || "" };
    });
  }, [selectedIds, students, txs, sectorSlug, type, numAmt, receiptsPreview]);

  const handleConfirm = () => {
    if (selectedIds.length === 0 || numAmt <= 0 || !title.trim()) {
      toast.error("Select students and enter a valid amount and title");
      return;
    }
    const batch = postBatch({
      sector: sectorSlug,
      studentIds: selectedIds,
      type,
      title: title.trim(),
      amount: Math.round(numAmt),
      date: date || TODAY,
      receiptPrefix: receiptPrefix.trim() || "KZ-",
      receiptStart: Number(receiptStart) || 1,
    });
    setPostedBatchId(batch.id);
    setStep(4);
    toast.success(`Posted batch ${batch.id} for ${selectedIds.length} student(s)`);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={sector?.name ?? sectorSlug}
        title="Bulk Class Entry"
        description="Post a single fee charge or credit batch across selected students in 4 guided steps."
      />

      <div className="flex flex-wrap gap-1.5">
        {[
          { n: 1 as const, label: "1. Select students" },
          { n: 2 as const, label: "2. Entry details" },
          { n: 3 as const, label: "3. Preview impact" },
          { n: 4 as const, label: "4. Complete" },
        ].map((s) => (
          <Chip key={s.n} tone={step === s.n ? "primary" : step > s.n ? "credit" : "neutral"}>
            {s.label}
          </Chip>
        ))}
      </div>

      {step === 1 && (
        <GlassCard className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput className="sm:w-72" value={q} onChange={setQ} placeholder="Search students…" />
            <div className="flex flex-wrap items-center gap-1.5">
              {["All", ...classes].map((c) => (
                <FilterChip key={c} active={clsFilter === c} onClick={() => setClsFilter(c)}>
                  {c}
                </FilterChip>
              ))}
              <Btn variant="soft" size="sm" data-ai-id="bulk-select-all-btn" onClick={selectAllVisible}>
                Toggle all ({visibleStudents.length})
              </Btn>
            </div>
          </div>

          <div className="grid max-h-[360px] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {visibleStudents.map((s) => {
              const checked = selectedIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                    checked ? "border-primary/50 bg-primary/10" : "border-hairline bg-accent/40 hover:bg-accent"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStudent(s.id)}
                    className="size-4 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{s.name}</div>
                    <div className="text-xs text-muted-foreground num">{s.id} · {s.className}</div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-hairline pt-3">
            <span className="text-xs font-medium text-muted-foreground">{selectedIds.length} student(s) selected</span>
            <Btn variant="primary" data-ai-id="bulk-step1-next-btn" disabled={selectedIds.length === 0} onClick={() => setStep(2)}>
              Next: Details <ArrowRight />
            </Btn>
          </div>
        </GlassCard>
      )}

      {step === 2 && (
        <GlassCard className="space-y-4 p-5">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <FilterChip
                key={p.label}
                active={title === p.label && Number(amount) === p.amount}
                onClick={() => {
                  setTitle(p.label);
                  setAmount(String(p.amount));
                  setType(p.type);
                }}
              >
                {p.label} · ₹{p.amount}
              </FilterChip>
            ))}
          </div>

          <Segmented
            value={type}
            onChange={(v) => setType(v === "credit" ? "credit" : "debit")}
            options={[
              { value: "debit", label: "Debit (Fee Due)" },
              { value: "credit", label: "Credit (Receipt / Grant)" },
            ]}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Title" required>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="k-input" />
            </Field>
            <Field label="Amount per student (INR)" required>
              <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="k-input num" />
            </Field>
            <Field label="Receipt prefix">
              <input value={receiptPrefix} onChange={(e) => setReceiptPrefix(e.target.value)} className="k-input font-mono" />
            </Field>
            <Field label="Starting number & Date">
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min="1" value={receiptStart} onChange={(e) => setReceiptStart(e.target.value)} className="k-input num" />
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="k-input" />
              </div>
            </Field>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
            <Btn variant="primary" data-ai-id="bulk-step2-next-btn" disabled={numAmt <= 0 || !title.trim()} onClick={() => setStep(3)}>
              Preview impact <ArrowRight />
            </Btn>
          </div>
        </GlassCard>
      )}

      {step === 3 && (
        <GlassCard className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
              <p className="text-xs text-muted-foreground">
                {selectedIds.length} students × ₹{numAmt.toLocaleString("en-IN")} = Total ₹{(selectedIds.length * numAmt).toLocaleString("en-IN")}
              </p>
            </div>
            <Chip tone={type === "credit" ? "credit" : "debit"}>{type.toUpperCase()}</Chip>
          </div>

          <div className="overflow-x-auto rounded-xl border border-hairline">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Receipt</th>
                  <th className="text-right">Before</th>
                  <th className="text-right">After</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 15).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-foreground">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.id} · {r.className}</div>
                    </td>
                    <td className="font-mono text-xs">{r.receipt}</td>
                    <td className="text-right"><Amount value={r.before} /></td>
                    <td className="text-right font-semibold"><Amount value={r.after} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Btn variant="ghost" onClick={() => setStep(2)}>Back</Btn>
            <Btn variant="primary" data-ai-id="bulk-confirm-post-btn" onClick={handleConfirm}>
              <ListChecks /> Post {selectedIds.length} entries
            </Btn>
          </div>
        </GlassCard>
      )}

      {step === 4 && (
        <GlassCard className="flex flex-col items-center gap-4 p-8 text-center">
          <ProgressRing value={1} size={112} stroke={10} color="var(--credit)">
            <CheckCircle2 className="size-10 text-credit" />
          </ProgressRing>
          <h2 className="text-xl font-semibold text-foreground">Batch Posted Successfully</h2>
          <p className="text-sm text-muted-foreground">
            Batch <span className="font-mono font-semibold text-foreground">{postedBatchId}</span> recorded{" "}
            {selectedIds.length} receipts for {title}.
          </p>
          <div className="flex gap-2">
            <Btn variant="glass" onClick={() => void navigate({ to: "/m/$sectorSlug/batches", params: { sectorSlug } })}>
              View batches
            </Btn>
            <Btn variant="primary" onClick={() => void navigate({ to: "/m/$sectorSlug/ledger", params: { sectorSlug } })}>
              Open ledger
            </Btn>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
