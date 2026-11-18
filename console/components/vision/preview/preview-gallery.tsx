'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { IslandView, LineTone } from '@/lib/island';
import { PROBLEM_TEXT } from '@/lib/problems';
import type { CaptionSize, ThemeName } from '@/lib/settings';
import { settingsStore } from '@/lib/settings';
import { ApertureCore, type ApertureState } from '../aperture-core';
import { Island } from '../surfaces/island';
import { type VisionModel, VisionModelProvider } from '../vision-model';
import { useMockLevel } from './mock-levels';
import { PREVIEW_STATES, buildMockModel } from './mock-model';

type PreviewSurface = 'island' | 'aperture' | 'marks';

const noop = () => undefined;
const ACTIONS = {
  activate: noop,
  answerConfirm: noop,
  collapse: noop,
  navigate: noop,
  toggleMute: noop,
  endSession: noop,
  sendCommand: noop,
};

/**
 * /preview — design QA without a backend.
 *   ?surface=island|aperture  &view=resting|sliver|menu|wake|listening|...
 *   &theme=ember|paper  &position=top-center|top-right|bottom-center
 *   &face=unseen|paused  &voice=nokeys|offline|nomic  &near=1 (faded)
 *   &dwell=0.6 (freeze a dwell indicator)  &tone=idle|accent|warn|dim (full-screen line)
 * With no `surface`, renders a gallery of every island view (iframes).
 */
export function PreviewGallery() {
  const params = useSearchParams();
  const surface = params.get('surface') as PreviewSurface | null;
  const theme = (params.get('theme') === 'paper' ? 'paper' : 'ember') as ThemeName;

  useEffect(() => {
    const position = params.get('position');
    settingsStore.override({
      theme,
      onboarded: true,
      captionSize: (params.get('caption') as CaptionSize) ?? 'L',
      reducedMotion: params.get('reduced') === '1',
      islandPosition:
        position === 'top-right' || position === 'bottom-center' ? position : 'top-center',
      wakePhrase: params.get('phrase') === 'vision' ? 'vision' : 'hey-vision',
    });
    if (params.get('anchor') === '1') document.documentElement.classList.add('is-electron');
  }, [params, theme]);

  if (!surface) return <Gallery theme={theme} />;
  return <SingleCapture surface={surface} />;
}

function SingleCapture({ surface }: { surface: PreviewSurface }) {
  const params = useSearchParams();
  const dwell = params.get('dwell') ? Number(params.get('dwell')) : undefined;
  const view = (params.get('view') as IslandView | null) ?? 'resting';
  const faceParam = params.get('face');
  const voice = params.get('voice');
  // Preview runs outside Electron: show a talk hotkey only when the caller passes the registered one.
  const hotkey = params.get('hotkey') ?? '';
  const mic = useMockLevel(true, 0.4);
  const out = useMockLevel(true, 2.1);
  const [now] = useState(() => Date.now());

  const model = useMemo(
    () => ({
      ...buildMockModel({
        surface: islandSurface(view),
        state: 'idle',
        mic,
        out,
        pulse: 0,
        now,
        actions: ACTIONS,
      }),
      hotkeyLabel: hotkey,
      voiceOff: voice === 'nokeys',
      micMissing: voice === 'nomic',
      ...islandMock(view, now, faceParam),
      ...(voice === 'offline' || voice === 'nomic'
        ? { notice: voice === 'nomic' ? PROBLEM_TEXT.mic : PROBLEM_TEXT.voice }
        : {}),
    }),
    [mic, out, now, hotkey, view, faceParam, voice]
  );

  return (
    <VisionModelProvider value={model}>
      <div className="min-h-svh">
        {surface === 'island' && (
          <Island
            previewView={view}
            previewProgress={dwell}
            previewNear={params.get('near') === '1'}
            previewTone={(params.get('tone') as LineTone | null) ?? undefined}
          />
        )}
        {(surface === 'aperture' || surface === 'marks') && <MarkSheet />}
      </div>
    </VisionModelProvider>
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
    case 'help':
      return {
        ...base,
        uiState: 'speaking',
        agentCaption: 'On YouTube you can say play, pause, next video or full screen.',
        help: {
          app: 'YouTube',
          phrases: [
            'Play or pause',
            'Next video',
            'Full screen',
            'Search YouTube for cats',
            'Scroll down',
            'Slower cursor',
            'Longer dwell',
            'Pause face control',
          ],
        },
      };
    case 'speaking':
      return {
        ...base,
        uiState: 'speaking',
        userCaption: "what's the weather like in Mumbai today",
        agentCaption:
          "It's thirty-one degrees and humid in Mumbai, with light rain likely after four.",
      };
    case 'offline':
      return { ...base, uiState: 'offline', notice: 'Voice is offline. Face control still works.' };
    default:
      return base;
  }
}

/* ----------------------------------------------------------------------------- */

const GALLERY: [string, string, number, number][] = [
  ['Resting', 'view=resting', 380, 80],
  ['Resting, dwell ring', 'view=resting&dwell=0.6', 380, 80],
  ['Resting, faded near the cursor', 'view=resting&near=1', 380, 80],
  ['Paused', 'view=resting&face=paused', 380, 80],
  ['Voice off', 'view=resting&voice=nokeys', 380, 80],
  ['Full-screen line', 'view=sliver', 380, 80],
  ['Listening', 'view=listening', 380, 80],
  ['Speaking', 'view=speaking', 380, 80],
  ['Menu', 'view=menu', 340, 520],
  ['Menu, voice off', 'view=menu&voice=nokeys', 340, 520],
];

function Gallery({ theme }: { theme: ThemeName }) {
  return (
    <div className="bg-ink-0 text-bone min-h-svh p-10">
      <header className="mb-10 flex items-baseline gap-6">
        <span className="font-mono text-[15px] tracking-[0.42em]">VISION</span>
        <span className="text-bone-3 text-[13px]">
          Island · {theme === 'paper' ? 'Paper Light' : 'Ember Dark'}
        </span>
        <a
          className="text-ember-text ml-auto text-[13px]"
          href={`/preview?theme=${theme === 'paper' ? 'ember' : 'paper'}`}
        >
          Switch theme
        </a>
      </header>
      <div className="flex flex-wrap gap-6">
        {GALLERY.map(([name, query, w, h]) => (
          <div key={name}>
            <p className="text-bone-2 mb-2 text-[13px]">{name}</p>
            <iframe
              src={`/preview?surface=island&anchor=1&${query}&theme=${theme}`}
              title={name}
              width={w}
              height={h}
              className="bg-ink-3"
              style={{ border: 0 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
