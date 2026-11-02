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
