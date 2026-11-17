'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/shadcn/utils';
import { ApertureCore } from '../aperture-core';
import { DwellTarget } from '../dwell-target';
import { LiveCaption } from '../live-caption';
import { CropMarks, StateWord, StreamingText, useFocusLock } from '../primitives';
import { useVision } from '../vision-model';
import { ActivityTimeline } from './activity-timeline';
import { QuickCommands } from './quick-commands';

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn('label-mono text-bone-3', className)}>{children}</h2>;
}

/* -------------------------------------------------------------------------- */
/* Home                                                                         */
/* -------------------------------------------------------------------------- */
export function HomeView({ previewProgress }: { previewProgress?: number }) {
  const model = useVision();
  // Viewfinder focus lock: corners close in and turn ember on every action.
  const focusLock = useFocusLock(model.actionPulse);
  const word = model.connection === 'connecting' ? 'connecting' : model.uiState;
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_320px] grid-rows-[minmax(0,1fr)_auto] gap-x-6 gap-y-5">
      {/* Hero */}
      <section className="relative flex min-h-0 flex-col items-center justify-center rounded-[28px] px-10 pt-6 pb-4">
        <CropMarks inset={0} length={22} lock={focusLock} />
        <ApertureCore
          size={280}
          state={model.uiState}
          micLevel={model.micLevel}
          outputLevel={model.outputLevel}
          actionPulse={model.actionPulse}
          errorPulse={model.errorPulse}
        />
        <div className="mt-7 flex h-9 items-center">
          <StateWord state={word} size={32} />
        </div>
        <LiveCaption
          variant="console"
          showStateWord={false}
          className="mt-3 h-[142px] w-full max-w-[620px] items-center justify-start text-center [&_p]:mx-auto [&>div:first-child]:justify-center"
        />
      </section>

      {/* Activity */}
      <aside className="bg-ink-1 flex min-h-0 flex-col rounded-[18px] p-3 shadow-[inset_0_0_0_1px_var(--rule)]">
        <div className="flex items-center justify-between px-3 pt-2 pb-3">
          <SectionLabel>Activity</SectionLabel>
          <span className="text-bone-3 text-[13px] tabular-nums">
            {model.activity.length || ''}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ActivityTimeline items={model.activity} limit={7} />
        </div>
      </aside>

      {/* Quick commands */}
      <section className="col-span-2">
        <SectionLabel className="mb-3 px-1">Quick commands</SectionLabel>
        <QuickCommands previewProgress={previewProgress} />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Assistant — editorial transcript                                            */
/* -------------------------------------------------------------------------- */
export function AssistantView() {
  const { turns, agentCaptionKey } = useVision();
  const scroller = useRef<HTMLDivElement>(null);
  const { captionSize } = useSettings();
  const replySize = captionSize === 'M' ? 22 : captionSize === 'L' ? 26 : 31;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between pb-5">
        <SectionLabel>Conversation</SectionLabel>
        <span className="text-bone-3 text-[13px] tabular-nums">{turns.length} lines</span>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_48px)] pr-4"
      >
        {turns.length === 0 ? (
          <p className="text-bone-3 pt-16 text-center text-[17px]">
            Your conversation with VISION will appear here.
          </p>
        ) : (
          <ol className="mx-auto flex max-w-[760px] flex-col gap-7 pt-12 pb-6">
            {turns.map((turn, index) =>
              turn.speaker === 'user' ? (
                <li key={turn.id} className="text-bone-3 font-mono text-[14px] leading-relaxed">
                  <span className="text-bone-2 mr-3 font-sans font-medium">You</span>
                  {turn.text}
                </li>
              ) : (
                <li
                  key={turn.id}
                  className="border-rule text-bone border-l pl-6"
                  style={{ fontSize: replySize, lineHeight: 1.45, letterSpacing: '-0.012em' }}
                >
                  {index === turns.length - 1 ? (
                    <StreamingText text={turn.text} resetKey={agentCaptionKey} />
                  ) : (
                    turn.text
                  )}
                </li>
              )
            )}
          </ol>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity — full timeline                                                     */
/* -------------------------------------------------------------------------- */
export function ActivityView() {
  const { activity } = useVision();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between pb-5">
        <SectionLabel>What VISION has done so far</SectionLabel>
        <span className="text-bone-3 text-[13px] tabular-nums">{activity.length} actions</span>
      </div>
      <div className="bg-ink-1 min-h-0 flex-1 overflow-y-auto rounded-[18px] p-3 shadow-[inset_0_0_0_1px_var(--rule)]">
        <ActivityTimeline items={activity} limit={30} detailed />
      </div>
    </div>
  );
}
