'use client';

import { useSyncExternalStore } from 'react';

export type ThemeName = 'ember' | 'paper';
export type CaptionSize = 'M' | 'L' | 'XL';
export type WakeSensitivity = 'relaxed' | 'normal' | 'strict';

export interface VisionSettings {
  theme: ThemeName;
  dwellEnabled: boolean;
  dwellMs: number;
  captionSize: CaptionSize;
  reducedMotion: boolean;
  /** "Vision" wake word. Strict needs "Hey Vision". */
  wakeSensitivity: WakeSensitivity;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: VisionSettings = {
  theme: 'ember',
  dwellEnabled: true,
  dwellMs: 900,
  captionSize: 'L',
  reducedMotion: false,
  wakeSensitivity: 'normal',
  onboarded: false,
};

export const DWELL_MIN_MS = 600;
export const DWELL_MAX_MS = 1500;

const STORAGE_KEY = 'vision.settings.v1';

type Listener = () => void;

function clampDwell(ms: number) {
  if (!Number.isFinite(ms)) return DEFAULT_SETTINGS.dwellMs;
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, Math.round(ms)));
}

function sanitize(raw: unknown): VisionSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<VisionSettings>;
  return {
    theme: value.theme === 'paper' ? 'paper' : 'ember',
    dwellEnabled: value.dwellEnabled !== false,
    dwellMs: clampDwell(Number(value.dwellMs ?? DEFAULT_SETTINGS.dwellMs)),
    captionSize: value.captionSize === 'M' || value.captionSize === 'XL' ? value.captionSize : 'L',
    reducedMotion: value.reducedMotion === true,
    wakeSensitivity:
      value.wakeSensitivity === 'relaxed' || value.wakeSensitivity === 'strict'
        ? value.wakeSensitivity
        : 'normal',
    onboarded: value.onboarded === true,
  };
}

class SettingsStore {
  private state: VisionSettings = DEFAULT_SETTINGS;
  private loaded = false;
  private listeners = new Set<Listener>();

  private load() {
    if (this.loaded || typeof window === 'undefined') return;
    this.loaded = true;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) this.state = sanitize(JSON.parse(stored));
    } catch {
      // Storage can be unavailable (private mode, blocked site data): use defaults.
    }
  }

  get = (): VisionSettings => {
    this.load();
    return this.state;
  };

  getServer = (): VisionSettings => DEFAULT_SETTINGS;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      this.loaded = false;
      this.load();
      listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      this.listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  };

  update = (patch: Partial<VisionSettings>) => {
    this.state = sanitize({ ...this.get(), ...patch });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Non-fatal: settings just won't persist.
    }
    this.listeners.forEach((listener) => listener());
  };

  /** Used by the dev-only /preview route to render without touching real settings. */
  override = (next: Partial<VisionSettings>) => {
    this.loaded = true;
    this.state = sanitize({ ...DEFAULT_SETTINGS, ...next });
    this.listeners.forEach((listener) => listener());
  };
}

export const settingsStore = new SettingsStore();

export function useSettings(): VisionSettings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.getServer);
}

export function updateSettings(patch: Partial<VisionSettings>) {
  settingsStore.update(patch);
}
