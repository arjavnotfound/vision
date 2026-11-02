'use client';

import { useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import {
  type CaptionSize,
  DWELL_MAX_MS,
  DWELL_MIN_MS,
  type ThemeName,
  updateSettings,
  useSettings,
} from '@/lib/settings';
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
        <SectionLabel>Everything VISION did this session</SectionLabel>
        <span className="text-bone-3 text-[13px] tabular-nums">{activity.length} actions</span>
      </div>
      <div className="bg-ink-1 min-h-0 flex-1 overflow-y-auto rounded-[18px] p-3 shadow-[inset_0_0_0_1px_var(--rule)]">
        <ActivityTimeline items={activity} limit={30} detailed />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings — big, dwell-friendly controls                                      */
/* -------------------------------------------------------------------------- */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-3">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <DwellTarget
            key={option.value}
            label={`${label}: ${option.label}`}
            pressed={active}
            onActivate={() => onChange(option.value)}
            indicator="bar"
            hitSize={64}
            className={cn(
              'h-16 flex-1 rounded-[18px] px-5 text-[15px] font-medium transition-colors',
              active
                ? 'bg-ember-soft text-bone shadow-[inset_0_0_0_1.5px_var(--ember)]'
                : 'bg-ink-2 text-bone-2 hover:bg-ink-3 hover:text-bone shadow-[inset_0_0_0_1px_var(--rule)]'
            )}
          >
            {option.label}
          </DwellTarget>
        );
      })}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <DwellTarget
      label={label}
      pressed={on}
      onActivate={() => onChange(!on)}
      indicator="bar"
      hitSize={64}
      className={cn(
        'h-16 w-[172px] justify-between rounded-[18px] px-5 text-[15px] font-medium transition-colors',
        on
          ? 'bg-ember-soft text-bone shadow-[inset_0_0_0_1.5px_var(--ember)]'
          : 'bg-ink-2 text-bone-2 hover:bg-ink-3 shadow-[inset_0_0_0_1px_var(--rule)]'
      )}
    >
      <span>{on ? 'On' : 'Off'}</span>
      <span
        className={cn(
          'relative h-7 w-12 rounded-full transition-colors',
          on ? 'bg-ember' : 'bg-ink-3 shadow-[inset_0_0_0_1px_var(--rule-strong)]'
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className={cn(
            'absolute top-1 size-5 rounded-full',
            on ? 'bg-ink-0 right-1' : 'bg-bone-2 left-1'
          )}
        />
      </span>
    </DwellTarget>
  );
}

function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-rule flex items-center justify-between gap-8 border-b py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-bone text-[16px]">{title}</p>
        {hint && <p className="text-bone-3 mt-1 text-[14px] leading-snug">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const { hotkeyLabel, searchProvider } = useVision();
  const stepDwell = (delta: number) =>
    updateSettings({
      dwellMs: Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, settings.dwellMs + delta)),
    });

  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-6 overflow-y-auto">
      <section className="bg-ink-1 rounded-[18px] px-6 py-3 shadow-[inset_0_0_0_1px_var(--rule)]">
        <SectionLabel className="pt-3 pb-1">Looking & pointing</SectionLabel>
        <SettingRow title="Dwell to click" hint="Rest the pointer on a control to press it.">
          <Toggle
            label="Dwell to click"
            on={settings.dwellEnabled}
            onChange={(dwellEnabled) => updateSettings({ dwellEnabled })}
          />
        </SettingRow>
        <SettingRow title="Dwell time" hint="How long to hold still. 600–1500 ms.">
          <div className="flex items-center gap-3">
            <DwellTarget
              label="Shorter dwell"
              onActivate={() => stepDwell(-100)}
              disabled={settings.dwellMs <= DWELL_MIN_MS}
              hitSize={64}
              className="bg-ink-2 text-bone hover:bg-ink-3 rounded-full shadow-[inset_0_0_0_1px_var(--rule)]"
            >
              <Minus className="size-6" strokeWidth={1.8} />
            </DwellTarget>
            <span className="text-bone w-[92px] text-center font-mono text-[24px] font-medium tabular-nums">
              {(settings.dwellMs / 1000).toFixed(1)}s
            </span>
            <DwellTarget
              label="Longer dwell"
              onActivate={() => stepDwell(100)}
              disabled={settings.dwellMs >= DWELL_MAX_MS}
              hitSize={64}
              className="bg-ink-2 text-bone hover:bg-ink-3 rounded-full shadow-[inset_0_0_0_1px_var(--rule)]"
            >
              <Plus className="size-6" strokeWidth={1.8} />
            </DwellTarget>
          </div>
        </SettingRow>
        <SettingRow title="Talk hotkey" hint="Works from any app.">
          <kbd className="bg-ink-2 text-bone inline-flex h-12 items-center rounded-[12px] px-4 font-mono text-[15px] tracking-[0.06em] shadow-[inset_0_0_0_1px_var(--rule-strong),inset_0_-2px_0_var(--rule)]">
            {hotkeyLabel}
          </kbd>
        </SettingRow>
        <SettingRow
          title="Wake word"
          hint="“Hey Vision”. Experimental: often unavailable in the desktop app."
        >
          <Toggle
            label="Experimental wake word"
            on={settings.wakeWord}
            onChange={(wakeWord) => updateSettings({ wakeWord })}
          />
        </SettingRow>
      </section>

      <section className="bg-ink-1 rounded-[18px] px-6 py-3 shadow-[inset_0_0_0_1px_var(--rule)]">
        <SectionLabel className="pt-3 pb-1">Display</SectionLabel>
        <div className="border-rule border-b py-4">
          <p className="text-bone mb-3 text-[16px]">Theme</p>
          <Segmented<ThemeName>
            label="Theme"
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'ember', label: 'Ember Dark' },
              { value: 'paper', label: 'Paper Light' },
            ]}
          />
        </div>
        <div className="border-rule border-b py-4">
          <p className="text-bone mb-3 text-[16px]">Caption size</p>
          <Segmented<CaptionSize>
            label="Caption size"
            value={settings.captionSize}
            onChange={(captionSize) => updateSettings({ captionSize })}
            options={[
              { value: 'M', label: 'M' },
              { value: 'L', label: 'L' },
              { value: 'XL', label: 'XL' },
            ]}
          />
        </div>
        <SettingRow title="Reduced motion" hint="Crossfades instead of movement.">
          <Toggle
            label="Reduced motion"
            on={settings.reducedMotion}
            onChange={(reducedMotion) => updateSettings({ reducedMotion })}
          />
        </SettingRow>
        <SettingRow title="Search engine" hint="Set with VISION_SEARCH_PROVIDER.">
          <span className="text-bone-2 text-[15px]">{searchProvider}</span>
        </SettingRow>
      </section>
    </div>
  );
}
