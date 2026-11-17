import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Gauge, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useNetworkStore } from '@/lib/network/networkStore';
import { useOfflineQueue } from '@/lib/network/offlineQueue';
import { cn } from '@/lib/utils';

type IslandState = 'offline' | 'syncing' | 'slow' | 'synced' | 'connected' | null;

export function DynamicIsland() {
  const { isOnline, pendingCount, syncState, syncNow } = useOfflineQueue();
  const isSlowConnection = useNetworkStore((s) => s.isSlowConnection);
  const showConnected = useNetworkStore((s) => s.showConnected);
  const lastSyncedCount = useNetworkStore((s) => s.lastSyncedCount);

  let state: IslandState = null;
  if (!isOnline) {
    state = 'offline';
  } else if (syncState === 'syncing') {
    state = 'syncing';
  } else if (syncState === 'synced') {
    state = 'synced';
  } else if (isSlowConnection) {
    state = 'slow';
  } else if (showConnected) {
    state = 'connected';
  }

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-3 z-[120] flex justify-center px-4">
      <AnimatePresence mode="wait">
        {state && (
          <motion.div
            key={state}
            data-testid="dynamic-island"
            data-state={state}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.8 }}
            className={cn(
              'pointer-events-auto glass-strong flex items-center gap-2.5 rounded-full border px-4 py-2 shadow-[0_12px_36px_rgba(0,0,0,0.22)] backdrop-blur-xl',
              state === 'offline' && 'border-rose-500/45 bg-rose-950/85 text-rose-50 dark:bg-rose-950/90',
              state === 'slow' && 'border-amber-500/45 bg-amber-950/85 text-amber-50 dark:bg-amber-950/90',
              state === 'syncing' && 'border-primary/45 bg-slate-900/90 text-white',
              (state === 'synced' || state === 'connected') &&
                'border-emerald-500/45 bg-emerald-950/85 text-emerald-50 dark:bg-emerald-950/90'
            )}
          >
            {state === 'offline' && (
              <>
                <span className="relative flex size-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-rose-500" />
                </span>
                <WifiOff className="size-3.5 text-rose-300 shrink-0" />
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-semibold tracking-tight">
                    Reconnecting…
                    {pendingCount > 0 ? ` (${pendingCount} queued)` : ''}
                  </span>
                  <span className="text-[10px] text-rose-200/85">
                    Your work may not be saved
                  </span>
                </div>
              </>
            )}

            {state === 'slow' && (
              <>
                <span className="size-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                <Gauge className="size-3.5 text-amber-300 shrink-0" />
                <span className="text-xs font-semibold tracking-tight">
                  Slow Connection
                </span>
              </>
            )}

            {state === 'syncing' && (
              <>
                <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
                <span className="text-xs font-semibold tracking-tight">
                  Syncing{pendingCount > 0 ? ` (${pendingCount})` : '…'}
                </span>
                <button
                  type="button"
                  onClick={() => void syncNow()}
                  className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium hover:bg-white/20 transition-colors"
                >
                  Sync now
                </button>
              </>
            )}

            {state === 'synced' && (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold tracking-tight">
                  Synced{lastSyncedCount > 0 ? ` (${lastSyncedCount} saved)` : ''}
                </span>
              </>
            )}

            {state === 'connected' && (
              <>
                <span className="size-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                <Wifi className="size-3.5 text-emerald-300 shrink-0" />
                <span className="text-xs font-semibold tracking-tight">
                  Connected
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
