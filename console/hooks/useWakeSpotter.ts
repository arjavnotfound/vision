'use client';

import { useEffect, useMemo, useRef } from 'react';
import { type WakeHeard, getElectron } from '@/lib/electron';
import type { WakeSensitivity } from '@/lib/settings';

const RATE = 16_000;
/**
 * Pre-roll: the voice session's mic starts this far before the end of the chunk the wake
 * word was heard in. The spotter reports up to 0.64 s after the word ends (T06a eval),
 * so this always holds the start of "open YouTube" in "Vision open YouTube".
 */
export const PREROLL_S = 0.8;

// One worklet does both jobs on the same samples, so positions match exactly:
// - it sends 20 ms chunks to the spotter, each with the sample count at its end (100 ms
//   chunks measured 80 ms later at p90);
// - its output is the voice session's mic: normally the live input, but after a rewind
//   it plays from the ring buffer, then catches up by dropping quiet 8 ms blocks until
//   it is live again. Speech is never dropped.
const WORKLET = `
const RING = ${RATE * 4};
const BLOCK = 128;
const SLACK = BLOCK * 2;
class WakeTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(320); this.n = 0;
    this.ring = new Float32Array(RING); this.write = 0; this.read = 0;
    this.floor = 0.01;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'rewind') this.read = Math.max(this.write - RING + BLOCK * 4, Math.min(this.write, Math.floor(data.to)));
      else if (data.type === 'live') this.read = this.write;
    };
  }
  rms(at) {
    let e = 0;
    for (let i = 0; i < BLOCK; i++) { const v = this.ring[(at + i) % RING]; e += v * v; }
    return Math.sqrt(e / BLOCK);
  }
  process(inputs, outputs) {
    const ch = inputs[0] && inputs[0][0];
    const out = outputs[0] && outputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.ring[this.write % RING] = ch[i];
      this.write++;
      this.chunk[this.n++] = ch[i];
      if (this.n === this.chunk.length) { this.port.postMessage({ samples: this.chunk.slice(), end: this.write }); this.n = 0; }
    }
    if (ch) {
      // Noise floor: the quietest recent block, rising slowly (about 3 s to double).
      const level = this.rms(this.write - ch.length);
      this.floor = Math.min(level, this.floor * 1.002 + 1e-7);
    }
    if (!out) return true;
    if (this.write - this.read > RING - BLOCK) this.read = this.write - (RING - BLOCK);
    const quiet = Math.max(this.floor * 3, 0.003);
    while (this.write - this.read > out.length + SLACK && this.rms(this.read) < quiet) this.read += BLOCK;
    for (let i = 0; i < out.length; i++) out[i] = this.read < this.write ? this.ring[this.read++ % RING] : 0;
    return true;
  }
}
registerProcessor('wake-tap', WakeTap);
`;

interface Options {
  sensitivity: WakeSensitivity;
  onHeard: (heard: WakeHeard) => void;
}

export interface WakeMic {
  /** A new track of the wake capture for the voice session, or undefined if the mic is not open. */
  takeTrack: () => MediaStreamTrack | undefined;
  /** Make the session mic replay from just before the wake word ended. */
  rewind: (end: number) => void;
  /** Drop any backlog: the session mic is live again. */
  live: () => void;
  /** About how many samples the capture has taken so far (for the wake latency log). */
  position: () => number;
}

/**
 * Streams the mic to the local "Vision" spotter in the main process, and gives the voice
 * session its mic from the same capture, with the audio from just after the wake word
 * ("Vision open YouTube" in one breath). Echo cancellation stays on, so VISION's own
 * voice is mostly removed before either hears it. Retries when the mic is missing or busy.
 */
export function useWakeSpotter({ sensitivity, onHeard }: Options): WakeMic {
  const callback = useRef(onHeard);
  useEffect(() => {
    callback.current = onHeard;
  }, [onHeard]);
  const tap = useRef<{ node: AudioWorkletNode; output: MediaStreamAudioDestinationNode }>(
    undefined
  );
  const lastChunk = useRef({ end: 0, at: 0 });

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
    let sessionContext: AudioContext | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const teardown = () => {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      void sessionContext?.close().catch(() => undefined);
      sessionContext = undefined;
      stream = undefined;
      context = undefined;
      tap.current = undefined;
    };

    const open = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            // On: through Chromium's capture it woke as often or more often in noise and
            // music (T06a, 147 vs 141 of 160). AGC stays off: it pumps after silence.
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
          },
        });
        context = new AudioContext({ sampleRate: RATE });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
        await context.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        if (stopped) return teardown();
        const node = new AudioWorkletNode(context, 'wake-tap');
        node.port.onmessage = (event) => {
          const { samples, end } = event.data as { samples: Float32Array; end: number };
          lastChunk.current = { end, at: performance.now() };
          electron.sendWakeAudio?.(samples, end);
        };
        context.createMediaStreamSource(stream).connect(node);
        const spotted = context.createMediaStreamDestination();
        node.connect(spotted);
        // The session gets a mono 48 kHz track like a normal mic: LiveKit's pre-connect
        // buffer labels its recording that way, and a stereo track reached the agent at half
        // speed.
        sessionContext = new AudioContext({ sampleRate: 48_000 });
        // Mono: destinations default to stereo, and LiveKit labels the recording mono.
        const output = new MediaStreamAudioDestinationNode(sessionContext, {
          channelCount: 1,
          channelCountMode: 'explicit',
        });
        sessionContext.createMediaStreamSource(spotted.stream).connect(output);
        tap.current = { node, output };
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

  return useMemo(
    () => ({
      // A clone per session: ending a session stops its track, not the capture.
      takeTrack: () => tap.current?.output.stream.getAudioTracks()[0]?.clone(),
      rewind: (end: number) =>
        tap.current?.node.port.postMessage({ type: 'rewind', to: end - PREROLL_S * RATE }),
      live: () => tap.current?.node.port.postMessage({ type: 'live' }),
      position: () =>
        lastChunk.current.end + ((performance.now() - lastChunk.current.at) * RATE) / 1000,
    }),
    []
  );
}
