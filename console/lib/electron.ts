'use client';

import { useSyncExternalStore } from 'react';

export type OverlayMode = 'orb' | 'orb-hint' | 'strip' | 'console';

export type VoiceLanguage = 'auto' | 'en' | 'hi';
export interface VoiceConfig {
  voice: string;
  language: VoiceLanguage;
  hasKeys: boolean;
  voices: { name: string; style: string }[];
  keyFields: { name: string; label: string; secret: boolean }[];
}

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
  /** LiveKit server URL + token, minted by the VISION main process. */
  getConnectionDetails?: (options: { agentName?: string }) => Promise<{
    serverUrl: string;
    roomName: string;
    participantName: string;
    participantToken: string;
  }>;
  getVoiceConfig?: () => Promise<VoiceConfig>;
  setVoiceConfig?: (
    change: Partial<Pick<VoiceConfig, 'voice' | 'language'>>
  ) => Promise<Pick<VoiceConfig, 'voice' | 'language'>>;
  saveVoiceKeys?: (keys: Record<string, string>) => Promise<VoiceConfig>;
  onVoiceConfigChanged?: (
    callback: (config: Pick<VoiceConfig, 'voice' | 'language'>) => void
  ) => () => void;
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
