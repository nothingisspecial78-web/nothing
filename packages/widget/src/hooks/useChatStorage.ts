import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonalizationSettings } from '@ai-assistant/core';
import type { WidgetMessage } from './useChatStream.ts';

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: WidgetMessage[];
}

export const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  displayName: '',
  tone: 'balanced',
  preferredLanguage: 'auto',
  customInstructions: '',
  voiceAutoSend: false,
};

export function threadsStorageKey(appId: string, userKey?: string): string {
  return `aia:threads:${appId}:${userKey || 'default'}`;
}

export function activeThreadStorageKey(appId: string, userKey?: string): string {
  return `aia:activeThread:${appId}:${userKey || 'default'}`;
}

export function personalizationStorageKey(appId: string, userKey?: string): string {
  return `aia:prefs:${appId}:${userKey || 'default'}`;
}

export function deriveThreadTitle(messages: WidgetMessage[], fallback = 'New conversation'): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim().length > 0);
  if (!firstUser) return fallback;
  const clean = firstUser.content.replace(/\s+/g, ' ').trim();
  return clean.length > 46 ? `${clean.slice(0, 45)}…` : clean;
}

export function makeEmptyThread(title = 'New conversation'): ChatThread {
  const now = new Date().toISOString();
  return {
    id: `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function createThreadInList(threads: ChatThread[], title = 'New conversation'): {
  threads: ChatThread[];
  activeThreadId: string;
} {
  const fresh = makeEmptyThread(title);
  return {
    threads: [fresh, ...threads],
    activeThreadId: fresh.id,
  };
}

export function renameThreadInList(threads: ChatThread[], threadId: string, title: string): ChatThread[] {
  const trimmed = title.trim();
  if (!trimmed) return threads;
  const now = new Date().toISOString();
  return threads.map((t) => (t.id === threadId ? { ...t, title: trimmed, updatedAt: now } : t));
}

export function deleteThreadFromList(
  threads: ChatThread[],
  threadId: string,
  currentActiveId: string | null
): { threads: ChatThread[]; activeThreadId: string } {
  const remaining = threads.filter((t) => t.id !== threadId);
  if (remaining.length === 0) {
    const fresh = makeEmptyThread();
    return { threads: [fresh], activeThreadId: fresh.id };
  }
  const nextActive =
    currentActiveId && currentActiveId !== threadId && remaining.some((t) => t.id === currentActiveId)
      ? currentActiveId
      : remaining[0].id;
  return { threads: remaining, activeThreadId: nextActive };
}

export function clearThreadsList(): { threads: ChatThread[]; activeThreadId: string } {
  const fresh = makeEmptyThread();
  return { threads: [fresh], activeThreadId: fresh.id };
}

export function upsertThreadMessagesInList(
  threads: ChatThread[],
  threadId: string,
  messages: WidgetMessage[]
): ChatThread[] {
  const now = new Date().toISOString();
  const cleanMessages = messages.map((m) => ({
    ...m,
    isStreaming: false,
    // Keep lightweight attachment metadata in local history
    attachments: m.attachments?.map((a) =>
      a.dataUrl && a.dataUrl.length > 48_000 ? { ...a, dataUrl: undefined } : a
    ),
  }));

  const exists = threads.some((t) => t.id === threadId);
  if (!exists) {
    const created: ChatThread = {
      id: threadId,
      title: deriveThreadTitle(cleanMessages),
      createdAt: now,
      updatedAt: now,
      messages: cleanMessages,
    };
    return [created, ...threads];
  }

  return threads.map((t) => {
    if (t.id !== threadId) return t;
    const nextTitle =
      t.title === 'New conversation' && cleanMessages.length > 0
        ? deriveThreadTitle(cleanMessages, t.title)
        : t.title;
    return {
      ...t,
      title: nextTitle,
      updatedAt: now,
      messages: cleanMessages,
    };
  });
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadUserThreads(
  appId: string,
  userKey?: string,
  storage?: StorageLike
): { threads: ChatThread[]; activeThreadId: string } {
  const store = getBrowserStorage(storage);
  if (!store) {
    const fresh = makeEmptyThread();
    return { threads: [fresh], activeThreadId: fresh.id };
  }
  try {
    const raw = store.getItem(threadsStorageKey(appId, userKey));
    const parsed = raw ? (JSON.parse(raw) as ChatThread[]) : [];
    if (Array.isArray(parsed) && parsed.length > 0) {
      const savedActive = store.getItem(activeThreadStorageKey(appId, userKey));
      const activeId =
        savedActive && parsed.some((t) => t.id === savedActive) ? savedActive : parsed[0].id;
      return { threads: parsed, activeThreadId: activeId };
    }
  } catch {
    // fallback to clean thread
  }
  const fresh = makeEmptyThread();
  return { threads: [fresh], activeThreadId: fresh.id };
}

export function saveUserThreads(
  appId: string,
  userKey: string | undefined,
  threads: ChatThread[],
  activeThreadId: string,
  storage?: StorageLike
): void {
  const store = getBrowserStorage(storage);
  if (!store) return;
  try {
    store.setItem(threadsStorageKey(appId, userKey), JSON.stringify(threads.slice(0, 40)));
    store.setItem(activeThreadStorageKey(appId, userKey), activeThreadId);
  } catch {
    // ignore storage quota errors
  }
}

export function loadUserPersonalization(
  appId: string,
  userKey?: string,
  storage?: StorageLike
): PersonalizationSettings {
  const store = getBrowserStorage(storage);
  if (!store) return { ...DEFAULT_PERSONALIZATION };
  try {
    const raw = store.getItem(personalizationStorageKey(appId, userKey));
    if (!raw) return { ...DEFAULT_PERSONALIZATION };
    const parsed = JSON.parse(raw) as Partial<PersonalizationSettings>;
    return {
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      tone:
        parsed.tone === 'concise' || parsed.tone === 'detailed' || parsed.tone === 'balanced'
          ? parsed.tone
          : 'balanced',
      preferredLanguage:
        parsed.preferredLanguage === 'en' || parsed.preferredLanguage === 'ml'
          ? parsed.preferredLanguage
          : 'auto',
      customInstructions: typeof parsed.customInstructions === 'string' ? parsed.customInstructions : '',
      voiceAutoSend: Boolean(parsed.voiceAutoSend),
    };
  } catch {
    return { ...DEFAULT_PERSONALIZATION };
  }
}

export function saveUserPersonalization(
  appId: string,
  userKey: string | undefined,
  prefs: PersonalizationSettings,
  storage?: StorageLike
): void {
  const store = getBrowserStorage(storage);
  if (!store) return;
  try {
    store.setItem(personalizationStorageKey(appId, userKey), JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export function useChatStorage(appId: string, userKey?: string) {
  const [threads, setThreads] = useState<ChatThread[]>(() => loadUserThreads(appId, userKey).threads);
  const [activeThreadId, setActiveThreadId] = useState<string>(
    () => loadUserThreads(appId, userKey).activeThreadId
  );
  const [personalization, setPersonalization] = useState<PersonalizationSettings>(() =>
    loadUserPersonalization(appId, userKey)
  );

  // Reload isolated threads + personalization whenever userKey or appId changes
  useEffect(() => {
    const loaded = loadUserThreads(appId, userKey);
    setThreads(loaded.threads);
    setActiveThreadId(loaded.activeThreadId);
    setPersonalization(loadUserPersonalization(appId, userKey));
  }, [appId, userKey]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || threads[0] || makeEmptyThread(),
    [activeThreadId, threads]
  );

  const createNewThread = useCallback(() => {
    setThreads((prev) => {
      const current = prev.find((t) => t.id === activeThreadId);
      if (current && current.messages.length === 0) {
        saveUserThreads(appId, userKey, prev, current.id);
        return prev;
      }
      const next = createThreadInList(prev);
      setActiveThreadId(next.activeThreadId);
      saveUserThreads(appId, userKey, next.threads, next.activeThreadId);
      return next.threads;
    });
  }, [activeThreadId, appId, userKey]);

  const selectThread = useCallback(
    (id: string) => {
      setActiveThreadId(id);
      setThreads((prev) => {
        saveUserThreads(appId, userKey, prev, id);
        return prev;
      });
    },
    [appId, userKey]
  );

  const renameThreadById = useCallback(
    (id: string, title: string) => {
      setThreads((prev) => {
        const next = renameThreadInList(prev, id, title);
        saveUserThreads(appId, userKey, next, activeThreadId);
        return next;
      });
    },
    [activeThreadId, appId, userKey]
  );

  const deleteThreadById = useCallback(
    (id: string) => {
      setThreads((prev) => {
        const next = deleteThreadFromList(prev, id, activeThreadId);
        setActiveThreadId(next.activeThreadId);
        saveUserThreads(appId, userKey, next.threads, next.activeThreadId);
        return next.threads;
      });
    },
    [activeThreadId, appId, userKey]
  );

  const clearAllUserThreads = useCallback(() => {
    const next = clearThreadsList();
    setThreads(next.threads);
    setActiveThreadId(next.activeThreadId);
    saveUserThreads(appId, userKey, next.threads, next.activeThreadId);
    return next.threads[0].messages;
  }, [appId, userKey]);

  const syncActiveMessages = useCallback(
    (messages: WidgetMessage[]) => {
      if (messages.some((m) => m.isStreaming)) return;
      setThreads((prev) => {
        const targetId = prev.some((t) => t.id === activeThreadId)
          ? activeThreadId
          : prev[0]?.id || makeEmptyThread().id;
        const next = upsertThreadMessagesInList(prev, targetId, messages);
        saveUserThreads(appId, userKey, next, targetId);
        return next;
      });
    },
    [activeThreadId, appId, userKey]
  );

  const updatePersonalization = useCallback(
    (patch: Partial<PersonalizationSettings>) => {
      setPersonalization((prev) => {
        const next = { ...prev, ...patch };
        saveUserPersonalization(appId, userKey, next);
        return next;
      });
    },
    [appId, userKey]
  );

  return {
    threads,
    activeThread,
    activeThreadId: activeThread.id,
    personalization,
    createNewThread,
    selectThread,
    renameThreadById,
    deleteThreadById,
    clearAllUserThreads,
    syncActiveMessages,
    updatePersonalization,
  };
}
