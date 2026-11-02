'use client';

import { useMemo } from 'react';
import { useSessionContext, useSessionMessages } from '@livekit/components-react';
import { type ConversationTurn, buildTurns, latestTurn } from '@/lib/transcript';

export type { ConversationTurn } from '@/lib/transcript';

export interface UseConversationTranscriptReturn {
  turns: ConversationTurn[];
  latestUser?: ConversationTurn;
  latestAgent?: ConversationTurn;
  /** Send typed text / a Quick Command to the agent over `lk.chat`. */
  sendText: (text: string) => Promise<void>;
}

/**
 * Single source of truth for captions: LiveKit's session messages (text streams).
 *
 * The previous version merged these with the legacy `TranscriptionReceived` event,
 * which carries different ids for the same speech, and only inserted messages the
 * first time an id was seen — producing duplicated and frozen captions.
 */
export function useConversationTranscript(): UseConversationTranscriptReturn {
  const session = useSessionContext();
  const { messages, send } = useSessionMessages(session);

  const turns = useMemo(() => buildTurns(messages), [messages]);

  return useMemo(
    () => ({
      turns,
      latestUser: latestTurn(turns, 'user'),
      latestAgent: latestTurn(turns, 'agent'),
      sendText: async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        await send(trimmed, { topic: 'lk.chat' });
      },
    }),
    [turns, send]
  );
}
