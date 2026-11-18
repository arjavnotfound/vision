/** What the island shows. Pure, so the live app, the preview and the tests agree. */

export type IslandView =
  | 'sliver'
  | 'resting'
  | 'menu'
  | 'wake'
  | 'listening'
  | 'understood'
  | 'acting'
  | 'confirm'
  | 'help'
  | 'speaking'
  | 'offline';

/** Face control as the resting island shows it. */
export type FaceState = 'tracking' | 'unseen' | 'paused';

/** The "wake heard" flash lasts this long, then the island says it is listening. */
export const WAKE_MS = 700;
/** A finished step stays on the card this long, so "done" is visible. */
export const DONE_MS = 2_500;

export interface IslandInput {
  /** 'orb': resting (no voice), 'strip': voice is on. */
  surface: 'orb' | 'strip';
  uiState: string;
  userCaption: string;
  agentCaption: string;
  hasConfirm: boolean;
  /** "What can I say?" card. */
  hasHelp?: boolean;
  hasNotice: boolean;
  /** A step is running, or one finished in the last DONE_MS. */
  hasSteps: boolean;
  fullScreen: boolean;
  menu: 'menu' | null;
  /** ms since the last wake / hotkey / Talk. */
  sinceActivate: number;
}

export function islandView(i: IslandInput): IslandView {
  if (i.surface !== 'strip') {
    if (i.menu) return 'menu';
    return i.fullScreen ? 'sliver' : 'resting';
  }
  if (i.hasConfirm) return 'confirm';
  if (i.hasHelp) return 'help';
  if (i.hasNotice) return 'offline';
  if (i.sinceActivate < WAKE_MS && i.uiState !== 'speaking' && i.uiState !== 'acting')
    return 'wake';
  if (i.uiState === 'acting' || i.hasSteps) return 'acting';
  if ((i.uiState === 'speaking' || i.uiState === 'error') && i.agentCaption) return 'speaking';
  // New words with no reply yet. While connecting (thinking, no words) it is listening:
  // the words said after the wake are kept and sent once the session is up.
  if (i.userCaption && !i.agentCaption && i.uiState !== 'idle') return 'understood';
  return 'listening';
}

/** What main needs to know: the idle bar (or line), the caption pill, or the menu. */
export function windowModeFor(view: IslandView): 'idle' | 'caption' | 'controls' | 'menu' {
  if (view === 'menu') return 'menu';
  if (view === 'resting' || view === 'sliver') return 'idle';
  return islandControls(view) ? 'controls' : 'caption';
}

/**
 * Dwell buttons under the caption: Stop while voice is live, Yes / No for a confirmation.
 * Speech can be misheard, so each always has a way that needs no voice.
 */
export function islandControls(view: IslandView): 'stop' | 'confirm' | null {
  if (view === 'confirm') return 'confirm';
  return ['wake', 'listening', 'understood', 'acting', 'speaking', 'help'].includes(view)
    ? 'stop'
    : null;
}

/** Voice as the menu shows it: `<state> · <reason> · <action>` when it can't be used. */
export function voiceStatus(i: {
  voiceOff: boolean;
  offline: boolean;
  micMissing: boolean;
  wakePhrase: 'hey-vision' | 'vision';
  hotkey?: string;
}): { on: boolean; text: string } {
  if (i.voiceOff) return { on: false, text: 'Voice is off · Voice keys missing · Add keys' };
  if (i.micMissing) return { on: false, text: 'Voice is off · No microphone · Plug one in' };
  if (i.offline) return { on: false, text: 'Voice is off · Could not connect · Try again' };
  const phrase = i.wakePhrase === 'vision' ? 'Vision' : 'Hey Vision';
  return { on: true, text: `Say “${phrase}” to talk${i.hotkey ? ` · or ${i.hotkey}` : ''}` };
}

/** One caption line for the pill: the end of a long reply, so the newest words show. */
export function captionTail(text: string, max = 52): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(-max + 1);
  return `…${cut.slice(cut.indexOf(' ') + 1 || 0)}`;
}

/** The face status dot and line. paused wins over unseen. */
export function faceState(status: { tracking: boolean; seen: boolean } | null): FaceState {
  if (!status) return 'tracking';
  if (!status.tracking) return 'paused';
  return status.seen ? 'tracking' : 'unseen';
}

export interface StepLike {
  id: string;
  status: 'running' | 'done' | 'error';
  ts: number;
}

/**
 * Steps of the current request (newest-first activity in, oldest-first out), while one
 * runs and for DONE_MS after the last one ended (endedAt: when the island last saw one
 * running; steps carry only their start time).
 */
export function currentSteps<T extends StepLike>(
  activity: T[],
  since: number,
  now: number,
  endedAt = 0
): T[] {
  const steps = activity.filter((item) => item.ts >= since).reverse();
  const last = steps[steps.length - 1];
  if (!last) return [];
  if (last.status === 'running' || now - Math.max(last.ts, endedAt) < DONE_MS)
    return steps.slice(-3);
  return [];
}

/** The full-screen line's colour: neutral at rest, accent while voice works, warning
 * when voice is offline or the face is lost, dim while paused. */
export type LineTone = 'idle' | 'accent' | 'warn' | 'dim';

export function lineTone(i: {
  voiceOn: boolean;
  offline: boolean;
  face: FaceState;
  uiState: string;
}): LineTone {
  if (i.offline || i.uiState === 'offline' || i.uiState === 'error') return 'warn';
  if (i.voiceOn) return 'accent';
  if (i.face === 'unseen') return 'warn';
  if (i.face === 'paused') return 'dim';
  return 'idle';
}
