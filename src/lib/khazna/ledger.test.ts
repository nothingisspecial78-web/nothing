import { describe, expect, it } from "vitest";
import { receiptSeries, totals } from "./ledger";
import { pendingDues, topPendingStudents } from "./selectors";
import { checkSignatoryUniqueness, DEMO_SIGNATORIES } from "./store";
import type { Student, Tx } from "./types";

const sampleTxs: Tx[] = [
  { id: "1", sector: "office", studentId: "S1", type: "credit", title: "Fee", amount: 1500, date: "2026-11-01", receiptNo: "OF-1", createdBy: "Mgr" },
  { id: "2", sector: "office", studentId: "S1", type: "debit", title: "Due", amount: 500, date: "2026-11-02", receiptNo: "OF-2", createdBy: "Mgr" },
  { id: "3", sector: "office", studentId: "S2", type: "debit", title: "Mess", amount: 1200, date: "2026-11-03", receiptNo: "OF-3", createdBy: "Mgr" },
  { id: "4", sector: "office", studentId: "S2", type: "credit", title: "Voided", amount: 900, date: "2026-11-03", receiptNo: "OF-4", createdBy: "Mgr", voided: { reason: "err", by: "Mgr", at: "2026-11-03T10:00:00Z" } },
];

const sampleStudents: Student[] = [
  { id: "S1", name: "Alice", className: "Fiqh 1", phone: "111", guardian: "G1", joined: "2026-06-01" },
  { id: "S2", name: "Bilal", className: "Fiqh 2", phone: "222", guardian: "G2", joined: "2026-06-01" },
];

describe("Khazna ledger & selector pure helpers", () => {
  it("ignores voided entries and sums credits/debits accurately", () => {
    const res = totals(sampleTxs);
    expect(res.credit).toBe(1500);
    expect(res.debit).toBe(1700);
    expect(res.balance).toBe(-200);
    expect(res.count).toBe(3);
  });

  it("identifies students with unpaid dues via negative net balance", () => {
    const dues = pendingDues(sampleTxs);
    expect(dues.count).toBe(1);
    expect(dues.amount).toBe(1200);

    const ranked = topPendingStudents(sampleTxs, sampleStudents, "office");
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.student.id).toBe("S2");
    expect(ranked[0]?.owed).toBe(1200);
  });

  it("formats sequential padded receipt numbers", () => {
    expect(receiptSeries("FQ-", 8, 3)).toEqual(["FQ-008", "FQ-009", "FQ-010"]);
  });

  it("blocks duplicate active signatory role+sector combinations", () => {
    const conflict = checkSignatoryUniqueness(DEMO_SIGNATORIES, {
      role: "hod",
      sector_id: "fiqh",
      active: true,
    });
    expect(conflict.valid).toBe(false);

    const ok = checkSignatoryUniqueness(DEMO_SIGNATORIES, {
      role: "hod",
      sector_id: "velitcham",
      active: true,
    });
    expect(ok.valid).toBe(true);
  });
});
