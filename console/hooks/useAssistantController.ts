'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { type OverlayMode, getElectron } from '@/lib/electron';
import { visionAudio } from '@/lib/vision-audio';

/** Pill → orb after this long with nothing happening. The session stays alive. */
export const COLLAPSE_AFTER_MS = 8_000;
/** End the LiveKit session after this long with no interaction at all. */
export const END_SESSION_AFTER_MS = 90_000;
/** After the strip collapses, the voice session closes this long later (short-lived sessions). */
export const SESSION_END_AFTER_COLLAPSE_MS = 10_000;
/** Mic stays off this long after VISION stops speaking (room / PA echo). */
export const ECHO_TAIL_MS = 600;
/** Connecting longer than this means no internet / LiveKit down: say so, never hang. */
export const START_TIMEOUT_MS = 12_000;
export const OFFLINE_MESSAGE = 'Voice is offline. Face control still works.';

function speakOffline() {
  try {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    synth.cancel();
    synth.speak(
      new SpeechSynthesisUtterance('No internet. Voice is off. Face control still works.')
    );
  } catch {
    // no speech engine: the caption still says it
  }
}

export type Surface = Exclude<OverlayMode, 'orb-hint'>;

const SURFACE_ORDER: Record<Surface, number> = { orb: 0, strip: 1, console: 2 };
// Longer than the orb's 0.6s width spring, so the collapse is never clipped.
const WINDOW_SHRINK_DELAY_MS = 680;

interface ControllerInput {
  room?: Room;
  isConnected: boolean;
  start: () => Promise<void> | void;
  end: () => Promise<void> | void;
  /** True while the agent is mid-turn (thinking / speaking / acting): never collapse. */
  isBusy: boolean;
  /** VISION is talking: the mic is off, so it never hears itself through hall speakers. */
  agentSpeaking?: boolean;
  /** Anything that changes when the conversation moves (captions, actions, state). */
  activitySignal: unknown;
  initialSurface?: Surface;
}

export interface AssistantController {
  surface: Surface;
  isMuted: boolean;
  isStarting: boolean;
  /** The last start failed (no internet, LiveKit or the agent unreachable). */
  isOffline: boolean;
  /** Report that the session could not get going (e.g. the agent never joined). */
  reportOffline: () => void;
  activate: () => void;
  collapse: () => void;
  openConsole: () => void;
  closeConsole: () => void;
  toggleMute: () => void;
  endSession: () => void;
  /** Reset the idle timers (call on any user interaction with the UI). */
  touch: () => void;
}

async function setMic(room: Room | undefined, enabled: boolean) {
  const participant = room?.localParticipant;
  if (!participant) return;
  if (participant.isMicrophoneEnabled === enabled) return;
  try {
    await participant.setMicrophoneEnabled(enabled);
  } catch {
    // Permission or device errors must never take the UI down.
  }
}

/**
 * Collapsing the UI and ending the session are separate:
 * - after ~8s idle the strip collapses to the orb and the mic track is MUTED
 *   (no idle audio reaches Gemini), but the session stays connected;
 * - re-activating unmutes instantly, with no reconnect;
 * - only ~90s without any interaction (or an explicit End) ends the session.
 */
export function useAssistantController({
  room,
  isConnected,
  start,
  end,
  isBusy,
  agentSpeaking = false,
  activitySignal,
  initialSurface = 'orb',
}: ControllerInput): AssistantController {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [userMuted, setUserMuted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastInteraction, setLastInteraction] = useState(() => Date.now());
  const wasConnected = useRef(isConnected);

  const touch = useCallback(() => setLastInteraction(Date.now()), []);

  // Conversation movement counts as interaction.
  useEffect(() => {
    touch();
  }, [activitySignal, isBusy, touch]);

  // Keep the Electron window bounds in sync with the surface. Growing happens at
  // once; shrinking waits for the collapse morph so it is not clipped.
  const previousSurface = useRef(surface);
  useEffect(() => {
    const electron = getElectron();
    const grew = SURFACE_ORDER[surface] >= SURFACE_ORDER[previousSurface.current];
    previousSurface.current = surface;
    if (!electron?.setMode) return;
    if (grew) {
      electron.setMode(surface);
      return;
    }
    const timer = setTimeout(() => electron.setMode?.(surface), WINDOW_SHRINK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [surface]);

  // Half-duplex: mute the mic while VISION speaks, and a moment after (hall echo), so
  // on a PA system it never hears and answers its own voice.
  const [speakingHold, setSpeakingHold] = useState(false);
  useEffect(() => {
    if (agentSpeaking) {
      setSpeakingHold(true);
      return;
    }
    const timer = setTimeout(() => setSpeakingHold(false), ECHO_TAIL_MS);
    return () => clearTimeout(timer);
  }, [agentSpeaking]);

  // Mic follows the surface: muted while collapsed, live while open (unless the
  // user muted it themselves).
  useEffect(() => {
    if (!isConnected) return;
    void setMic(room, surface !== 'orb' && !userMuted && !speakingHold);
  }, [room, isConnected, surface, userMuted, speakingHold]);

  // Face Control pauses mouth gestures while the mic is live (talking opens the mouth).
  const micLive = isConnected && surface !== 'orb' && !userMuted;
  useEffect(() => {
    getElectron()?.setVoiceState?.({ connected: isConnected, live: micLive });
  }, [isConnected, micLive]);

  useEffect(() => {
    if (isConnected && !wasConnected.current) setIsStarting(false);
    if (!isConnected && wasConnected.current) {
      setIsStarting(false);
      setUserMuted(false);
    }
    wasConnected.current = isConnected;
  }, [isConnected]);

  // Strip → orb after a quiet spell.
  useEffect(() => {
    if (surface !== 'strip' || isBusy || isStarting) return;
    const wait = Math.max(0, lastInteraction + COLLAPSE_AFTER_MS - Date.now());
    const timer = setTimeout(() => setSurface('orb'), wait);
    return () => clearTimeout(timer);
  }, [surface, isBusy, isStarting, lastInteraction]);

  // Short-lived voice sessions: a Gemini Live session left open (even muted) was
  // aborted with 1008 every ~2.5 min. So once the strip has collapsed back to the orb
  // and nothing is happening, end the session; the next activation opens a fresh one.
  useEffect(() => {
    if (!isConnected || isBusy || surface !== 'orb') return;
    const timer = setTimeout(() => {
      void end();
    }, SESSION_END_AFTER_COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [isConnected, isBusy, surface, end]);

  // Backstop: end the session after a long quiet spell.
  useEffect(() => {
    if (!isConnected || isBusy) return;
    const wait = Math.max(0, lastInteraction + END_SESSION_AFTER_MS - Date.now());
    const timer = setTimeout(() => {
      void end();
    }, wait);
    return () => clearTimeout(timer);
  }, [isConnected, isBusy, lastInteraction, end]);

  const reportOffline = useCallback(() => {
    setIsStarting(false);
    setIsOffline(true);
    visionAudio.playTing('notice');
    speakOffline();
    void Promise.resolve(end()).catch(() => undefined);
  }, [end]);

  const activate = useCallback(() => {
    touch();
    visionAudio.playTing('connect');
    setUserMuted(false);
    setIsOffline(false);
    setSurface((current) => (current === 'orb' ? 'strip' : current));
    if (!isConnected && !isStarting) {
      setIsStarting(true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('start timed out')), START_TIMEOUT_MS);
      });
      Promise.race([Promise.resolve(start()), timeout])
        .catch((error) => {
          console.error('[VISION] Voice session failed to start:', error);
          reportOffline();
        })
        .finally(() => clearTimeout(timer));
    }
  }, [isConnected, isStarting, start, touch, reportOffline]);

  const collapse = useCallback(() => {
    touch();
    setSurface('orb');
  }, [touch]);

  const openConsole = useCallback(() => {
    touch();
    setSurface('console');
  }, [touch]);

  const closeConsole = useCallback(() => {
    touch();
    setSurface('strip');
  }, [touch]);

  const toggleMute = useCallback(() => {
    touch();
    setUserMuted((muted) => !muted);
  }, [touch]);

  const endSession = useCallback(() => {
    visionAudio.playTing('notice');
    setSurface('orb');
    if (isConnected) void end();
  }, [end, isConnected]);

  return {
    surface,
    isMuted: userMuted || surface === 'orb',
    isStarting,
    isOffline,
    reportOffline,
    activate,
    collapse,
    openConsole,
    closeConsole,
    toggleMute,
    endSession,
    touch,
  };
}
