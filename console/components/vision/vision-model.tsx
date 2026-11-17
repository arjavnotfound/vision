'use client';

import { createContext, useContext } from 'react';
import type { MotionValue } from 'motion/react';
import type { Surface } from '@/hooks/useAssistantController';
import type { ActivityItem } from '@/lib/activity';
import type { FaceStatus } from '@/lib/electron';
import type { ConversationTurn } from '@/lib/transcript';
import type { ApertureState } from './aperture-core';

export type ConnectionState = 'live' | 'connecting' | 'offline';
export type ConsoleTab = 'home' | 'assistant' | 'activity' | 'settings';

/**
 * Everything a VISION surface needs to render. The live app builds this from
 * LiveKit; the /preview route builds it from mocks. Surfaces never touch LiveKit.
 */
export interface VisionModel {
  surface: Surface;
  uiState: ApertureState;
  connection: ConnectionState;
  /** Latest user words, if they belong to the current exchange. */
  userCaption: string;
  /** Latest Vision reply in the current exchange (grows while streaming). */
  agentCaption: string;
  /** Changes when a new reply starts, so word fade-in restarts. */
  agentCaptionKey: string;
  turns: ConversationTurn[];
  activity: ActivityItem[];
  chip: ActivityItem | null;
  /** A yes/no question waiting for the user (dwell Yes / No, or just say it). */
  confirm: { question: string } | null;
  /** A one-line status that replaces the caption, e.g. "Voice is offline". */
  notice: string | null;
  actionPulse: number;
  errorPulse: number;
  micLevel: MotionValue<number>;
  outputLevel: MotionValue<number>;
  isMuted: boolean;
  hotkeyLabel: string;
  searchProvider: string;
  showOnboarding: boolean;
  consoleTab: ConsoleTab;
  /** Face control's state (null until Face Control reports it). */
  face: FaceStatus | null;
  /** A full-screen app is in front: the resting island is a line at the top. */
  fullScreen: boolean;
  /** Date.now() of the last wake / hotkey / Talk (the wake-heard flash). */
  activatedAt: number;
  actions: {
    activate: () => void;
    collapse: () => void;
    openConsole: () => void;
    /** The console on its Settings tab. */
    openSettings: () => void;
    /** Electron: show Face Control's window. */
    showFace?: () => void;
    /** Electron: pause or resume face control. */
    togglePause?: () => void;
    toggleMute: () => void;
    endSession: () => void;
    sendCommand: (text: string) => void;
    answerConfirm: (yes: boolean) => void;
    setConsoleTab: (tab: ConsoleTab) => void;
    finishOnboarding: () => void;
    /** Electron: hide the overlay to the tray. */
    hideWindow?: () => void;
  };
}

const VisionContext = createContext<VisionModel | null>(null);

export const VisionModelProvider = VisionContext.Provider;

export function useVision(): VisionModel {
  const model = useContext(VisionContext);
  if (!model) throw new Error('useVision() must be used inside a VisionModelProvider');
  return model;
}
