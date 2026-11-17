import { createFileRoute } from "@tanstack/react-router";
import { Download, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AUDIT_ICON } from "@/components/khazna/audit-meta";
import { Btn } from "@/components/khazna/btn";
import { Chip, EmptyState, FilterChip, PageHeader, ScrollLoadFooter, SearchInput, TableShell, useProgressiveSlice } from "@/components/khazna/primitives";
import { downloadCSV } from "@/lib/khazna/download";
import { timeAgo, TODAY } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";
import type { Role } from "@/lib/khazna/types";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — Khazna" },
      { name: "description", content: "Append-only ledger and administrative audit log." },
    ],
  }),
  component: AuditLogPage,
});

const PER_PAGE = 15;

function AuditLogPage() {
  const audit = useKhazna((s) => s.audit);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [actionFilter, setActionFilter] = useState("all");

  const actions = useMemo(() => {
    const set = new Set(audit.map((a) => a.action));
    return ["all", ...Array.from(set)];
  }, [audit]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return audit.filter((a) => {
      if (roleFilter !== "all" && a.role !== roleFilter) return false;
      if (actionFilter !== "all" && a.action !== actionFilter) return false;
      if (!term) return true;
      return (
        a.actor.toLowerCase().includes(term) ||
        a.target.toLowerCase().includes(term) ||
        a.details.toLowerCase().includes(term) ||
        a.action.toLowerCase().includes(term)
      );
    });
  }, [audit, q, roleFilter, actionFilter]);

  const {
    visibleItems: rows,
    visibleCount,
    totalCount,
    hasMore,
    loadMore,
    sentinelRef,
  } = useProgressiveSlice(filtered, PER_PAGE, `${q}|${roleFilter}|${actionFilter}`);

  const handleExportCsv = () => {
    downloadCSV(`khazna-audit-log-${TODAY}.csv`, [
      ["Timestamp", "Actor", "Role", "Action", "Target", "Sector", "Details", "IP"],
      ...filtered.map((a) => [a.at, a.actor, a.role, a.action, a.target, a.sector || "", a.details, a.ip || ""]),
    ]);
    toast.success(`Exported ${filtered.length} audit log entries`);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Audit Log"
        description="Chronological trail of every ledger transaction, void, batch post, and configuration change."
        actions={
          <Btn data-ai-id="audit-export-csv-btn" variant="glass" onClick={handleExportCsv}>
            <Download /> Export CSV
          </Btn>
        }
      />

      <div className="glass mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          aiId="audit-search-input"
          className="lg:w-80"
          value={q}
          onChange={setQ}
          placeholder="Search actor, target, action, or details…"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "admin", "manager", "student"] as const).map((r) => (
              <FilterChip
                key={r}
                aiId={`audit-role-${r}-chip`}
                active={roleFilter === r}
                onClick={() => setRoleFilter(r)}
              >
                {r === "all" ? "All roles" : r[0]!.toUpperCase() + r.slice(1)}
              </FilterChip>
            ))}
          </div>
          <select
            aria-label="Filter by action"
            data-ai-id="audit-action-select"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="k-input h-9 w-auto min-w-[160px] text-xs"
          >
            {actions.map((act) => (
              <option key={act} value={act}>
                {act === "all" ? "All actions" : act.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TableShell>
        {rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No audit events match" body="Adjust your search query or filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Details</th>
                  <th className="text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const Icon = AUDIT_ICON[a.action] ?? ScrollText;
                  const tone = a.action.startsWith("VOID") || a.action.startsWith("DELETE") || a.action === "REVOKE_REPORT"
                    ? "debit"
                    : a.action === "CREATE_ENTRY" || a.action === "BULK_POST"
                      ? "credit"
                      : "info";
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                            <Icon className="size-4" />
                          </span>
                          <Chip tone={tone}>{a.action.replace(/_/g, " ")}</Chip>
                        </div>
                      </td>
                      <td>
                        <div className="font-medium text-foreground">{a.actor}</div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{a.role}</div>
                      </td>
                      <td className="font-medium text-foreground">{a.target}</td>
                      <td className="max-w-xs truncate text-muted-foreground">{a.details}</td>
                      <td className="text-right text-xs text-muted-foreground">{timeAgo(a.at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ScrollLoadFooter
          idPrefix="audit"
          visibleCount={visibleCount}
          totalCount={totalCount}
          hasMore={hasMore}
          onLoadMore={loadMore}
          sentinelRef={sentinelRef}
          label="events"
        />
      </TableShell>
    </div>
  );
}
