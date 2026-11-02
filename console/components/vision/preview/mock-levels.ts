'use client';

import { useAnimationFrame, useMotionValue } from 'motion/react';

/** A fake 0..1 audio level that looks like speech: syllable bursts with pauses. */
export function useMockLevel(enabled = true, seed = 0) {
  const level = useMotionValue(0);
  useAnimationFrame((time) => {
    if (!enabled) {
      level.set(0);
      return;
    }
    const t = time / 1000 + seed;
    const syllables = Math.max(0, Math.sin(t * 9.5) * 0.5 + Math.sin(t * 4.1 + 1) * 0.35);
    const phrase = Math.sin(t * 0.9) > -0.3 ? 1 : 0.15;
    level.set(Math.min(1, syllables * phrase * 1.1));
  });
  return level;
}
