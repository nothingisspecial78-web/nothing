import type { GuideDef, GuideStep } from '@ai-assistant/core';
import { TargetResolver } from './TargetResolver.ts';
import { VoiceController } from './VoiceController.ts';

export type GuideState = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'aborted';

export interface GuideEngineOptions {
  apiUrl?: string;
  appId?: string;
  defaultLang?: string;
  getAuthToken?: () => string | Promise<string>;
  onStateChange?: (state: GuideState) => void;
  onStepChange?: (step: GuideStep, stepIndex: number, totalSteps: number) => void;
  onTargetUpdate?: (rect: DOMRect | null, notFound: boolean) => void;
  onSpeakChange?: (speaking: boolean) => void;
  onStuckHint?: (hint: string | null) => void;
  onOfferMiniChat?: (offer: boolean) => void;
  onDetectedError?: (message: string | null) => void;
  onComplete?: (guide: GuideDef) => void;
  onAbort?: (guide: GuideDef) => void;
  onAskMiniChat?: (query: string) => void;
}

const STORAGE_KEY = 'khazna_guide_active';

export class GuideEngine {
  private state: GuideState = 'idle';
  private guide: GuideDef | null = null;
  private currentStepIndex = 0;
  private lang = 'en';

  public targetResolver: TargetResolver;
  public voiceController: VoiceController;

  private cleanupListeners: Array<() => void> = [];
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  private miniChatTimer: ReturnType<typeof setTimeout> | null = null;
  private options: GuideEngineOptions;
  private stepRunNonce = 0;

  constructor(options: GuideEngineOptions = {}) {
    this.options = options;
    this.lang = options.defaultLang === 'ml' ? 'ml' : 'en';
    this.targetResolver = new TargetResolver();
    this.voiceController = new VoiceController({
      apiUrl: options.apiUrl,
      appId: options.appId,
      defaultLang: this.lang,
      getAuthToken: options.getAuthToken,
      onSpeakStart: () => this.options.onSpeakChange?.(true),
      onSpeakEnd: () => this.options.onSpeakChange?.(false),
    });
  }

  public getState(): GuideState {
    return this.state;
  }

  public getActiveGuide(): GuideDef | null {
    return this.guide;
  }

  public getCurrentStep(): GuideStep | null {
    if (!this.guide || this.currentStepIndex >= this.guide.steps.length) return null;
    return this.guide.steps[this.currentStepIndex];
  }

  public getCurrentStepIndex(): number {
    return this.currentStepIndex;
  }

  public getTotalSteps(): number {
    return this.guide ? this.guide.steps.length : 0;
  }

  public setLanguage(lang: string): void {
    this.lang = lang === 'ml' ? 'ml' : 'en';
    this.voiceController.setLanguage(this.lang);
  }

  public async start(guide: GuideDef, startStepId?: string): Promise<void> {
    this.cleanupStep();
    this.guide = guide;
    this.currentStepIndex = 0;

    if (startStepId) {
      const idx = guide.steps.findIndex((s) => s.stepId === startStepId);
      if (idx >= 0) this.currentStepIndex = idx;
    }

    this.setState('running');
    this.saveProgress();
    void this.postProgress(guide.guideId, this.getCurrentStep()?.stepId || 'start', 'started');
    await this.executeCurrentStep();
  }

  public async next(): Promise<void> {
    if (!this.guide) return;
    if (this.currentStepIndex < this.guide.steps.length - 1) {
      this.currentStepIndex++;
      this.saveProgress();
      await this.executeCurrentStep();
    } else {
      await this.complete();
    }
  }

  public async back(): Promise<void> {
    if (!this.guide || this.currentStepIndex <= 0) return;
    this.currentStepIndex--;
    this.saveProgress();
    await this.executeCurrentStep();
  }

  public async repeat(): Promise<void> {
    if (!this.guide) return;
    await this.executeCurrentStep();
  }

  public pause(): void {
    if (this.state !== 'running') return;
    this.setState('paused');
    this.clearTimers();
    this.voiceController.stop();
  }

  public resume(): void {
    if (this.state !== 'paused') return;
    this.setState('running');
    void this.executeCurrentStep();
  }

  public async complete(): Promise<void> {
    this.stepRunNonce += 1;
    this.clearTimers();
    this.cleanupStep();
    this.setState('completed');
    GuideEngine.clearSavedProgress();

    const finishedGuide = this.guide;
    if (finishedGuide) {
      void this.postProgress(
        finishedGuide.guideId,
        finishedGuide.steps[finishedGuide.steps.length - 1]?.stepId || 'complete',
        'completed'
      );
      const finalMsg =
        this.voiceController.resolveText(finishedGuide.completion?.message, this.lang) ||
        (this.lang === 'ml'
          ? 'അഭിനന്ദനങ്ങൾ! ഈ ഘട്ടങ്ങൾ വിജയകരമായി പൂർത്തിയായി.'
          : 'Great job! Walkthrough complete.');
      await this.voiceController.speak(finalMsg, this.lang, {
        guideId: finishedGuide.guideId,
        stepId: 'complete',
      });
      this.options.onTargetUpdate?.(null, false);
      this.options.onStuckHint?.(null);
      this.options.onOfferMiniChat?.(false);
      this.options.onDetectedError?.(null);
      this.options.onComplete?.(finishedGuide);
    }
  }

  public abort(): void {
    this.stepRunNonce += 1;
    this.clearTimers();
    this.cleanupStep();
    this.setState('aborted');
    GuideEngine.clearSavedProgress();
    this.voiceController.stop();
    this.options.onTargetUpdate?.(null, false);
    this.options.onStuckHint?.(null);
    this.options.onOfferMiniChat?.(false);
    this.options.onDetectedError?.(null);
    if (this.guide) {
      const lastStep = this.getCurrentStep()?.stepId || 'aborted';
      void this.postProgress(this.guide.guideId, lastStep, 'abandoned');
      this.options.onAbort?.(this.guide);
    }
  }

  private setState(state: GuideState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private saveProgress(): void {
    if (typeof window === 'undefined' || !this.guide) return;
    try {
      const current = this.getCurrentStep();
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          guideId: this.guide.guideId,
          title: this.guide.title,
          stepId: current?.stepId,
          stepIndex: this.currentStepIndex,
          totalSteps: this.guide.steps.length,
          timestamp: Date.now(),
        })
      );
    } catch {
      // ignore
    }
  }

  public static clearSavedProgress(): void {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  public static getSavedProgress(): {
    guideId: string;
    title?: { en: string; ml?: string };
    stepId?: string;
    stepIndex?: number;
    totalSteps?: number;
  } | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.guideId === 'string' && Date.now() - parsed.timestamp < 2 * 60 * 60 * 1000) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async postProgress(
    guideId: string,
    stepId: string,
    status: 'started' | 'step_reached' | 'completed' | 'abandoned'
  ): Promise<void> {
    if (typeof fetch === 'undefined') return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.options.appId) headers['x-app-id'] = this.options.appId;
      if (this.options.getAuthToken) {
        const token = await this.options.getAuthToken();
        if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }
      const base = (this.options.apiUrl || '').replace(/\/$/, '');
      await fetch(`${base}/api/assistant/guides/${encodeURIComponent(guideId)}/progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ guideId, stepId, status }),
      });
    } catch {
      // non-blocking telemetry
    }
  }

  private async executeCurrentStep(): Promise<void> {
    const step = this.getCurrentStep();
    if (!step || !this.guide) return;

    const runId = ++this.stepRunNonce;
    this.clearTimers();
    this.cleanupStep();
    this.options.onStuckHint?.(null);
    this.options.onOfferMiniChat?.(false);
    this.options.onDetectedError?.(null);

    this.options.onStepChange?.(step, this.currentStepIndex, this.guide.steps.length);
    void this.postProgress(this.guide.guideId, step.stepId, 'step_reached');

    // Resolve target element on screen
    const resolved = await this.targetResolver.waitForTarget(step.target, 8000);
    if (runId !== this.stepRunNonce || this.state !== 'running') return;

    const targetEl = resolved.element;
    this.options.onTargetUpdate?.(resolved.rect, resolved.notFound);

    if (targetEl) {
      this.trackTargetGeometry(targetEl);
    }

    // Speak Voice Narration (English default, Malayalam if explicitly enabled)
    const narration =
      this.voiceController.resolveText(step.voice || step.instruction, this.lang) ||
      this.voiceController.resolveText(step.instruction, this.lang);
    void this.voiceController.speak(narration, this.lang, {
      guideId: this.guide.guideId,
      stepId: step.stepId,
    });

    // Observe on-screen errors/alerts during this step
    this.attachErrorObserver();

    // Wire Step Advance Detection
    this.attachAdvanceListeners(step, targetEl);

    // Setup Stuck Timers (15s hint, 45s mini-chat offer)
    this.setupStuckTimers(step);
  }

  private trackTargetGeometry(targetEl: HTMLElement): void {
    const updateRect = () => {
      if (!targetEl.isConnected) {
        this.options.onTargetUpdate?.(null, true);
        return;
      }
      this.options.onTargetUpdate?.(targetEl.getBoundingClientRect(), false);
    };

    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateRect);
      ro.observe(targetEl);
    }

    this.cleanupListeners.push(() => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
      ro?.disconnect();
    });
  }

  private attachErrorObserver(): void {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    let lastError = '';
    const checkAlerts = () => {
      const alertEls = document.querySelectorAll<HTMLElement>(
        '[role="alert"], [data-sonner-toast][data-type="error"], .aia-guide-error-watch'
      );
      for (const el of Array.from(alertEls)) {
        if (el.closest('.aia-guide-root')) continue;
        const msg = (el.textContent || '').trim();
        if (msg && msg.length > 3 && msg !== lastError) {
          lastError = msg;
          this.options.onDetectedError?.(msg);
          void this.voiceController.speak(msg, this.lang);
          return;
        }
      }
    };
    const mo = new MutationObserver(checkAlerts);
    mo.observe(document.body, { childList: true, subtree: true });
    this.cleanupListeners.push(() => mo.disconnect());
  }

  private attachAdvanceListeners(step: GuideStep, targetEl: HTMLElement | null): void {
    const condition = step.completeWhen;
    if (!condition || condition.type === 'manual') return;

    if (condition.type === 'click' && targetEl) {
      const handler = () => {
        setTimeout(() => void this.next(), 240);
      };
      targetEl.addEventListener('click', handler, { once: true });
      this.cleanupListeners.push(() => targetEl.removeEventListener('click', handler));
      return;
    }

    if (condition.type === 'valueFilled' && targetEl) {
      const inputEl =
        targetEl.tagName === 'INPUT' || targetEl.tagName === 'TEXTAREA'
          ? (targetEl as HTMLInputElement | HTMLTextAreaElement)
          : (targetEl.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null);

      if (inputEl) {
        const regex = condition.pattern ? new RegExp(condition.pattern) : null;
        const minLen = condition.minLength ?? 1;
        const handler = () => {
          const val = inputEl.value.trim();
          const okLen = val.length >= minLen;
          const okPattern = regex ? regex.test(val) : true;
          if (okLen && okPattern) {
            setTimeout(() => void this.next(), 360);
          }
        };
        inputEl.addEventListener('change', handler);
        inputEl.addEventListener('blur', handler);
        this.cleanupListeners.push(() => {
          inputEl.removeEventListener('change', handler);
          inputEl.removeEventListener('blur', handler);
        });
      }
      return;
    }

    if (condition.type === 'valueChanged' && targetEl) {
      const ctrl =
        targetEl.tagName === 'SELECT' || targetEl.tagName === 'INPUT' || targetEl.tagName === 'TEXTAREA'
          ? targetEl
          : targetEl.querySelector('select, input, textarea');
      if (ctrl) {
        const handler = () => {
          setTimeout(() => void this.next(), 260);
        };
        ctrl.addEventListener('change', handler, { once: true });
        this.cleanupListeners.push(() => ctrl.removeEventListener('change', handler));
      }
      return;
    }

    if (condition.type === 'fileSelected' && targetEl) {
      const fileInput =
        targetEl.tagName === 'INPUT' && targetEl.getAttribute('type') === 'file'
          ? (targetEl as HTMLInputElement)
          : (targetEl.querySelector('input[type="file"]') as HTMLInputElement | null);

      if (fileInput) {
        const handler = () => {
          if (fileInput.files && fileInput.files.length > 0) {
            setTimeout(() => void this.next(), 300);
          }
        };
        fileInput.addEventListener('change', handler, { once: true });
        this.cleanupListeners.push(() => fileInput.removeEventListener('change', handler));
      }
      return;
    }

    if (condition.type === 'routeChanged') {
      const expected = condition.to;
      const checkRoute = () => {
        if (typeof window !== 'undefined' && window.location.pathname.includes(expected)) {
          void this.next();
        }
      };
      const pollId = window.setInterval(checkRoute, 350);
      window.addEventListener('popstate', checkRoute);
      this.cleanupListeners.push(() => {
        window.clearInterval(pollId);
        window.removeEventListener('popstate', checkRoute);
      });
      return;
    }

    if (condition.type === 'elementAppears') {
      const watchId = condition.guideId;
      const mo = new MutationObserver(() => {
        const el = document.querySelector<HTMLElement>(`[data-guide-id="${watchId}"]`);
        if (el && this.targetResolver.isVisible(el)) {
          mo.disconnect();
          setTimeout(() => void this.next(), 240);
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      this.cleanupListeners.push(() => mo.disconnect());
    }
  }

  private setupStuckTimers(step: GuideStep): void {
    // 15-second stuck hint
    this.stuckTimer = setTimeout(() => {
      if (this.state !== 'running') return;
      const fallbackHint =
        this.lang === 'ml'
          ? 'ഹൈലൈറ്റ് ചെയ്ത ഭാഗം പരിശോധിച്ച് അടുത്ത ഘട്ടത്തിലേക്ക് പോകുക.'
          : 'Click or complete the highlighted control to continue, or click Next.';
      const hintText = this.voiceController.resolveText(step.hint, this.lang) || fallbackHint;
      this.options.onStuckHint?.(hintText);
      void this.voiceController.speak(hintText, this.lang, {
        guideId: this.guide?.guideId,
        stepId: `${step.stepId}-hint`,
      });
    }, 15000);

    // 45-second offer mini-chat
    this.miniChatTimer = setTimeout(() => {
      if (this.state !== 'running') return;
      this.options.onOfferMiniChat?.(true);
      const offer =
        this.lang === 'ml'
          ? 'സഹായം വേണമെന്നുണ്ടോ? ഈ ഘട്ടത്തെക്കുറിച്ച് ചോദിക്കാൻ Ask ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.'
          : 'Need extra help? Click Ask below and I will explain this step.';
      void this.voiceController.speak(offer, this.lang, {
        guideId: this.guide?.guideId,
        stepId: `${step.stepId}-help`,
      });
    }, 45000);
  }

  private clearTimers(): void {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
    if (this.miniChatTimer) {
      clearTimeout(this.miniChatTimer);
      this.miniChatTimer = null;
    }
  }

  private cleanupStep(): void {
    this.targetResolver.cancel();
    this.cleanupListeners.forEach((cleanup) => cleanup());
    this.cleanupListeners = [];
  }

  public destroy(): void {
    this.stepRunNonce += 1;
    this.clearTimers();
    this.cleanupStep();
    this.voiceController.destroy();
  }
}
