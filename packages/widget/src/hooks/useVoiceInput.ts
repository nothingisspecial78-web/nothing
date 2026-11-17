import { useCallback, useEffect, useRef, useState } from 'react';
import { parseJsonSafely } from '../utils/safeFetchJson.ts';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export type VoiceInputState = 'idle' | 'listening' | 'transcribing';

export interface UseVoiceInputOptions {
  apiUrl?: string;
  appId?: string;
  language?: 'auto' | 'en' | 'ml' | string;
  getAuthToken?: () => string | Promise<string>;
  onTranscript: (transcript: string) => void;
}

export function useVoiceInput({
  apiUrl = '',
  appId = 'khazna-ledger',
  language = 'auto',
  getAuthToken,
  onTranscript,
}: UseVoiceInputOptions) {
  const [recordingState, setRecordingState] = useState<VoiceInputState>('idle');
  const [micError, setMicError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const getAuthTokenRef = useRef(getAuthToken);
  getAuthTokenRef.current = getAuthToken;

  const stopVoiceInput = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        setRecordingState('idle');
      }
    } else {
      setRecordingState('idle');
    }
  }, []);

  useEffect(() => () => stopVoiceInput(), [stopVoiceInput]);

  const startMediaRecorder = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setMicError('Microphone recording is not supported in this browser.');
      setRecordingState('idle');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) mediaChunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(mediaChunksRef.current, { type: mimeType });
        if (blob.size === 0) {
          setRecordingState('idle');
          return;
        }
        setRecordingState('transcribing');
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const dataUrl = String(reader.result || '');
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            const baseUrl = apiUrl ? apiUrl.replace(/\/$/, '') : '';
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'x-app-id': appId,
            };
            if (getAuthTokenRef.current) {
              const token = await getAuthTokenRef.current();
              if (token) {
                headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
              }
            }
            const res = await fetch(`${baseUrl}/api/transcribe`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                audioBase64: base64,
                mimeType,
                language: language === 'auto' ? undefined : language,
              }),
            });
            const { data: json, errorMessage } = await parseJsonSafely<{ text?: string; error?: string }>(
              res,
              'Transcription failed'
            );
            if (!res.ok || !json || errorMessage) {
              throw new Error(json?.error || errorMessage || `Transcription failed (${res.status})`);
            }
            if (json.text?.trim()) {
              onTranscriptRef.current(json.text.trim());
            } else {
              setMicError('No speech detected. Try again.');
            }
          } catch (err) {
            setMicError(err instanceof Error ? err.message : 'Voice transcription failed.');
          } finally {
            setRecordingState('idle');
            mediaRecorderRef.current = null;
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingState('listening');
    } catch {
      setMicError('Microphone permission denied or unavailable.');
      setRecordingState('idle');
    }
  }, [apiUrl, appId, language]);

  const toggleVoiceInput = useCallback(() => {
    setMicError(null);

    if (recordingState === 'listening') {
      stopVoiceInput();
      return;
    }

    if (recordingState === 'transcribing') return;

    const SpeechCtor =
      typeof window !== 'undefined'
        ? ((window as unknown as Record<string, unknown>).SpeechRecognition ||
            (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
        : undefined;

    if (typeof SpeechCtor === 'function') {
      try {
        const rec = new (SpeechCtor as new () => SpeechRecognitionInstance)();
        rec.lang = language === 'ml' ? 'ml-IN' : 'en-IN';
        rec.continuous = false;
        rec.interimResults = false;

        let captured = false;
        rec.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((r) => r[0]?.transcript || '')
            .join(' ')
            .trim();
          if (transcript) {
            captured = true;
            onTranscriptRef.current(transcript);
          }
        };
        rec.onerror = (ev) => {
          recognitionRef.current = null;
          if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
            setMicError('Microphone permission denied.');
            setRecordingState('idle');
            return;
          }
          void startMediaRecorder();
        };
        rec.onend = () => {
          recognitionRef.current = null;
          if (captured || mediaRecorderRef.current) {
            setRecordingState((cur) =>
              cur === 'listening' && !mediaRecorderRef.current ? 'idle' : cur
            );
          } else {
            setRecordingState('idle');
          }
        };

        recognitionRef.current = rec;
        setRecordingState('listening');
        rec.start();
        return;
      } catch {
        recognitionRef.current = null;
      }
    }

    void startMediaRecorder();
  }, [language, recordingState, startMediaRecorder, stopVoiceInput]);

  const clearMicError = useCallback(() => {
    setMicError(null);
  }, []);

  return {
    recordingState,
    micError,
    clearMicError,
    toggleVoiceInput,
    stopVoiceInput,
  };
}
