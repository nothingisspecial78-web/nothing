import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { safeSessionSet } from "@/lib/safeStorage";
import { ShieldCheck, Lock, Mail, ArrowRight, Loader2, AlertCircle } from "lucide-react";

export function SuperAdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/super-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to sign in as Platform Super Admin");
      }

      safeSessionSet("khazna_super_admin_token", data.token);
      safeSessionSet("khazna_super_admin_user", JSON.stringify(data.admin));
      navigate({ to: "/super-admin" as any });
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-black p-4 text-white">
      <div className="w-full max-w-md bg-neutral-900/95 border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/80">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="size-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-lg shadow-amber-500/10">
            <ShieldCheck className="size-8" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/90 mb-1">
            Platform Administration
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Super Admin Portal</h1>
          <p className="text-xs text-neutral-400 mt-1 max-w-xs">
            Multi-tenant control center, platform-wide audit logs, and global analytics.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2.5">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
              Super Admin Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-500" />
              <input
                type="email"
                required
                aria-label="Super Admin Email"
                data-ai-id="super-admin-email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="superadmin@khaznacampus.platform"
                className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/60 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-neutral-500" />
              <input
                type="password"
                required
                aria-label="Password"
                data-ai-id="super-admin-password-input"
                data-sensitive="true"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/60 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            data-ai-id="super-admin-login-submit-btn"
            data-sensitive="true"
            className="w-full mt-2 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-neutral-950 font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <span>Sign In to Platform</span>
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/10 text-center">
          <a
            href="/login"
            data-ai-id="super-admin-back-login-link"
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            ← Back to College Workspace Login
          </a>
        </div>
      </div>
    </div>
  );
}
