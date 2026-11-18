'use client';

import { useSyncExternalStore } from 'react';

/** What the island shows; the window takes the mouse only for 'menu'. */
/** controls: the caption pill with Stop or Yes/No under it (the window takes the mouse). */
export type IslandMode = 'idle' | 'caption' | 'controls' | 'menu';
export type IslandPosition = 'top-center' | 'top-right' | 'bottom-center';
export type WakePhrase = 'hey-vision' | 'vision';
/** Pages of the VISION window the island menu opens. */
export type VisionPage = 'settings' | 'diagnostics' | 'help' | 'voice' | 'home';

/** Face control as Face Control reports it to the island. */
export interface FaceStatus {
  tracking: boolean;
  seen: boolean;
  /** Closing the eyes for 2 s pauses and resumes. */
  eyesResume: boolean;
}

export type VoiceLanguage = 'auto' | 'en' | 'hi';
export interface VoiceConfig {
  voice: string;
  language: VoiceLanguage;
  hasKeys: boolean;
  voices: { name: string; style: string; label?: string }[];
  keyFields: { name: string; label: string; secret: boolean }[];
}

/** A keyword the local spotter heard. ok: it started after a pause (the second check). */
export interface WakeHeard {
  keyword: 'vision' | 'hey_vision' | 'stop' | 'cancel' | 'menu';
  ok: boolean;
  /** What main's wake gate decided (ignored keywords are never sent). */
  action?: 'wake' | 'stop' | 'menu';
  /** Mic sample count (from sendWakeAudio) at the end of the chunk it was heard in. */
  end?: number;
}

export interface ElectronAPI {
  isElectron: true;
  setMode?: (mode: IslandMode) => void;
  setPosition?: (position: IslandPosition) => void;
  /** The cursor is within 80 px of the island. */
  onNear?: (callback: (near: boolean) => void) => () => void;
  /** Dwell progress on the island, 0..1 (measured in main). */
  onDwell?: (callback: (progress: number) => void) => () => void;
  /** Main opens (dwell, menu hotkey) or closes (left alone, cursor far away) the menu. */
  onMenu?: (callback: (action: string) => void) => () => void;
  /** vision:navigate: open the VISION window on a page. */
  navigate?: (page: VisionPage) => void;
  setWakePhrase?: (phrase: WakePhrase) => void;
  showFace?: () => void;
  togglePause?: () => void;
  onFullScreen?: (callback: (on: boolean) => void) => () => void;
  onFaceStatus?: (callback: (status: FaceStatus) => void) => () => void;
  onActivate?: (callback: () => void) => () => void;
  getHotkey?: () => Promise<string>;
  hide?: () => void;
  quit?: () => void;
  /** One-app VISION: tell Face Control when the mic is live (mouth gestures pause). */
  setVoiceState?: (state: { connected: boolean; live: boolean; open: boolean }) => void;
  isOneApp?: () => Promise<boolean>;
  /** LiveKit server URL + token, minted by the VISION main process. */
  getConnectionDetails?: (options: { agentName?: string }) => Promise<{
    serverUrl: string;
    roomName: string;
    participantName: string;
    participantToken: string;
  }>;
  /** Wake word: 16 kHz mono mic audio for the local spotter (never leaves the PC). */
  sendWakeAudio?: (samples: Float32Array, end: number) => void;
  reportWakeSound?: (ms: number) => void;
  setWakeSensitivity?: (sensitivity: 'relaxed' | 'normal') => void;
  /** Open the one Settings view (in the face window). */
  openSettings?: (section?: 'voice') => void;
  getSettings?: () => Promise<MainSettings>;
  migrateSettings?: (old: unknown) => Promise<MainSettings>;
  onSettings?: (callback: (settings: MainSettings) => void) => () => void;
  onWake?: (callback: (heard: WakeHeard) => void) => () => void;
  getVoiceConfig?: () => Promise<VoiceConfig>;
  setVoiceConfig?: (
    change: Partial<Pick<VoiceConfig, 'voice' | 'language'>>
  ) => Promise<Pick<VoiceConfig, 'voice' | 'language'>>;
  saveVoiceKeys?: (keys: Record<string, string>) => Promise<VoiceConfig>;
  onVoiceConfigChanged?: (
    callback: (config: Partial<Pick<VoiceConfig, 'voice' | 'language' | 'hasKeys'>>) => void
  ) => () => void;
}

/** The island's share of the one settings store (vision-settings.json). */
export interface MainSettings {
  dwellTime: number;
  wakeSensitivity: 'relaxed' | 'normal';
  islandEdge?: 'top' | 'bottom';
  islandPosition?: IslandPosition;
  wakePhrase?: WakePhrase;
  /** VISION's own voice, 10-100. */
  voiceVolume?: number;
  /** Voice cue sounds on/off and their volume, 10-100. */
  soundsOn?: boolean;
  soundVolume?: number;
  migrated: boolean;
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
