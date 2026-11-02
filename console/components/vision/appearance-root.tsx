'use client';

import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { MotionConfig } from 'motion/react';
import { getElectron } from '@/lib/electron';
import { useSettings } from '@/lib/settings';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

/** True when the OS asks for reduced motion OR the user turned it on in Settings. */
export function useReducedMotionPref() {
  const { reducedMotion } = useSettings();
  const system = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
  return reducedMotion || system;
}

/** Applies theme + reduced-motion to <html> and configures Motion globally. */
export function AppearanceRoot({ children }: { children: ReactNode }) {
  const { theme } = useSettings();
  const reduced = useReducedMotionPref();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.reducedMotion = String(reduced);
    if (getElectron()) root.classList.add('is-electron');
  }, [theme, reduced]);

  return <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig>;
}
