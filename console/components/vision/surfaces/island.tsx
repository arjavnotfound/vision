'use client';

import { useEffect, useState } from 'react';
import { Check, Mic, Pause, Play, ScanFace, Settings, Square, X } from 'lucide-react';
import { AnimatePresence, type MotionValue, motion, useTransform } from 'motion/react';
import { type ActivityItem, actionVerb, domainOf } from '@/lib/activity';
import { getElectron } from '@/lib/electron';
import {
  type FaceState,
  type IslandView,
  currentSteps,
  faceState,
  islandView,
  windowModeFor,
} from '@/lib/island';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/shadcn/utils';
import { requestWindowMode } from '@/lib/window-mode';
import { useReducedMotionPref } from '../appearance-root';
import { DwellTarget } from '../dwell-target';
import { VisionMark } from '../vision-mark';
import { useVision } from '../vision-model';

/** Prototype spring: cubic-bezier(.2,1.35,.35,1) over ~0.6s. */
const SPRING = { duration: 0.55, ease: [0.2, 1.2, 0.35, 1] } as const;
/** "Can't see you" only after the face has been gone this long (not on a blink). */
const UNSEEN_AFTER_MS = 1_500;
/** The menu closes by itself after this long without the pointer on it. */
const MENU_IDLE_MS = 10_000;

const STOP_HINT = 'Stops when you’re quiet · say “Vision, stop”';

function stepText(item: ActivityItem) {
  const domain = domainOf(item);
  const target = item.action === 'open_url' && domain ? domain : item.target;
  return `${actionVerb(item.action)} ${target}`.trim();
}

function pausedText(eyesResume: boolean) {
  // The spoken "Vision, resume" is not built yet: show the gesture that resumes.
  return eyesResume ? 'Paused · close your eyes 2 s to resume' : 'Paused · rest here to resume';
}

const DOT: Record<FaceState, string> = {
  tracking: 'bg-ok',
  unseen: 'bg-warn',
  paused: 'bg-bone-3',
};

function StatusDot({ state, className }: { state: FaceState; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[state], className)}
    />
  );
}

/** Live level bars for Listening (motion values, no re-render per frame). */
function LevelMeter({ level }: { level: MotionValue<number> }) {
  return (
    <span aria-hidden className="flex h-6 items-center gap-[3px]">
      {[0.55, 0.85, 1, 0.75, 0.5].map((k, i) => (
        <Bar key={i} level={level} k={k} />
      ))}
    </span>
  );
}

function Bar({ level, k }: { level: MotionValue<number>; k: number }) {
  const scaleY = useTransform(level, (v) => 0.18 + Math.min(1, v * 1.25) * k * 0.82);
  return <motion.span className="bg-ember h-6 w-[3px] rounded-full" style={{ scaleY }} />;
}

function BigTarget({
  label,
  icon,
  onActivate,
  onHover,
  className,
  previewProgress,
}: {
  label: string;
  icon?: React.ReactNode;
  onActivate: () => void;
  onHover?: () => void;
  className?: string;
  previewProgress?: number;
}) {
  return (
    <DwellTarget
      label={label}
      onActivate={onActivate}
      onHoverChange={(on) => on && onHover?.()}
      indicator="bar"
      hitSize={72}
      previewProgress={previewProgress}
      className={cn(
        'bg-ink-2 text-bone hover:bg-ink-3 flex-col gap-1.5 rounded-[18px] text-[15px] font-medium shadow-[inset_0_0_0_1px_var(--rule-strong)] transition-colors',
        className
      )}
    >
      {icon}
      {label}
    </DwellTarget>
  );
}

/** Stop / Close at the island's far end: never where the resting pill was. */
function EndTarget({
  label,
  onActivate,
  stop = false,
}: {
  label: string;
  onActivate: () => void;
  stop?: boolean;
}) {
  return (
    <DwellTarget
      label={label}
      onActivate={onActivate}
      indicator="bar"
      hitSize={56}
      className="text-bone-2 hover:bg-ink-3 hover:text-bone h-14 shrink-0 gap-2 rounded-full px-4 text-[14px] font-medium shadow-[inset_0_0_0_1px_var(--rule-strong)] transition-colors"
    >
      {stop ? (
        <Square className="text-ember size-4 fill-current" strokeWidth={0} />
      ) : (
        <X className="size-5" strokeWidth={1.8} />
      )}
      {label}
    </DwellTarget>
  );
}

export function Island({
  previewView,
  previewProgress,
}: {
  /** Force a view (preview only). */
  previewView?: IslandView;
  previewProgress?: number;
}) {
  const model = useVision();
  const { actions } = model;
  const settings = useSettings();
  const reduced = useReducedMotionPref();
  const bottom = settings.islandEdge === 'bottom';
  const [menu, setMenu] = useState<'menu' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    getElectron()?.setEdge?.(settings.islandEdge);
  }, [settings.islandEdge]);

  // Voice starting (wake word, hotkey) closes the menu.
  const voiceOn = model.surface === 'strip';
  useEffect(() => {
    if (voiceOn) setMenu(null);
  }, [voiceOn]);

  // A clock for the wake flash and the done window; ticks only while voice is on.
  const sinceActivate = now - model.activatedAt;
  useEffect(() => {
    if (!voiceOn) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    setNow(Date.now());
    return () => clearInterval(id);
  }, [voiceOn, model.activatedAt]);

  // Steps: when the island last saw one running, so a finished request shows "done".
  const anyRunning = model.activity.some((item) => item.status === 'running');
  const [endedAt, setEndedAt] = useState(0);
  useEffect(() => {
    if (!anyRunning) setEndedAt(Date.now());
  }, [anyRunning]);
  const steps = voiceOn
    ? currentSteps(model.activity, model.activatedAt - 1_000, now, endedAt)
    : [];

  const view: IslandView =
    previewView ??
    islandView({
      surface: model.surface,
      uiState: model.uiState,
      userCaption: model.userCaption,
      agentCaption: model.agentCaption,
      hasConfirm: Boolean(model.confirm),
      hasNotice: Boolean(model.notice),
      hasSteps: steps.length > 0,
      fullScreen: model.fullScreen,
      menu,
      sinceActivate,
    });

  useEffect(() => {
    if (previewView) return;
    requestWindowMode(windowModeFor(view));
  }, [view, previewView]);

  // Face status, with "can't see you" held back over short dropouts.
  const rawFace = faceState(model.face);
  const [face, setFace] = useState<FaceState>(rawFace);
  useEffect(() => {
    if (rawFace !== 'unseen') {
      setFace(rawFace);
      return;
    }
    const timer = setTimeout(() => setFace('unseen'), UNSEEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [rawFace]);

  // The menu closes itself when left alone.
  const [menuTouched, setMenuTouched] = useState(0);
  const touchMenu = () => setMenuTouched(Date.now());
  useEffect(() => {
    if (!menu || previewView) return;
    const timer = setTimeout(() => setMenu(null), MENU_IDLE_MS);
    return () => clearTimeout(timer);
  }, [menu, menuTouched, previewView]);

  const openMenu = () => {
    touchMenu();
    setMenu('menu');
  };
  const closeMenu = () => setMenu(null);
  const run = (fn?: () => void) => () => {
    setMenu(null);
    fn?.();
  };

  const transition = reduced ? { duration: 0 } : SPRING;
  const hotkey = model.hotkeyLabel.replace(/\+/g, ' ');

  const body = (() => {
    switch (view) {
      case 'sliver':
        return null;
      case 'resting':
        return null;
      case 'wake':
        return (
          <Row mark={<VisionMark size={44} state="listening" micLevel={model.micLevel} />}>
            <p className="label-mono text-ember-text text-[12px] tracking-[0.18em] uppercase">
              Heard you
            </p>
            <p className="text-bone text-[22px] leading-tight font-medium">Go ahead</p>
          </Row>
        );
      case 'listening':
        return (
          <Row
            mark={<VisionMark size={44} state="listening" micLevel={model.micLevel} />}
            end={<EndTarget label="Stop" stop onActivate={actions.endSession} />}
          >
            <div className="flex items-center gap-3">
              <p className="text-bone text-[22px] leading-tight font-medium">Listening…</p>
              <LevelMeter level={model.micLevel} />
            </div>
            <p className="text-bone-2 text-[14px]">{STOP_HINT}</p>
          </Row>
        );
      case 'understood':
        return (
          <Row
            mark={<VisionMark size={44} state="listening" micLevel={model.micLevel} />}
            end={<EndTarget label="Stop" stop onActivate={actions.endSession} />}
          >
            <p className="label-mono text-bone-3 text-[11px] tracking-[0.18em] uppercase">
              You said
            </p>
            <p className="text-bone line-clamp-2 text-[20px] leading-snug">“{model.userCaption}”</p>
          </Row>
        );
      case 'acting':
        return (
          <Row
            mark={<VisionMark size={44} state="acting" actionPulse={model.actionPulse} />}
            end={<EndTarget label="Stop" stop onActivate={actions.endSession} />}
          >
            <p className="text-bone text-[20px] leading-tight font-medium">
              {steps.some((s) => s.status === 'running') || !steps.length
                ? 'Working on it'
                : 'Done'}
            </p>
            {model.userCaption && (
              <p className="text-bone-2 line-clamp-1 text-[14px]">“{model.userCaption}”</p>
            )}
          </Row>
        );
      case 'speaking':
        return (
          <Row
            mark={
              <VisionMark
                size={44}
                state={model.uiState === 'error' ? 'error' : 'speaking'}
                outputLevel={model.outputLevel}
                errorPulse={model.errorPulse}
              />
            }
            end={<EndTarget label="Stop" stop onActivate={actions.endSession} />}
          >
            <p className="text-bone line-clamp-3 text-[18px] leading-snug">{model.agentCaption}</p>
          </Row>
        );
      case 'confirm':
        return (
          <Row mark={<VisionMark size={44} state="thinking" />}>
            <p className="label-mono text-ember-text text-[11px] tracking-[0.18em] uppercase">
              Needs a yes
            </p>
            <p className="text-bone line-clamp-3 text-[19px] leading-snug">
              {model.confirm?.question || 'Should I go ahead?'}
            </p>
          </Row>
        );
      case 'offline':
        return (
          <Row
            mark={<VisionMark size={44} state="offline" />}
            end={<EndTarget label="Close" onActivate={actions.collapse} />}
          >
            <p className="text-bone text-[20px] leading-tight font-medium">Voice is offline</p>
            <p className="text-bone-2 text-[14px]">Face control still works</p>
          </Row>
        );
      case 'menu':
        return (
          <Row
            mark={<VisionMark size={44} state="idle" />}
            end={<EndTarget label="Close" onActivate={closeMenu} />}
          >
            <p className="text-bone flex items-center gap-2 text-[17px] font-medium">
              <StatusDot state={face} />
              {face === 'paused'
                ? pausedText(Boolean(model.face?.eyesResume))
                : face === 'unseen'
                  ? 'Can’t see you'
                  : 'Face control is on'}
            </p>
            <p className="text-bone-2 text-[14px]">
              Say “Vision” to talk{hotkey ? ` · or ${hotkey}` : ''}
            </p>
            {model.fullScreen && (
              <p className="text-bone-3 text-[13px]">
                In full screen VISION waits as a thin line at the top. Rest on it or say “Vision”.
              </p>
            )}
          </Row>
        );
    }
  })();

  // The card under the island: steps, yes/no, the menu.
  const card = (() => {
    if (view === 'acting' && steps.length) {
      return (
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <li key={step.id} className="flex items-center gap-3 text-[15px]">
              <span className="label-mono text-bone-3 w-[64px] shrink-0 text-[11px] tracking-[0.12em] uppercase">
                Step {i + 1}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  step.status === 'running' ? 'text-bone' : 'text-bone-2'
                )}
              >
                {stepText(step)}
              </span>
              {step.status === 'running' && (
                <span className="bg-ember size-2 shrink-0 animate-pulse rounded-full" />
              )}
              {step.status === 'done' && <Check className="text-ok size-4" strokeWidth={2.2} />}
              {step.status === 'error' && (
                <span className="text-err shrink-0 text-[13px]">Didn’t work</span>
              )}
            </li>
          ))}
        </ol>
      );
    }
    if (view === 'confirm') {
      return (
        // The middle, where a resting pointer is likely, is text. No background dismiss.
        <div className="flex items-stretch gap-4">
          <BigTarget
            label="No"
            className="h-[88px] w-[190px] text-[20px]"
            onActivate={() => actions.answerConfirm(false)}
          />
          <p className="text-bone-2 flex flex-1 items-center justify-center text-center text-[14px] leading-snug">
            say yes
            <br />
            or no
          </p>
          <BigTarget
            label="Yes"
            className="bg-ember-soft h-[88px] w-[190px] text-[20px] shadow-[inset_0_0_0_1.5px_var(--ember)]"
            onActivate={() => actions.answerConfirm(true)}
            previewProgress={previewProgress}
          />
        </div>
      );
    }
    if (view === 'menu') {
      const paused = face === 'paused';
      const icon = 'size-6';
      return (
        <div className="grid grid-cols-4 gap-3">
          <BigTarget
            label="Talk"
            icon={<Mic className={icon} strokeWidth={1.8} />}
            className="h-[92px]"
            onHover={touchMenu}
            onActivate={run(actions.activate)}
            previewProgress={previewProgress}
          />
          <BigTarget
            label="Face control"
            icon={<ScanFace className={icon} strokeWidth={1.8} />}
            className="h-[92px] text-[14px]"
            onHover={touchMenu}
            onActivate={run(actions.showFace)}
          />
          <BigTarget
            label={paused ? 'Resume' : 'Pause'}
            icon={
              paused ? (
                <Play className={icon} strokeWidth={1.8} />
              ) : (
                <Pause className={icon} strokeWidth={1.8} />
              )
            }
            className="h-[92px]"
            onHover={touchMenu}
            onActivate={run(actions.togglePause)}
          />
          <BigTarget
            label="Settings"
            icon={<Settings className={icon} strokeWidth={1.8} />}
            className="h-[92px]"
            onHover={touchMenu}
            onActivate={run(actions.openSettings)}
          />
        </div>
      );
    }
    return null;
  })();

  const resting = view === 'resting';
  const restingLabel =
    face === 'paused'
      ? pausedText(Boolean(model.face?.eyesResume))
      : face === 'unseen'
        ? 'Can’t see you'
        : null;

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 flex items-center',
        bottom ? 'bottom-0 flex-col-reverse' : 'top-0 flex-col'
      )}
    >
      {view === 'sliver' ? (
        <DwellTarget
          label="Open VISION"
          onActivate={openMenu}
          indicator="none"
          hitSize={0}
          className={cn('bg-bone-3 pointer-events-auto h-2 w-[160px] opacity-80', 'rounded-b-full')}
        >
          <span className="sr-only">VISION</span>
        </DwellTarget>
      ) : (
        <motion.div
          layout
          transition={transition}
          className={cn(
            'bg-ink-1 pointer-events-auto relative overflow-hidden',
            'shadow-[inset_0_0_0_1px_var(--rule-strong),0_18px_40px_-18px_rgba(0,0,0,0.55)]',
            view === 'wake' &&
              'shadow-[inset_0_0_0_2px_var(--ember),0_0_40px_rgba(255,90,31,0.35)]',
            face === 'paused' && resting && 'bg-ink-2'
          )}
          style={{ borderRadius: bottom ? '26px 26px 0 0' : '0 0 26px 26px' }}
        >
          {resting ? (
            <DwellTarget
              label="VISION menu"
              onActivate={openMenu}
              indicator="bar"
              hitSize={34}
              previewProgress={previewProgress}
              className="h-[34px] justify-center gap-2.5 px-4"
              style={{ minWidth: 130 }}
            >
              <span className={cn(face === 'paused' && 'opacity-50')}>
                <VisionMark size={22} state="idle" />
              </span>
              <StatusDot state={face} />
              {restingLabel && (
                <span
                  className={cn(
                    'text-[13px] font-medium whitespace-nowrap',
                    face === 'paused' ? 'text-bone-2' : 'text-bone'
                  )}
                >
                  {restingLabel}
                </span>
              )}
            </DwellTarget>
          ) : (
            <motion.div
              key="open"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduced ? 0 : 0.2, delay: reduced ? 0 : 0.12 }}
              className="w-[min(580px,calc(100vw-24px))]"
            >
              {body}
            </motion.div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {card && (
          <motion.div
            key={view}
            initial={reduced ? false : { opacity: 0, y: bottom ? 8 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.15 } }}
            transition={transition}
            className="bg-ink-1 pointer-events-auto mt-2 mb-2 w-[min(580px,calc(100vw-24px))] rounded-[22px] p-4 shadow-[inset_0_0_0_1px_var(--rule-strong),var(--shadow-lift)]"
          >
            {card}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({
  mark,
  end,
  children,
}: {
  mark: React.ReactNode;
  end?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[84px] items-center gap-4 py-3 pr-3 pl-5">
      <div className="shrink-0">{mark}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {end}
    </div>
  );
}
