'use client';

import { useSyncExternalStore } from 'react';

export type OverlayMode = 'orb' | 'orb-hint' | 'strip' | 'console';

export interface ElectronAPI {
  isElectron: true;
  setMode?: (mode: OverlayMode) => void;
  onActivate?: (callback: () => void) => () => void;
  getHotkey?: () => Promise<string>;
  hide?: () => void;
  quit?: () => void;
  /** One-app VISION: tell Face Control when the mic is live (mouth gestures pause). */
  setVoiceState?: (state: { connected: boolean; live: boolean }) => void;
  isOneApp?: () => Promise<boolean>;
  /** Stage / wake-word mode: always listening, acts only on "Hey Vision". */
  isWakeMode?: () => Promise<boolean>;
}

export function getElectron(): ElectronAPI | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
  return api?.isElectron ? api : null;
}

export const DEFAULT_HOTKEY_LABEL = 'Ctrl+Alt+Space';

const noop = () => () => undefined;

/** Hydration-safe Electron check (false on the server and the first client render). */
export function useIsElectron() {
  return useSyncExternalStore(
    noop,
    () => getElectron() !== null,
    () => false
  );
}
