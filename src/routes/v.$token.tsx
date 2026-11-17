import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Building2, CheckCircle2, Download, FileCheck2, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { Btn } from "@/components/khazna/btn";
import { formatDate } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/v/$token")({
  head: () => ({
    meta: [
      { title: "Document Verification — Khazna" },
      { name: "description", content: "Public QR verification portal for Khazna Campus Ledger official reports." },
    ],
  }),
  component: VerifyReportPage,
});

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .map((p) => (p.length <= 2 ? `${p[0] ?? "*"}*` : `${p.slice(0, 2)}${"*".repeat(Math.min(4, p.length - 2))}`))
    .join(" ");
}

function VerifyReportPage() {
  const { token } = Route.useParams();
  const reportExports = useKhazna((s) => s.reportExports);
  const profile = useKhazna((s) => s.institutionProfile);
  const college = useKhazna((s) => s.college);

  const report = useMemo(
    () => reportExports.find((r) => r.token === token || r.ref === token),
    [reportExports, token]
  );

  const status = useMemo(() => {
    if (!report) return "unavailable" as const;
    if (report.revoked_at) return "revoked" as const;
    if (report.expires_at && new Date(report.expires_at).getTime() < Date.now()) return "expired" as const;
    return "valid" as const;
  }, [report]);

  const handleDownload = () => {
    if (!report?.pdf_base64) return;
    const link = document.createElement("a");
    link.href = report.pdf_base64;
    link.download = `${report.ref}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Official Document Verification
              </div>
              <h1 className="text-lg font-semibold text-foreground">{profile.name || college.name}</h1>
            </div>
          </div>
          <Link
            to="/login"
            data-ai-id="verify-portal-login-link"
            className="text-xs font-medium text-primary hover:underline"
          >
            Khazna Portal →
          </Link>
        </div>

        {status !== "valid" || !report ? (
          <div className="rounded-2xl border border-debit/25 bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-debit/10 text-debit">
              {status === "revoked" ? <ShieldAlert className="size-7" /> : <AlertCircle className="size-7" />}
            </div>
            <h2 className="text-xl font-semibold text-foreground">This document is not available.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {status === "revoked"
                ? `Reference ${report?.ref ?? token} has been revoked by the issuing institution.`
                : status === "expired"
                  ? `The verification window for ${report?.ref ?? token} has expired.`
                  : "No active official report matches this QR verification token."}
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-credit/30 bg-card p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-credit/15 text-credit">
                    <CheckCircle2 className="size-6" />
                  </div>
                  <div>
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-credit/15 px-2.5 py-0.5 text-xs font-semibold text-credit">
                      <FileCheck2 className="size-3.5" /> Authentic & Active
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">
                      Report Ref: <span className="font-mono">{report.ref}</span>
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Issued on {formatDate(report.issued_at.slice(0, 10))} by{" "}
                      {profile.verify_mask_names ? maskName(report.issued_by) : report.issued_by}
                    </p>
                  </div>
                </div>
                {report.pdf_base64 && (
                  <Btn data-ai-id="verify-download-pdf-btn" variant="primary" size="sm" onClick={handleDownload}>
                    <Download className="size-4" /> Download PDF
                  </Btn>
                )}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-accent/40 p-3">
                  <div className="text-[11px] text-muted-foreground">Sector</div>
                  <div className="mt-0.5 font-medium text-foreground">{report.sector_name || report.sector_id}</div>
                </div>
                <div className="rounded-xl border border-border bg-accent/40 p-3">
                  <div className="text-[11px] text-muted-foreground">Scope</div>
                  <div className="mt-0.5 font-medium text-foreground">{report.class_name || "All Classes"}</div>
                </div>
                <div className="rounded-xl border border-border bg-accent/40 p-3">
                  <div className="text-[11px] text-muted-foreground">Period</div>
                  <div className="mt-0.5 font-medium text-foreground">
                    {formatDate(report.date_from)} – {formatDate(report.date_to)}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-accent/40 p-3">
                  <div className="text-[11px] text-muted-foreground">Expiry</div>
                  <div className="mt-0.5 font-medium text-foreground">
                    {report.expires_at ? formatDate(report.expires_at.slice(0, 10)) : "Never"}
                  </div>
                </div>
              </div>
            </div>

            {report.pdf_base64 && (
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <iframe
                  title={`Verified PDF ${report.ref}`}
                  src={report.pdf_base64}
                  className="h-[640px] w-full bg-white"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
