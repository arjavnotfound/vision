'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { CaptionSize, ThemeName } from '@/lib/settings';
import { settingsStore } from '@/lib/settings';
import { ApertureCore, type ApertureState } from '../aperture-core';
import { ConsoleSurface } from '../console/console';
import { Onboarding } from '../console/onboarding';
import { CropMarks, Grain } from '../primitives';
import { OrbSurface } from '../surfaces/orb';
import { StripSurface } from '../surfaces/strip';
import { type ConsoleTab, VisionModelProvider } from '../vision-model';
import { useMockLevel } from './mock-levels';
import { PREVIEW_STATES, buildMockModel } from './mock-model';

type PreviewSurface = 'orb' | 'strip' | 'console' | 'onboarding' | 'aperture' | 'marks' | 'orbs';

const noop = () => undefined;
const ACTIONS = {
  activate: noop,
  answerConfirm: noop,
  collapse: noop,
  openConsole: noop,
  closeConsole: noop,
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
  const open = params.get('open') === '1';
  const muted = params.get('muted') === '1';
  const chip = params.get('chip') ?? undefined;
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
        surface: surface === 'orb' || surface === 'strip' ? surface : 'console',
        state,
        tab,
        onboarding: surface === 'onboarding',
        mic,
        out,
        pulse,
        now,
        actions: ACTIONS,
      }),
      ...(muted ? { isMuted: true } : {}),
    }),
    [surface, state, tab, mic, out, pulse, now, muted]
  );

  return (
    <VisionModelProvider value={model}>
      <div className="min-h-svh">
        {surface === 'orb' &&
          (open ? (
            <StripSurface previewProgress={dwell} />
          ) : (
            <OrbSurface
              forceHint={params.get('hint') === '1'}
              previewProgress={dwell}
              previewChip={chip}
            />
          ))}
        {surface === 'strip' && <StripSurface previewProgress={dwell} />}
        {surface === 'console' && <ConsoleSurface previewProgress={dwell} />}
        {surface === 'onboarding' && <ConsoleOnboarding step={step} previewProgress={dwell} />}
        {(surface === 'aperture' || surface === 'marks') && <MarkSheet />}
        {surface === 'orbs' && <OrbSheet />}
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

const ORB_STATES: { label: string; query: string }[] = [
  { label: 'Resting', query: 'state=idle' },
  { label: 'Dwelling', query: 'state=idle&hint=1&dwell=0.62' },
  { label: 'Listening', query: 'state=listening&open=1' },
  { label: 'Acting, with chip', query: 'state=acting&chip=Opening%20youtube.com' },
  { label: 'Muted', query: 'state=idle&open=1&muted=1' },
];

/** The floating orb in its states, each rendered in a real orb-sized frame. */
function OrbSheet() {
  const params = useSearchParams();
  const theme = params.get('theme') === 'paper' ? 'paper' : 'ember';
  return (
    <div className="bg-ink-0 flex min-h-svh flex-col gap-3 px-10 py-8">
      {ORB_STATES.map(({ label, query }) => (
        <div key={label} className="flex items-center gap-8">
          <span className="text-bone-2 w-[140px] shrink-0 text-[15px]">{label}</span>
          <iframe
            src={`/preview?surface=orb&anchor=1&theme=${theme}&${query}`}
            title={label}
            width={640}
            height={182}
            className="bg-ink-1 rounded-[18px]"
            style={{ border: 0 }}
          />
        </div>
      ))}
    </div>
  );
}
/* ----------------------------------------------------------------------------- */

const FRAMES: { surface: PreviewSurface; w: number; h: number; extra?: string; label: string }[] = [
  { surface: 'orb', w: 380, h: 182, extra: '&hint=1', label: 'Orb · hover hint' },
  { surface: 'strip', w: 640, h: 182, label: 'Strip' },
];

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

      {FRAMES.map(({ surface, w, h, extra, label }) => (
        <section key={surface} className="mb-12">
          <h2 className="label-mono text-bone-3 mb-4">{label}</h2>
          <div className="flex flex-wrap gap-4">
            {PREVIEW_STATES.map((state) => (
              <div key={state}>
                <p className="label-mono text-bone-2 mb-2">{state}</p>
                <div
                  className="bg-ink-1 rounded-[18px] shadow-[inset_0_0_0_1px_var(--rule)]"
                  style={{ width: w, height: h }}
                >
                  {frame(
                    `/preview?surface=${surface}&state=${state}&theme=${theme}${extra ?? ''}`,
                    w,
                    h
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

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
