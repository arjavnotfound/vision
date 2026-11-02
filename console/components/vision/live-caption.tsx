'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { type CaptionSize, useSettings } from '@/lib/settings';
import { cn } from '@/lib/shadcn/utils';
import { DwellTarget } from './dwell-target';
import { ActionChip, StateWord, StreamingText } from './primitives';
import { useVision } from './vision-model';

const SIZES: Record<'strip' | 'console', Record<CaptionSize, number>> = {
  // The strip is the 68px orb, opened: one line of reply, newest words kept.
  strip: { M: 16, L: 18, XL: 20 },
  console: { M: 24, L: 28, XL: 34 },
};

/**
 * Shows at most `lines` lines of a streaming reply, anchored to the NEWEST words:
 * older text slides up and fades out under a top mask instead of the tail being cut.
 */
function ReplyTail({
  lines,
  fontSize,
  variant,
  children,
}: {
  lines: number;
  fontSize: number;
  variant: 'strip' | 'console';
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const lineHeight = 1.28;
  const maxHeight = Math.ceil(fontSize * lineHeight * lines);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () =>
      setOverflowing(
        lines === 1
          ? ((el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0) > el.clientWidth + 1
          : el.scrollHeight > el.clientHeight + 1
      );
    check();
    const observer = new ResizeObserver(check);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    observer.observe(el);
    return () => observer.disconnect();
  }, [lines]);

  if (lines === 1) {
    // One unwrapped line; when it overflows, keep the NEWEST words and fade the start.
    return (
      <div
        ref={box}
        className={cn(
          'flex overflow-hidden whitespace-nowrap',
          overflowing ? 'justify-end' : 'justify-start'
        )}
        style={{
          maskImage: overflowing ? 'linear-gradient(to right, transparent, black 22%)' : undefined,
        }}
      >
        <p
          className="text-bone shrink-0 font-normal"
          style={{ fontSize, lineHeight, letterSpacing: '-0.01em' }}
        >
          {children}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={box}
      className="flex flex-col justify-end overflow-hidden"
      style={{
        maxHeight,
        maskImage: overflowing ? 'linear-gradient(to bottom, transparent, black 45%)' : undefined,
      }}
    >
      <p
        className={cn('text-bone font-normal', variant === 'console' && 'text-balance')}
        style={{ fontSize, lineHeight, letterSpacing: '-0.01em' }}
      >
        {children}
      </p>
    </div>
  );
}

/** A pending yes/no: answer by resting on Yes or No, or by saying it. No key needed. */
function ConfirmRow({ question, variant }: { question: string; variant: 'strip' | 'console' }) {
  const { actions } = useVision();
  const button = (label: string, yes: boolean) => (
    <DwellTarget
      label={label}
      onActivate={() => actions.answerConfirm(yes)}
      hitSize={56}
      indicator="bar"
      tone={yes ? 'ink' : 'ember'}
      className={cn(
        'h-14 shrink-0 rounded-full px-5 text-[16px] font-medium',
        yes
          ? 'bg-ember text-[#1a0d07]'
          : 'text-bone hover:bg-ink-3 shadow-[inset_0_0_0_1px_var(--rule-strong)]'
      )}
    >
      {label}
    </DwellTarget>
  );
  return (
    <div className={cn('flex min-w-0 items-center gap-3', variant === 'console' && 'py-2')}>
      <p
        className="text-bone min-w-0 flex-1 truncate font-medium"
        style={{ fontSize: variant === 'console' ? 24 : 16 }}
        title={question}
      >
        {question}
      </p>
      {button('Yes', true)}
      {button('No', false)}
    </div>
  );
}

/**
 * The Live Caption: the user's words in a small mono line (YOU), Vision's reply
 * underneath in large Geist. Actions briefly replace it with a chip.
 */
export function LiveCaption({
  variant,
  className,
  showStateWord = true,
}: {
  variant: 'strip' | 'console';
  className?: string;
  /** In the console the state word lives under the hero, so the caption omits it. */
  showStateWord?: boolean;
}) {
  const model = useVision();
  const { captionSize } = useSettings();
  const fontSize = SIZES[variant][captionSize];
  const {
    uiState,
    userCaption,
    agentCaption,
    agentCaptionKey,
    chip,
    connection,
    isMuted,
    confirm,
  } = model;

  const word =
    connection === 'connecting'
      ? 'connecting'
      : isMuted && variant === 'strip'
        ? 'muted'
        : uiState === 'thinking'
          ? 'thinking'
          : uiState === 'listening'
            ? 'listening'
            : uiState === 'error'
              ? 'error'
              : uiState === 'acting'
                ? 'acting'
                : 'idle';

  // The strip has the orb's own ember chip underneath, so it shows the state word.
  const showChip = Boolean(chip) && variant === 'console';
  const showReply =
    !showChip && Boolean(agentCaption) && uiState !== 'thinking' && !(chip && variant === 'strip');
  const mainKey = showChip
    ? `chip-${chip?.id}`
    : showReply
      ? `reply-${agentCaptionKey}`
      : `word-${word}`;

  if (model.notice && !confirm) {
    return (
      <div className={cn('flex min-w-0 flex-col justify-center', className)}>
        <p
          className="text-bone min-w-0 truncate font-medium"
          style={{ fontSize: variant === 'console' ? 24 : 16 }}
          role="status"
        >
          {model.notice}
        </p>
      </div>
    );
  }

  if (confirm) {
    return (
      <div className={cn('flex min-w-0 flex-col justify-center', className)}>
        <ConfirmRow question={confirm.question} variant={variant} />
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-col justify-center', className)}>
      <div className={cn('flex items-center gap-2.5', variant === 'strip' ? 'h-4' : 'h-5')}>
        <AnimatePresence initial={false}>
          {userCaption && (
            <motion.p
              key="you"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-bone-3 min-w-0 truncate font-mono text-[12px] tracking-[0.02em]"
              style={{ fontSize: variant === 'console' ? 13 : 12 }}
            >
              <span className="text-bone-2 mr-2 font-sans font-medium">You</span>
              {userCaption}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div
        className={cn('relative', variant === 'strip' ? 'mt-0.5' : 'mt-1.5')}
        style={{ minHeight: Math.round(fontSize * 1.3) }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mainKey}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="min-w-0"
          >
            {showChip && chip ? (
              <ActionChip item={chip} size={variant === 'console' ? 'lg' : 'md'} />
            ) : showReply ? (
              <ReplyTail lines={variant === 'strip' ? 1 : 3} fontSize={fontSize} variant={variant}>
                <StreamingText text={agentCaption} resetKey={agentCaptionKey} />
              </ReplyTail>
            ) : showStateWord ? (
              <StateWord state={word} size={variant === 'strip' ? 20 : 30} />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
