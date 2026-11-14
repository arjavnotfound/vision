'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalAudioTrack, Track } from 'livekit-client';
import {
  useAgent,
  useLocalParticipant,
  useSessionContext,
  useStartAudio,
  useVoiceAssistant,
} from '@livekit/components-react';
import { useActivationHotkey } from '@/hooks/useActivationHotkey';
import {
  ECHO_TAIL_MS,
  OFFLINE_MESSAGE,
  useAssistantController,
} from '@/hooks/useAssistantController';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import { useConversationTranscript } from '@/hooks/useConversationTranscript';
import { useVisionActions } from '@/hooks/useVisionActions';
import { useWakeSpotter } from '@/hooks/useWakeSpotter';
import { type WakeHeard, getElectron } from '@/lib/electron';
import { settingsStore, updateSettings, useSettings } from '@/lib/settings';
import type { ApertureState } from './aperture-core';
import {
  type ConnectionState,
  type ConsoleTab,
  type VisionModel,
  VisionModelProvider,
} from './vision-model';
import { VisionShell } from './vision-shell';

const READY_STATES = new Set(['listening', 'thinking', 'speaking', 'idle']);
/** "Stop" or "cancel" counts only this soon after "Vision". */
const STOP_WINDOW_MS = 2_500;

/** Builds the VisionModel from the live LiveKit session and renders the shell. */
export function LiveVision({ searchProvider }: { searchProvider: string }) {
  const session = useSessionContext();
  const { isConnected } = session;
  const agent = useAgent();
  const voiceAssistant = useVoiceAssistant();
  const { microphoneTrack } = useLocalParticipant();
  const transcript = useConversationTranscript();
  const vision = useVisionActions();
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('home');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [failurePulse, setFailurePulse] = useState(0);

  const agentReady = isConnected && READY_STATES.has(agent.state);
  const chipRunning = vision.chip?.status === 'running';
  // A pending yes/no keeps the strip (and the mic) open until it is answered.
  const isBusy =
    agent.state === 'thinking' ||
    agent.state === 'speaking' ||
    chipRunning ||
    Boolean(vision.confirm);

  // The wake capture is also the session's mic (pre-roll, one capture): published here
  // instead of LiveKit opening the mic again. Without it, LiveKit opens the mic itself.
  const onWakeHeardRef = useRef<(heard: WakeHeard) => void>(() => undefined);
  const { wakeSensitivity } = useSettings();
  const wakeMic = useWakeSpotter({
    sensitivity: wakeSensitivity,
    onHeard: useCallback((heard: WakeHeard) => onWakeHeardRef.current(heard), []),
  });
  const { room } = session;
  const start = useCallback(async () => {
    const mediaTrack = wakeMic.takeTrack();
    if (!mediaTrack) return session.start();
    const track = new LocalAudioTrack(mediaTrack, undefined, true);
    // Like LiveKit's own mic: audio from before the agent joins is sent to it on join.
    track.startPreConnectBuffer();
    const started = session.start({ tracks: { microphone: { enabled: false } } });
    const published = room.localParticipant.publishTrack(track, {
      source: Track.Source.Microphone,
      preConnectBuffer: true,
    });
    await Promise.all([started, published]);
  }, [session, room, wakeMic]);
  const end = useCallback(() => session.end(), [session]);

  const controller = useAssistantController({
    room: session.room,
    isConnected,
    start,
    end,
    isBusy,
    agentSpeaking: agent.state === 'speaking',
    activitySignal: `${transcript.latestUser?.text}|${transcript.latestAgent?.text}|${vision.activity.length}|${agent.state}`,
  });

  // Connected to LiveKit but the agent never joined (its worker is offline): say so.
  const { reportOffline } = controller;
  useEffect(() => {
    if (!isConnected || agentReady) return;
    const timer = setTimeout(reportOffline, 15_000);
    return () => clearTimeout(timer);
  }, [isConnected, agentReady, reportOffline]);

  // No voice keys yet (first run of an installed build): open Settings to add them.
  const { activate: startVoice, openConsole: showConsole } = controller;
  // started: runs right after the connect sound (the wake latency log).
  const activate = useCallback(
    (started?: () => void) => {
      const go = () => {
        startVoice();
        started?.();
      };
      const getVoiceConfig = getElectron()?.getVoiceConfig;
      if (!getVoiceConfig) return go();
      void getVoiceConfig().then((config) => {
        if (config && !config.hasKeys) {
          setConsoleTab('settings');
          showConsole();
        } else {
          go();
        }
      }, go);
    },
    [startVoice, showConsole]
  );

  const activateNow = useCallback(() => activate(), [activate]);
  const hotkeyLabel = useActivationHotkey(activateNow);
  // Wake word. While VISION speaks (and its echo tail) a wake is ignored, so its own voice
  // never wakes it; "Vision, stop" / "Vision, cancel" still work then.
  const speakingUntil = useRef(0);
  useEffect(() => {
    if (agent.state === 'speaking') {
      speakingUntil.current = Number.POSITIVE_INFINITY;
      // The mic is held off while VISION speaks: any pre-roll backlog is stale now.
      wakeMic.live();
    } else if (speakingUntil.current === Number.POSITIVE_INFINITY)
      speakingUntil.current = Date.now() + ECHO_TAIL_MS;
  }, [agent.state, wakeMic]);
  const micLive = isConnected && controller.surface !== 'orb';
  const lastVisionHeard = useRef(0);
  const { endSession } = controller;
  const onWakeHeard = useCallback(
    (heard: WakeHeard) => {
      const now = Date.now();
      if (heard.keyword === 'stop' || heard.keyword === 'cancel') {
        if (now - lastVisionHeard.current < STOP_WINDOW_MS) {
          console.log(`[VISION] Wake word: ${heard.keyword}`);
          endSession();
        }
        return;
      }
      lastVisionHeard.current = now;
      if (!heard.ok || now < speakingUntil.current) return;
      console.log('[VISION] Wake word heard');
      // A mic that is already live sent these words; otherwise replay from the wake word.
      const end = heard.end;
      if (!micLive && end !== undefined) wakeMic.rewind(end);
      activate(() => {
        if (end === undefined) return;
        getElectron()?.reportWakeSound?.(((wakeMic.position() - end) / 16_000) * 1000);
      });
    },
    [activate, endSession, micLive, wakeMic]
  );
  useEffect(() => {
    onWakeHeardRef.current = onWakeHeard;
  }, [onWakeHeard]);

  // First run: show onboarding in the console.
  const openConsole = controller.openConsole;
  // In the one VISION app, Face Control's Start screen and try-it replace this.
  useEffect(() => {
    if (settingsStore.get().onboarded) return;
    let cancelled = false;
    void (getElectron()?.isOneApp?.() ?? Promise.resolve(false))
      .catch(() => false)
      .then((oneApp) => {
        if (cancelled) return;
        if (oneApp) {
          updateSettings({ onboarded: true });
          return;
        }
        setShowOnboarding(true);
        openConsole();
      });
    return () => {
      cancelled = true;
    };
  }, [openConsole]);

  // A failed agent ends the session and shows the error state once.
  useEffect(() => {
    if (isConnected && agent.state === 'failed') {
      setFailurePulse((n) => n + 1);
      void session.end();
    }
  }, [agent.state, isConnected, session]);

  // Quick Commands sent before the agent has joined are queued until it is ready.
  const pending = useRef<string | null>(null);
  const { sendText } = transcript;
  useEffect(() => {
    if (!agentReady || !pending.current) return;
    const text = pending.current;
    pending.current = null;
    void sendText(text).catch(() => undefined);
  }, [agentReady, sendText]);

  const sendCommand = useCallback(
    (text: string) => {
      controller.touch();
      if (agentReady) {
        void sendText(text).catch(() => undefined);
      } else {
        pending.current = text;
        activate();
      }
    },
    [activate, agentReady, controller, sendText]
  );

  // Audio levels for the Aperture.
  const micTrack = microphoneTrack?.track?.mediaStreamTrack;
  const outputTrack = voiceAssistant.audioTrack?.publication?.track?.mediaStreamTrack;
  const micLevel = useAudioLevel(isConnected && !controller.isMuted ? micTrack : undefined);
  const outputLevel = useAudioLevel(outputTrack);

  // Browsers can block audio until a real click; dwell is not a user gesture.
  const { mergedProps: startAudioProps, canPlayAudio } = useStartAudio({
    room: session.room,
    props: {},
  });

  const uiState: ApertureState = useMemo(() => {
    if (agent.state === 'failed') return 'error';
    if (!isConnected) {
      if (controller.isOffline) return 'offline';
      return controller.isStarting ? 'thinking' : 'idle';
    }
    if (chipRunning) return 'acting';
    if (agent.state === 'speaking') return 'speaking';
    if (agent.state === 'thinking') return 'thinking';
    if (!agentReady) return 'thinking';
    if (agent.state === 'listening' && !controller.isMuted) return 'listening';
    return 'idle';
  }, [
    agent.state,
    agentReady,
    chipRunning,
    controller.isMuted,
    controller.isOffline,
    controller.isStarting,
    isConnected,
  ]);

  const connection: ConnectionState = isConnected
    ? agentReady
      ? 'live'
      : 'connecting'
    : controller.isStarting
      ? 'connecting'
      : 'offline';

  // Captions belong to the current exchange: the latest user line, and Vision's
  // reply only if it came after it.
  const { turns, latestUser, latestAgent } = transcript;
  const userIndex = latestUser ? turns.indexOf(latestUser) : -1;
  const agentIndex = latestAgent ? turns.indexOf(latestAgent) : -1;
  const replyIsCurrent = agentIndex > userIndex;

  const model: VisionModel = {
    surface: controller.surface,
    uiState,
    connection,
    userCaption: latestUser?.text ?? '',
    agentCaption: replyIsCurrent ? (latestAgent?.text ?? '') : '',
    agentCaptionKey: latestAgent?.id ?? 'none',
    turns,
    activity: vision.activity,
    chip: vision.chip,
    confirm: vision.confirm,
    notice: controller.isOffline ? OFFLINE_MESSAGE : null,
    actionPulse: vision.actionPulse,
    errorPulse: vision.errorPulse + failurePulse,
    micLevel,
    outputLevel,
    isMuted: controller.isMuted && controller.surface !== 'orb',
    hotkeyLabel,
    searchProvider,
    showOnboarding,
    consoleTab,
    actions: {
      activate: activateNow,
      collapse: controller.collapse,
      openConsole: controller.openConsole,
      closeConsole: controller.closeConsole,
      toggleMute: controller.toggleMute,
      endSession: controller.endSession,
      sendCommand,
      answerConfirm: (yes) => {
        vision.clearConfirm();
        sendCommand(yes ? 'Yes' : 'No');
      },
      setConsoleTab: (tab) => {
        controller.touch();
        setConsoleTab(tab);
      },
      finishOnboarding: () => {
        updateSettings({ onboarded: true });
        setShowOnboarding(false);
        setConsoleTab('home');
        controller.collapse();
      },
      hideWindow: getElectron()?.hide,
    },
  };

  return (
    <VisionModelProvider value={model}>
      <VisionShell />
      {!canPlayAudio && isConnected && (
        <button
          type="button"
          {...startAudioProps}
          className="surface-glass text-bone fixed top-4 left-1/2 z-50 h-14 -translate-x-1/2 rounded-full px-6 text-[15px] font-medium"
        >
          Click to enable sound
        </button>
      )}
    </VisionModelProvider>
  );
}
