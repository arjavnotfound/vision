export interface PendingConfirm {
  id: string;
  question: string;
}

/** Tools publish `confirm_request` before asking the user; answer it by voice or dwell. */
export function confirmFromEvent(raw: unknown): PendingConfirm | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  if (event.type !== 'confirm_request') return null;
  const target = typeof event.target === 'string' ? event.target.trim() : '';
  const question =
    typeof event.question === 'string' && event.question.trim()
      ? event.question.trim()
      : event.action === 'click' && target
        ? `Click “${target}”?`
        : target
          ? `${target}?`
          : 'Are you sure?';
  return { id: `${event.ts ?? Date.now()}`, question };
}

export interface HelpCard {
  /** The app in front, as people call it ("YouTube", "File Explorer"). */
  app: string;
  phrases: string[];
}

/** "Vision, what can I say?": the agent sends the phrases for the app in front. */
export function helpFromEvent(raw: unknown): HelpCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  if (event.type !== 'help' || !Array.isArray(event.phrases)) return null;
  const phrases = event.phrases
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.trim().slice(0, 60))
    .slice(0, 10);
  if (!phrases.length) return null;
  const app = typeof event.app === 'string' && event.app.trim() ? event.app.trim() : 'VISION';
  return { app: app.slice(0, 40), phrases };
}
