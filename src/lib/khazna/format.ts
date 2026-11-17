export const TODAY = "2026-11-15";
export const NOW_ISO = "2026-11-15T09:30:00.000Z";

export function addDays(isoDate: string, deltaDays: number): string {
  const base = isoDate ? new Date(`${isoDate.slice(0, 10)}T00:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return TODAY;
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00Z` : dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatINR(value: number, opts?: { sign?: boolean }): string {
  const rounded = Math.round(Number(value) || 0);
  const abs = Math.abs(rounded).toLocaleString("en-IN");
  if (rounded < 0) return `−₹${abs}`;
  if (opts?.sign && rounded > 0) return `+₹${abs}`;
  return `₹${abs}`;
}

export function formatCompactINR(value: number): string {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 10_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

export function timeAgo(iso: string): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function initials(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
