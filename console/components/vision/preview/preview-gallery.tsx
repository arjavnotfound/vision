'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { IslandView } from '@/lib/island';
import type { CaptionSize, ThemeName } from '@/lib/settings';
import { settingsStore } from '@/lib/settings';
import { ApertureCore, type ApertureState } from '../aperture-core';
import { ConsoleSurface } from '../console/console';
import { Onboarding } from '../console/onboarding';
import { CropMarks, Grain } from '../primitives';
import { Island } from '../surfaces/island';
import { type ConsoleTab, type VisionModel, VisionModelProvider } from '../vision-model';
import { useMockLevel } from './mock-levels';
import { PREVIEW_STATES, buildMockModel } from './mock-model';

type PreviewSurface = 'island' | 'console' | 'onboarding' | 'aperture' | 'marks';

const noop = () => undefined;
const ACTIONS = {
  activate: noop,
  answerConfirm: noop,
  collapse: noop,
  openConsole: noop,
  openSettings: noop,
  toggleMute: noop,
  endSession: noop,
  sendCommand: noop,
  setConsoleTab: noop,
  finishOnboarding: noop,
};

/**
 * /preview — design QA without a backend.
 *   ?surface=orb|strip|console|onboarding|aperture
 *   &state=idle|listening|thinking|speaking|acting|error|offline
 *   &theme=ember|paper  &tab=home|assistant|activity|settings  &step=0|1|2
 *   &hint=1 (orb hover label)  &dwell=0.6 (freeze a dwell indicator)  &caption=M|L|XL
 * With no `surface`, renders a gallery of every surface × state (iframes).
 */
export function PreviewGallery() {
  const params = useSearchParams();
  const surface = params.get('surface') as PreviewSurface | null;
  const theme = (params.get('theme') === 'paper' ? 'paper' : 'ember') as ThemeName;

  useEffect(() => {
    settingsStore.override({
      theme,
      onboarded: true,
      captionSize: (params.get('caption') as CaptionSize) ?? 'L',
      reducedMotion: params.get('reduced') === '1',
    });
    // anchor=1: lay the orb out exactly as in the Electron window (right-anchored).
    if (params.get('anchor') === '1') document.documentElement.classList.add('is-electron');
  }, [params, theme]);

  if (!surface) return <Gallery theme={theme} />;
  return <SingleCapture surface={surface} />;
}

function SingleCapture({ surface }: { surface: PreviewSurface }) {
  const params = useSearchParams();
  const state = (params.get('state') as ApertureState) ?? 'idle';
  const tab = (params.get('tab') as ConsoleTab) ?? 'home';
  const step = Number(params.get('step') ?? 0) as 0 | 1 | 2;
  const dwell = params.get('dwell') ? Number(params.get('dwell')) : undefined;
  const view = (params.get('view') as IslandView | null) ?? 'resting';
  const faceParam = params.get('face');
  // Preview runs outside Electron: show a talk hotkey only when the caller passes the registered one.
  const hotkey = params.get('hotkey') ?? '';
  const mic = useMockLevel(true, 0.4);
  const out = useMockLevel(true, 2.1);
  const [pulse, setPulse] = useState(0);
  const [now] = useState(() => Date.now());

  // Re-fire the shutter / error so a still capture catches it.
  useEffect(() => {
    if (state !== 'acting' && state !== 'error') return;
    const first = setTimeout(() => setPulse(1), 300);
    const id = setInterval(() => setPulse((n) => n + 1), 2600);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [state]);

  const model = useMemo(
    () => ({
      ...buildMockModel({
        surface: surface === 'island' ? islandSurface(view) : 'console',
        state,
        tab,
        onboarding: surface === 'onboarding',
        mic,
        out,
        pulse,
        now,
        actions: ACTIONS,
      }),
      hotkeyLabel: hotkey,
      ...(surface === 'island' ? islandMock(view, now, faceParam) : {}),
    }),
    [surface, state, tab, mic, out, pulse, now, hotkey, view, faceParam]
  );

  return (
    <VisionModelProvider value={model}>
      <div className="min-h-svh">
        {surface === 'island' && <Island previewView={view} previewProgress={dwell} />}
        {surface === 'console' && <ConsoleSurface previewProgress={dwell} />}
        {surface === 'onboarding' && <ConsoleOnboarding step={step} previewProgress={dwell} />}
        {(surface === 'aperture' || surface === 'marks') && <MarkSheet />}
      </div>
    </VisionModelProvider>
  );
}

function ConsoleOnboarding({
  step,
  previewProgress,
}: {
  step: 0 | 1 | 2;
  previewProgress?: number;
}) {
  return (
    <div className="pointer-events-none fixed inset-0 grid place-items-center p-4">
      <div
        className="bg-ink-0 pointer-events-auto relative overflow-hidden rounded-[28px] shadow-[inset_0_0_0_1px_var(--rule-strong),var(--shadow-lift)]"
        style={{
          width: 'min(1168px, calc(100vw - 32px))',
          height: 'min(748px, calc(100vh - 32px))',
        }}
      >
        <Grain />
        <CropMarks inset={12} length={20} />
        <Onboarding previewStep={step} previewProgress={previewProgress} />
      </div>
    </div>
  );
}

/** All 7 mark states at 160px and 40px (the 40px row uses the thicker small band). */
function MarkSheet() {
  const mic = useMockLevel(true, 0.4);
  const out = useMockLevel(true, 2.1);
  const states: ApertureState[] = [...PREVIEW_STATES, 'offline'];
  return (
    <div className="bg-ink-0 flex min-h-svh flex-col justify-center gap-10 p-12">
      <div className="grid grid-cols-7 gap-6">
        {states.map((state) => (
          <div key={state} className="flex flex-col items-center gap-6">
            <span className="label-mono text-bone-2">{state}</span>
            {[160, 40].map((size) => (
              <ApertureCore key={size} size={size} state={state} micLevel={mic} outputLevel={out} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The model surface a view belongs to: voice views are 'strip', the rest 'orb'. */
function islandSurface(view: IslandView): VisionModel['surface'] {
  return ['resting', 'menu', 'sliver'].includes(view) ? 'orb' : 'strip';
}

/** Mock data that makes each island view look as it does live. */
function islandMock(view: IslandView, now: number, face: string | null): Partial<VisionModel> {
  const base: Partial<VisionModel> = {
    face: {
      tracking: face !== 'paused',
      seen: face !== 'unseen',
      eyesResume: true,
    },
    fullScreen: view === 'sliver' || face === 'fullscreen',
    activatedAt: view === 'wake' ? now : now - 5_000,
  };
  switch (view) {
    case 'wake':
    case 'listening':
      return { ...base, uiState: 'listening', userCaption: '', agentCaption: '' };
    case 'understood':
      return { ...base, uiState: 'thinking', userCaption: 'open youtube and play some lo-fi' };
    case 'acting': {
      const done = {
        id: 's1',
        action: 'open_url',
        target: 'youtube.com',
        url: 'https://www.youtube.com/',
        status: 'done' as const,
        ts: now - 3_000,
      };
      const running = {
        id: 's2',
        action: 'search',
        target: 'lo-fi music',
        status: 'running' as const,
        ts: now - 400,
      };
      return {
        ...base,
        uiState: 'acting',
        userCaption: 'open youtube and play some lo-fi',
        chip: running,
        activity: [running, done],
      };
    }
    case 'confirm':
      return {
        ...base,
        uiState: 'idle',
        confirm: { question: 'Close this tab? Anything you typed in it will be lost.' },
      };
    case 'offline':
      return { ...base, uiState: 'offline', notice: 'Voice is offline. Face control still works.' };
    default:
      return base;
  }
}

/* ----------------------------------------------------------------------------- */

function Gallery({ theme }: { theme: ThemeName }) {
  const scale = 0.5;
  const frame = (src: string, w: number, h: number, s = 1) => (
    <iframe
      src={src}
      title={src}
      width={w}
      height={h}
      style={{ width: w, height: h, transform: `scale(${s})`, transformOrigin: '0 0', border: 0 }}
    />
  );
  return (
    <div className="bg-ink-0 text-bone min-h-svh p-10">
      <header className="mb-10 flex items-baseline gap-6">
        <span className="font-mono text-[15px] tracking-[0.42em]">VISION</span>
        <span className="label-mono text-bone-3">
          Design QA · {theme === 'paper' ? 'Paper Light' : 'Ember Dark'}
        </span>
        <a
          className="label-mono text-ember-text ml-auto"
          href={`/preview?theme=${theme === 'paper' ? 'ember' : 'paper'}`}
        >
          Switch theme
        </a>
      </header>

      <section className="mb-12">
        <h2 className="label-mono text-bone-3 mb-4">Console · Home</h2>
        <div className="flex flex-wrap gap-4">
          {PREVIEW_STATES.map((state) => (
            <div
              key={state}
              style={{ width: 1200 * scale, height: 780 * scale }}
              className="overflow-hidden"
            >
              <p className="label-mono text-bone-2 mb-2">{state}</p>
              {frame(`/preview?surface=console&state=${state}&theme=${theme}`, 1200, 780, scale)}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="label-mono text-bone-3 mb-4">Console · tabs & onboarding</h2>
        <div className="flex flex-wrap gap-4">
          {['assistant', 'activity', 'settings'].map((tab) => (
            <div
              key={tab}
              style={{ width: 1200 * scale, height: 780 * scale }}
              className="overflow-hidden"
            >
              {frame(
                `/preview?surface=console&tab=${tab}&state=speaking&theme=${theme}`,
                1200,
                780,
                scale
              )}
            </div>
          ))}
          {[0, 1, 2].map((step) => (
            <div
              key={step}
              style={{ width: 1200 * scale, height: 780 * scale }}
              className="overflow-hidden"
            >
              {frame(`/preview?surface=onboarding&step=${step}&theme=${theme}`, 1200, 780, scale)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
