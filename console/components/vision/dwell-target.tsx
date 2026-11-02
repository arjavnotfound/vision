'use client';

import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type AnimationPlaybackControls,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from 'motion/react';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/shadcn/utils';

export const DWELL_COOLDOWN_MS = 1000;

export interface DwellTargetProps {
  onActivate: () => void;
  children: ReactNode;
  /** Accessible name. Required: many targets are icon-only. */
  label: string;
  /** 'ring' draws a conic ember ring (round targets); 'bar' a bottom bar (wide targets). */
  indicator?: 'ring' | 'bar' | 'none';
  /** Minimum hit area in px (square). Visual content can be smaller. */
  hitSize?: number;
  /** Override the user's dwell time. */
  dwellMs?: number;
  disabled?: boolean;
  /** Pressed/selected state for toggles and nav items. */
  pressed?: boolean;
  /** Fires with 0..1 progress so a parent can render its own indicator. */
  onProgress?: (progress: number) => void;
  /** Hover/dwell state callback, e.g. to reveal a hint label. */
  onHoverChange?: (hovering: boolean) => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Force the visual progress (used by the /preview route). */
  previewProgress?: number;
  /** Indicator colour; use 'ink' on ember-filled buttons. */
  tone?: 'ember' | 'ink';
  /** Draw the dwell ring this many px outside the hit area (e.g. around a larger disc). */
  ringOutset?: number;
}

/**
 * Every interactive element in VISION is a DwellTarget: resting a (head-tracked)
 * pointer on it for the dwell time clicks it. Normal clicks and keyboard still work.
 * After a dwell fires the target needs the pointer to leave before it can dwell again,
 * so a resting pointer never machine-guns a toggle.
 */
export const DwellTarget = forwardRef<HTMLButtonElement, DwellTargetProps>(function DwellTarget(
  {
    onActivate,
    children,
    label,
    indicator = 'ring',
    hitSize = 56,
    dwellMs,
    disabled = false,
    pressed,
    onProgress,
    onHoverChange,
    className,
    style,
    title,
    previewProgress,
    tone = 'ember',
    ringOutset = 0,
  },
  ref
) {
  const settings = useSettings();
  const duration = dwellMs ?? settings.dwellMs;
  const dwellEnabled = settings.dwellEnabled && !disabled;

  const progress = useMotionValue(previewProgress ?? 0);
  const pressScale = useMotionValue(1);
  const ringOffset = useTransform(progress, (p) => 1 - p);
  const ringOpacity = useTransform(progress, [0, 0.04, 1], [0, 1, 1]);
  const controls = useRef<AnimationPlaybackControls | null>(null);
  const armed = useRef(true);
  const cooldownUntil = useRef(0);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    if (previewProgress !== undefined) progress.set(previewProgress);
  }, [previewProgress, progress]);

  useEffect(() => {
    if (!onProgress) return;
    return progress.on('change', onProgress);
  }, [progress, onProgress]);

  const fire = useCallback(() => {
    if (disabled || Date.now() < cooldownUntil.current) return;
    cooldownUntil.current = Date.now() + DWELL_COOLDOWN_MS;
    setFlash((n) => n + 1);
    animate(pressScale, [1, 0.92, 1], { duration: 0.32, ease: 'easeOut' });
    onActivate();
  }, [disabled, onActivate, pressScale]);

  const cancel = useCallback(() => {
    controls.current?.stop();
    controls.current = null;
    if (previewProgress === undefined) {
      animate(progress, 0, { duration: 0.18, ease: 'easeOut' });
    }
  }, [progress, previewProgress]);

  const begin = useCallback(() => {
    if (!dwellEnabled || !armed.current || Date.now() < cooldownUntil.current) return;
    controls.current?.stop();
    progress.set(0);
    controls.current = animate(progress, 1, {
      duration: duration / 1000,
      ease: 'linear',
      onComplete: () => {
        controls.current = null;
        armed.current = false;
        fire();
        animate(progress, 0, { duration: 0.25, ease: 'easeOut' });
      },
    });
  }, [dwellEnabled, duration, fire, progress]);

  useEffect(() => () => controls.current?.stop(), []);

  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      disabled={disabled}
      onPointerEnter={() => {
        onHoverChange?.(true);
        begin();
      }}
      onPointerLeave={() => {
        onHoverChange?.(false);
        armed.current = true;
        cancel();
      }}
      onPointerDown={cancel}
      onClick={fire}
      whileTap={{ scale: 0.94 }}
      className={cn(
        'dwell-target relative inline-flex shrink-0 items-center justify-center outline-none select-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--ember)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ink-0)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      style={{ minWidth: hitSize, minHeight: hitSize, scale: pressScale, ...style }}
    >
      {children}

      {indicator === 'ring' && (
        <svg
          aria-hidden
          className="pointer-events-none absolute -rotate-90 overflow-visible"
          style={{
            inset: -ringOutset,
            width: `calc(100% + ${ringOutset * 2}px)`,
            height: `calc(100% + ${ringOutset * 2}px)`,
          }}
          viewBox="0 0 100 100"
        >
          <motion.circle
            cx="50"
            cy="50"
            r="48.5"
            fill="none"
            stroke={tone === 'ink' ? '#160a04' : 'var(--ember)'}
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray="1 1"
            style={{ strokeDashoffset: ringOffset, opacity: ringOpacity }}
          />
        </svg>
      )}

      {indicator === 'bar' && (
        <motion.span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-[14px] bottom-[6px] h-[2px] origin-left rounded-full',
            tone === 'ink' ? 'bg-[#160a04]/75' : 'bg-[var(--ember)]'
          )}
          style={{ scaleX: progress, opacity: ringOpacity }}
        />
      )}

      {flash > 0 && (
        <motion.span
          key={flash}
          aria-hidden
          initial={{ opacity: 0.55, scale: 0.9 }}
          animate={{ opacity: 0, scale: 1.18 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-[var(--ember)]"
        />
      )}
    </motion.button>
  );
});
