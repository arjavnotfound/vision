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
  surface: 'orb' | 'strip' | 'console';
  uiState: string;
  userCaption: string;
  agentCaption: string;
  hasConfirm: boolean;
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

/** Which window size a view needs. */
export function windowModeFor(view: IslandView): 'island' | 'island-open' {
  return view === 'resting' || view === 'sliver' ? 'island' : 'island-open';
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
