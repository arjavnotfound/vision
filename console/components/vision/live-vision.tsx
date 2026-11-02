'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useAgent,
  useLocalParticipant,
  useSessionContext,
  useStartAudio,
  useVoiceAssistant,
} from '@livekit/components-react';
import { useActivationHotkey } from '@/hooks/useActivationHotkey';
import { OFFLINE_MESSAGE, useAssistantController } from '@/hooks/useAssistantController';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import { useConversationTranscript } from '@/hooks/useConversationTranscript';
import { useVisionActions } from '@/hooks/useVisionActions';
import { useWakeWord } from '@/hooks/useWakeWord';
import { getElectron } from '@/lib/electron';
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

/** Builds the VisionModel from the live LiveKit session and renders the shell. */
export function LiveVision({ searchProvider }: { searchProvider: string }) {
  const session = useSessionContext();
  const { isConnected } = session;
  const agent = useAgent();
  const voiceAssistant = useVoiceAssistant();
  const { microphoneTrack } = useLocalParticipant();
  const transcript = useConversationTranscript();
  // Wake-word mode (Stage): always listening, acts only on "Hey Vision".
  const wakeRef = useRef<() => void>(() => undefined);
  const vision = useVisionActions(() => wakeRef.current());
  const [alwaysListen, setAlwaysListen] = useState(false);
  useEffect(() => {
    void getElectron()
      ?.isWakeMode?.()
      .then((on) => setAlwaysListen(Boolean(on)))
      .catch(() => undefined);
  }, []);
  const settings = useSettings();
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

  const start = useCallback(() => session.start(), [session]);
  const end = useCallback(() => session.end(), [session]);

  const controller = useAssistantController({
    room: session.room,
    isConnected,
    start,
    end,
    isBusy,
    agentSpeaking: agent.state === 'speaking',
    activitySignal: `${transcript.latestUser?.text}|${transcript.latestAgent?.text}|${vision.activity.length}|${agent.state}`,
    alwaysListen,
  });
  wakeRef.current = controller.wake;

  // Connected to LiveKit but the agent never joined (its worker is offline): say so.
  const { reportOffline } = controller;
  useEffect(() => {
    if (!isConnected || agentReady) return;
    const timer = setTimeout(reportOffline, 15_000);
    return () => clearTimeout(timer);
  }, [isConnected, agentReady, reportOffline]);

  // No voice keys yet (first run of an installed build): open Settings to add them.
  const { activate: startVoice, openConsole: showConsole } = controller;
  const activate = useCallback(() => {
    const getVoiceConfig = getElectron()?.getVoiceConfig;
    if (!getVoiceConfig) return startVoice();
    void getVoiceConfig().then((config) => {
      if (config && !config.hasKeys) {
        setConsoleTab('settings');
        showConsole();
      } else {
        startVoice();
      }
    }, startVoice);
  }, [startVoice, showConsole]);

  const hotkeyLabel = useActivationHotkey(activate);
  useWakeWord({
    onWakeWord: activate,
    enabled: settings.wakeWord && controller.surface === 'orb',
  });

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
      activate,
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
