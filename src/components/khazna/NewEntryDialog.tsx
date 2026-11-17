import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { TODAY } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";
import type { SectorSlug, Tx, TxType } from "@/lib/khazna/types";
import { queueKhaznaMutationIfOffline } from "@/lib/network/offlineQueue";
import { SafeButton } from "@/components/network/SafeButton";
import { Btn } from "./btn";
import { KDialog } from "./overlays";
import { Field, Segmented } from "./primitives";

export interface EntryPreset {
  type?: TxType | undefined;
  studentId?: string | undefined;
  title?: string | undefined;
  amount?: number | undefined;
  reason?: string | undefined;
  entry?: Tx | undefined;
}

export function NewEntryDialog({
  open,
  onOpenChange,
  sector,
  preset,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sector: SectorSlug;
  preset?: EntryPreset | undefined;
}) {
  const students = useKhazna((s) => s.students);
  const sectorObj = useKhazna((s) => s.sectors.find((x) => x.slug === sector));
  const addEntry = useKhazna((s) => s.addEntry);
  const editEntry = useKhazna((s) => s.editEntry);

  const editing = preset?.entry;
  const [type, setType] = useState<TxType>("credit");
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(TODAY);
  const [receiptNo, setReceiptNo] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(editing.type);
      setStudentId(editing.studentId);
      setTitle(editing.title);
      setAmount(String(editing.amount));
      setReason(editing.reason || "");
      setDate(editing.date);
      setReceiptNo(editing.receiptNo);
      setErr("");
      return;
    }
    const nextType: TxType = preset?.type ?? "credit";
    const defaultTitles =
      nextType === "credit" ? sectorObj?.creditTitles : sectorObj?.debitTitles;
    setType(nextType);
    setStudentId(preset?.studentId || students[0]?.id || "S0125");
    setTitle(preset?.title || defaultTitles?.[0] || (nextType === "credit" ? "Fee Deposit" : "Term Assessment"));
    setAmount(preset?.amount ? String(preset.amount) : "");
    setReason(preset?.reason || "");
    setDate(TODAY);
    const prefix = sectorObj?.receiptPrefix || "KZ-";
    setReceiptNo(`${prefix}${Math.floor(800 + Math.random() * 199)}`);
    setErr("");
  }, [open, editing, preset, sectorObj, students]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const numAmt = Number(amount);
    if (!studentId) {
      setErr("Select a student.");
      return;
    }
    if (!Number.isFinite(numAmt) || numAmt <= 0) {
      setErr("Enter a valid positive amount.");
      return;
    }
    if (!title.trim()) {
      setErr("Enter an entry title.");
      return;
    }

    if (editing) {
      const patch = {
        sector,
        studentId,
        type,
        title: title.trim(),
        reason: reason.trim() || undefined,
        amount: Math.round(numAmt),
        date: date || TODAY,
        receiptNo: receiptNo.trim() || editing.receiptNo,
      };
      editEntry(editing.id, patch);
      const queued = queueKhaznaMutationIfOffline(
        "EDIT_ENTRY",
        { id: editing.id, ...patch },
        `Edit ${patch.receiptNo}`
      );
      toast.success(
        queued
          ? `Saved offline: ${patch.receiptNo} will sync on reconnect`
          : `Updated receipt ${patch.receiptNo}`
      );
    } else {
      const created = addEntry({
        sector,
        studentId,
        type,
        title: title.trim(),
        reason: reason.trim() || undefined,
        amount: Math.round(numAmt),
        date: date || TODAY,
        receiptNo: receiptNo.trim() || `KZ-${Date.now().toString().slice(-4)}`,
      });
      const queued = queueKhaznaMutationIfOffline(
        "ADD_ENTRY",
        created as unknown as Record<string, unknown>,
        `Post ${created.receiptNo}`
      );
      toast.success(
        queued
          ? `Saved offline: ${created.receiptNo} queued to sync`
          : `Posted ${created.receiptNo} (₹${created.amount.toLocaleString("en-IN")})`
      );
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <KDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit ledger entry" : `New ${sectorObj?.name ?? sector} entry`}
      description={editing ? `Receipt ${editing.receiptNo}` : "Record a credit receipt or debit assessment."}
      footer={
        <>
          <Btn type="button" variant="ghost" data-ai-id="dialog-entry-cancel-btn" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <SafeButton
            type="submit"
            form="new-entry-form"
            variant="primary"
            data-ai-id="dialog-entry-submit-btn"
            data-guide-id="dialog-entry-submit"
          >
            {editing ? "Save changes" : "Post entry"}
          </SafeButton>
        </>
      }
    >
      <form id="new-entry-form" onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <Segmented
            value={type}
            onChange={(v) => setType(v)}
            idPrefix="entry-type"
            options={[
              { value: "credit", label: "Credit (Receipt)" },
              { value: "debit", label: "Debit (Due / Expense)" },
            ]}
          />
        </div>

        <Field label="Student" required>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            data-ai-id="dialog-entry-student-select"
            data-guide-id="dialog-entry-student"
            className="k-input"
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.name} ({s.className})
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount (INR)" required>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-ai-id="dialog-entry-amount-input"
              data-guide-id="dialog-entry-amount"
              placeholder="e.g. 1500"
              className="k-input num"
            />
          </Field>
          <Field label="Receipt No." required>
            <input
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              data-ai-id="dialog-entry-receipt-input"
              className="k-input font-mono"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title / Fee Head" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-ai-id="dialog-entry-title-input"
              placeholder="e.g. Tuition Fee"
              className="k-input"
            />
          </Field>
          <Field label="Date" required>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-ai-id="dialog-entry-date-input"
              className="k-input"
            />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-ai-id="dialog-entry-reason-input"
            placeholder="Optional remark or term reference"
            className="k-input"
          />
        </Field>

        {err && (
          <div className="rounded-lg border border-debit/30 bg-debit/10 px-3 py-2 text-xs text-debit">
            {err}
          </div>
        )}
      </form>
    </KDialog>
  );
}
