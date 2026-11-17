import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { GlassCard } from '@/components/khazna/primitives';
import { SafeButton } from '@/components/network/SafeButton';
import { useKhazna } from '@/lib/khazna/store';
import { resilientFetch } from '@/lib/network/resilientFetch';

interface BillingExpiryState {
  effectivePlan: 'free' | 'premium';
  planInterval: 'monthly' | 'annual' | null;
  premiumExpiresAt: string | null;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  isAdmin: boolean;
}

export function ExpiryWarningBanner({
  onRenewClick,
}: {
  onRenewClick?: (interval: 'monthly' | 'annual') => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const activeOrgId = useKhazna((s) => s.activeOrgId);
  const adminEmail = useKhazna((s) => s.college.adminEmail);
  const currentRole = useKhazna((s) => s.currentRole);
  const sessionLoginRole = useKhazna((s) => s.sessionLoginRole);
  const isAdminSession =
    sessionLoginRole === 'admin' || currentRole === 'admin';

  const [state, setState] = useState<BillingExpiryState | null>(null);

  const load = useCallback(async () => {
    if (!isAdminSession) return;
    try {
      const cleanEmail = (adminEmail || 'admin@islahululoom.edu').trim().toLowerCase();
      const res = await resilientFetch(
        `/api/assistant/billing/status?orgId=${encodeURIComponent(activeOrgId || 'demo')}`,
        {
          maxRetries: 1,
          timeoutMs: 6000,
          headers: {
            Authorization: `demo:ADMIN:${cleanEmail}:::${activeOrgId || 'demo'}`,
            'x-app-id': 'khazna-ledger',
          },
        }
      );
      if (res.ok) {
        const json = (await res.json()) as BillingExpiryState;
        setState(json);
      }
    } catch {
      // ignore transient status polling error
    }
  }, [activeOrgId, adminEmail, isAdminSession]);

  useEffect(() => {
    void load();
    const onRefresh = () => void load();
    window.addEventListener('aia:billing-refresh', onRefresh);
    return () => window.removeEventListener('aia:billing-refresh', onRefresh);
  }, [load]);

  if (
    !isAdminSession ||
    !state ||
    state.effectivePlan !== 'premium' ||
    !state.expiringSoon ||
    state.daysUntilExpiry === null
  ) {
    return null;
  }

  const days = state.daysUntilExpiry;
  const interval = state.planInterval || 'monthly';

  return (
    <GlassCard
      className="mb-5 border-amber-500/40 bg-amber-500/10 p-4"
      data-testid="premium-expiry-warning-banner"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-amber-500/35 bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="size-4.5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {days <= 0
                ? 'Premium expires today'
                : `Premium expires in ${days} day${days === 1 ? '' : 's'}`}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Renew now to avoid interruption for sector managers and students. Extending adds to your remaining days.
            </p>
          </div>
        </div>
        <SafeButton
          variant="primary"
          size="sm"
          disableWhenOffline
          loadingText="Opening checkout…"
          data-testid="expiry-banner-renew-btn"
          data-ai-id="expiry-banner-renew-btn"
          onClick={() => {
            if (onRenewClick) {
              return onRenewClick(interval);
            }
            return navigate({ to: '/upgrade' });
          }}
        >
          <RefreshCw className="size-3.5" />
          Renew
        </SafeButton>
      </div>
    </GlassCard>
  );
}
