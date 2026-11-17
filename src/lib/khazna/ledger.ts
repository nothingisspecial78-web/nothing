import type { SectorSlug, Tx } from "./types";

export interface LedgerTotals {
  credit: number;
  debit: number;
  balance: number;
  count: number;
}

export function totals(
  txs: Tx[],
  filter?: { sector?: SectorSlug | undefined; studentId?: string | undefined; includeVoided?: boolean | undefined }
): LedgerTotals {
  let credit = 0;
  let debit = 0;
  let count = 0;

  const sectorFilter = filter?.sector;
  const studentFilter = filter?.studentId;
  const includeVoided = filter?.includeVoided ?? false;

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]!;
    if (!includeVoided && t.voided) continue;
    if (sectorFilter && t.sector !== sectorFilter) continue;
    if (studentFilter && t.studentId !== studentFilter) continue;
    if (t.type === "credit") credit += t.amount;
    else debit += t.amount;
    count += 1;
  }

  return {
    credit,
    debit,
    balance: credit - debit,
    count,
  };
}

export function receiptSeries(prefix: string, start: number, count: number): string[] {
  const out: string[] = [];
  const safePrefix = prefix || "KZ-";
  const safeStart = Number.isFinite(start) ? Math.max(1, Math.floor(start)) : 1;
  for (let i = 0; i < count; i++) {
    out.push(`${safePrefix}${String(safeStart + i).padStart(3, "0")}`);
  }
  return out;
}
