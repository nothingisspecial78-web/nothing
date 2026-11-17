export interface VoiceControllerOptions {
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
  onLipSyncBoundary?: (charIndex: number) => void;
  apiUrl?: string;
  appId?: string;
  defaultLang?: string;
  getAuthToken?: () => string | Promise<string>;
}

export interface LocalizedString {
  en: string;
  ml?: string;
}

export class VoiceController {
  private muted = false;
  private defaultLang: 'en' | 'ml' = 'en';
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private isSpeaking = false;
  private options: VoiceControllerOptions;

  constructor(options: VoiceControllerOptions = {}) {
    this.options = options;
    this.defaultLang = options.defaultLang === 'ml' ? 'ml' : 'en';
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('khazna_guide_muted');
        this.muted = saved === 'true';
      } catch {
        // ignore
      }
    }
  }

  setLanguage(lang: string): void {
    this.defaultLang = lang === 'ml' ? 'ml' : 'en';
  }

  getLanguage(): 'en' | 'ml' {
    return this.defaultLang;
  }

  resolveText(val: LocalizedString | string | undefined | null, lang?: string): string {
    if (!val) return '';
    if (typeof val === 'string') return val;
    const effective = lang === 'ml' ? 'ml' : lang === 'en' ? 'en' : this.defaultLang;
    if (effective === 'ml' && val.ml && val.ml.trim().length > 0) {
      return val.ml;
    }
    return val.en;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('khazna_guide_muted', String(muted));
      } catch {
        // ignore
      }
    }
    if (muted) {
      this.stop();
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  stop(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.currentUtterance = null;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.options.onSpeakEnd?.();
    }
  }

  destroy(): void {
    this.stop();
  }

  /**
   * Speaks the given text using browser SpeechSynthesis with English default / Malayalam optional voice selection,
   * falling back to POST /api/assistant/guides/tts when needed.
   */
  async speak(
    text: string,
    lang?: 'en' | 'ml' | string,
    meta?: { guideId?: string; stepId?: string }
  ): Promise<void> {
    if (this.muted || !text || text.trim().length === 0) return;
    if (typeof window === 'undefined') return;

    const targetLang: 'en' | 'ml' = lang === 'ml' ? 'ml' : lang === 'en' ? 'en' : this.defaultLang;
    this.stop();

    if ('speechSynthesis' in window) {
      try {
        const voices = window.speechSynthesis.getVoices();
        let chosenVoice: SpeechSynthesisVoice | null = null;

        if (targetLang === 'ml') {
          chosenVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ml')) || null;
        } else {
          chosenVoice =
            voices.find((v) => v.lang === 'en-IN') ||
            voices.find((v) => v.lang === 'en-US' && v.name.includes('Natural')) ||
            voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
            null;
        }

        if (chosenVoice || (targetLang === 'en' && typeof SpeechSynthesisUtterance !== 'undefined')) {
          const utterance = new SpeechSynthesisUtterance(text);
          if (chosenVoice) utterance.voice = chosenVoice;
          utterance.lang = chosenVoice?.lang || (targetLang === 'ml' ? 'ml-IN' : 'en-US');
          utterance.rate = 1.0;
          utterance.pitch = 1.05;

          utterance.onstart = () => {
            this.isSpeaking = true;
            this.options.onSpeakStart?.();
          };

          utterance.onend = () => {
            this.isSpeaking = false;
            this.options.onSpeakEnd?.();
          };

          utterance.onerror = () => {
            this.isSpeaking = false;
            this.options.onSpeakEnd?.();
          };

          utterance.onboundary = (e) => {
            this.options.onLipSyncBoundary?.(e.charIndex);
          };

          this.currentUtterance = utterance;
          window.speechSynthesis.speak(utterance);
          return;
        }
      } catch {
        // Fall through to server TTS
      }
    }

    // Server TTS Fallback if browser synthesis lacks voice or fails
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.options.appId) headers['x-app-id'] = this.options.appId;
      if (this.options.getAuthToken) {
        const token = await this.options.getAuthToken();
        if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }
      const endpoint = `${(this.options.apiUrl || '').replace(/\/$/, '')}/api/assistant/guides/tts`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text,
          lang: targetLang,
          guideId: meta?.guideId,
          stepId: meta?.stepId,
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.currentAudio = audio;

        audio.onplay = () => {
          this.isSpeaking = true;
          this.options.onSpeakStart?.();
        };

        audio.onended = () => {
          this.isSpeaking = false;
          this.options.onSpeakEnd?.();
          URL.revokeObjectURL(url);
        };

        audio.onerror = () => {
          this.isSpeaking = false;
          this.options.onSpeakEnd?.();
          URL.revokeObjectURL(url);
        };

        await audio.play();
      }
    } catch {
      // Gracefully fall back to captions only
      this.isSpeaking = false;
      this.options.onSpeakEnd?.();
    }
  }
}
