import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useNetworkStore } from './networkStore';

export const OFFLINE_QUEUE_STORAGE_KEY = 'khazna_offline_action_queue_v1';

export interface OfflineQueuedAction {
  id: string;
  kind: 'http' | 'khazna_sync';
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  actionType?: string;
  label: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface OfflineQueueStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function getDefaultStorage(): OfflineQueueStorageLike | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function isPaymentEndpoint(url: string): boolean {
  const normalized = String(url || '').toLowerCase();
  return (
    normalized.includes('/api/payments/') ||
    normalized.includes('/api/assistant/billing/subscribe') ||
    normalized.includes('/api/assistant/billing/cancel')
  );
}

export function readOfflineQueue(
  storage: OfflineQueueStorageLike | null = getDefaultStorage()
): OfflineQueuedAction[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is OfflineQueuedAction => Boolean(item && item.id && item.url))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  } catch {
    return [];
  }
}

export function writeOfflineQueue(
  items: OfflineQueuedAction[],
  storage: OfflineQueueStorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    if (items.length === 0 && storage.removeItem) {
      storage.removeItem(OFFLINE_QUEUE_STORAGE_KEY);
    } else {
      storage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(items));
    }
  } catch {
    // ignore storage quota errors
  }
  if (typeof window !== 'undefined') {
    useNetworkStore.getState().setPendingCount(items.length);
  }
}

export function enqueueOfflineAction(
  input: Omit<OfflineQueuedAction, 'id' | 'createdAt' | 'idempotencyKey'> & {
    id?: string;
    createdAt?: string;
    idempotencyKey?: string;
  },
  storage: OfflineQueueStorageLike | null = getDefaultStorage()
): OfflineQueuedAction {
  if (isPaymentEndpoint(input.url)) {
    throw new Error(
      'Payment operations require a live internet connection and cannot be queued offline.'
    );
  }

  const current = readOfflineQueue(storage);
  const idempotencyKey =
    input.idempotencyKey ||
    `off_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (current.some((existing) => existing.idempotencyKey === idempotencyKey)) {
    return current.find((existing) => existing.idempotencyKey === idempotencyKey)!;
  }

  const entry: OfflineQueuedAction = {
    id: input.id || `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: input.kind,
    url: input.url,
    method: input.method,
    headers: input.headers,
    body: input.body,
    actionType: input.actionType,
    label: input.label,
    idempotencyKey,
    createdAt: input.createdAt || new Date().toISOString(),
  };

  const next = [...current, entry].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
  writeOfflineQueue(next, storage);
  return entry;
}

export type OfflineReplayExecutor = (action: OfflineQueuedAction) => Promise<boolean>;

async function defaultHttpExecutor(action: OfflineQueuedAction): Promise<boolean> {
  if (isPaymentEndpoint(action.url)) {
    // Safety guard: never auto-replay a queued payment call
    return true;
  }
  const targetUrl = action.kind === 'khazna_sync' ? '/api/sync/ack' : action.url;
  const payload =
    action.kind === 'khazna_sync'
      ? { actions: [{ id: action.id, actionType: action.actionType, payload: action.body }] }
      : action.body;

  const res = await fetch(targetUrl, {
    method: action.kind === 'khazna_sync' ? 'POST' : action.method,
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': action.idempotencyKey,
      ...(action.headers || {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
    // 2xx succeeded, or non-retryable 4xx cleared from queue
    return true;
  }
  return false;
}

let activeSyncPromise: Promise<{ synced: number; remaining: number }> | null = null;

export async function replayOfflineQueue(params?: {
  storage?: OfflineQueueStorageLike | null;
  executor?: OfflineReplayExecutor;
  isOnline?: () => boolean;
}): Promise<{ synced: number; remaining: number }> {
  if (activeSyncPromise) return activeSyncPromise;

  const storage = params?.storage ?? getDefaultStorage();
  const executor = params?.executor ?? defaultHttpExecutor;
  const checkOnline =
    params?.isOnline ??
    (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  activeSyncPromise = (async () => {
    const queue = readOfflineQueue(storage);
    if (queue.length === 0) {
      if (typeof window !== 'undefined') {
        useNetworkStore.getState().setPendingCount(0);
      }
      return { synced: 0, remaining: 0 };
    }

    if (!checkOnline()) {
      return { synced: 0, remaining: queue.length };
    }

    if (typeof window !== 'undefined') {
      useNetworkStore.getState().setSyncState('syncing');
    }

    let synced = 0;
    const remaining: OfflineQueuedAction[] = [];

    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      if (!checkOnline()) {
        remaining.push(...queue.slice(i));
        break;
      }
      try {
        const ok = await executor(item);
        if (ok) {
          synced += 1;
        } else {
          remaining.push(...queue.slice(i));
          break;
        }
      } catch {
        remaining.push(...queue.slice(i));
        break;
      }
    }

    writeOfflineQueue(remaining, storage);

    if (typeof window !== 'undefined') {
      const store = useNetworkStore.getState();
      if (synced > 0 && remaining.length === 0) {
        store.triggerSyncedBanner(synced);
      } else if (remaining.length > 0) {
        store.setSyncState('idle');
      } else {
        store.setSyncState('idle');
      }
    }

    return { synced, remaining: remaining.length };
  })().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}

export function queueKhaznaMutationIfOffline(
  actionType: string,
  payload: Record<string, unknown>,
  label: string
): boolean {
  const isOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!isOffline) return false;

  enqueueOfflineAction({
    kind: 'khazna_sync',
    url: '/api/sync/ack',
    method: 'POST',
    actionType,
    body: payload,
    label,
  });
  return true;
}

export function useOfflineQueue() {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const syncState = useNetworkStore((s) => s.syncState);

  const syncNow = useCallback(async () => {
    const result = await replayOfflineQueue();
    if (result.synced > 0 && result.remaining === 0) {
      toast.success(`Synced ${result.synced} queued change${result.synced === 1 ? '' : 's'}`);
    }
    return result;
  }, []);

  useEffect(() => {
    const store = useNetworkStore.getState();
    const initialQueue = readOfflineQueue();
    store.setPendingCount(initialQueue.length);
    store.setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);

    if (typeof navigator !== 'undefined' && navigator.onLine && initialQueue.length > 0) {
      void syncNow();
    }

    const handleOnline = () => {
      useNetworkStore.getState().setOnline(true);
      void syncNow();
    };

    const handleOffline = () => {
      useNetworkStore.getState().setOnline(false);
    };

    const handleConnectionChange = () => {
      const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
      if (conn?.effectiveType) {
        useNetworkStore
          .getState()
          .setSlowConnection(conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
    conn?.addEventListener?.('change', handleConnectionChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      conn?.removeEventListener?.('change', handleConnectionChange);
    };
  }, [syncNow]);

  return {
    isOnline,
    pendingCount,
    syncState,
    syncNow,
  };
}
