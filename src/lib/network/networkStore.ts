import { create } from 'zustand';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

export interface NetworkState {
  isOnline: boolean;
  isSlowConnection: boolean;
  syncState: SyncState;
  showConnected: boolean;
  pendingCount: number;
  lastSyncedCount: number;
  lastLatencyMs: number | null;
  activeRetries: number;
  setOnline: (online: boolean) => void;
  setSlowConnection: (slow: boolean) => void;
  setSyncState: (state: SyncState) => void;
  setPendingCount: (count: number) => void;
  triggerConnectedBanner: () => void;
  triggerSyncedBanner: (count: number) => void;
  recordLatency: (latencyMs: number) => void;
  incrementRetries: () => void;
  decrementRetries: () => void;
}

let connectedTimer: ReturnType<typeof setTimeout> | null = null;
let syncedTimer: ReturnType<typeof setTimeout> | null = null;

function readInitialOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  isOnline: readInitialOnline(),
  isSlowConnection: false,
  syncState: 'idle',
  showConnected: false,
  pendingCount: 0,
  lastSyncedCount: 0,
  lastLatencyMs: null,
  activeRetries: 0,

  setOnline: (online) => {
    const prev = get().isOnline;
    set({
      isOnline: online,
      ...(online ? {} : { showConnected: false, isSlowConnection: false }),
    });
    if (!prev && online && get().pendingCount === 0) {
      get().triggerConnectedBanner();
    }
  },

  setSlowConnection: (slow) => set({ isSlowConnection: slow }),

  setSyncState: (syncState) => set({ syncState }),

  setPendingCount: (pendingCount) => set({ pendingCount: Math.max(0, pendingCount) }),

  triggerConnectedBanner: () => {
    if (connectedTimer) clearTimeout(connectedTimer);
    set({ showConnected: true });
    connectedTimer = setTimeout(() => {
      set({ showConnected: false });
    }, 3000);
  },

  triggerSyncedBanner: (count) => {
    if (syncedTimer) clearTimeout(syncedTimer);
    if (connectedTimer) clearTimeout(connectedTimer);
    set({
      syncState: 'synced',
      lastSyncedCount: count,
      showConnected: false,
    });
    syncedTimer = setTimeout(() => {
      set((s) => (s.syncState === 'synced' ? { syncState: 'idle' } : s));
    }, 3000);
  },

  recordLatency: (latencyMs) => {
    const isSlow = latencyMs > 2500;
    set({ lastLatencyMs: Math.round(latencyMs), isSlowConnection: isSlow });
  },

  incrementRetries: () => set((s) => ({ activeRetries: s.activeRetries + 1 })),

  decrementRetries: () => set((s) => ({ activeRetries: Math.max(0, s.activeRetries - 1) })),
}));
