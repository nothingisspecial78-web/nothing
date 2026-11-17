import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import type {
  AssistantConfig,
  AssistantAdapters,
  UserContext,
  PageContext,
  PlanStatus,
  AssistantEventMap,
  AssistantEventHandler,
} from '@ai-assistant/core';
import { globalEventBus } from '@ai-assistant/core';

export interface AssistantContextValue {
  config: AssistantConfig;
  adapters?: AssistantAdapters;
  apiUrl: string;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  send: (text: string) => Promise<void>;
  user: UserContext | null;
  setUser: (user: UserContext | null) => void;
  pageContext: PageContext;
  setPageContext: (ctx: Partial<PageContext>) => void;
  credits: number;
  plan: PlanStatus;
  on: <K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>) => () => void;
  emit: <K extends keyof AssistantEventMap>(event: K, data: AssistantEventMap[K]) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export interface AssistantProviderProps {
  config: AssistantConfig;
  adapters?: AssistantAdapters;
  apiUrl?: string;
  initialUser?: UserContext | null;
  initialPageContext?: PageContext;
  children: ReactNode;
}

export function AssistantProvider({
  config,
  adapters,
  apiUrl = '',
  initialUser = null,
  initialPageContext = { route: '/' },
  children,
}: AssistantProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<UserContext | null>(initialUser);
  const [pageContext, setPageContextState] = useState<PageContext>(initialPageContext);
  const [credits, setCredits] = useState<number>(config.plans?.free?.creditAllowance || 50);
  const [plan, setPlan] = useState<PlanStatus>({
    planId: 'free',
    isPremium: false,
    creditsRemaining: config.plans?.free?.creditAllowance || 50,
    creditsMonthlyAllowance: config.plans?.free?.creditAllowance || 50,
    features: config.plans?.free?.features || ['basic_chat', 'search'],
  });

  // Sync pageContext subscription if adapter is supplied
  useEffect(() => {
    if (adapters?.pageContext) {
      const current = adapters.pageContext.getCurrentPage();
      if (current) setPageContextState(current);
      return adapters.pageContext.subscribe((newCtx) => {
        setPageContextState(newCtx);
      });
    }
  }, [adapters?.pageContext]);

  // Sync user from auth adapter if supplied
  useEffect(() => {
    if (adapters?.auth && !initialUser) {
      adapters.auth.getCurrentUser().then((u) => {
        if (u) setUser(u);
      }).catch(() => {});
    }
  }, [adapters?.auth, initialUser]);

  // Sync billing status
  useEffect(() => {
    if (adapters?.billing && user?.organizationId) {
      adapters.billing.getPlan(user.organizationId).then((status) => {
        setPlan(status);
        setCredits(status.creditsRemaining);
      }).catch(() => {});
    }
  }, [adapters?.billing, user?.organizationId]);

  // Listen for global billing and credits events
  useEffect(() => {
    const unsubCredits = globalEventBus.on('credits_changed', (evt) => {
      setCredits(evt.creditsRemaining);
    });
    const unsubPlan = globalEventBus.on('plan_changed', (evt) => {
      setPlan((prev) => ({
        ...prev,
        planId: evt.planId,
        isPremium: evt.isPremium,
      }));
    });
    return () => {
      unsubCredits();
      unsubPlan();
    };
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const setPageContext = useCallback((patch: Partial<PageContext>) => {
    setPageContextState((prev) => ({ ...prev, ...patch }));
  }, []);

  const send = useCallback(async (text: string) => {
    globalEventBus.emit('message_sent', {
      id: `msg_${Date.now()}`,
      text,
      role: 'user',
      timestamp: new Date().toISOString(),
    });
  }, []);

  const on = useCallback(<K extends keyof AssistantEventMap>(event: K, handler: AssistantEventHandler<K>) => {
    return globalEventBus.on(event, handler);
  }, []);

  const emit = useCallback(<K extends keyof AssistantEventMap>(event: K, data: AssistantEventMap[K]) => {
    globalEventBus.emit(event, data);
  }, []);

  const value = useMemo<AssistantContextValue>(
    () => ({
      config,
      adapters,
      apiUrl,
      isOpen,
      open,
      close,
      toggle,
      send,
      user,
      setUser,
      pageContext,
      setPageContext,
      credits,
      plan,
      on,
      emit,
    }),
    [config, adapters, apiUrl, isOpen, open, close, toggle, send, user, pageContext, setPageContext, credits, plan, on, emit]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error('useAssistant must be used within an <AssistantProvider>');
  }
  return context;
}
