import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isAffirmativeReply,
  isCloseReply,
  MAX_GUIDE_STEPS,
  truncateTipWords,
  type AvailableRouteHint,
  type GuideClarificationOption,
  type GuideStepResponse,
  type GuideTroubleshootingContext,
  type PageMapElement,
} from '@ai-assistant/core';
import {
  findElementByAiId,
  getAvailableRoutes,
  getElementLabel,
  getPageMap,
  getVisiblePageErrors,
  isSensitiveDomElement,
} from '../guide/pageMap.ts';
import { VoiceController } from '../guide/VoiceController.ts';
import { parseJsonSafely } from '../utils/safeFetchJson.ts';

const POST_REFRESH_STORAGE_KEY = 'aia_guide_post_refresh';

export interface UseGuideCoBrowserOptions {
  apiUrl: string;
  appId: string;
  language?: 'auto' | 'en' | 'ml' | string;
  muted?: boolean;
  onMuteChange?: (muted: boolean) => void;
  getAuthToken?: () => string | Promise<string>;
  getAvailableRoutes?: () => AvailableRouteHint[];
  getAppContext?: () => string;
  onNavigate?: (route: string) => void;
  onClarifyRequested?: (clarify: {
    goal: string;
    question: string;
    options: GuideClarificationOption[];
  }) => void;
}

export interface StartGuideOptions {
  confirmedPath?: boolean;
  preferredTargetId?: string;
  preferredRoute?: string;
  postRefreshMessage?: string;
}

export type StartGuideOutcome =
  | { status: 'started' }
  | {
      status: 'clarify';
      goal: string;
      question: string;
      options: GuideClarificationOption[];
    }
  | { status: 'error'; message: string };

interface GuideHistorySnapshot {
  stepNumber: number;
  route: string;
  decision: GuideStepResponse;
  summaryHistory: string[];
  troubleshootingContext: GuideTroubleshootingContext | null;
  detectedError: string | null;
}

export interface GuideCoBrowserState {
  active: boolean;
  checking: boolean;
  goal: string;
  stepNumber: number;
  maxSteps: number;
  totalSteps: number | null;
  loading: boolean;
  decision: GuideStepResponse | null;
  pausedForInput: boolean;
  sensitiveBlocked: boolean;
  targetRect: DOMRect | null;
  targetElement: HTMLElement | null;
  cursorPos: { x: number; y: number };
  targetMissing: boolean;
  error: string | null;
  detectedError: string | null;
  canGoBack: boolean;
  muted: boolean;
  isSpeaking: boolean;
  startGuide: (goal: string, options?: StartGuideOptions) => Promise<StartGuideOutcome>;
  continueAfterInput: () => Promise<void>;
  goBack: () => Promise<void>;
  submitUserReply: (reply: string) => Promise<void>;
  toggleMute: () => void;
  speakText: (text: string) => void;
  stopGuide: () => void;
}

function isInputControl(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea';
}

function mergeAvailableRoutes(
  domRoutes: AvailableRouteHint[],
  hostRoutes: AvailableRouteHint[]
): AvailableRouteHint[] {
  const seen = new Set<string>();
  const merged: AvailableRouteHint[] = [];
  for (const r of [...domRoutes, ...hostRoutes]) {
    if (!r?.route || seen.has(r.route)) continue;
    seen.add(r.route);
    merged.push({
      route: r.route.slice(0, 300),
      label: (r.label || r.route).slice(0, 100),
    });
    if (merged.length >= 40) break;
  }
  return merged;
}

function compactStepHistory(history: string[], maxChars = 380): string {
  const recent = history.slice(-8);
  let joined = recent.join(' -> ');
  while (joined.length > maxChars && recent.length > 1) {
    recent.shift();
    joined = recent.join(' -> ');
  }
  if (joined.length > maxChars) {
    return joined.slice(-maxChars);
  }
  return joined;
}

function sanitizePageMapForApi(items: PageMapElement[]): PageMapElement[] {
  return items
    .filter((el) => Boolean(el.id && el.tag && el.type))
    .slice(0, 200)
    .map((el) => ({
      id: el.id.slice(0, 180),
      tag: el.tag.slice(0, 32),
      type: el.type.slice(0, 40),
      label: (el.label || '').slice(0, 160),
      hasValue: Boolean(el.hasValue),
      currentRoute: (el.currentRoute || '/').slice(0, 300),
      ...(el.sensitive ? { sensitive: true } : {}),
    }));
}

async function waitForPageTransitionIfBusy(maxWaitMs = 350): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const startRoute = window.location.pathname;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const busyEl = Array.from(document.querySelectorAll('[aria-busy="true"]')).find(
      (el) => !el.closest('.aia-root')
    );
    if (!busyEl || window.location.pathname !== startRoute) {
      break;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}

export function useGuideCoBrowser({
  apiUrl,
  appId,
  language = 'en',
  muted: controlledMuted,
  onMuteChange,
  getAuthToken,
  getAvailableRoutes: getHostAvailableRoutes,
  getAppContext,
  onNavigate,
  onClarifyRequested,
}: UseGuideCoBrowserOptions): GuideCoBrowserState {
  const [active, setActive] = useState(false);
  const [checking, setChecking] = useState(false);
  const [goal, setGoal] = useState('');
  const [stepNumber, setStepNumber] = useState(0);
  const [totalSteps, setTotalSteps] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<GuideStepResponse | null>(null);
  const [pausedForInput, setPausedForInput] = useState(false);
  const [sensitiveBlocked, setSensitiveBlocked] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({
    x: typeof window !== 'undefined' ? window.innerWidth * 0.5 : 320,
    y: typeof window !== 'undefined' ? window.innerHeight * 0.4 : 240,
  });
  const [targetMissing, setTargetMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedError, setDetectedError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [internalMuted, setInternalMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const effectiveMuted = typeof controlledMuted === 'boolean' ? controlledMuted : internalMuted;

  const sessionTokenRef = useRef(0);
  const summaryHistoryRef = useRef<string[]>([]);
  const historyStackRef = useRef<GuideHistorySnapshot[]>([]);
  const currentSnapshotRef = useRef<GuideHistorySnapshot | null>(null);
  const troubleshootingContextRef = useRef<GuideTroubleshootingContext | null>(null);
  const lastReportedErrorRef = useRef<string>('');
  const postRefreshBannerRef = useRef<string>('');
  const loadingRef = useRef(false);
  const decisionRef = useRef<GuideStepResponse | null>(null);
  const activeGoalRef = useRef('');
  const pausedRouteRef = useRef('');
  const targetElRef = useRef<HTMLElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const voiceRef = useRef<VoiceController | null>(null);

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onClarifyRequestedRef = useRef(onClarifyRequested);
  onClarifyRequestedRef.current = onClarifyRequested;
  const getAuthTokenRef = useRef(getAuthToken);
  getAuthTokenRef.current = getAuthToken;
  const getHostRoutesRef = useRef(getHostAvailableRoutes);
  getHostRoutesRef.current = getHostAvailableRoutes;
  const getAppContextRef = useRef(getAppContext);
  getAppContextRef.current = getAppContext;
  const onMuteChangeRef = useRef(onMuteChange);
  onMuteChangeRef.current = onMuteChange;

  loadingRef.current = loading;
  decisionRef.current = decision;

  // Initialize shared VoiceController for co-browser step & prompt speech output
  useEffect(() => {
    const vc = new VoiceController({
      apiUrl,
      appId,
      defaultLang: language === 'ml' ? 'ml' : 'en',
      getAuthToken: () => (getAuthTokenRef.current ? getAuthTokenRef.current() : ''),
      onSpeakStart: () => setIsSpeaking(true),
      onSpeakEnd: () => setIsSpeaking(false),
    });
    voiceRef.current = vc;
    setInternalMuted(vc.isMuted());
    return () => {
      vc.destroy();
      voiceRef.current = null;
    };
  }, [apiUrl, appId]);

  useEffect(() => {
    voiceRef.current?.setLanguage(language === 'ml' ? 'ml' : 'en');
  }, [language]);

  useEffect(() => {
    if (typeof controlledMuted === 'boolean' && voiceRef.current) {
      voiceRef.current.setMuted(controlledMuted);
    }
  }, [controlledMuted]);

  const toggleMute = useCallback(() => {
    const vc = voiceRef.current;
    const next = vc ? vc.toggleMute() : !effectiveMuted;
    setInternalMuted(next);
    onMuteChangeRef.current?.(next);
  }, [effectiveMuted]);

  const speakText = useCallback((text: string) => {
    if (!text?.trim()) return;
    void voiceRef.current?.speak(text);
  }, []);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const stopGuide = useCallback(() => {
    sessionTokenRef.current += 1;
    clearTimers();
    voiceRef.current?.stop();
    targetElRef.current = null;
    setTargetElement(null);
    summaryHistoryRef.current = [];
    historyStackRef.current = [];
    currentSnapshotRef.current = null;
    troubleshootingContextRef.current = null;
    lastReportedErrorRef.current = '';
    postRefreshBannerRef.current = '';
    activeGoalRef.current = '';
    setCanGoBack(false);
    setActive(false);
    setChecking(false);
    setLoading(false);
    setDecision(null);
    setPausedForInput(false);
    setSensitiveBlocked(false);
    setTargetRect(null);
    setTargetMissing(false);
    setError(null);
    setDetectedError(null);
    setStepNumber(0);
    setTotalSteps(null);
  }, [clearTimers]);

  // Keep spotlight rect & gliding SVG cursor synced on scroll, resize, and CSS drawer/modal transitions
  useEffect(() => {
    if (!active) return;

    let rafId = 0;
    let lastRectSig = '';
    const syncRect = () => {
      const el = targetElRef.current;
      if (el && document.contains(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const sig = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
          if (sig === lastRectSig) return;
          lastRectSig = sig;
          setTargetRect(rect);
          setCursorPos({
            x: rect.left + Math.min(rect.width * 0.72, rect.width - 8),
            y: rect.top + Math.min(rect.height * 0.65, rect.height - 6),
          });
          setTargetMissing(false);
          return;
        }
      }
      if (targetElRef.current && lastRectSig !== 'missing') {
        lastRectSig = 'missing';
        setTargetRect(null);
      }
    };

    const scheduleSync = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncRect);
    };

    syncRect();
    window.addEventListener('scroll', scheduleSync, true);
    window.addEventListener('resize', scheduleSync);
    const interval = window.setInterval(scheduleSync, 180);
    const postTransitionTimers = [
      window.setTimeout(scheduleSync, 60),
      window.setTimeout(scheduleSync, 180),
      window.setTimeout(scheduleSync, 380),
    ];

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(scheduleSync);
      if (targetElRef.current) {
        ro.observe(targetElRef.current);
        const container = targetElRef.current.closest('[role="dialog"], [aria-modal="true"], form');
        if (container) ro.observe(container);
      }
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.clearInterval(interval);
      for (const tid of postTransitionTimers) window.clearTimeout(tid);
      ro?.disconnect();
      window.removeEventListener('scroll', scheduleSync, true);
      window.removeEventListener('resize', scheduleSync);
    };
  }, [active, decision]);

  // Escape key cancels active guide cleanly
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopGuide();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, stopGuide]);

  const applyStepDecision = useCallback(
    (
      rawDecision: GuideStepResponse,
      stepNum: number,
      sessionToken: number,
      onAdvance: (nextStep: number, tok: number) => void,
      options: {
        recordHistory?: boolean;
        forcePauseOnBack?: boolean;
        keepPreviousStepOnComplete?: boolean;
      } = {}
    ) => {
      const {
        recordHistory = true,
        forcePauseOnBack = false,
        keepPreviousStepOnComplete = false,
      } = options;

      // Record previous active step before moving to the new one
      if (recordHistory && currentSnapshotRef.current) {
        historyStackRef.current.push(currentSnapshotRef.current);
        if (historyStackRef.current.length > 20) {
          historyStackRef.current.shift();
        }
        setCanGoBack(historyStackRef.current.length > 0);
      }

      const effectiveStep =
        keepPreviousStepOnComplete && rawDecision.action === 'complete'
          ? Math.max(1, stepNum - 1)
          : stepNum;

      setStepNumber(effectiveStep);

      if (rawDecision.action === 'complete') {
        setTotalSteps(effectiveStep);
      } else if (
        typeof rawDecision.totalSteps === 'number' &&
        Number.isFinite(rawDecision.totalSteps)
      ) {
        setTotalSteps(
          Math.max(effectiveStep, Math.min(MAX_GUIDE_STEPS, Math.round(rawDecision.totalSteps)))
        );
      }

      const rawTip = rawDecision.tip || 'Follow this step.';
      const isPromptLike =
        rawDecision.action === 'ask_user' || rawDecision.action === 'refresh_and_retry';
      let nextTip = isPromptLike
        ? rawTip.trim()
        : truncateTipWords(rawTip);

      // On first step right after refresh recovery, surface & speak retry guidance
      const postRefreshPrefix = postRefreshBannerRef.current;
      if (postRefreshPrefix) {
        postRefreshBannerRef.current = '';
        nextTip = `${postRefreshPrefix} ${nextTip}`.trim();
      }

      const normalized: GuideStepResponse = { ...rawDecision, tip: nextTip };
      const currentRouteNow =
        typeof window !== 'undefined' ? window.location.pathname : '/';

      setLoading(false);
      setDecision(normalized);

      // Update troubleshooting context when entering or leaving ask_user
      if (normalized.action === 'ask_user') {
        const nextCtx: GuideTroubleshootingContext = {
          errorText: lastReportedErrorRef.current || troubleshootingContextRef.current?.errorText || '',
          questionAsked: normalized.question || nextTip,
          stage: normalized.askStage === 'follow_up_guide' ? 'follow_up_guide' : 'diagnostic',
        };
        troubleshootingContextRef.current = nextCtx;
      } else {
        troubleshootingContextRef.current = null;
      }

      currentSnapshotRef.current = {
        stepNumber: effectiveStep,
        route: currentRouteNow,
        decision: normalized,
        summaryHistory: [...summaryHistoryRef.current],
        troubleshootingContext: troubleshootingContextRef.current,
        detectedError: lastReportedErrorRef.current || null,
      };
      setCanGoBack(historyStackRef.current.length > 0);

      // Speak instruction or question aloud immediately
      const spokenText =
        normalized.action === 'ask_user'
          ? normalized.question || normalized.tip
          : normalized.tip;
      if (spokenText) {
        void voiceRef.current?.speak(spokenText);
      }

      if (normalized.action === 'refresh_and_retry') {
        targetElRef.current = null;
        setTargetElement(null);
        setTargetRect(null);
        setTargetMissing(false);
        setPausedForInput(false);
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(
              POST_REFRESH_STORAGE_KEY,
              JSON.stringify({
                goal: activeGoalRef.current,
                tip: 'App refreshed. Try signing in again.',
                timestamp: Date.now(),
              })
            );
          } catch {
            // ignore storage errors
          }
          const reloadTimer = window.setTimeout(() => {
            if (sessionToken === sessionTokenRef.current) {
              window.location.reload();
            }
          }, 450);
          timersRef.current.push(reloadTimer);
        }
        return;
      }

      if (normalized.action === 'ask_user') {
        targetElRef.current = null;
        setTargetElement(null);
        setTargetRect(null);
        setTargetMissing(false);
        setPausedForInput(true);
        return;
      }

      if (normalized.action === 'complete') {
        targetElRef.current = null;
        setTargetElement(null);
        setTargetRect(null);
        setTargetMissing(false);
        setPausedForInput(false);
        const autoCloseTimer = window.setTimeout(() => {
          if (sessionToken === sessionTokenRef.current) {
            stopGuide();
          }
        }, 1800);
        timersRef.current.push(autoCloseTimer);
        return;
      }

      if (normalized.action === 'navigate') {
        targetElRef.current = null;
        setTargetElement(null);
        setTargetRect(null);
        const nextRoute = normalized.route || '/';
        summaryHistoryRef.current.push(`Navigated to ${nextRoute}`);
        if (onNavigateRef.current) {
          onNavigateRef.current(nextRoute);
        } else if (typeof window !== 'undefined' && window.location.pathname !== nextRoute) {
          window.history.pushState({}, '', nextRoute);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }

        if (forcePauseOnBack) {
          setPausedForInput(true);
          return;
        }

        const t = window.setTimeout(() => {
          if (sessionToken === sessionTokenRef.current) {
            onAdvance(effectiveStep + 1, sessionToken);
          }
        }, 520);
        timersRef.current.push(t);
        return;
      }

      // Locate target element by data-ai-id (or fallback slug/id)
      const el = normalized.targetId ? findElementByAiId(normalized.targetId) : null;
      if (!el) {
        targetElRef.current = null;
        setTargetElement(null);
        setTargetRect(null);
        setTargetMissing(true);
        pausedRouteRef.current = currentRouteNow;
        setPausedForInput(true);
        return;
      }

      targetElRef.current = el;
      setTargetElement(el);
      setTargetMissing(false);
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect(rect);
        setCursorPos({
          x: rect.left + Math.min(rect.width * 0.72, rect.width - 8),
          y: rect.top + Math.min(rect.height * 0.65, rect.height - 6),
        });
      }

      const domSensitive = isSensitiveDomElement(el);
      const inputEl = isInputControl(el);
      const label = getElementLabel(el) || normalized.targetId || 'element';

      // Client-side safety guardrail: NEVER auto-click sensitive controls or input fields
      if (
        !forcePauseOnBack &&
        normalized.action === 'click_safe' &&
        !domSensitive &&
        !inputEl &&
        !normalized.sensitiveBlocked
      ) {
        summaryHistoryRef.current.push(`Clicked ${normalized.targetId} (${label})`);
        const tClick = window.setTimeout(() => {
          if (sessionToken !== sessionTokenRef.current) return;
          if (!isSensitiveDomElement(el) && !isInputControl(el)) {
            el.click();
          }
          const tNext = window.setTimeout(() => {
            if (sessionToken === sessionTokenRef.current) {
              onAdvance(stepNum + 1, sessionToken);
            }
          }, 680);
          timersRef.current.push(tNext);
        }, 420);
        timersRef.current.push(tClick);
        return;
      }

      if (domSensitive || normalized.sensitiveBlocked) {
        setSensitiveBlocked(true);
      }
      if (inputEl) {
        try {
          el.focus({ preventScroll: true });
        } catch {
          el.focus();
        }
      }

      pausedRouteRef.current = currentRouteNow;
      summaryHistoryRef.current.push(`Guided user to ${normalized.targetId} (${label})`);
      setPausedForInput(true);
    },
    [stopGuide]
  );

  const requestGuideStep = useCallback(
    async (payload: {
      goal: string;
      previousStepSummary: string;
      stepNumber: number;
      currentRoute: string;
      pageMap: PageMapElement[];
      confirmedPath?: boolean;
      preferredTargetId?: string;
      preferredRoute?: string;
      availableRoutes?: AvailableRouteHint[];
      appContext?: string;
      pageErrors?: string[];
      userReply?: string;
      troubleshootingContext?: GuideTroubleshootingContext;
    }): Promise<GuideStepResponse> => {
      const token = getAuthTokenRef.current ? await getAuthTokenRef.current() : '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-app-id': appId,
      };
      if (token) {
        headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }

      const sanitizedPayload = {
        ...payload,
        goal: payload.goal.slice(0, 750),
        previousStepSummary: payload.previousStepSummary.slice(-1400),
        currentRoute: (payload.currentRoute || '/').slice(0, 300),
        pageMap: sanitizePageMapForApi(payload.pageMap),
        ...(payload.preferredTargetId
          ? { preferredTargetId: payload.preferredTargetId.slice(0, 180) }
          : {}),
        ...(payload.preferredRoute
          ? { preferredRoute: payload.preferredRoute.slice(0, 300) }
          : {}),
        ...(payload.appContext ? { appContext: payload.appContext.slice(0, 500) } : {}),
        ...(payload.pageErrors && payload.pageErrors.length > 0
          ? { pageErrors: payload.pageErrors.slice(0, 5).map((e) => e.slice(0, 220)) }
          : {}),
        ...(payload.userReply ? { userReply: payload.userReply.slice(0, 380) } : {}),
        ...(payload.troubleshootingContext
          ? { troubleshootingContext: payload.troubleshootingContext }
          : {}),
      };

      const base = apiUrl ? apiUrl.replace(/\/$/, '') : '';
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 10000);
      let res: Response;
      try {
        res = await fetch(`${base}/api/guide-step`, {
          method: 'POST',
          headers,
          body: JSON.stringify(sanitizedPayload),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const { data: parsedBody, errorMessage } = await parseJsonSafely<
        GuideStepResponse & { error?: string }
      >(res, 'Guide step failed');

      if (!res.ok) {
        throw new Error(parsedBody?.error || errorMessage || `Guide step failed (${res.status})`);
      }

      if (!parsedBody || errorMessage) {
        throw new Error(errorMessage || 'Invalid response from guide-step API');
      }

      return parsedBody;
    },
    [apiUrl, appId]
  );

  const fetchNextStep = useCallback(
    async (
      stepNum: number,
      sessionToken: number,
      opts: { completionCheck?: boolean } = {}
    ): Promise<void> => {
      if (sessionToken !== sessionTokenRef.current) return;

      if (stepNum > MAX_GUIDE_STEPS) {
        setDecision({
          action: 'complete',
          tip: truncateTipWords('Reached 10-step guide limit. Guide closing.'),
        });
        setPausedForInput(false);
        setLoading(false);
        const autoCloseTimer = window.setTimeout(() => {
          if (sessionToken === sessionTokenRef.current) {
            stopGuide();
          }
        }, 1600);
        timersRef.current.push(autoCloseTimer);
        return;
      }

      if (!opts.completionCheck) {
        setStepNumber(stepNum);
      } else {
        targetElRef.current = null;
        setTargetElement(null);
        setTargetRect(null);
      }
      setLoading(true);
      setPausedForInput(false);
      setSensitiveBlocked(false);
      setError(null);

      await waitForPageTransitionIfBusy(350);
      if (sessionToken !== sessionTokenRef.current) return;

      const currentRoute =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      const pageMap: PageMapElement[] = getPageMap({ currentRoute });
      const visibleErrors = getVisiblePageErrors();
      const freshError = visibleErrors.find((e) => e !== lastReportedErrorRef.current);
      if (freshError) {
        lastReportedErrorRef.current = freshError;
        setDetectedError(freshError);
      } else if (visibleErrors.length === 0) {
        setDetectedError(null);
      }

      const domRoutes = getAvailableRoutes();
      const hostRoutes = getHostRoutesRef.current ? getHostRoutesRef.current() : [];
      const availableRoutes = mergeAvailableRoutes(domRoutes, hostRoutes);
      const appContext = getAppContextRef.current ? getAppContextRef.current() : undefined;
      const previousStepSummary = compactStepHistory(summaryHistoryRef.current, 380);

      try {
        const rawDecision = await requestGuideStep({
          goal: activeGoalRef.current,
          previousStepSummary,
          stepNumber: stepNum,
          currentRoute,
          pageMap,
          confirmedPath: true,
          ...(freshError ? { pageErrors: [freshError] } : {}),
          ...(availableRoutes.length > 0 ? { availableRoutes } : {}),
          ...(appContext ? { appContext } : {}),
        });

        if (sessionToken !== sessionTokenRef.current) return;

        applyStepDecision(
          rawDecision,
          stepNum,
          sessionToken,
          (nextStep, tok) => {
            void fetchNextStep(nextStep, tok);
          },
          { keepPreviousStepOnComplete: Boolean(opts.completionCheck) }
        );
      } catch (err) {
        if (sessionToken !== sessionTokenRef.current) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Unable to fetch guide step.');
      }
    },
    [applyStepDecision, requestGuideStep, stopGuide]
  );

  // Trigger troubleshooting automatically when an error alert appears on the page during a guide
  const triggerTroubleshootingForErrors = useCallback(
    async (errors: string[], tok: number) => {
      if (tok !== sessionTokenRef.current || errors.length === 0) return;
      if (loadingRef.current || decisionRef.current?.action === 'ask_user') return;

      const firstErr = errors[0]!;
      lastReportedErrorRef.current = firstErr;
      setDetectedError(firstErr);
      setLoading(true);
      setPausedForInput(false);

      const currentRoute =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      const pageMap = getPageMap({ currentRoute });
      const previousStepSummary = compactStepHistory(summaryHistoryRef.current, 380);

      try {
        const rawDecision = await requestGuideStep({
          goal: activeGoalRef.current,
          previousStepSummary,
          stepNumber: Math.max(1, stepNumber),
          currentRoute,
          pageMap,
          confirmedPath: true,
          pageErrors: errors,
        });
        if (tok !== sessionTokenRef.current) return;
        applyStepDecision(rawDecision, Math.max(1, stepNumber), tok, (nextStep, nextTok) => {
          void fetchNextStep(nextStep, nextTok);
        });
      } catch (err) {
        if (tok !== sessionTokenRef.current) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Unable to resolve page error.');
      }
    },
    [applyStepDecision, fetchNextStep, requestGuideStep, stepNumber]
  );

  // Observe visible host-DOM error alerts while a guide is active & awaiting user input
  useEffect(() => {
    if (!active || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }

    let timerId = 0;
    const scanForErrors = () => {
      if (loadingRef.current) return;
      const curAction = decisionRef.current?.action;
      if (curAction === 'ask_user' || curAction === 'refresh_and_retry' || curAction === 'complete') {
        return;
      }
      const errs = getVisiblePageErrors();
      if (errs.length === 0) {
        if (lastReportedErrorRef.current) {
          lastReportedErrorRef.current = '';
          setDetectedError(null);
        }
        return;
      }
      const unseen = errs.filter((e) => e !== lastReportedErrorRef.current);
      if (unseen.length > 0) {
        const tok = sessionTokenRef.current;
        void triggerTroubleshootingForErrors(unseen, tok);
      }
    };

    const observer = new MutationObserver((mutations) => {
      const hasHostMutation = mutations.some((m) => {
        const target = m.target instanceof Element ? m.target : m.target.parentElement;
        return !target?.closest('.aia-root, .aia-guide-cursor-root, .aia-guide-root');
      });
      if (!hasHostMutation) return;
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(scanForErrors, 160);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
    });

    // Also run once immediately and periodically in case CSS/Framer fade-in finishes after mutation
    timerId = window.setTimeout(scanForErrors, 160);
    const pollId = window.setInterval(scanForErrors, 400);

    return () => {
      if (timerId) window.clearTimeout(timerId);
      window.clearInterval(pollId);
      observer.disconnect();
    };
  }, [active, pausedForInput, decision, triggerTroubleshootingForErrors]);

  // When paused on a sensitive button or interactive control, clicking it directly, pressing Enter, or navigating forward advances cleanly
  useEffect(() => {
    if (!active || !pausedForInput || !decision || decision.action === 'ask_user') return;
    const el = targetElRef.current;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        el &&
        e.key === 'Enter' &&
        el.tagName.toLowerCase() === 'input' &&
        document.activeElement === el
      ) {
        e.preventDefault();
        const tok = sessionTokenRef.current;
        void fetchNextStep(stepNumber + 1, tok);
      }
    };

    const handleManualButtonClick = () => {
      if (el && (isSensitiveDomElement(el) || !isInputControl(el))) {
        const tok = sessionTokenRef.current;
        const elText = `${el.getAttribute('data-ai-id') || ''} ${el.id || ''} ${el.textContent || ''}`;
        const isSubmitLike =
          el.getAttribute('type') === 'submit' ||
          /\b(submit|save|create|confirm|pay|post|import)\b/i.test(elText);
        const t = window.setTimeout(() => {
          if (
            tok === sessionTokenRef.current &&
            !loadingRef.current &&
            decisionRef.current?.action !== 'ask_user' &&
            decisionRef.current?.action !== 'refresh_and_retry'
          ) {
            void fetchNextStep(stepNumber + 1, tok, { completionCheck: isSubmitLike });
          }
        }, 480);
        timersRef.current.push(t);
      }
    };

    let routeCheckTriggered = false;
    const checkRouteChanged = () => {
      if (routeCheckTriggered) return;
      const nowRoute = typeof window !== 'undefined' ? window.location.pathname : '/';
      if (pausedRouteRef.current && nowRoute !== pausedRouteRef.current) {
        routeCheckTriggered = true;
        const tok = sessionTokenRef.current;
        void fetchNextStep(stepNumber + 1, tok);
      }
    };

    const activeContainer = el
      ? (el.closest('[role="dialog"], [aria-modal="true"], form') as HTMLElement | null)
      : null;

    const handleContainerEarlySubmit = () => {
      const tok = sessionTokenRef.current;
      const t = window.setTimeout(() => {
        if (
          tok !== sessionTokenRef.current ||
          loadingRef.current ||
          decisionRef.current?.action === 'ask_user' ||
          decisionRef.current?.action === 'refresh_and_retry' ||
          decisionRef.current?.action === 'complete'
        ) {
          return;
        }
        const stillMounted = Boolean(el && document.contains(el));
        const containerClosed = Boolean(activeContainer && !document.contains(activeContainer));
        if ((!stillMounted || containerClosed) && getVisiblePageErrors().length === 0) {
          summaryHistoryRef.current.push('Submitted form and closed modal');
          applyStepDecision(
            {
              action: 'complete',
              totalSteps: Math.max(1, stepNumber),
              tip: 'Done! Your changes have been saved.',
            },
            Math.max(1, stepNumber),
            tok,
            (nextStep, nextTok) => {
              void fetchNextStep(nextStep, nextTok);
            },
            { recordHistory: false }
          );
        }
      }, 520);
      timersRef.current.push(t);
    };

    const handleContainerClick = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      const btn = target?.closest('button, [role="button"]');
      if (!btn || btn === el) return;
      const btnText = `${btn.getAttribute('data-ai-id') || ''} ${btn.id || ''} ${btn.textContent || ''}`;
      if (
        btn.getAttribute('type') === 'submit' ||
        /\b(submit|save|create|confirm|pay|post|import)\b/i.test(btnText)
      ) {
        handleContainerEarlySubmit();
      }
    };

    const routePoll = window.setInterval(checkRouteChanged, 260);
    window.addEventListener('popstate', checkRouteChanged);

    if (el) {
      el.addEventListener('keydown', handleKeyDown);
      if (!isInputControl(el)) {
        el.addEventListener('click', handleManualButtonClick);
      }
    }
    if (activeContainer) {
      activeContainer.addEventListener('submit', handleContainerEarlySubmit, true);
      activeContainer.addEventListener('click', handleContainerClick, true);
    }
    return () => {
      window.clearInterval(routePoll);
      window.removeEventListener('popstate', checkRouteChanged);
      if (el) {
        el.removeEventListener('keydown', handleKeyDown);
        el.removeEventListener('click', handleManualButtonClick);
      }
      if (activeContainer) {
        activeContainer.removeEventListener('submit', handleContainerEarlySubmit, true);
        activeContainer.removeEventListener('click', handleContainerClick, true);
      }
    };
  }, [active, pausedForInput, decision, stepNumber, fetchNextStep, applyStepDecision]);

  const startGuide = useCallback(
    async (userGoal: string, options: StartGuideOptions = {}): Promise<StartGuideOutcome> => {
      const cleanGoal = userGoal.trim();
      if (!cleanGoal) return { status: 'error', message: 'Empty guide goal.' };

      clearTimers();
      const token = sessionTokenRef.current + 1;
      sessionTokenRef.current = token;
      summaryHistoryRef.current = [];
      historyStackRef.current = [];
      currentSnapshotRef.current = null;
      troubleshootingContextRef.current = null;
      lastReportedErrorRef.current = '';
      postRefreshBannerRef.current = options.postRefreshMessage || '';
      targetElRef.current = null;
      setTargetElement(null);
      activeGoalRef.current = cleanGoal;
      setTotalSteps(null);
      setCanGoBack(false);
      setDetectedError(null);

      setChecking(true);
      setError(null);

      const currentRoute =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      const pageMap = getPageMap({ currentRoute });
      const domRoutes = getAvailableRoutes();
      const hostRoutes = getHostRoutesRef.current ? getHostRoutesRef.current() : [];
      const availableRoutes = mergeAvailableRoutes(domRoutes, hostRoutes);
      const appContext = getAppContextRef.current ? getAppContextRef.current() : undefined;

      try {
        const rawDecision = await requestGuideStep({
          goal: cleanGoal,
          previousStepSummary: '',
          stepNumber: 1,
          currentRoute,
          pageMap,
          confirmedPath: Boolean(options.confirmedPath),
          preferredTargetId: options.preferredTargetId,
          preferredRoute: options.preferredRoute,
          ...(availableRoutes.length > 0 ? { availableRoutes } : {}),
          ...(appContext ? { appContext } : {}),
        });

        if (token !== sessionTokenRef.current) {
          return { status: 'error', message: 'Guide cancelled.' };
        }

        setChecking(false);

        if (
          rawDecision.action === 'clarify' &&
          !options.confirmedPath &&
          Array.isArray(rawDecision.options) &&
          rawDecision.options.length >= 2
        ) {
          setActive(false);
          setDecision(null);
          return {
            status: 'clarify',
            goal: cleanGoal,
            question:
              rawDecision.question ||
              'Multiple paths are available. Which one would you like me to guide you through?',
            options: rawDecision.options,
          };
        }

        setGoal(cleanGoal);
        setStepNumber(1);
        setActive(true);
        setTargetRect(null);
        setPausedForInput(false);
        setSensitiveBlocked(false);
        setTargetMissing(false);

        applyStepDecision(
          rawDecision,
          1,
          token,
          (nextStep, tok) => {
            void fetchNextStep(nextStep, tok);
          },
          { recordHistory: false }
        );

        return { status: 'started' };
      } catch (err) {
        if (token !== sessionTokenRef.current) {
          return { status: 'error', message: 'Guide cancelled.' };
        }
        const msg = err instanceof Error ? err.message : 'Unable to start guide.';
        setChecking(false);
        setLoading(false);
        setError(msg);
        return { status: 'error', message: msg };
      }
    },
    [applyStepDecision, clearTimers, fetchNextStep, requestGuideStep]
  );

  // Resume automatically after a troubleshooting refresh_and_retry page reload
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(POST_REFRESH_STORAGE_KEY);
      if (raw) {
        sessionStorage.removeItem(POST_REFRESH_STORAGE_KEY);
      }
    } catch {
      raw = null;
    }
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { goal?: string; tip?: string; timestamp?: number };
      if (
        parsed?.goal &&
        (!parsed.timestamp || Date.now() - parsed.timestamp < 5 * 60 * 1000)
      ) {
        const timer = window.setTimeout(() => {
          void startGuide(parsed.goal!, {
            confirmedPath: true,
            postRefreshMessage: parsed.tip || 'App refreshed. Try again.',
          });
        }, 250);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore malformed storage
    }
  }, [startGuide]);

  const goBack = useCallback(async () => {
    if (!active || loading) return;
    const prev = historyStackRef.current.pop();
    if (!prev) {
      setCanGoBack(false);
      return;
    }

    clearTimers();
    const tok = sessionTokenRef.current + 1;
    sessionTokenRef.current = tok;

    const exitingError = currentSnapshotRef.current?.detectedError || '';
    summaryHistoryRef.current = [...prev.summaryHistory];
    troubleshootingContextRef.current = prev.troubleshootingContext;
    lastReportedErrorRef.current = prev.detectedError || exitingError || '';
    currentSnapshotRef.current = null;

    setStepNumber(prev.stepNumber);
    setDetectedError(prev.detectedError);
    setError(null);
    setLoading(false);
    setSensitiveBlocked(Boolean(prev.decision.sensitiveBlocked));
    setCanGoBack(historyStackRef.current.length > 0);

    const curRoute = typeof window !== 'undefined' ? window.location.pathname : '/';
    if (prev.route && prev.route !== curRoute) {
      if (onNavigateRef.current) {
        onNavigateRef.current(prev.route);
      } else if (typeof window !== 'undefined') {
        window.history.pushState({}, '', prev.route);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      await new Promise((r) => setTimeout(r, 200));
      if (tok !== sessionTokenRef.current) return;
    }

    applyStepDecision(
      prev.decision,
      prev.stepNumber,
      tok,
      (nextStep, nextTok) => {
        void fetchNextStep(nextStep, nextTok);
      },
      { recordHistory: false, forcePauseOnBack: true }
    );
  }, [active, loading, clearTimers, applyStepDecision, fetchNextStep]);

  const submitUserReply = useCallback(
    async (rawReply: string) => {
      const reply = rawReply.trim();
      if (!active || loading || !reply) return;

      const ctx = troubleshootingContextRef.current;

      // In follow-up guide stage, a new non-close, non-bare-yes topic launches a fresh guide immediately
      if (ctx?.stage === 'follow_up_guide') {
        if (isCloseReply(reply)) {
          void voiceRef.current?.speak('Closing guide.');
          stopGuide();
          return;
        }
        if (!isAffirmativeReply(reply)) {
          const outcome = await startGuide(reply);
          if (outcome.status === 'clarify') {
            onClarifyRequestedRef.current?.({
              goal: outcome.goal,
              question: outcome.question,
              options: outcome.options,
            });
          }
          return;
        }
      }

      setLoading(true);
      setError(null);

      const tok = sessionTokenRef.current;
      const currentRoute =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      const pageMap = getPageMap({ currentRoute });
      const previousStepSummary = compactStepHistory(summaryHistoryRef.current, 380);

      try {
        const rawDecision = await requestGuideStep({
          goal: activeGoalRef.current,
          previousStepSummary,
          stepNumber: Math.max(1, stepNumber),
          currentRoute,
          pageMap,
          confirmedPath: true,
          userReply: reply,
          ...(ctx ? { troubleshootingContext: ctx } : {}),
        });

        if (tok !== sessionTokenRef.current) return;

        applyStepDecision(rawDecision, Math.max(1, stepNumber), tok, (nextStep, nextTok) => {
          void fetchNextStep(nextStep, nextTok);
        });
      } catch (err) {
        if (tok !== sessionTokenRef.current) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Unable to process your reply.');
      }
    },
    [active, applyStepDecision, fetchNextStep, loading, requestGuideStep, startGuide, stepNumber, stopGuide]
  );

  const continueAfterInput = useCallback(async () => {
    if (!active || loading) return;
    if (decision?.action === 'complete') {
      stopGuide();
      return;
    }
    const token = sessionTokenRef.current;
    await fetchNextStep(stepNumber + 1, token);
  }, [active, loading, decision, stepNumber, fetchNextStep, stopGuide]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    active,
    checking,
    goal,
    stepNumber,
    maxSteps: totalSteps ?? MAX_GUIDE_STEPS,
    totalSteps,
    loading,
    decision,
    pausedForInput,
    sensitiveBlocked,
    targetRect,
    targetElement,
    cursorPos,
    targetMissing,
    error,
    detectedError,
    canGoBack,
    muted: effectiveMuted,
    isSpeaking,
    startGuide,
    continueAfterInput,
    goBack,
    submitUserReply,
    toggleMute,
    speakText,
    stopGuide,
  };
}
