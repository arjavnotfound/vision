import type { MotionValue } from 'motion/react';
import type { ActivityItem } from '@/lib/activity';
import type { ConversationTurn } from '@/lib/transcript';
import type { ApertureState } from '../aperture-core';
import type { ConsoleTab, VisionModel } from '../vision-model';

export const PREVIEW_STATES: ApertureState[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'acting',
  'error',
];

const MIN = 60_000;

export function mockActivity(now: number): ActivityItem[] {
  return [
    {
      id: 'a1',
      action: 'open_url',
      target: 'youtube.com',
      url: 'https://www.youtube.com/',
      title: 'YouTube',
      status: 'done',
      ts: now - 8_000,
    },
    {
      id: 'a2',
      action: 'search',
      target: 'weather in Mumbai today',
      url: 'https://www.bing.com/search?q=weather+in+Mumbai+today',
      title: 'weather in Mumbai today - Search',
      status: 'done',
      ts: now - 2 * MIN,
    },
    {
      id: 'a3',
      action: 'scroll',
      target: 'down',
      url: 'https://en.wikipedia.org/wiki/Camera_aperture',
      status: 'done',
      ts: now - 4 * MIN,
    },
    {
      id: 'a4',
      action: 'open_url',
      target: 'wikipedia.org',
      url: 'https://en.wikipedia.org/wiki/Camera_aperture',
      title: 'Aperture - Wikipedia',
      status: 'done',
      ts: now - 5 * MIN,
    },
    {
      id: 'a5',
      action: 'click',
      target: 'Play all',
      url: 'https://music.youtube.com/',
      title: 'YouTube Music',
      status: 'done',
      ts: now - 9 * MIN,
    },
    {
      id: 'a6',
      action: 'open_url',
      target: 'github.com',
      url: 'https://github.com/',
      title: 'GitHub',
      status: 'done',
      ts: now - 14 * MIN,
    },
  ];
}

export const MOCK_TURNS: ConversationTurn[] = [
  {
    id: 't1',
    speaker: 'user',
    text: 'Hey, open Wikipedia and look up camera apertures.',
    timestamp: 1,
  },
  {
    id: 't2',
    speaker: 'agent',
    text: 'Done. An aperture is the opening that lets light into a camera. The blades you see here are an iris diaphragm.',
    timestamp: 2,
  },
  { id: 't3', speaker: 'user', text: 'scroll down', timestamp: 3 },
  { id: 't4', speaker: 'user', text: "what's the weather like in Mumbai today", timestamp: 4 },
  {
    id: 't5',
    speaker: 'agent',
    text: "It's thirty-one degrees and humid in Mumbai, with light rain likely after four.",
    timestamp: 5,
  },
  { id: 't6', speaker: 'user', text: 'open youtube', timestamp: 6 },
];

interface MockOptions {
  surface: VisionModel['surface'];
  state: ApertureState;
  tab: ConsoleTab;
  onboarding: boolean;
  mic: MotionValue<number>;
  out: MotionValue<number>;
  pulse: number;
  now: number;
  actions: VisionModel['actions'];
}

export function buildMockModel(o: MockOptions): VisionModel {
  const activity = mockActivity(o.now);
  const base: VisionModel = {
    surface: o.surface,
    uiState: o.state,
    connection: 'live',
    userCaption: '',
    agentCaption: '',
    agentCaptionKey: 'mock',
    turns: MOCK_TURNS,
    activity,
    chip: null,
    confirm: null,
    notice: null,
    actionPulse: 0,
    errorPulse: 0,
    micLevel: o.mic,
    outputLevel: o.out,
    isMuted: false,
    hotkeyLabel: 'Ctrl+Alt+Space',
    searchProvider: 'Bing',
    showOnboarding: o.onboarding,
    consoleTab: o.tab,
    actions: o.actions,
  };

  switch (o.state) {
    case 'listening':
      return { ...base, userCaption: 'open youtube and play some lo-fi' };
    case 'thinking':
      return { ...base, userCaption: "what's the weather like in Mumbai today" };
    case 'speaking':
      return {
        ...base,
        userCaption: "what's the weather like in Mumbai today",
        agentCaption:
          "It's thirty-one degrees and humid in Mumbai, with light rain likely after four.",
      };
    case 'acting': {
      const running: ActivityItem = {
        id: 'run',
        action: 'open_url',
        target: 'youtube.com',
        status: 'running',
        ts: o.now - 400,
      };
      return {
        ...base,
        userCaption: 'open youtube',
        chip: running,
        activity: [running, ...activity.slice(1)],
        actionPulse: o.pulse,
      };
    }
    case 'error': {
      const failed: ActivityItem = {
        id: 'err',
        action: 'click',
        target: 'Sign in',
        error: "I could not find a visible control named 'Sign in'.",
        status: 'error',
        ts: o.now - 1200,
      };
      return {
        ...base,
        userCaption: 'click sign in',
        agentCaption: "I couldn't find a Sign in button on this page. Want me to look for a menu?",
        activity: [failed, ...activity],
        errorPulse: o.pulse,
      };
    }
    case 'offline':
      return { ...base, connection: 'offline', activity: [], turns: [] };
    default:
      return { ...base, agentCaption: '' };
  }
}
