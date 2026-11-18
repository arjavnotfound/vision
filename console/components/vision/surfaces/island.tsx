'use client';

import { useEffect, useState } from 'react';
import { Activity, Check, CircleHelp, Mic, Pause, Play, Settings, X } from 'lucide-react';
import { type MotionValue, motion, useTransform } from 'motion/react';
import { type ActivityItem, actionVerb, domainOf } from '@/lib/activity';
import { getElectron } from '@/lib/electron';
import {
  type FaceState,
  type IslandView,
  type LineTone,
  captionTail,
  currentSteps,
  faceState,
  islandView,
  lineTone,
  voiceStatus,
  windowModeFor,
} from '@/lib/island';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/shadcn/utils';
import { requestWindowMode } from '@/lib/window-mode';
import { useReducedMotionPref } from '../appearance-root';
import { DwellTarget } from '../dwell-target';
import { VisionMark } from '../vision-mark';
import { useVision } from '../vision-model';

/** "Can't see you" only after the face has been gone this long (not on a blink). */
const UNSEEN_AFTER_MS = 1_500;
/** Near the cursor the island fades to this, so it never hides what is under it. */
const NEAR_OPACITY = 0.15;

function stepText(item: ActivityItem) {
  const domain = domainOf(item);
  const target = item.action === 'open_url' && domain ? domain : item.target;
  return `${actionVerb(item.action)} ${target}`.trim();
}

const LINE: Record<LineTone, string> = {
  idle: 'bg-bone-3 opacity-80',
  accent: 'bg-ember',
  warn: 'bg-warn',
  dim: 'bg-bone-3 opacity-35',
};

/** Live level bars for Listening (motion values, no re-render per frame). */
function LevelMeter({ level }: { level: MotionValue<number> }) {
  return (
    <span aria-hidden className="flex h-4 shrink-0 items-center gap-[3px]">
      {[0.55, 0.85, 1, 0.75, 0.5].map((k, i) => (
        <Bar key={i} level={level} k={k} />
      ))}
    </span>
  );
}

function Bar({ level, k }: { level: MotionValue<number>; k: number }) {
  const scaleY = useTransform(level, (v) => 0.18 + Math.min(1, v * 1.25) * k * 0.82);
  return <motion.span className="bg-ember h-4 w-[3px] rounded-full" style={{ scaleY }} />;
}

/** The dwell fill ring next to the bar. It stays solid while the island fades. */
function DwellRing({ progress }: { progress: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden width={22} height={22} viewBox="0 0 22 22" className="shrink-0">
      <circle cx={11} cy={11} r={r} fill="none" stroke="var(--rule-strong)" strokeWidth={2.5} />
      <circle
        cx={11}
        cy={11}
        r={r}
        fill="none"
        stroke="var(--ember)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        transform="rotate(-90 11 11)"
      />
    </svg>
  );
}

/** The resting island: a 56x8 bar. Paused: grey with a pause glyph. Offline: a red dot. */
function RestingBar({ face, offline }: { face: FaceState; offline: boolean }) {
  return (
    <div
      role="img"
      aria-label={
        face === 'paused'
          ? 'VISION: face control paused'
          : offline
            ? 'VISION: voice is off'
            : 'VISION'
      }
      className={cn(
        'relative flex h-2 w-14 items-center justify-center gap-[3px] rounded-full',
        face === 'paused' ? 'bg-bone-3 opacity-60' : face === 'unseen' ? 'bg-warn' : 'bg-bone-2'
      )}
    >
      {face === 'paused' && (
        <>
          <span className="bg-ink-0 h-[5px] w-[2px] rounded-full" />
          <span className="bg-ink-0 h-[5px] w-[2px] rounded-full" />
        </>
      )}
      {offline && (
        <span className="bg-err absolute top-1/2 -right-3 size-1.5 -translate-y-1/2 rounded-full" />
      )}
    </div>
  );
}

/** One line, at most 360x40: what VISION hears, does or says. */
function CaptionPill({ mark, children }: { mark: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-ink-1 flex h-10 max-w-[360px] min-w-[160px] items-center gap-2.5 rounded-full pr-4 pl-2.5 shadow-[inset_0_0_0_1px_var(--rule-strong),0_12px_30px_-14px_rgba(0,0,0,0.55)]">
      <span className="shrink-0">{mark}</span>
      <div className="text-bone flex min-w-0 flex-1 items-center gap-2 text-[15px] leading-none">
        {children}
      </div>
    </div>
  );
}

function MenuRow({
  label,
  detail,
  icon,
  onActivate,
  disabled,
  previewProgress,
}: {
  label: string;
  detail?: string;
  icon: React.ReactNode;
  onActivate: () => void;
  disabled?: boolean;
  previewProgress?: number;
}) {
  return (
    <DwellTarget
      label={label}
      onActivate={onActivate}
      disabled={disabled}
      indicator="bar"
      hitSize={64}
      previewProgress={previewProgress}
      className={cn(
        'bg-ink-2 hover:bg-ink-3 h-16 w-full justify-start gap-4 rounded-[16px] px-4 text-left shadow-[inset_0_0_0_1px_var(--rule)] transition-colors',
        disabled && 'opacity-50'
      )}
    >
      <span className="text-bone-2 grid size-7 shrink-0 place-items-center">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-bone text-[17px] leading-tight font-medium">{label}</span>
        {detail && <span className="text-bone-2 truncate text-[13px]">{detail}</span>}
      </span>
    </DwellTarget>
  );
}

export function Island({
  previewView,
  previewProgress,
  previewTone,
  previewNear,
}: {
  /** Force a view (preview only). */
  previewView?: IslandView;
  previewProgress?: number;
  /** Force the full-screen line's colour (preview only). */
  previewTone?: LineTone;
  /** Show the faded look (preview only). */
  previewNear?: boolean;
}) {
  const model = useVision();
  const { actions } = model;
  const settings = useSettings();
  const reduced = useReducedMotionPref();
  const position = settings.islandPosition;
  const bottom = position === 'bottom-center';
  const [menu, setMenu] = useState<'menu' | null>(null);
  const [near, setNear] = useState(false);
  const [dwell, setDwell] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    getElectron()?.setPosition?.(position);
  }, [position]);
  useEffect(() => {
    const electron = getElectron();
    const offNear = electron?.onNear?.(setNear);
    const offDwell = electron?.onDwell?.(setDwell);
    const offMenu = electron?.onMenu?.((action) => setMenu(action === 'open' ? 'menu' : null));
    return () => {
      offNear?.();
      offDwell?.();
      offMenu?.();
    };
  }, []);
  // "Vision, menu".
  useEffect(() => {
    if (model.menuRequest) setMenu('menu');
  }, [model.menuRequest]);

  // Voice starting (wake phrase, hotkey) closes the menu.
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
      hasHelp: Boolean(model.help),
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

  // A request whose steps have all finished goes back to the resting island once VISION
  // has nothing more to say.
  const working = steps.some((step) => step.status === 'running') || !steps.length;
  const [finished, setFinished] = useState(false);
  const hadSteps = steps.length > 0;
  useEffect(() => {
    if (hadSteps) setFinished(true);
  }, [hadSteps]);
  useEffect(() => {
    if (!voiceOn) setFinished(false);
  }, [voiceOn, model.activatedAt]);
  const { collapse } = actions;
  useEffect(() => {
    if (previewView || !finished || hadSteps || view !== 'listening') return;
    setFinished(false);
    collapse();
  }, [previewView, finished, hadSteps, view, collapse]);
  const run = (fn?: () => void) => () => {
    setMenu(null);
    fn?.();
  };

  const hotkey = model.hotkeyLabel.replace(/\+/g, ' ');
  const voice = voiceStatus({
    voiceOff: Boolean(model.voiceOff),
    offline: Boolean(model.notice) && !model.micMissing,
    micMissing: Boolean(model.micMissing),
    wakePhrase: settings.wakePhrase,
    hotkey,
  });
  const offline = !voice.on;
  const [noticeTitle] = (model.notice ?? 'Voice is off. Face control still works.').split(
    /(?<=\.) /
  );

  const caption = (() => {
    switch (view) {
      case 'wake':
        return (
          <CaptionPill mark={<VisionMark size={22} state="listening" micLevel={model.micLevel} />}>
            <span className="font-medium">Go ahead</span>
          </CaptionPill>
        );
      case 'listening':
        return (
          <CaptionPill mark={<VisionMark size={22} state="listening" micLevel={model.micLevel} />}>
            <span className="font-medium">Listening…</span>
            <LevelMeter level={model.micLevel} />
          </CaptionPill>
        );
      case 'understood':
        return (
          <CaptionPill mark={<VisionMark size={22} state="listening" micLevel={model.micLevel} />}>
            <span className="truncate">“{captionTail(model.userCaption, 44)}”</span>
          </CaptionPill>
        );
      case 'acting': {
        const running = steps.find((step) => step.status === 'running');
        return (
          <CaptionPill
            mark={
              working ? (
                <VisionMark size={22} state="acting" actionPulse={model.actionPulse} />
              ) : (
                <VisionMark size={22} state="idle" />
              )
            }
          >
            {working ? (
              <span className="truncate">
                <span className="font-medium">Working on it</span>
                {running && <span className="text-bone-2"> · {stepText(running)}</span>}
              </span>
            ) : (
              <>
                <Check className="text-ok size-4 shrink-0" strokeWidth={2.4} />
                <span className="font-medium">Done</span>
              </>
            )}
          </CaptionPill>
        );
      }
      case 'speaking':
        return (
          <CaptionPill
            mark={
              <VisionMark
                size={22}
                state={model.uiState === 'error' ? 'error' : 'speaking'}
                outputLevel={model.outputLevel}
                errorPulse={model.errorPulse}
              />
            }
          >
            <span className="truncate">{captionTail(model.agentCaption)}</span>
          </CaptionPill>
        );
      case 'confirm':
        return (
          <CaptionPill mark={<VisionMark size={22} state="thinking" />}>
            <span className="truncate">{model.confirm?.question || 'Should I go ahead?'}</span>
            <span className="text-ember-text shrink-0 text-[13px]">Say yes or no</span>
          </CaptionPill>
        );
      case 'help':
        return (
          <CaptionPill mark={<VisionMark size={22} state="idle" />}>
            <span className="truncate">
              <span className="text-bone-2">Say </span>
              {(model.help?.phrases ?? []).slice(0, 3).join(' · ')}
            </span>
          </CaptionPill>
        );
      case 'offline':
        return (
          <CaptionPill mark={<VisionMark size={22} state="offline" />}>
            <span className="truncate">{noticeTitle}</span>
          </CaptionPill>
        );
      default:
        return null;
    }
  })();

  const paused = face === 'paused';
  const menuPanel = view === 'menu' && (
    <div className="bg-ink-1 flex w-[320px] flex-col gap-1.5 rounded-[22px] p-2 shadow-[inset_0_0_0_1px_var(--rule-strong),var(--shadow-lift)]">
      <div className="flex flex-col gap-0.5 px-3 pt-1.5 pb-1">
        <p className="text-bone text-[15px] font-medium">
          {paused
            ? 'Face control is paused'
            : face === 'unseen'
              ? 'Face control can’t see you'
              : 'Face control is on'}
        </p>
        <p className={cn('text-[13px]', voice.on ? 'text-bone-2' : 'text-warn')}>{voice.text}</p>
      </div>
      <MenuRow
        label="Talk"
        detail={voice.on ? undefined : voice.text.split(' · ')[1]}
        disabled={!voice.on && Boolean(model.voiceOff)}
        icon={<Mic className="size-6" strokeWidth={1.8} />}
        onActivate={run(actions.activate)}
        previewProgress={previewProgress}
      />
      <MenuRow
        label={paused ? 'Resume face control' : 'Pause face control'}
        icon={
          paused ? (
            <Play className="size-6" strokeWidth={1.8} />
          ) : (
            <Pause className="size-6" strokeWidth={1.8} />
          )
        }
        onActivate={run(actions.togglePause)}
      />
      <MenuRow
        label="Settings"
        icon={<Settings className="size-6" strokeWidth={1.8} />}
        onActivate={run(() => actions.navigate('settings'))}
      />
      <MenuRow
        label="Diagnostics"
        icon={<Activity className="size-6" strokeWidth={1.8} />}
        onActivate={run(() => actions.navigate('diagnostics'))}
      />
      <MenuRow
        label="Help"
        icon={<CircleHelp className="size-6" strokeWidth={1.8} />}
        onActivate={run(() => actions.navigate('help'))}
      />
      <MenuRow
        label="Close"
        icon={<X className="size-6" strokeWidth={1.8} />}
        onActivate={() => setMenu(null)}
      />
    </div>
  );

  const tone = previewTone ?? lineTone({ voiceOn, offline, face, uiState: model.uiState });
  const progress = previewProgress ?? dwell;
  const faded = (previewNear ?? near) && view !== 'menu';

  // Laid out as main expects: centred (or right-aligned 10 px in at top right), 4 px from
  // the edge; the line touches the top edge. See shapeRect in orb-window.js.
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-0 flex',
        bottom ? 'flex-col-reverse' : 'flex-col',
        position === 'top-right' && view !== 'sliver' ? 'items-end pr-[10px]' : 'items-center',
        view === 'sliver' ? 'pt-0' : bottom ? 'pb-1' : 'pt-1'
      )}
    >
      <div
        className={cn(view === 'menu' && 'pointer-events-auto')}
        style={{
          opacity: faded ? NEAR_OPACITY : 1,
          transition: reduced ? undefined : 'opacity 150ms ease',
        }}
      >
        {view === 'sliver' ? (
          <div aria-label="VISION" className={cn('h-[3px] w-10 rounded-b-full', LINE[tone])} />
        ) : view === 'resting' ? (
          <RestingBar face={face} offline={offline} />
        ) : view === 'menu' ? (
          menuPanel
        ) : (
          caption
        )}
      </div>
      {progress > 0 && view !== 'menu' && (
        <div className={cn(bottom ? 'mb-1.5' : 'mt-1.5', position === 'top-right' && 'mr-[17px]')}>
          <DwellRing progress={progress} />
        </div>
      )}
    </div>
  );
}
