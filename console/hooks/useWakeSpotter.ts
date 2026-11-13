'use client';

import { useEffect, useRef } from 'react';
import { type WakeHeard, getElectron } from '@/lib/electron';
import type { WakeSensitivity } from '@/lib/settings';

const RATE = 16_000;
// 100 ms chunks: the spotter decodes in larger steps anyway.
const WORKLET = `
class WakeTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1600); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('wake-tap', WakeTap);
`;

interface Options {
  sensitivity: WakeSensitivity;
  onHeard: (heard: WakeHeard) => void;
}

/**
 * Streams the mic to the local "Vision" spotter in the main process. Echo cancellation
 * stays on, so VISION's own voice is mostly removed before the spotter hears it. Retries
 * when the mic is missing or busy.
 */
export function useWakeSpotter({ sensitivity, onHeard }: Options) {
  const callback = useRef(onHeard);
  useEffect(() => {
    callback.current = onHeard;
  }, [onHeard]);

  useEffect(() => {
    getElectron()?.setWakeSensitivity?.(sensitivity);
  }, [sensitivity]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.sendWakeAudio || !electron.onWake) return;
    const unsubscribe = electron.onWake((heard) => callback.current(heard));
    let stopped = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const teardown = () => {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      stream = undefined;
      context = undefined;
    };

    const open = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            // Off: the spotter was trained on unprocessed speech, and AGC pumps after silence.
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
        });
        context = new AudioContext({ sampleRate: RATE });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
        await context.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        if (stopped) return teardown();
        const tap = new AudioWorkletNode(context, 'wake-tap');
        tap.port.onmessage = (event) => electron.sendWakeAudio?.(event.data as Float32Array);
        context.createMediaStreamSource(stream).connect(tap);
        // Unplugged mic: start again when a device comes back.
        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          teardown();
          if (!stopped) retry = setTimeout(open, 3_000);
        });
      } catch (error) {
        console.warn('[VISION] Wake word mic unavailable, retrying:', error);
        teardown();
        if (!stopped) retry = setTimeout(open, 5_000);
      }
    };
    void open();

    return () => {
      stopped = true;
      clearTimeout(retry);
      unsubscribe();
      teardown();
    };
  }, []);
}
