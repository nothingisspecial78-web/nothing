import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { safeSessionGet, safeSessionRemove } from "@/lib/safeStorage";
import {
  ShieldCheck,
  Building2,
  Users,
  Coins,
  Receipt,
  LogOut,
  KeyRound,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
} from "lucide-react";

interface OrgSummary {
  id: string;
  name: string;
  adminEmail: string;
  studentCount: number;
  managerCount: number;
  sectorCount: number;
  balance: number;
  isDemo?: boolean;
}

interface PlatformAnalytics {
  organizationCount: number;
  totalStudents: number;
  totalSectors: number;
  totalTransactions: number;
  totalVolume: number;
  systemHealth: string;
}

interface AuditLog {
  id: string;
  adminId: string;
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export function SuperAdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Selected Org Drill Down
  const [selectedOrg, setSelectedOrg] = useState<{ org: OrgSummary; sectors: any[] } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Change Password Modal
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);

  const token = safeSessionGet("khazna_super_admin_token");
  const user = (() => {
    try {
      return JSON.parse(safeSessionGet("khazna_super_admin_user") || "{}");
    } catch {
      return {};
    }
  })();

  const handleLogout = async () => {
    try {
      if (token) {
        await fetch("/api/super-admin/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // ignore
    } finally {
      safeSessionRemove("khazna_super_admin_token");
      safeSessionRemove("khazna_super_admin_user");
      navigate({ to: "/super-admin/login" as any });
    }
  };

  const fetchData = async () => {
    if (!token) {
      navigate({ to: "/super-admin/login" as any });
      return;
    }

    try {
      setError(null);
      const headers = { Authorization: `Bearer ${token}` };

      const [resAnalytics, resOrgs, resLogs] = await Promise.all([
        fetch("/api/super-admin/analytics", { headers }),
        fetch("/api/super-admin/organizations", { headers }),
        fetch("/api/super-admin/audit-logs", { headers }),
      ]);

      if (resAnalytics.status === 401 || resAnalytics.status === 403) {
        handleLogout();
        return;
      }

      const dataAnalytics = await resAnalytics.json();
      const dataOrgs = await resOrgs.json();
      const dataLogs = await resLogs.json();

      if (dataAnalytics.ok) setAnalytics(dataAnalytics.analytics);
      if (dataOrgs.ok) setOrgs(dataOrgs.organizations);
      if (dataLogs.ok) setAuditLogs(dataLogs.auditLogs || []);
    } catch (err: any) {
      setError(err.message || "Failed to load platform data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDrillDown = async (orgId: string) => {
    setDrillLoading(true);
    try {
      const res = await fetch(`/api/super-admin/organizations/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setSelectedOrg({ org: data.organization, sectors: data.sectors || [] });
      }
    } catch (e: any) {
      setError("Failed to load organization details: " + (e?.message || "Unknown error"));
    } finally {
      setDrillLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    if (newPwd.length < 12) {
      setPwdMsg({ type: "error", text: "New password must be at least 12 characters long." });
      return;
    }
    setPwdLoading(true);
    try {
      const res = await fetch("/api/super-admin/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to change password.");
      }
      setPwdMsg({ type: "success", text: "Password changed successfully!" });
      setCurrentPwd("");
      setNewPwd("");
      setTimeout(() => setPwdModalOpen(false), 1500);
    } catch (err: any) {
      setPwdMsg({ type: "error", text: err.message });
    } finally {
      setPwdLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 text-amber-500 animate-spin" />
          <p className="text-sm text-neutral-400">Loading Super Admin Platform...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 bg-neutral-900/90 backdrop-blur-md border-b border-white/10 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">Khazna Platform</span>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                Super Admin
              </span>
            </div>
            <span className="text-xs text-neutral-400">Cross-Organization Management</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            data-ai-id="super-admin-refresh-btn"
            aria-label="Refresh platform data"
            onClick={() => {
              setRefreshing(true);
              fetchData();
            }}
            disabled={refreshing}
            className="p-2 text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
          </button>

          <button
            data-ai-id="super-admin-change-pwd-btn"
            onClick={() => setPwdModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
          >
            <KeyRound className="size-3.5" />
            <span className="hidden sm:inline">Change Password</span>
          </button>

          <div className="h-5 w-px bg-white/10 mx-1" />

          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium text-white">{user.email || "superadmin"}</p>
            <p className="text-[10px] text-neutral-400">Platform Owner</p>
          </div>

          <button
            data-ai-id="super-admin-logout-btn"
            data-sensitive="true"
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="size-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* KPI Summary Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-neutral-900/60 border border-white/10 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase font-medium">Organizations</span>
              <Building2 className="size-4 text-amber-400" />
            </div>
            <div className="text-3xl font-bold text-white tracking-tight">
              {analytics?.organizationCount ?? orgs.length}
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">Tenant colleges on platform</p>
          </div>

          <div className="bg-neutral-900/60 border border-white/10 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase font-medium">Total Students</span>
              <Users className="size-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-bold text-white tracking-tight">
              {analytics?.totalStudents ?? orgs.reduce((acc, o) => acc + o.studentCount, 0)}
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">Enrolled across all tenants</p>
          </div>

          <div className="bg-neutral-900/60 border border-white/10 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase font-medium">Platform Volume</span>
              <Coins className="size-4 text-sky-400" />
            </div>
            <div className="text-3xl font-bold text-white tracking-tight">
              ₹{Number((analytics?.totalVolume ?? orgs.reduce((acc, o) => acc + (o.balance || 0), 0)) || 0).toLocaleString("en-IN")}
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">Total managed campus funds</p>
          </div>

          <div className="bg-neutral-900/60 border border-white/10 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase font-medium">System Health</span>
              <Receipt className="size-4 text-indigo-400" />
            </div>
            <div className="text-xl font-bold text-emerald-400 tracking-tight mt-1 flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              {analytics?.systemHealth || "100% Operational"}
            </div>
            <p className="text-[11px] text-neutral-400 mt-2">
              {analytics?.totalTransactions || 0} ledger transactions
            </p>
          </div>
        </section>

        {/* Organizations Table */}
        <section className="bg-neutral-900/60 border border-white/10 rounded-2xl overflow-hidden shadow-lg">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Managed Organizations</h2>
              <p className="text-xs text-neutral-400">All tenant institutions isolated within the platform</p>
            </div>
            <span className="text-xs text-neutral-400 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
              {orgs.length} Total
            </span>
          </div>

          <div className="overflow-x-auto" data-guide-id="super-admin-orgs-table">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-neutral-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Organization</th>
                  <th className="px-6 py-3">Admin Email</th>
                  <th className="px-6 py-3 text-center">Students</th>
                  <th className="px-6 py-3 text-center">Sectors</th>
                  <th className="px-6 py-3 text-right">Balance</th>
                  <th className="px-6 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {orgs.map((org) => (
                  <tr key={org.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 font-medium text-white flex items-center gap-2.5">
                      <div className="size-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-primary">
                        <Building2 className="size-4" />
                      </div>
                      <div>
                        <div>{org.name}</div>
                        <div className="text-[11px] text-neutral-500 font-mono">ID: {org.id}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-neutral-300 text-xs font-mono">{org.adminEmail}</td>
                    <td className="px-6 py-4 text-center font-semibold text-neutral-200">
                      {org.studentCount}
                    </td>
                    <td className="px-6 py-4 text-center text-neutral-300">{org.sectorCount}</td>
                    <td className="px-6 py-4 text-right font-medium text-emerald-400">
                      ₹{Number(org.balance || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        data-ai-id={`super-admin-drilldown-btn-${org.id}`}
                        onClick={() => handleDrillDown(org.id)}
                        className="px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/20 rounded-lg transition-colors inline-flex items-center gap-1"
                      >
                        <span>Drill Down</span>
                        <ChevronRight className="size-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Platform Audit Logs Table */}
        <section className="bg-neutral-900/60 border border-white/10 rounded-2xl overflow-hidden shadow-lg">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Platform Super Admin Audit Logs</h2>
              <p className="text-xs text-neutral-400">Immutable security logs for platform administrative actions</p>
            </div>
            <span className="text-xs text-neutral-400 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
              {auditLogs.length} Events
            </span>
          </div>

          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-neutral-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-6 py-2.5">Timestamp</th>
                  <th className="px-6 py-2.5">Admin ID</th>
                  <th className="px-6 py-2.5">Action</th>
                  <th className="px-6 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-6 text-center text-neutral-500">
                      No super admin actions recorded yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02]">
                      <td className="px-6 py-3 text-neutral-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-3 text-amber-400">{log.adminId}</td>
                      <td className="px-6 py-3 font-semibold text-white">
                        <span className="px-2 py-0.5 rounded bg-white/10 text-neutral-200">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-neutral-300 truncate max-w-md">
                        {JSON.stringify(log.details)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Drill-down Modal */}
      {selectedOrg && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/10 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">{selectedOrg.org.name}</h3>
                <p className="text-xs text-neutral-400 font-mono">Tenant ID: {selectedOrg.org.id}</p>
              </div>
              <button
                data-ai-id="super-admin-drilldown-x-btn"
                aria-label="Close organization details"
                onClick={() => setSelectedOrg(null)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 py-2 text-center">
              <div className="bg-white/5 p-3 rounded-xl">
                <div className="text-xs text-neutral-400">Students</div>
                <div className="text-xl font-bold text-white mt-1">{selectedOrg.org.studentCount}</div>
              </div>
              <div className="bg-white/5 p-3 rounded-xl">
                <div className="text-xs text-neutral-400">Sectors</div>
                <div className="text-xl font-bold text-white mt-1">{selectedOrg.org.sectorCount}</div>
              </div>
              <div className="bg-white/5 p-3 rounded-xl">
                <div className="text-xs text-neutral-400">Ledger Balance</div>
                <div className="text-xl font-bold text-emerald-400 mt-1">
                  ₹{Number(selectedOrg.org.balance || 0).toLocaleString("en-IN")}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                Active Sectors
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {selectedOrg.sectors.length === 0 ? (
                  <p className="text-xs text-neutral-500 italic">No sectors registered in this organization.</p>
                ) : (
                  selectedOrg.sectors.map((s: any) => (
                    <div
                      key={s.id || s.slug}
                      className="p-3 bg-white/5 border border-white/5 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white">{s.name}</span>
                        <span className="text-neutral-500 font-mono ml-2">({s.code || s.slug})</span>
                      </div>
                      <span className="text-neutral-300 font-mono">
                        Target: ₹{Number(s.target || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                data-ai-id="super-admin-drilldown-close-btn"
                onClick={() => setSelectedOrg(null)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {pwdModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <KeyRound className="size-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Change Super Admin Password</h3>
              </div>
              <button
                data-ai-id="super-admin-pwd-x-btn"
                aria-label="Close password modal"
                onClick={() => setPwdModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5"
              >
                <X className="size-4" />
              </button>
            </div>

            {pwdMsg && (
              <div
                className={`mb-4 p-3 rounded-xl text-xs flex items-center gap-2 ${
                  pwdMsg.type === "success"
                    ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border border-red-500/30 text-red-400"
                }`}
              >
                {pwdMsg.type === "success" ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <AlertCircle className="size-4 shrink-0" />
                )}
                <span>{pwdMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  aria-label="Current Password"
                  data-ai-id="super-admin-current-pwd-input"
                  data-sensitive="true"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full px-3.5 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">
                  New Password (at least 12 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={12}
                  aria-label="New Password"
                  data-ai-id="super-admin-new-pwd-input"
                  data-sensitive="true"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="Enter new strong password"
                  className="w-full px-3.5 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  data-ai-id="super-admin-pwd-cancel-btn"
                  onClick={() => setPwdModalOpen(false)}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-neutral-300 rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-ai-id="super-admin-pwd-submit-btn"
                  data-sensitive="true"
                  disabled={pwdLoading}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {pwdLoading ? <Loader2 className="size-3.5 animate-spin" /> : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
