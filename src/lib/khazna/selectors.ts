import { TODAY } from "./format";
import type { SectorSlug, Student, Tx } from "./types";

const TODAY_MS = new Date(`${TODAY}T23:59:59Z`).getTime();

export function inLastDays(tx: Tx, days: number): boolean {
  if (!tx.date) return false;
  const ms = new Date(`${tx.date.slice(0, 10)}T12:00:00Z`).getTime();
  if (Number.isNaN(ms)) return false;
  const cutoff = Math.max(Date.now(), TODAY_MS) - days * 86_400_000;
  return ms >= cutoff;
}

export function pendingDues(
  txs: Tx[],
  filter?: { sector?: SectorSlug | undefined }
): { amount: number; count: number; byStudent: Map<string, number> } {
  const balances = new Map<string, number>();
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]!;
    if (t.voided) continue;
    if (filter?.sector && t.sector !== filter.sector) continue;
    const prev = balances.get(t.studentId) ?? 0;
    balances.set(t.studentId, prev + (t.type === "credit" ? t.amount : -t.amount));
  }

  let amount = 0;
  let count = 0;
  const duesMap = new Map<string, number>();
  for (const [sid, bal] of balances.entries()) {
    if (bal < 0) {
      const owed = Math.abs(bal);
      amount += owed;
      count += 1;
      duesMap.set(sid, owed);
    }
  }
  return { amount, count, byStudent: duesMap };
}

export function topPendingStudents(
  txs: Tx[],
  students: Student[],
  sector?: SectorSlug,
  limit = 6
): Array<{ student: Student; owed: number }> {
  const { byStudent } = pendingDues(txs, sector ? { sector } : undefined);
  const stuMap = new Map(students.map((s) => [s.id, s]));
  const items: Array<{ student: Student; owed: number }> = [];
  for (const [sid, owed] of byStudent.entries()) {
    const stu = stuMap.get(sid);
    if (stu) items.push({ student: stu, owed });
  }
  items.sort((a, b) => b.owed - a.owed);
  return items.slice(0, limit);
}
