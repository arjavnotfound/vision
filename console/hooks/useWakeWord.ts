'use client';

import { useEffect, useRef, useState } from 'react';

interface UseWakeWordOptions {
  onWakeWord: () => void;
  /** Only listen while true. Callers gate this behind the "experimental" setting. */
  enabled?: boolean;
}

const WAKE_PHRASES = ['hey vision', 'hey, vision', 'a vision'];

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

/**
 * EXPERIMENTAL "Hey Vision" wake word using the Web Speech API.
 *
 * Electron does not ship Chrome's cloud speech service, so this usually cannot work
 * in the desktop overlay. It is off by default and fails silently: any error simply
 * stops it. Dwell, hotkey and click are the primary activation paths.
 * Audio never reaches Gemini from here; recognition runs in the browser engine.
 */
export function useWakeWord({ onWakeWord, enabled = false }: UseWakeWordOptions) {
  const [isListening, setIsListening] = useState(false);
  const callback = useRef(onWakeWord);

  useEffect(() => {
    callback.current = onWakeWord;
  }, [onWakeWord]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => Recognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
        .webkitSpeechRecognition;
    if (!Ctor) return;

    let stopped = false;
    let recognition: Recognition;
    try {
      recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0]?.transcript.toLowerCase() ?? '';
          if (WAKE_PHRASES.some((phrase) => text.includes(phrase))) {
            callback.current();
            break;
          }
        }
      };
      // Fatal errors (no service, no permission) end it for good. Silently.
      recognition.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') stopped = true;
      };
      recognition.onend = () => {
        setIsListening(false);
        if (stopped) return;
        setTimeout(() => {
          if (stopped) return;
          try {
            recognition.start();
            setIsListening(true);
          } catch {
            stopped = true;
          }
        }, 400);
      };
      recognition.start();
      setIsListening(true);
    } catch {
      return;
    }

    return () => {
      stopped = true;
      setIsListening(false);
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    };
  }, [enabled]);

  return { isListening };
}
