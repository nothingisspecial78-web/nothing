import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  Lock,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Route as RootRoute } from "./__root";
import { AppShell } from "@/components/khazna/AppShell";
import { ExpiryWarningBanner } from "@/components/khazna/ExpiryWarningBanner";
import { Chip, GlassCard, PageHeader, Segmented } from "@/components/khazna/primitives";
import { SafeButton } from "@/components/network/SafeButton";
import { openRazorpayCheckout } from "@/lib/khazna/razorpayCheckout";
import { downloadBillingReceiptPdf } from "@/lib/khazna/receiptPdf";
import { useKhazna } from "@/lib/khazna/store";
import type { Role } from "@/lib/khazna/types";
import { NetworkOfflineError, resilientFetch } from "@/lib/network/resilientFetch";
import { cn } from "@/lib/utils";

interface BillingStatusDto {
  orgId: string;
  plan: "free" | "premium";
  effectivePlan: "free" | "premium";
  planInterval: "monthly" | "annual" | null;
  status: "active" | "cancelled" | "expired";
  premiumStartedAt: string | null;
  premiumExpiresAt: string | null;
  daysUntilExpiry?: number | null;
  expiringSoon?: boolean;
  creditsRemaining: number;
  creditsMonthlyAllowance: number;
  periodStart: string;
  periodEnd: string;
  role: string;
  isAdmin: boolean;
  canUseAssistant: boolean;
  lockedReason: "UPGRADE_REQUIRED" | "CREDITS_EXHAUSTED" | null;
  devSwitchEnabled: boolean;
  razorpay?: {
    configured: boolean;
    testMode: boolean;
    liveKeyBlocked: boolean;
    webhookConfigured: boolean;
  };
  pricing: {
    currency: "INR";
    monthlyPrice: number;
    annualPrice: number;
    annualMonthlyEquivalent: number;
    annualSavingsPercent: number;
  };
  costs: Record<string, number>;
  persistence?: {
    backend: "supabase" | "memory";
    schemaReady: boolean;
    lastError?: string;
  };
}

interface UsageLogItem {
  id: string;
  orgId: string;
  userId: string;
  role: string;
  action: string;
  creditsUsed: number;
  timestamp: string;
  success: boolean;
  refunded?: boolean;
  errorReason?: string;
}

interface PaymentHistoryItem {
  id: string;
  orgId: string;
  userId: string;
  plan: "free" | "premium";
  interval: "monthly" | "annual";
  amount: number;
  amountPaise: number;
  currency: "INR";
  provider: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  method?: string | null;
  status: "created" | "paid" | "failed" | "refunded";
  errorReason?: string | null;
  createdAt: string;
  paidAt?: string | null;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/upgrade",
  component: UpgradePage,
});

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function buildDemoBillingToken(): string {
  const st = useKhazna.getState();
  const effectiveRole: Role =
    st.sessionLoginRole === "admin" && st.currentRole === "manager" ? "admin" : st.currentRole;
  const orgId = st.activeOrgId || "demo";
  if (effectiveRole === "student") {
    const sid = st.meStudentId || "S0125";
    return `demo:STUDENT:${sid}:dept-fiqh:${sid}:${orgId}`;
  }
  if (effectiveRole === "manager") {
    const sec = st.managerSector || "dept-fiqh";
    const mgr = st.managers?.find((m) => m.sectors?.includes(sec));
    const mgrId = mgr?.id || mgr?.email || sec;
    return `demo:SECTOR_MANAGER:${mgrId}:${sec}::${orgId}`;
  }
  const cleanEmail = (st.college.adminEmail || "admin@islahululoom.edu").trim().toLowerCase();
  return `demo:ADMIN:${cleanEmail}:::${orgId}`;
}

export function UpgradePage() {
  const activeOrgId = useKhazna((s) => s.activeOrgId);
  const college = useKhazna((s) => s.college);
  const institutionPhone = useKhazna((s) => s.institutionProfile.phone);
  const currentRole = useKhazna((s) => s.currentRole);
  const sessionLoginRole = useKhazna((s) => s.sessionLoginRole);
  const managerSector = useKhazna((s) => s.managerSector);

  const displayRole: Role = useMemo(
    () => (sessionLoginRole === "admin" && currentRole === "manager" ? "admin" : currentRole),
    [currentRole, sessionLoginRole]
  );

  const [interval, setInterval] = useState<"monthly" | "annual">("annual");
  const [status, setStatus] = useState<BillingStatusDto | null>(null);
  const [logs, setLogs] = useState<UsageLogItem[]>([]);
  const [payments, setPayments] = useState<PaymentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [checkoutBanner, setCheckoutBanner] = useState<{
    type: "success" | "error" | "cancelled";
    title: string;
    message: string;
    payment?: PaymentHistoryItem;
  } | null>(null);

  const fetchBilling = useCallback(async () => {
    try {
      const token = buildDemoBillingToken();
      const headers = {
        Authorization: token,
        "x-app-id": "khazna-ledger",
      };
      const statusRes = await resilientFetch(
        `/api/assistant/billing/status?orgId=${encodeURIComponent(activeOrgId)}`,
        { headers, maxRetries: 2, timeoutMs: 8000 }
      );
      if (statusRes.ok) {
        const sData = (await statusRes.json()) as BillingStatusDto;
        setStatus(sData);
        if (sData.planInterval) {
          setInterval(sData.planInterval);
        }
        if (sData.isAdmin) {
          const [usageRes, historyRes] = await Promise.all([
            resilientFetch(
              `/api/assistant/billing/usage?orgId=${encodeURIComponent(activeOrgId)}&limit=30`,
              { headers, maxRetries: 1, timeoutMs: 8000 }
            ),
            resilientFetch(
              `/api/payments/history?orgId=${encodeURIComponent(activeOrgId)}`,
              { headers, maxRetries: 1, timeoutMs: 8000 }
            ),
          ]);
          if (usageRes.ok) {
            const uData = (await usageRes.json()) as { logs?: UsageLogItem[] };
            setLogs(Array.isArray(uData.logs) ? uData.logs : []);
          }
          if (historyRes.ok) {
            const hData = (await historyRes.json()) as { payments?: PaymentHistoryItem[] };
            setPayments(Array.isArray(hData.payments) ? hData.payments : []);
          }
        } else {
          setLogs([]);
          setPayments([]);
        }
      }
    } catch {
      // keep existing UI state on transient error
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    setLoading(true);
    void fetchBilling();
  }, [fetchBilling, currentRole, sessionLoginRole]);

  useEffect(() => {
    const onRefresh = () => void fetchBilling();
    window.addEventListener("aia:billing-refresh", onRefresh);
    return () => window.removeEventListener("aia:billing-refresh", onRefresh);
  }, [fetchBilling]);

  const notifyWidgetRefresh = () => {
    window.dispatchEvent(new CustomEvent("aia:billing-refresh"));
  };

  const startRazorpayCheckout = async (targetInterval: "monthly" | "annual" = interval) => {
    setBusyAction(`checkout:${targetInterval}`);
    setCheckoutBanner(null);

    try {
      const token = buildDemoBillingToken();
      const idempotencyKey = `ord_${activeOrgId}_${targetInterval}_${Date.now().toString(36)}`;
      const orderRes = await resilientFetch("/api/payments/create-order", {
        method: "POST",
        maxRetries: 2,
        timeoutMs: 10_000,
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          "x-app-id": "khazna-ledger",
        },
        body: JSON.stringify({
          orgId: activeOrgId,
          plan: "premium",
          interval: targetInterval,
          idempotencyKey,
        }),
      });

      const orderJson = (await orderRes.json()) as {
        ok?: boolean;
        orderId?: string;
        amount?: number;
        amountInr?: number;
        currency?: "INR";
        keyId?: string;
        error?: string;
      };

      if (!orderRes.ok || !orderJson.orderId || !orderJson.keyId || !orderJson.amount) {
        const msg = orderJson.error || "Unable to create Razorpay checkout order.";
        setCheckoutBanner({
          type: "error",
          title: "Checkout could not start",
          message: msg,
        });
        toast.error(msg);
        return;
      }

      const outcome = await openRazorpayCheckout({
        keyId: orderJson.keyId,
        orderId: orderJson.orderId,
        amountPaise: orderJson.amount,
        currency: orderJson.currency || "INR",
        appName: "Khazna AI",
        description: `${college.name} — Premium (${targetInterval === "annual" ? "Annual" : "Monthly"})`,
        prefill: {
          name: college.adminName || "College Admin",
          email: college.adminEmail || "admin@islahululoom.edu",
          contact: institutionPhone || "",
        },
        notes: {
          orgId: activeOrgId,
          plan: "premium",
          interval: targetInterval,
        },
      });

      if (outcome.status === "dismissed") {
        setCheckoutBanner({
          type: "cancelled",
          title: "Payment cancelled",
          message: "No amount was charged and your plan remains unchanged. You can retry anytime.",
        });
        toast("Payment checkout closed");
        await fetchBilling();
        return;
      }

      if (outcome.status === "failed") {
        void resilientFetch("/api/payments/record-failure", {
          method: "POST",
          maxRetries: 1,
          headers: {
            "Content-Type": "application/json",
            Authorization: token,
            "x-app-id": "khazna-ledger",
          },
          body: JSON.stringify({
            orgId: activeOrgId,
            razorpay_order_id: outcome.orderId || orderJson.orderId,
            razorpay_payment_id: outcome.paymentId,
            reason: outcome.reason,
          }),
        }).catch(() => {});

        setCheckoutBanner({
          type: "error",
          title: "Payment failed",
          message: `${outcome.reason}. Nothing was activated — please retry with UPI QR, card, or another method.`,
        });
        toast.error(outcome.reason);
        await fetchBilling();
        return;
      }

      // Verify signature & confirm payment status on server
      setBusyAction("verifying");
      const verifyRes = await resilientFetch("/api/payments/verify", {
        method: "POST",
        maxRetries: 3,
        timeoutMs: 12_000,
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          "x-app-id": "khazna-ledger",
        },
        body: JSON.stringify({
          orgId: activeOrgId,
          razorpay_order_id: outcome.payload.razorpay_order_id,
          razorpay_payment_id: outcome.payload.razorpay_payment_id,
          razorpay_signature: outcome.payload.razorpay_signature,
        }),
      });

      const verifyJson = (await verifyRes.json()) as {
        ok?: boolean;
        error?: string;
        extended?: boolean;
        payment?: PaymentHistoryItem;
        status?: BillingStatusDto;
      };

      if (!verifyRes.ok || !verifyJson.ok) {
        const msg =
          verifyJson.error || "Payment verification failed on server. Please contact support.";
        setCheckoutBanner({
          type: "error",
          title: "Verification failed",
          message: msg,
        });
        toast.error(msg);
        await fetchBilling();
        return;
      }

      if (verifyJson.status) {
        setStatus(verifyJson.status);
      }

      const activeUntil = formatShortDate(verifyJson.status?.premiumExpiresAt);
      setCheckoutBanner({
        type: "success",
        title: `Premium active until ${activeUntil}`,
        message: verifyJson.extended
          ? `Your Premium plan has been extended for ${college.name}. Assistant access remains unlimited for all managers and students.`
          : `All sector managers and students at ${college.name} now have unlimited AI Assistant access.`,
        payment: verifyJson.payment,
      });

      toast.success(`Premium active until ${activeUntil}`);
      notifyWidgetRefresh();
      await fetchBilling();
    } catch (err) {
      const msg =
        err instanceof NetworkOfflineError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to complete Razorpay checkout.";
      setCheckoutBanner({
        type: "error",
        title: "Payment could not be completed",
        message: msg,
      });
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancel = async () => {
    setBusyAction("cancel");
    try {
      const res = await resilientFetch("/api/assistant/billing/cancel", {
        method: "POST",
        maxRetries: 2,
        headers: {
          "Content-Type": "application/json",
          Authorization: buildDemoBillingToken(),
          "x-app-id": "khazna-ledger",
        },
        body: JSON.stringify({ orgId: activeOrgId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; status?: BillingStatusDto };
      if (!res.ok) {
        toast.error(json.error || "Unable to cancel subscription");
        return;
      }
      if (json.status) setStatus(json.status);
      setCheckoutBanner(null);
      toast.success("Cancelled Premium — organization returned to Free rules immediately");
      notifyWidgetRefresh();
      await fetchBilling();
    } catch {
      toast.error("Failed to cancel subscription");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDevSwitch = async (opts: {
    plan: "free" | "premium";
    interval?: "monthly" | "annual";
    creditsRemaining?: number;
    expiresAt?: string;
  }) => {
    setBusyAction(`dev:${opts.plan}:${opts.creditsRemaining ?? ""}:${opts.expiresAt ? "exp" : ""}`);
    try {
      const res = await resilientFetch("/api/assistant/billing/dev-switch", {
        method: "POST",
        maxRetries: 1,
        headers: {
          "Content-Type": "application/json",
          Authorization: buildDemoBillingToken(),
          "x-app-id": "khazna-ledger",
        },
        body: JSON.stringify({ orgId: activeOrgId, ...opts }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; status?: BillingStatusDto };
      if (!res.ok) {
        toast.error(json.error || "Dev switch failed");
        return;
      }
      if (json.status) setStatus(json.status);
      toast.success(
        opts.plan === "premium"
          ? `Switched organization to Premium (${opts.interval || "monthly"})`
          : `Switched organization to Free (${opts.creditsRemaining ?? 100} credits)`
      );
      notifyWidgetRefresh();
      await fetchBilling();
    } catch {
      toast.error("Failed to switch test plan");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadReceipt = async (payment: PaymentHistoryItem) => {
    await downloadBillingReceiptPdf({
      receiptNumber: `INV-${(payment.razorpayPaymentId || payment.razorpayOrderId).slice(-8).toUpperCase()}`,
      organizationName: college.name,
      orgId: activeOrgId,
      adminEmail: college.adminEmail || "admin@islahululoom.edu",
      planLabel: "Khazna AI Organization Premium",
      interval: payment.interval,
      amountInr: payment.amount,
      currency: payment.currency,
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId,
      method: payment.method,
      status: payment.status,
      paidAt: payment.paidAt || payment.createdAt,
      expiresAt: status?.premiumExpiresAt,
      testMode: status?.razorpay?.testMode ?? true,
    });
    toast.success("Downloaded PDF payment receipt");
  };

  const isPremium = status?.effectivePlan === "premium";
  const isAdmin = Boolean(status?.isAdmin ?? displayRole === "admin");
  const pricing = status?.pricing || {
    currency: "INR" as const,
    monthlyPrice: 999,
    annualPrice: 9590,
    annualMonthlyEquivalent: 799,
    annualSavingsPercent: 20,
  };
  const allowance = status?.creditsMonthlyAllowance || 100;
  const remaining = status?.creditsRemaining ?? 100;
  const pct = Math.max(0, Math.min(100, Math.round((remaining / Math.max(1, allowance)) * 100)));
  const testMode = status?.razorpay?.testMode ?? true;
  const liveKeyBlocked = Boolean(status?.razorpay?.liveKeyBlocked);

  return (
    <AppShell role={displayRole} sectorSlug={managerSector}>
      <PageHeader
        eyebrow="Organization Plan & AI Credits"
        title="Upgrade Khazna AI for Your Campus"
        description={`Credits and plan access apply across ${college.name} (${activeOrgId}). Free includes 100 monthly credits for Admin only; Premium unlocks unlimited credits for every sector manager and student.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {testMode && (
              <Chip
                tone="info"
                icon={ShieldAlert}
                data-testid="razorpay-test-mode-badge"
              >
                TEST MODE
              </Chip>
            )}
            <Chip
              tone={isPremium ? "credit" : remaining === 0 ? "debit" : "primary"}
              icon={Sparkles}
              data-testid="upgrade-plan-status-pill"
            >
              {isPremium ? "Premium · Unlimited" : `Free · ${remaining} / ${allowance} credits`}
            </Chip>
          </div>
        }
      />

      {liveKeyBlocked && isAdmin && (
        <GlassCard className="mb-5 border-debit/40 bg-debit/10 p-4" data-testid="live-key-blocked-warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 text-debit" />
            <div>
              <div className="text-sm font-semibold text-foreground">
                Live Razorpay key refused in TEST MODE
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A <span className="font-mono">rzp_live_</span> key was detected while TEST MODE is enabled. Switch to an{" "}
                <span className="font-mono">rzp_test_</span> key in server environment variables to process test checkouts.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      <ExpiryWarningBanner onRenewClick={(iv) => void startRazorpayCheckout(iv)} />

      {checkoutBanner && (
        <GlassCard
          className={cn(
            "mb-6 p-5",
            checkoutBanner.type === "success" && "border-credit/40 bg-credit/10",
            checkoutBanner.type === "error" && "border-debit/40 bg-debit/10",
            checkoutBanner.type === "cancelled" && "border-amber-500/40 bg-amber-500/10"
          )}
          data-testid={
            checkoutBanner.type === "success"
              ? "payment-success-banner"
              : "payment-error-banner"
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {checkoutBanner.type === "success" ? (
                <CheckCircle2 className="size-5 shrink-0 text-credit" />
              ) : (
                <AlertTriangle
                  className={cn(
                    "size-5 shrink-0",
                    checkoutBanner.type === "error" ? "text-debit" : "text-amber-500"
                  )}
                />
              )}
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {checkoutBanner.title}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{checkoutBanner.message}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {checkoutBanner.type === "success" && checkoutBanner.payment && (
                <SafeButton
                  size="sm"
                  variant="glass"
                  onClick={() => handleDownloadReceipt(checkoutBanner.payment!)}
                  data-testid="success-download-receipt-btn"
                >
                  <Download className="size-3.5" />
                  Receipt PDF
                </SafeButton>
              )}
              {checkoutBanner.type !== "success" && isAdmin && (
                <SafeButton
                  size="sm"
                  variant="primary"
                  disableWhenOffline
                  onClick={() => startRazorpayCheckout(interval)}
                  data-testid="retry-checkout-btn"
                >
                  <RefreshCw className="size-3.5" />
                  Try Again
                </SafeButton>
              )}
            </div>
          </div>
        </GlassCard>
      )}

      {!isAdmin && status && status.effectivePlan === "free" && (
        <GlassCard className="mb-6 border-primary/25 p-5" data-testid="upgrade-non-admin-notice">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary border border-primary/25">
                <Lock className="size-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  AI Assistant is available on the Premium plan. Ask your admin to upgrade.
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Only the organization Admin can manage subscriptions or use the assistant on the Free tier.
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Current Quota & Plan Summary */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <GlassCard className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Current Organization Quota
              </div>
              <div className="mt-1 flex items-center gap-2.5">
                <span className="font-display text-2xl font-semibold text-foreground">
                  {isPremium
                    ? `Premium (${status?.planInterval === "annual" ? "Annual" : "Monthly"})`
                    : "Free Plan"}
                </span>
                <Chip tone={isPremium ? "credit" : "neutral"}>
                  {status?.status === "cancelled"
                    ? "Cancelled"
                    : status?.status === "expired"
                      ? "Expired"
                      : "Active"}
                </Chip>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground" data-testid="upgrade-expiry-summary">
                {isPremium
                  ? `Unlimited AI queries, multimodal document inspection, and Excel imports active until ${formatShortDate(status?.premiumExpiresAt)}.`
                  : `Resets automatically to ${allowance} credits on ${formatShortDate(status?.periodEnd)} (no rollover).`}
              </p>
            </div>

            <div className="text-right">
              <div className="text-xs text-subtle">Shared Org Balance</div>
              <div className="font-display text-3xl font-semibold text-foreground num" data-testid="upgrade-credits-counter">
                {isPremium ? "Unlimited" : `${remaining} / ${allowance}`}
              </div>
            </div>
          </div>

          {!isPremium && (
            <div className="mt-4">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-accent">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    remaining === 0 ? "bg-debit" : remaining <= 20 ? "bg-amber-500" : "bg-gradient-primary"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {isPremium && isAdmin && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
              <SafeButton
                size="sm"
                variant="primary"
                disableWhenOffline
                isLoading={busyAction === `checkout:${status?.planInterval || "monthly"}`}
                loadingText="Opening Checkout…"
                onClick={() => startRazorpayCheckout(status?.planInterval || "monthly")}
                data-testid="billing-renew-extend-btn"
                data-ai-id="billing-renew-extend-btn"
              >
                <CalendarClock className="size-3.5" />
                Renew / Extend
              </SafeButton>
              {status?.planInterval === "monthly" && (
                <SafeButton
                  size="sm"
                  variant="soft"
                  disableWhenOffline
                  isLoading={busyAction === "checkout:annual"}
                  loadingText="Switching…"
                  onClick={() => startRazorpayCheckout("annual")}
                  data-testid="billing-switch-annual-btn"
                  data-ai-id="billing-switch-annual-btn"
                >
                  <Sparkles className="size-3.5" />
                  Switch to Annual (Save {pricing.annualSavingsPercent}%)
                </SafeButton>
              )}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
            <Zap className="size-3.5 text-primary" />
            Credit Costs (Free Plan)
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between text-foreground">
              <span>Normal question / chat</span>
              <span className="font-mono font-semibold">{status?.costs?.chat ?? 1} credit</span>
            </div>
            <div className="flex items-center justify-between text-foreground">
              <span>Data lookup / tool call</span>
              <span className="font-mono font-semibold">{status?.costs?.tool_call ?? 2} credits</span>
            </div>
            <div className="flex items-center justify-between text-foreground">
              <span>File / screenshot / Excel parse</span>
              <span className="font-mono font-semibold">{status?.costs?.attachment ?? 2} credits</span>
            </div>
            <div className="flex items-center justify-between text-foreground">
              <span>Export file generation</span>
              <span className="font-mono font-semibold">{status?.costs?.export ?? 2} credits</span>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Billing Interval Toggle */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Choose Your Organization Plan</h2>
          <p className="text-xs text-muted-foreground">
            Pay securely with UPI QR (GPay, PhonePe, Paytm), Cards, Netbanking or Wallets · save {pricing.annualSavingsPercent}% with annual billing.
          </p>
        </div>
        <Segmented
          idPrefix="billing-interval"
          value={interval}
          onChange={(v) => setInterval(v === "monthly" ? "monthly" : "annual")}
          options={[
            { value: "monthly", label: "Monthly", aiId: "billing-interval-monthly-btn" },
            {
              value: "annual",
              aiId: "billing-interval-annual-btn",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Annual
                  <span className="rounded-full bg-credit/15 px-1.5 py-0.5 text-[10px] font-semibold text-credit">
                    Save {pricing.annualSavingsPercent}%
                  </span>
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* Free vs Premium Plan Cards */}
      <div className="mb-6 grid gap-5 md:grid-cols-2">
        <GlassCard className={cn("flex flex-col justify-between p-6", !isPremium && "ring-1 ring-border")}>
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-muted-foreground" />
                <h3 className="font-display text-lg font-semibold text-foreground">Free</h3>
              </div>
              {!isPremium && <Chip tone="neutral">Current Plan</Chip>}
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="font-display text-3xl font-semibold text-foreground num">₹0</span>
              <span className="text-xs text-muted-foreground">/ month · per organization</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Starter allowance for campus Admins exploring AI reporting and CSV validation.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm text-foreground">
              <li className="flex items-center gap-2.5">
                <Check className="size-4 text-primary shrink-0" />
                <span>100 credits / calendar month (no rollover)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="size-4 text-primary shrink-0" />
                <span>Admin-only AI Assistant access</span>
              </li>
              <li className="flex items-center gap-2.5 text-muted-foreground">
                <Lock className="size-4 shrink-0" />
                <span>Sector managers, staff &amp; students locked</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 border-t border-hairline pt-4">
            {isPremium && isAdmin ? (
              <SafeButton
                variant="ghost"
                className="w-full"
                disabled={busyAction !== null}
                isLoading={busyAction === "cancel"}
                loadingText="Cancelling…"
                onClick={handleCancel}
                data-ai-id="billing-downgrade-cancel-btn"
              >
                Cancel Premium &amp; Return to Free
              </SafeButton>
            ) : (
              <div className="text-center text-xs font-medium text-muted-foreground">
                {!isPremium ? "Active on this workspace" : "Managed by organization Admin"}
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="flex flex-col justify-between border-primary/35 p-6 relative overflow-hidden">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h3 className="font-display text-lg font-semibold text-foreground">Premium</h3>
              </div>
              <Chip tone={isPremium ? "credit" : "primary"}>
                {isPremium ? "Active Plan" : "Recommended"}
              </Chip>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-3xl font-semibold text-foreground num" data-testid="premium-price-display">
                ₹{interval === "annual" ? pricing.annualMonthlyEquivalent : pricing.monthlyPrice}
              </span>
              <span className="text-xs text-muted-foreground">
                / month
                {interval === "annual" && ` (₹${pricing.annualPrice.toLocaleString("en-IN")}/yr)`}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Unlimited AI across your entire college — Admin, every Sector Manager, Staff, and Student.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm text-foreground">
              <li className="flex items-center gap-2.5">
                <Check className="size-4 text-credit shrink-0" />
                <span>Unlimited organization AI credits every month</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Users className="size-4 text-credit shrink-0" />
                <span>Unlocks AI Assistant for all managers, staff &amp; students</span>
              </li>
              <li className="flex items-center gap-2.5">
                <ShieldCheck className="size-4 text-credit shrink-0" />
                <span>Multimodal screenshots, PDFs, DOCX &amp; smart Excel imports</span>
              </li>
              <li className="flex items-center gap-2.5 text-xs text-muted-foreground pt-1">
                <QrCode className="size-4 text-primary shrink-0" />
                <span>Supports UPI QR (GPay, PhonePe, Paytm), Cards, Netbanking &amp; Wallets</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 border-t border-hairline pt-4 flex flex-col gap-2">
            {isAdmin ? (
              <>
                <SafeButton
                  variant="primary"
                  className="w-full"
                  disableWhenOffline
                  disabled={busyAction !== null || liveKeyBlocked}
                  isLoading={busyAction === `checkout:${interval}` || busyAction === "verifying"}
                  loadingText={
                    busyAction === "verifying" ? "Verifying payment…" : "Opening Razorpay…"
                  }
                  onClick={() => startRazorpayCheckout(interval)}
                  data-ai-id="billing-subscribe-btn"
                  data-testid="billing-subscribe-btn"
                >
                  {isPremium && status?.planInterval === interval
                    ? `Extend ${interval === "annual" ? "Annual" : "Monthly"} (+1 ${interval === "annual" ? "Year" : "Month"})`
                    : isPremium
                      ? `Switch to ${interval === "annual" ? "Annual" : "Monthly"} Premium`
                      : `Subscribe with Razorpay (₹${(interval === "annual" ? pricing.annualPrice : pricing.monthlyPrice).toLocaleString("en-IN")})`}
                </SafeButton>
                {isPremium && (
                  <SafeButton
                    variant="danger"
                    size="sm"
                    className="w-full"
                    disabled={busyAction !== null}
                    isLoading={busyAction === "cancel"}
                    loadingText="Cancelling…"
                    onClick={handleCancel}
                    data-ai-id="billing-cancel-btn"
                    data-testid="billing-cancel-btn"
                  >
                    Cancel Subscription
                  </SafeButton>
                )}
              </>
            ) : (
              <div className="rounded-xl bg-accent px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                Ask your campus Admin to upgrade to Premium.
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Admin Payment History & Invoices */}
      {isAdmin && (
        <GlassCard className="mb-6 overflow-hidden" data-testid="billing-payment-history">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ReceiptText className="size-4 text-primary" />
              Billing &amp; Payment History
              {testMode && <Chip tone="info" className="text-[10px]">TEST MODE</Chip>}
            </div>
            <span className="text-xs text-muted-foreground">
              {loading ? "Loading…" : `${payments.length} transaction(s)`}
            </span>
          </div>

          {payments.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              No Razorpay payments recorded yet for {college.name}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-accent/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 font-medium">Amount</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Payment ID</th>
                    <th className="px-4 py-2.5 font-medium text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {payments.map((row) => (
                    <tr key={row.id} className="hover:bg-accent/30">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatShortDate(row.paidAt || row.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-foreground capitalize">
                        Premium · {row.interval}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-foreground num">
                        ₹{row.amount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.status === "paid" ? (
                          <Chip tone="credit">Paid</Chip>
                        ) : row.status === "failed" ? (
                          <Chip tone="debit">Failed</Chip>
                        ) : row.status === "refunded" ? (
                          <Chip tone="info">Refunded</Chip>
                        ) : (
                          <Chip tone="neutral">Created</Chip>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {row.razorpayPaymentId || row.razorpayOrderId}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row.status === "paid" ? (
                          <SafeButton
                            size="sm"
                            variant="glass"
                            onClick={() => handleDownloadReceipt(row)}
                            data-testid={`download-receipt-${row.id}`}
                          >
                            <Download className="size-3.5" />
                            PDF
                          </SafeButton>
                        ) : (
                          <span className="text-[11px] text-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {/* Dev / Staging Plan Switcher */}
      {status?.devSwitchEnabled && isAdmin && (
        <GlassCard className="mb-6 p-5 border-dashed border-primary/35" data-testid="dev-plan-switcher">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Dev / Test Plan Switcher
              </div>
              <div className="text-xs text-muted-foreground">
                Instantly toggle this organization&apos;s plan, test 0-credit exhaustion, or preview 7-day expiry banners.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SafeButton
                size="sm"
                variant="glass"
                disabled={busyAction !== null}
                onClick={() => handleDevSwitch({ plan: "free", creditsRemaining: 100 })}
                data-ai-id="dev-switch-free-100"
              >
                Free (100 credits)
              </SafeButton>
              <SafeButton
                size="sm"
                variant="glass"
                disabled={busyAction !== null}
                onClick={() => handleDevSwitch({ plan: "free", creditsRemaining: 0 })}
                data-ai-id="dev-switch-free-0"
              >
                Free Exhausted (0 credits)
              </SafeButton>
              <SafeButton
                size="sm"
                variant="soft"
                disabled={busyAction !== null}
                onClick={() => handleDevSwitch({ plan: "premium", interval: "monthly" })}
                data-ai-id="dev-switch-premium-monthly"
              >
                Premium Monthly
              </SafeButton>
              <SafeButton
                size="sm"
                variant="soft"
                disabled={busyAction !== null}
                onClick={() => handleDevSwitch({ plan: "premium", interval: "annual" })}
                data-ai-id="dev-switch-premium-annual"
              >
                Premium Annual
              </SafeButton>
              <SafeButton
                size="sm"
                variant="glass"
                disabled={busyAction !== null}
                onClick={() =>
                  handleDevSwitch({
                    plan: "premium",
                    interval: "monthly",
                    expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
                  })
                }
                data-ai-id="dev-switch-expiring-soon"
                data-testid="dev-switch-expiring-soon"
              >
                Expiring in 3 Days
              </SafeButton>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Admin Recent Usage Log */}
      {isAdmin && (
        <GlassCard className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Clock className="size-4 text-primary" />
              Recent Organization AI Usage
              {status?.persistence && (
                <Chip
                  tone={status.persistence.schemaReady ? "credit" : "neutral"}
                  className="ml-1 text-[10px]"
                >
                  {status.persistence.schemaReady
                    ? "Supabase synced"
                    : status.persistence.backend === "supabase"
                      ? "DB migration pending"
                      : "Memory store"}
                </Chip>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{loading ? "Loading…" : `${logs.length} event(s)`}</span>
          </div>
          {status?.persistence?.backend === "supabase" && !status.persistence.schemaReady && (
            <div className="border-b border-hairline bg-amber-500/10 px-5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
              Supabase project connected, but billing tables are not created yet. Run{" "}
              <span className="font-mono font-semibold">packages/server/src/db/migrations/001_billing_credits.sql</span>{" "}
              in your Supabase SQL Editor to persist credits &amp; usage across restarts.
            </div>
          )}
          {logs.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              No AI usage events recorded yet in this session.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-accent/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Time</th>
                    <th className="px-4 py-2.5 font-medium">User / Role</th>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                    <th className="px-4 py-2.5 font-medium">Credits</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {logs.map((row) => (
                    <tr key={row.id} className="hover:bg-accent/30">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(row.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        <span className="font-medium">{row.userId}</span>{" "}
                        <span className="text-muted-foreground">({row.role})</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-foreground">{row.action}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-foreground num">
                        {row.creditsUsed}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.refunded ? (
                          <Chip tone="info">Refunded</Chip>
                        ) : row.success ? (
                          <Chip tone="credit">Charged</Chip>
                        ) : (
                          <Chip tone="debit">{row.errorReason || "Failed"}</Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}
    </AppShell>
  );
}
