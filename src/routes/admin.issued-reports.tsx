import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarPlus, Copy, Download, ExternalLink, FileCheck, ShieldOff } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { KDialog } from "@/components/khazna/overlays";
import { Chip, EmptyState, FilterChip, PageHeader, ScrollLoadFooter, SearchInput, TableShell, useProgressiveSlice } from "@/components/khazna/primitives";
import { formatDate } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";
import type { ReportExport } from "@/lib/khazna/types";

export const Route = createFileRoute("/admin/issued-reports")({
  head: () => ({
    meta: [
      { title: "Issued Reports — Khazna" },
      { name: "description", content: "Manage issued QR-verified PDF statements, expiry, and revocation." },
    ],
  }),
  component: IssuedReportsPage,
});

function reportStatus(r: ReportExport): "active" | "revoked" | "expired" {
  if (r.revoked_at) return "revoked";
  if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

function IssuedReportsPage() {
  const reports = useKhazna((s) => s.reportExports);
  const revokeReportExport = useKhazna((s) => s.revokeReportExport);
  const extendReportExport = useKhazna((s) => s.extendReportExport);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked" | "expired">("all");
  const [revoking, setRevoking] = useState<ReportExport | null>(null);
  const [revokeReason, setRevokeReason] = useState("Superseded by revised statement");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return reports.filter((r) => {
      const st = reportStatus(r);
      if (statusFilter !== "all" && st !== statusFilter) return false;
      if (!term) return true;
      return (
        r.ref.toLowerCase().includes(term) ||
        r.sector_id.toLowerCase().includes(term) ||
        r.sector_name.toLowerCase().includes(term) ||
        (r.class_name || "").toLowerCase().includes(term) ||
        r.issued_by.toLowerCase().includes(term)
      );
    });
  }, [reports, q, statusFilter]);

  const {
    visibleItems: visibleReports,
    visibleCount,
    totalCount,
    hasMore,
    loadMore,
    sentinelRef,
  } = useProgressiveSlice(filtered, 15, `${q}|${statusFilter}`);

  const copyVerifyLink = (token: string) => {
    const url = `${window.location.origin}/v/${token}`;
    void navigator.clipboard?.writeText(url);
    toast.success("Copied verification link", { description: `/v/${token}` });
  };

  const downloadPdf = (r: ReportExport) => {
    if (!r.pdf_base64) {
      toast.error("PDF bytes are not cached for this report");
      return;
    }
    const a = document.createElement("a");
    a.href = r.pdf_base64;
    a.download = `${r.ref}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`Downloaded ${r.ref}.pdf`);
  };

  const confirmRevoke = () => {
    if (!revoking) return;
    revokeReportExport(revoking.id, revokeReason.trim() || "Revoked by Admin");
    toast.success(`Revoked verification for ${revoking.ref}`);
    setRevoking(null);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Issued Reports"
        description="Registry of QR-signed official PDF reports. Verify authenticity, extend validity, or revoke compromised exports."
      />

      <div className="glass mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          aiId="issued-reports-search-input"
          className="lg:w-80"
          value={q}
          onChange={setQ}
          placeholder="Search reference, sector, class, or issuer…"
        />
        <div className="flex flex-wrap gap-1.5">
          {(["all", "active", "revoked", "expired"] as const).map((st) => (
            <FilterChip
              key={st}
              aiId={`issued-reports-filter-${st}-chip`}
              active={statusFilter === st}
              onClick={() => setStatusFilter(st)}
            >
              {st[0]!.toUpperCase() + st.slice(1)}
            </FilterChip>
          ))}
        </div>
      </div>

      <TableShell>
        {filtered.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title={reports.length === 0 ? "No verified PDFs issued yet" : "No reports match"}
            body={
              reports.length === 0
                ? "Export a class report PDF with QR verification enabled from any sector's Class Reports page."
                : "Try adjusting your search or status filter."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Scope</th>
                  <th>Period</th>
                  <th>Issuer</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleReports.map((r) => {
                  const st = reportStatus(r);
                  return (
                    <tr key={r.id}>
                      <td className="font-mono font-semibold text-foreground">{r.ref}</td>
                      <td>
                        <div className="text-foreground">{r.sector_name || r.sector_id}</div>
                        <div className="text-xs text-muted-foreground">{r.class_name || "All Classes"}</div>
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {formatDate(r.date_from)} – {formatDate(r.date_to)}
                      </td>
                      <td className="text-sm text-foreground">{r.issued_by}</td>
                      <td>
                        <Chip tone={st === "active" ? "credit" : st === "revoked" ? "debit" : "neutral"}>
                          {st}
                        </Chip>
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Btn
                            variant="ghost"
                            size="sm"
                            data-ai-id={`report-download-${r.id}`}
                            onClick={() => downloadPdf(r)}
                            title="Re-download PDF"
                          >
                            <Download className="size-3.5" />
                          </Btn>
                          <Btn
                            variant="ghost"
                            size="sm"
                            data-ai-id={`report-copy-${r.id}`}
                            onClick={() => copyVerifyLink(r.token)}
                            title="Copy QR verification URL"
                          >
                            <Copy className="size-3.5" />
                          </Btn>
                          <Btn asChild variant="ghost" size="sm" title="Open public verification page">
                            <Link to="/v/$token" params={{ token: r.token }} data-ai-id={`report-verify-link-${r.id}`}>
                              <ExternalLink className="size-3.5" />
                            </Link>
                          </Btn>
                          {st !== "revoked" && (
                            <>
                              <Btn
                                variant="ghost"
                                size="sm"
                                data-ai-id={`report-extend-${r.id}`}
                                onClick={() => {
                                  const next = new Date(Date.now() + 90 * 86400_000).toISOString();
                                  extendReportExport(r.id, next);
                                  toast.success(`Extended ${r.ref} validity by 90 days`);
                                }}
                                title="Extend validity (+90 days)"
                              >
                                <CalendarPlus className="size-3.5 text-info" />
                              </Btn>
                              <Btn
                                variant="ghost"
                                size="sm"
                                data-ai-id={`report-revoke-${r.id}`}
                                data-sensitive="true"
                                onClick={() => setRevoking(r)}
                                title="Revoke verification"
                              >
                                <ShieldOff className="size-3.5 text-debit" />
                              </Btn>
                            </>
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
          idPrefix="issued-reports"
          visibleCount={visibleCount}
          totalCount={totalCount}
          hasMore={hasMore}
          onLoadMore={loadMore}
          sentinelRef={sentinelRef}
          label="reports"
        />
      </TableShell>

      <KDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke QR verification"
        description={revoking ? `Verification links for ${revoking.ref} will show as unavailable.` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setRevoking(null)}>Cancel</Btn>
            <Btn variant="danger" data-ai-id="confirm-revoke-report-btn" onClick={confirmRevoke}>
              Revoke report
            </Btn>
          </>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Reason for revocation</span>
          <input
            value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)}
            className="k-input"
            placeholder="e.g. Superseded by updated entry"
          />
        </label>
      </KDialog>
    </div>
  );
}
