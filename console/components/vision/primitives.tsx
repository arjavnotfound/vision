'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  CornerDownLeft,
  MousePointerClick,
  Search,
  Type,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ActivityItem, actionVerb, domainOf } from '@/lib/activity';
import { cn } from '@/lib/shadcn/utils';
import { StaticMark } from './vision-mark';
import type { ConnectionState } from './vision-model';

/* -------------------------------------------------------------------------- */
/* Viewfinder crop marks — the signature motif. Hero panels and frames only.   */
/* -------------------------------------------------------------------------- */
export function CropMarks({
  inset = 14,
  length = 18,
  className,
  tone = 'rule',
  lock = false,
}: {
  inset?: number;
  length?: number;
  className?: string;
  tone?: 'rule' | 'ember';
  /** Focus lock: corners step 16px inward and turn ember (on every action). */
  lock?: boolean;
}) {
  const ember = tone === 'ember' || lock;
  const color = ember ? 'var(--ember)' : 'var(--bone-3)';
  const spring = '0.5s cubic-bezier(0.2, 1.35, 0.35, 1)';
  const corner = (pos: string, borders: string) => (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute', pos)}
      style={{
        width: length,
        height: length,
        borderColor: color,
        borderStyle: 'solid',
        borderWidth: 0,
        ...Object.fromEntries(borders.split(' ').map((b) => [b, 1.5])),
        opacity: ember ? 1 : 0.7,
        transition: `border-color 0.25s ease, opacity 0.25s ease`,
      }}
    />
  );
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute', className)}
      style={{ inset: inset + (lock ? 16 : 0), transition: `inset ${spring}` }}
    >
      {corner('top-0 left-0', 'borderTopWidth borderLeftWidth')}
      {corner('top-0 right-0', 'borderTopWidth borderRightWidth')}
      {corner('bottom-0 left-0', 'borderBottomWidth borderLeftWidth')}
      {corner('bottom-0 right-0', 'borderBottomWidth borderRightWidth')}
    </div>
  );
}

export function Grain() {
  return <div aria-hidden className="grain-layer" />;
}

/* -------------------------------------------------------------------------- */
/* State word (Doto) and clock                                                 */
/* -------------------------------------------------------------------------- */
const WORDS: Record<string, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  acting: 'Working',
  error: 'Error',
  offline: 'Offline',
  connecting: 'Connecting',
  muted: 'Mic off',
};

export function StateWord({
  state,
  className,
  size = 28,
}: {
  state: keyof typeof WORDS | string;
  className?: string;
  size?: number;
}) {
  const word = WORDS[state] ?? state;
  const shimmer = state === 'thinking' || state === 'connecting';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={word}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22 }}
        className={cn(
          'display-word inline-block leading-none',
          shimmer ? 'shimmer-text' : state === 'error' ? 'text-err' : 'text-bone',
          className
        )}
        style={{ fontSize: size }}
        aria-live="polite"
      >
        {word}
      </motion.span>
    </AnimatePresence>
  );
}

export function Clock({ className, size = 22 }: { className?: string; size?: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  const hours = now ? String(now.getHours()).padStart(2, '0') : '--';
  const minutes = now ? String(now.getMinutes()).padStart(2, '0') : '--';
  // Doto's colon reads like a dagger at this size, so draw two square dots that blink.
  const dot = Math.max(3, Math.round(size / 7));
  return (
    <span
      className={cn('display-word text-bone inline-flex items-center tabular-nums', className)}
      style={{ fontSize: size, letterSpacing: '0.08em' }}
      suppressHydrationWarning
      aria-label={now ? `${hours}:${minutes}` : undefined}
    >
      <span>{hours}</span>
      <span
        aria-hidden
        className="mx-[0.18em] flex animate-[pulse_2s_ease-in-out_infinite] flex-col justify-center"
        style={{ gap: dot * 1.4 }}
      >
        <span className="bg-ember" style={{ width: dot, height: dot, borderRadius: 1 }} />
        <span className="bg-ember" style={{ width: dot, height: dot, borderRadius: 1 }} />
      </span>
      <span>{minutes}</span>
    </span>
  );
}

export function ConnectionPill({ connection }: { connection: ConnectionState }) {
  const label =
    connection === 'live' ? 'Live' : connection === 'connecting' ? 'Linking' : 'Offline';
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium',
        connection === 'live'
          ? 'bg-ember-soft text-bone'
          : 'text-bone-2 shadow-[inset_0_0_0_1px_var(--rule)]'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          connection === 'live'
            ? 'bg-ember shadow-[0_0_10px_var(--ember)]'
            : connection === 'connecting'
              ? 'bg-warn'
              : 'bg-bone-3'
        )}
      />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Action chip: "↗ OPENING youtube.com"                                         */
/* -------------------------------------------------------------------------- */
const ACTION_ICON: Record<string, typeof ArrowUpRight> = {
  open_url: ArrowUpRight,
  search: Search,
  click: MousePointerClick,
  type: Type,
  scroll: ArrowDown,
  press_key: CornerDownLeft,
  go_back: ArrowLeft,
};

export function actionIcon(action: string) {
  return ACTION_ICON[action] ?? ArrowUpRight;
}

export function ActionChip({ item, size = 'md' }: { item: ActivityItem; size?: 'md' | 'lg' }) {
  const Icon = actionIcon(item.action);
  const domain = domainOf(item);
  const target = item.action === 'open_url' && domain ? domain : item.target;
  const failed = item.status === 'error';
  return (
    <span
      className={cn(
        'bg-ink-2 inline-flex max-w-full items-center gap-3 rounded-full pr-5 pl-2 shadow-[inset_0_0_0_1px_var(--rule)]',
        size === 'lg' ? 'h-14' : 'h-11'
      )}
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full',
          failed ? 'bg-err/15 text-err' : 'bg-ember-soft text-ember-text',
          size === 'lg' ? 'size-10' : 'size-8'
        )}
      >
        <Icon className={size === 'lg' ? 'size-5' : 'size-4'} strokeWidth={2.2} />
      </span>
      <span className="text-bone-2 shrink-0 text-[14px] font-medium">
        {failed ? `Couldn't ${actionVerb(item.action).toLowerCase()}` : actionVerb(item.action)}
      </span>
      {target && (
        <span
          className={cn(
            'truncate font-medium',
            item.action === 'open_url' && !failed ? 'text-ember-text' : 'text-bone',
            size === 'lg' ? 'text-[20px]' : 'text-[17px]'
          )}
        >
          {target}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Reply text: words fade in chunk by chunk, already-shown words never re-animate */
/* -------------------------------------------------------------------------- */
export function StreamingText({
  text,
  resetKey,
  className,
}: {
  text: string;
  resetKey: string;
  className?: string;
}) {
  const words = text.split(/(\s+)/).filter(Boolean);
  return (
    <span key={resetKey} className={className}>
      {words.map((word, index) =>
        /\s+/.test(word) ? (
          <span key={index}>{word}</span>
        ) : (
          <motion.span
            key={index}
            // Each word starts at 12% and comes up to full as it is spoken.
            initial={{ opacity: 0.12 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="inline-block"
          >
            {word}
          </motion.span>
        )
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Wordmark: static mark + VISION in Geist 500, uppercase, 0.34em tracking      */
/* -------------------------------------------------------------------------- */
export function Wordmark({
  markSize = 24,
  stacked = false,
  className,
}: {
  markSize?: number;
  stacked?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-bone inline-flex items-center',
        stacked ? 'flex-col gap-4' : 'gap-3',
        className
      )}
    >
      <StaticMark size={markSize} />
      <span
        className="font-sans text-[15px] font-medium uppercase"
        style={{ letterSpacing: '0.34em', marginRight: '-0.34em' }}
      >
        VISION
      </span>
    </span>
  );
}

/** True for ~650ms after each action: drives the viewfinder "focus lock". */
export function useFocusLock(actionPulse: number, durationMs = 650) {
  const [locked, setLocked] = useState(false);
  const first = useRef(actionPulse);
  useEffect(() => {
    if (actionPulse === first.current) return;
    setLocked(true);
    const timer = setTimeout(() => setLocked(false), durationMs);
    return () => clearTimeout(timer);
  }, [actionPulse, durationMs]);
  return locked;
}
