'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import { cn } from '@/lib/shadcn/utils';
import { ApertureCore, type ApertureState } from '../aperture-core';
import { DwellTarget } from '../dwell-target';
import { CropMarks, Wordmark } from '../primitives';
import { useVision } from '../vision-model';

type MicStatus = 'unknown' | 'asking' | 'granted' | 'denied';

function EmberCta({
  children,
  onActivate,
  previewProgress,
}: {
  children: React.ReactNode;
  onActivate: () => void;
  previewProgress?: number;
}) {
  return (
    <DwellTarget
      label={typeof children === 'string' ? children : 'Continue'}
      onActivate={onActivate}
      indicator="bar"
      hitSize={64}
      previewProgress={previewProgress}
      className="bg-ember h-[68px] min-w-[260px] rounded-full px-10 text-[17px] font-semibold text-[#160a04] shadow-[0_10px_40px_rgba(255,90,31,0.35)] transition-[filter] hover:brightness-105"
      tone="ink"
    >
      {children}
    </DwellTarget>
  );
}

/** First run: three screens, one sentence each, one ember CTA. */
export function Onboarding({
  previewStep,
  previewProgress,
}: {
  previewStep?: 0 | 1 | 2;
  previewProgress?: number;
}) {
  const model = useVision();
  const [step, setStep] = useState<0 | 1 | 2>(previewStep ?? 0);
  const [mic, setMic] = useState<MicStatus>(previewStep === 1 ? 'granted' : 'unknown');
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const liveLevel = useAudioLevel(track);
  const level = previewStep !== undefined ? model.micLevel : liveLevel;

  useEffect(() => {
    if (previewStep !== undefined) setStep(previewStep);
  }, [previewStep]);

  // Release the test microphone when leaving the level test.
  useEffect(() => {
    if (step !== 1 && track) {
      track.stop();
      setTrack(null);
    }
  }, [step, track]);
  useEffect(() => () => track?.stop(), [track]);

  const askMic = useCallback(async () => {
    setMic('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setTrack(stream.getAudioTracks()[0] ?? null);
      setMic('granted');
    } catch {
      setMic('denied');
    }
  }, []);

  const next = () => setStep((s) => (s < 2 ? ((s + 1) as 0 | 1 | 2) : s));

  const screens: {
    state: ApertureState;
    title: React.ReactNode;
    body?: React.ReactNode;
    cta: React.ReactNode;
  }[] = [
    {
      state: 'idle',
      title: 'VISION lets you use your computer without your hands.',
      cta: (
        <EmberCta onActivate={next} previewProgress={previewProgress}>
          Begin
        </EmberCta>
      ),
    },
    {
      state: mic === 'granted' ? 'listening' : mic === 'denied' ? 'error' : 'idle',
      title:
        mic === 'granted'
          ? 'Say something. The eye opens with your voice.'
          : mic === 'denied'
            ? 'The microphone is blocked. Quick Commands still work.'
            : 'VISION needs your microphone to hear you.',
      cta:
        mic === 'granted' || mic === 'denied' ? (
          <EmberCta onActivate={next} previewProgress={previewProgress}>
            {mic === 'granted' ? 'Sounds good' : 'Continue anyway'}
          </EmberCta>
        ) : (
          <EmberCta onActivate={askMic} previewProgress={previewProgress}>
            {mic === 'asking' ? 'Waiting…' : 'Allow microphone'}
          </EmberCta>
        ),
    },
    {
      state: 'idle',
      title: (
        <>
          Look at the eye, or press{' '}
          <kbd className="bg-ink-2 text-bone rounded-[10px] px-2.5 py-0.5 font-mono text-[0.78em] tracking-[0.04em] shadow-[inset_0_0_0_1px_var(--rule-strong)]">
            {model.hotkeyLabel}
          </kbd>
          , to talk.
        </>
      ),
      cta: (
        <EmberCta onActivate={model.actions.finishOnboarding} previewProgress={previewProgress}>
          Start using VISION
        </EmberCta>
      ),
    },
  ];
  const screen = screens[step];

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-16">
      <div className="absolute top-9 left-10 flex items-center gap-4">
        {step !== 0 && <Wordmark />}
      </div>
      <div
        className="absolute top-10 right-12 flex items-center gap-2"
        aria-label={`Step ${step + 1} of 3`}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'h-[3px] rounded-full transition-all duration-300',
              i === step ? 'bg-ember w-8' : 'bg-rule-strong w-4'
            )}
          />
        ))}
        <span className="text-bone-3 ml-3 text-[13px] tabular-nums">Step {step + 1} of 3</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${step}-${mic}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="flex flex-col items-center text-center"
        >
          <div className="relative p-9">
            <CropMarks
              inset={0}
              length={24}
              tone={step === 1 && mic === 'granted' ? 'ember' : 'rule'}
            />
            {step === 0 ? (
              <div className="flex flex-col items-center gap-5">
                <ApertureCore size={96} state={screen.state} micLevel={level} outputLevel={level} />
                <span
                  className="text-bone text-[15px] font-medium uppercase"
                  style={{ letterSpacing: '0.34em', marginRight: '-0.34em' }}
                >
                  VISION
                </span>
              </div>
            ) : (
              <ApertureCore size={248} state={screen.state} micLevel={level} outputLevel={level} />
            )}
          </div>
          <h1 className="text-bone mt-10 max-w-[700px] text-[34px] leading-[1.18] font-medium tracking-[-0.02em] text-balance">
            {screen.title}
          </h1>
          <div className="mt-10">{screen.cta}</div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
