'use client';

import { useEffect } from 'react';
import { type MotionValue, useMotionValue } from 'motion/react';

/**
 * Pipes a MediaStreamTrack's loudness (0..1) into a MotionValue every frame,
 * without re-rendering React. Used to drive the Aperture.
 */
export function useAudioLevel(track: MediaStreamTrack | undefined | null): MotionValue<number> {
  const level = useMotionValue(0);

  useEffect(() => {
    if (!track || track.readyState === 'ended' || typeof window === 'undefined') {
      level.set(0);
      return;
    }
    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Perceptual-ish curve: quiet speech ≈ 0.3, loud ≈ 0.9.
        level.set(Math.min(1, Math.pow(rms * 4.2, 0.75)));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      level.set(0);
    }
    return () => {
      cancelAnimationFrame(raf);
      level.set(0);
      void ctx?.close().catch(() => undefined);
    };
  }, [track, level]);

  return level;
}
