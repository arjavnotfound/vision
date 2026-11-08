'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, Mic, MicOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { actionVerb, domainOf } from '@/lib/activity';
import { getElectron } from '@/lib/electron';
import { cn } from '@/lib/shadcn/utils';
import { ApertureCore } from '../aperture-core';
import { DwellTarget } from '../dwell-target';
import { LiveCaption } from '../live-caption';
import { useVision } from '../vision-model';

/** Prototype spring: cubic-bezier(.2,1.35,.35,1) over ~0.6s. */
export const SHELL_SPRING = { duration: 0.6, ease: [0.2, 1.35, 0.35, 1] } as const;

export const ORB = 68;
export const STRIP_W = 580;
const CHIP_MS = 1500;

function OrbButton({
  label,
  onActivate,
  active = false,
  children,
  previewProgress,
}: {
  label: string;
  onActivate: () => void;
  active?: boolean;
  children: React.ReactNode;
  previewProgress?: number;
}) {
  return (
    <DwellTarget
      label={label}
      onActivate={onActivate}
      pressed={active}
      hitSize={56}
      previewProgress={previewProgress}
      className={cn(
        'size-14 rounded-full transition-colors duration-200',
        active
          ? 'bg-ember-soft text-ember-text shadow-[inset_0_0_0_1px_var(--ember)]'
          : 'text-bone-2 hover:bg-ink-3 hover:text-bone shadow-[inset_0_0_0_1px_var(--rule-strong)]'
      )}
    >
      {children}
    </DwellTarget>
  );
}

/**
 * The floating orb. Resting, it is a 68px disc with the live mark. Activated, the
 * same element grows to the LEFT into the strip while the mark stays anchored on
 * the right, under the pointer or gaze. One element, so the mark never restarts.
 */
export function FloatingOrb({
  open,
  forceHint = false,
  previewProgress,
  previewChip,
}: {
  open: boolean;
  forceHint?: boolean;
  /** Freeze a dwell indicator (preview only). */
  previewProgress?: number;
  /** Force the action chip text (preview only). */
  previewChip?: string;
}) {
  const model = useVision();
  const { actions } = model;
  const [hover, setHover] = useState(false);
  const showHint = !open && (hover || forceHint);

  // Electron: widen the window for the hint while resting. Ignore once the strip
  // is opening, so the hover-out during the morph can't shrink it back.
  const lastHover = useRef(false);
  const surfaceRef = useRef(model.surface);
  surfaceRef.current = model.surface;
  useEffect(() => {
    if (forceHint || hover === lastHover.current) return;
    lastHover.current = hover;
    if (model.surface === 'orb' && hover) getElectron()?.setMode?.('orb-hint');
  }, [hover, forceHint, model.surface]);
  // Shrink only after the hint has faded out; shrinking first clips the pill mid-fade.
  const shrinkAfterHint = () => {
    if (!forceHint && !lastHover.current && surfaceRef.current === 'orb') {
      getElectron()?.setMode?.('orb');
    }
  };

  // Ember chip under the orb on every action, for ~1.5s.
  const [chipText, setChipText] = useState<string | null>(null);
  const firstPulse = useRef(model.actionPulse);
  const chipSource = model.chip ?? model.activity[0] ?? null;
  const chipRef = useRef(chipSource);
  chipRef.current = chipSource;
  useEffect(() => {
    if (model.actionPulse === firstPulse.current) return;
    const item = chipRef.current;
    if (!item) return;
    const domain = domainOf(item);
    const target = item.action === 'open_url' && domain ? domain : item.target;
    setChipText(`${actionVerb(item.action)} ${target}`.trim());
    const timer = setTimeout(() => setChipText(null), CHIP_MS);
    return () => clearTimeout(timer);
  }, [model.actionPulse]);
  const chip = previewChip ?? chipText;

  const hotkey = model.hotkeyLabel.replace(/\+/g, ' ');

  return (
    <div className="orb-anchor pointer-events-none fixed bottom-3 flex flex-col items-end gap-3">
      {/* Hint pill (resting + dwelling only) */}
      <div className="flex h-[34px] items-end">
        <AnimatePresence onExitComplete={shrinkAfterHint}>
          {showHint && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ opacity: { duration: 0.25 }, y: SHELL_SPRING }}
              className="bg-bone text-ink-0 flex h-[34px] items-center gap-2 rounded-full px-[14px] font-mono text-[10.5px] font-medium tracking-[0.16em] whitespace-nowrap uppercase"
            >
              Look here to talk
              {hotkey && <span className="opacity-60">· {hotkey}</span>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* The orb itself */}
      <motion.div
        initial={false}
        animate={{ width: open ? `min(${STRIP_W}px, calc(100vw - 48px))` : `${ORB}px` }}
        transition={SHELL_SPRING}
        className="bg-ink-1 pointer-events-auto relative rounded-full shadow-[inset_0_0_0_1px_var(--rule-strong),0_18px_40px_-18px_rgba(0,0,0,0.55)]"
        style={{ height: ORB }}
      >
        <div className="flex h-full flex-row-reverse items-center gap-3 rounded-full py-[6px] pr-[6px] pl-[6px]">
          {/* Mark: anchored right. Dwell target only while resting. */}
          <DwellTarget
            label={model.hotkeyLabel ? `Talk to VISION (${model.hotkeyLabel})` : 'Talk to VISION'}
            onActivate={actions.activate}
            onHoverChange={setHover}
            disabled={open}
            hitSize={56}
            ringOutset={10}
            previewProgress={open ? undefined : previewProgress}
            className="size-14 shrink-0 rounded-full disabled:cursor-default disabled:opacity-100"
          >
            <ApertureCore
              size={54}
              state={model.uiState}
              micLevel={model.micLevel}
              outputLevel={model.outputLevel}
              actionPulse={model.actionPulse}
              errorPulse={model.errorPulse}
            />
          </DwellTarget>

          {/* Strip contents: hidden (not just transparent) while closed, so nothing
              intercepts clicks or dwell on the 68px orb. */}
          <motion.div
            initial={false}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 0.25, delay: open ? 0.18 : 0 }}
            className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
            style={{ visibility: open ? 'visible' : 'hidden' }}
            aria-hidden={!open}
          >
            <OrbButton label="Collapse" onActivate={actions.collapse}>
              <X className="size-[22px]" strokeWidth={1.8} />
            </OrbButton>
            <LiveCaption variant="strip" className="min-w-0 flex-1" />
            <OrbButton
              label={model.isMuted ? 'Unmute microphone' : 'Mute microphone'}
              onActivate={actions.toggleMute}
              active={model.isMuted}
              previewProgress={open ? previewProgress : undefined}
            >
              {model.isMuted ? (
                <MicOff className="size-[22px]" strokeWidth={1.8} />
              ) : (
                <Mic className="size-[22px]" strokeWidth={1.8} />
              )}
            </OrbButton>
            <OrbButton label="Full view" onActivate={actions.openConsole}>
              <Maximize2 className="size-5" strokeWidth={1.8} />
            </OrbButton>
          </motion.div>
        </div>
      </motion.div>

      {/* Action chip under the orb */}
      <div className="flex h-8 items-start">
        <AnimatePresence>
          {chip && (
            <motion.div
              key={chip}
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 0.25 }, default: SHELL_SPRING }}
              className="bg-ember flex h-8 max-w-[360px] items-center truncate rounded-full px-[14px] font-mono text-[10.5px] font-medium tracking-[0.14em] whitespace-nowrap text-[#1a0d07] uppercase"
            >
              {chip}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Resting orb (kept for existing callers). */
export function OrbSurface({
  forceHint = false,
  previewProgress,
  previewChip,
}: {
  forceHint?: boolean;
  previewProgress?: number;
  previewChip?: string;
}) {
  return (
    <FloatingOrb
      open={false}
      forceHint={forceHint}
      previewProgress={previewProgress}
      previewChip={previewChip}
    />
  );
}
