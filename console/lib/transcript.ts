export type Speaker = 'user' | 'agent';

export interface ConversationTurn {
  id: string;
  speaker: Speaker;
  text: string;
  timestamp: number;
}

/** Minimal shape of a LiveKit `ReceivedMessage` that the transcript needs. */
export interface TranscriptSource {
  id: string;
  type?: string;
  message: string;
  timestamp?: number;
  from?: { isLocal?: boolean } | null;
}

function speakerOf(message: TranscriptSource): Speaker {
  if (message.type === 'userTranscript') return 'user';
  if (message.type === 'agentTranscript') return 'agent';
  return message.from?.isLocal ? 'user' : 'agent';
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Build an ordered, de-duplicated conversation from LiveKit session messages.
 *
 * - Keyed by stream/segment id: an id seen again REPLACES its text in place (interim
 *   transcripts grow; they are never appended).
 * - Order is the first time each id was seen.
 * - Two adjacent turns from the same speaker with identical text collapse into one
 *   (protects against the same segment arriving over two transports).
 * - An adjacent same-speaker turn that only EXTENDS the previous one (an interim
 *   segment superseded by a final with a new id) replaces it instead of repeating it.
 */
export function buildTurns(messages: readonly TranscriptSource[]): ConversationTurn[] {
  const byId = new Map<string, ConversationTurn>();

  for (const message of messages) {
    if (!message?.id) continue;
    const text = normalize(message.message ?? '');
    const existing = byId.get(message.id);
    if (existing) {
      if (text) existing.text = text;
      continue;
    }
    byId.set(message.id, {
      id: message.id,
      speaker: speakerOf(message),
      text,
      timestamp: message.timestamp ?? 0,
    });
  }

  const turns: ConversationTurn[] = [];
  for (const turn of byId.values()) {
    if (!turn.text) continue;
    const previous = turns.at(-1);
    if (previous && previous.speaker === turn.speaker && previous.text === turn.text) continue;
    if (
      previous &&
      previous.speaker === turn.speaker &&
      previous.text.length >= 8 &&
      turn.text.startsWith(previous.text)
    ) {
      turns[turns.length - 1] = { ...turn, id: previous.id };
      continue;
    }
    turns.push({ ...turn });
  }
  return turns;
}

export function latestTurn(turns: readonly ConversationTurn[], speaker: Speaker) {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].speaker === speaker) return turns[i];
  }
  return undefined;
}
