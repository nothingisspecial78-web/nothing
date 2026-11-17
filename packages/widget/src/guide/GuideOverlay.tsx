import React, { useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  X,
  HelpCircle,
  Eye,
  EyeOff,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import type { GuideDef, GuideStep } from '@ai-assistant/core';
import { GuideAvatarController } from './GuideAvatarController.ts';

export interface GuideOverlayProps {
  guide: GuideDef;
  currentStepIndex: number;
  currentStep: GuideStep;
  lang?: string;
  targetRect: DOMRect | null;
  targetNotFound: boolean;
  paused: boolean;
  muted: boolean;
  isSpeaking: boolean;
  stuckHint: string | null;
  offerMiniChat?: boolean;
  detectedError?: string | null;
  onNext: () => void;
  onBack: () => void;
  onRepeat: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onExit: () => void;
  onAskQuestion: () => void;
}

export function GuideOverlay({
  guide,
  currentStepIndex,
  currentStep,
  lang = 'en',
  targetRect,
  targetNotFound,
  paused,
  muted,
  isSpeaking,
  stuckHint,
  offerMiniChat = false,
  detectedError = null,
  onNext,
  onBack,
  onRepeat,
  onTogglePause,
  onToggleMute,
  onExit,
  onAskQuestion,
}: GuideOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarControllerRef = useRef<GuideAvatarController | null>(null);
  const [hideAvatar, setHideAvatar] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Load hideAvatar preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('khazna_guide_hide_avatar');
      if (saved === 'true') setHideAvatar(true);
    } catch {
      // ignore
    }
  }, []);

  // Keyboard Escape exits walkthrough immediately
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExit]);

  // Global password/sensitive field focus detection
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isSensitiveEl = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el instanceof HTMLInputElement && el.type === 'password') return true;
      return el.getAttribute('data-guide-sensitive') === 'true' || Boolean(el.closest('[data-guide-sensitive="true"]'));
    };
    setPasswordFocused(isSensitiveEl(document.activeElement));
    const onFocusIn = (e: FocusEvent) => setPasswordFocused(isSensitiveEl(e.target));
    const onFocusOut = () => {
      window.setTimeout(() => setPasswordFocused(isSensitiveEl(document.activeElement)), 20);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const toggleHideAvatar = () => {
    const next = !hideAvatar;
    setHideAvatar(next);
    try {
      localStorage.setItem('khazna_guide_hide_avatar', String(next));
    } catch {
      // ignore
    }
  };

  // Mount 3D Avatar Controller onto Canvas
  useEffect(() => {
    if (hideAvatar || !canvasRef.current) return;
    const ctrl = new GuideAvatarController(canvasRef.current);
    avatarControllerRef.current = ctrl;

    const handleResize = () => ctrl.handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ctrl.dispose();
      avatarControllerRef.current = null;
    };
  }, [hideAvatar]);

  // Sync avatar movement with targetRect
  useEffect(() => {
    const ctrl = avatarControllerRef.current;
    if (!ctrl) return;
    if (targetRect) {
      ctrl.moveToTarget({
        x: targetRect.left,
        y: targetRect.top,
        width: targetRect.width,
        height: targetRect.height,
      });
    } else {
      ctrl.moveToTarget(null);
    }
  }, [targetRect, hideAvatar]);

  const isSensitiveActive = Boolean(currentStep?.sensitive) || passwordFocused;

  // Sync sensitive privacy gesture (password fields or sensitive step)
  useEffect(() => {
    avatarControllerRef.current?.setSensitive(isSensitiveActive);
  }, [isSensitiveActive, hideAvatar]);

  // Sync speaking state
  useEffect(() => {
    avatarControllerRef.current?.setSpeaking(isSpeaking);
  }, [isSpeaking, hideAvatar]);

  const totalSteps = guide.steps.length;
  const stepNumber = currentStepIndex + 1;
  const useMl = lang === 'ml';
  const titleText = useMl && guide.title.ml ? guide.title.ml : guide.title.en;
  const instructionText =
    useMl && currentStep.instruction.ml ? currentStep.instruction.ml : currentStep.instruction.en;

  const pad = 8;
  const spotX = targetRect ? Math.max(0, targetRect.left - pad) : 0;
  const spotY = targetRect ? Math.max(0, targetRect.top - pad) : 0;
  const spotW = targetRect ? targetRect.width + pad * 2 : 0;
  const spotH = targetRect ? targetRect.height + pad * 2 : 0;

  return (
    <div
      className="aia-guide-root"
      role="dialog"
      aria-modal="false"
      aria-label="Interactive Guide Walkthrough"
    >
      {/* 1. Full-screen Spotlight Cutout Overlay (passes clicks through hole to underlying target) */}
      <svg className="aia-guide-svg" aria-hidden="true">
        <defs>
          <mask id="aia-guide-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={spotX}
                y={spotY}
                width={spotW}
                height={spotH}
                rx="14"
                ry="14"
                fill="black"
              />
            )}
          </mask>
        </defs>

        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.56)"
          mask="url(#aia-guide-spotlight-mask)"
        />

        {targetRect && (
          <rect
            x={spotX}
            y={spotY}
            width={spotW}
            height={spotH}
            rx="14"
            ry="14"
            fill="none"
            stroke="#f97316"
            strokeWidth="3"
            strokeDasharray="6 4"
            className="aia-guide-ring"
          />
        )}
      </svg>

      {/* 2. Full-viewport 3D Avatar Canvas */}
      {!hideAvatar && (
        <canvas ref={canvasRef} className="aia-guide-canvas" aria-hidden="true" />
      )}

      {/* 3. Floating Instruction Caption Card */}
      <div className="aia-guide-caption-wrap">
        <div className="aia-guide-card">
          <div className="aia-guide-header">
            <div className="aia-guide-step-meta">
              <Sparkles size={14} />
              <span>
                {titleText} · Step {stepNumber} of {totalSteps}
              </span>
            </div>
            {isSensitiveActive && (
              <span className="aia-guide-privacy-badge" data-testid="guide-privacy-badge">
                <EyeOff size={12} /> Password typing (eyes closed)
              </span>
            )}
          </div>

          <div aria-live="polite" className="aia-guide-instruction">
            {targetNotFound
              ? useMl
                ? 'സ്ക്രീനിൽ ബന്ധപ്പെട്ട ഭാഗം കാണാനില്ല. തയ്യാറാകുമ്പോൾ Next അമർത്തുക അല്ലെങ്കിൽ പേജ് പരിശോധിക്കുക.'
                : 'The target control is not visible on this screen right now. Navigate to it or click Next when ready.'
              : instructionText}
          </div>

          {detectedError && (
            <div className="aia-guide-banner aia-guide-banner-error" role="status">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} />
                {detectedError}
              </span>
            </div>
          )}

          {stuckHint && (
            <div className="aia-guide-banner aia-guide-banner-hint">
              <span>
                <strong>Hint:</strong> {stuckHint}
              </span>
              {offerMiniChat && (
                <button
                  type="button"
                  data-ai-id="guide-overlay-ask-inline-btn"
                  onClick={onAskQuestion}
                  className="aia-guide-btn aia-guide-btn-primary"
                >
                  Ask Assistant
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4. Persistent Control Dock */}
      <div className="aia-guide-dock">
        <div className="aia-guide-group">
          <button
            type="button"
            data-ai-id="guide-overlay-back-btn"
            disabled={currentStepIndex === 0}
            onClick={onBack}
            className="aia-guide-btn"
            title="Go to previous step"
            aria-label="Back"
          >
            <SkipBack size={14} />
            <span>Back</span>
          </button>
          <button
            type="button"
            data-ai-id="guide-overlay-next-btn"
            onClick={onNext}
            className="aia-guide-btn aia-guide-btn-primary"
            title="Advance to next step"
            aria-label={stepNumber === totalSteps ? 'Finish' : 'Next'}
          >
            <span>{stepNumber === totalSteps ? 'Finish' : 'Next'}</span>
            <SkipForward size={14} />
          </button>
          <button
            type="button"
            data-ai-id="guide-overlay-repeat-btn"
            onClick={onRepeat}
            className="aia-guide-btn"
            title="Repeat voice instruction"
            aria-label="Repeat"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        <div className="aia-guide-group">
          <button
            type="button"
            data-ai-id="guide-overlay-pause-btn"
            onClick={onTogglePause}
            className="aia-guide-btn"
            title={paused ? 'Resume guide' : 'Pause guide'}
            aria-label={paused ? 'Resume guide' : 'Pause guide'}
          >
            {paused ? <Play size={14} color="#34d399" /> : <Pause size={14} />}
          </button>
          <button
            type="button"
            data-ai-id="guide-overlay-mute-btn"
            onClick={onToggleMute}
            className="aia-guide-btn"
            title={muted ? 'Unmute voice' : 'Mute voice'}
            aria-label={muted ? 'Unmute voice' : 'Mute voice'}
          >
            {muted ? <VolumeX size={14} color="#fb7185" /> : <Volume2 size={14} />}
          </button>
          <button
            type="button"
            data-ai-id="guide-overlay-avatar-toggle-btn"
            onClick={toggleHideAvatar}
            className="aia-guide-btn"
            title={hideAvatar ? 'Show 3D Avatar' : 'Hide 3D Avatar'}
            aria-label={hideAvatar ? 'Show 3D Avatar' : 'Hide 3D Avatar'}
          >
            {hideAvatar ? <Eye size={14} color="#fbbf24" /> : <EyeOff size={14} />}
          </button>
        </div>

        <div className="aia-guide-group">
          <button
            type="button"
            data-ai-id="guide-overlay-ask-btn"
            onClick={onAskQuestion}
            className="aia-guide-btn"
            title="Ask a question about this step"
            aria-label="Ask"
          >
            <HelpCircle size={14} color="#fbbf24" />
            <span>Ask</span>
          </button>
          <button
            type="button"
            data-ai-id="guide-overlay-exit-btn"
            onClick={onExit}
            className="aia-guide-btn aia-guide-btn-danger"
            title="Exit guide (Esc)"
            aria-label="Exit guide"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
