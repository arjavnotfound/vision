'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { useMaybeRoomContext } from '@livekit/components-react';
import { type ActivityItem, applyActionEvent, parseActionEvent } from '@/lib/activity';
import { type PendingConfirm, confirmFromEvent } from '@/lib/confirm';
import { visionAudio } from '@/lib/vision-audio';

export interface VisionActionsState {
  activity: ActivityItem[];
  /** Increments on every action_start: drives the Aperture shutter snap. */
  actionPulse: number;
  /** Increments on every action_error: drives the Aperture error shake. */
  errorPulse: number;
  /** The item to show as a caption chip, cleared a few seconds after it settles. */
  chip: ActivityItem | null;
  /** A pending yes/no question from a tool (closing a window, a consequential click). */
  confirm: PendingConfirm | null;
  clearConfirm: () => void;
}

const CONFIRM_TIMEOUT_MS = 30_000;

let counter = 0;
const makeId = () => `act-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** `onWake`: the agent heard "Hey Vision" (wake-word mode). */
export function useVisionActions(onWake?: () => void): VisionActionsState {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;
  const room = useMaybeRoomContext();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [actionPulse, setActionPulse] = useState(0);
  const [errorPulse, setErrorPulse] = useState(0);
  const [chipVisible, setChipVisible] = useState(false);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!room) return;

    const handleData = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string
    ) => {
      if (topic !== 'vision_events') return;
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      if ((raw as { type?: string } | null)?.type === 'wake') {
        onWakeRef.current?.();
        return;
      }
      const question = confirmFromEvent(raw);
      if (question) {
        setConfirm(question);
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
        confirmTimer.current = setTimeout(() => setConfirm(null), CONFIRM_TIMEOUT_MS);
        return;
      }
      const event = parseActionEvent(raw);
      if (!event) return;

      if (event.type === 'action_start') {
        // Whatever was waiting for a yes has now been answered.
        setConfirm(null);
        visionAudio.playTing('action');
        setActionPulse((n) => n + 1);
      } else if (event.type === 'action_error') {
        setErrorPulse((n) => n + 1);
      }

      setActivity((items) => applyActionEvent(items, event, makeId));
      setChipVisible(true);

      if (chipTimer.current) clearTimeout(chipTimer.current);
      chipTimer.current = setTimeout(
        () => setChipVisible(false),
        event.type === 'action_start' ? 6000 : 2600
      );
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      if (chipTimer.current) clearTimeout(chipTimer.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [room]);

  const clearConfirm = useCallback(() => setConfirm(null), []);

  // The feed is newest-first, so the chip always reflects the latest action.
  const chip = chipVisible ? (activity[0] ?? null) : null;
  return { activity, actionPulse, errorPulse, chip, confirm, clearConfirm };
}
