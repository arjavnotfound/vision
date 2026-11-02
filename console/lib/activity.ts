export type ActivityStatus = 'running' | 'done' | 'error';

export interface ActivityItem {
  id: string;
  action: string;
  target: string;
  url?: string;
  title?: string;
  error?: string;
  status: ActivityStatus;
  ts: number;
}

export interface ActionEventPayload {
  type: 'action_start' | 'action_done' | 'action_error';
  action: string;
  target?: string;
  url?: string;
  title?: string;
  error?: string;
  ts?: number;
}

export const MAX_ACTIVITY = 30;

export function parseActionEvent(raw: unknown): ActionEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const type = data.type;
  if (type !== 'action_start' && type !== 'action_done' && type !== 'action_error') return null;
  if (typeof data.action !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    type,
    action: data.action,
    target: str(data.target) ?? '',
    url: str(data.url),
    title: str(data.title),
    error: str(data.error),
    ts: typeof data.ts === 'number' ? data.ts : Date.now(),
  };
}

/**
 * Fold one event into the feed (newest first). A done/error event completes the
 * most recent running item with the same action and target; otherwise it is added.
 */
export function applyActionEvent(
  items: readonly ActivityItem[],
  event: ActionEventPayload,
  makeId: () => string
): ActivityItem[] {
  const target = event.target ?? '';
  const ts = event.ts ?? Date.now();

  if (event.type === 'action_start') {
    return [
      { id: makeId(), action: event.action, target, status: 'running' as const, ts },
      ...items,
    ].slice(0, MAX_ACTIVITY);
  }

  const status: ActivityStatus = event.type === 'action_done' ? 'done' : 'error';
  const index = items.findIndex(
    (item) => item.status === 'running' && item.action === event.action && item.target === target
  );
  const patch = { status, url: event.url, title: event.title, error: event.error };
  if (index === -1) {
    return [{ id: makeId(), action: event.action, target, ts, ...patch }, ...items].slice(
      0,
      MAX_ACTIVITY
    );
  }
  const next = items.slice();
  next[index] = { ...next[index], ...patch };
  return next;
}

const VERBS: Record<string, string> = {
  open_url: 'Opening',
  search: 'Searching',
  click: 'Clicking',
  type: 'Typing in',
  scroll: 'Scrolling',
  press_key: 'Pressing',
  go_back: 'Going back',
};

export function actionVerb(action: string) {
  return VERBS[action] ?? action.replace(/_/g, ' ');
}

export function domainOf(item: Pick<ActivityItem, 'url' | 'target' | 'action'>): string {
  const candidate = item.url || (item.action === 'open_url' ? item.target : '');
  if (!candidate) return '';
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function relativeTime(ts: number, now: number) {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
