'use client';

import { Activity, Home, MessageSquareText, Minimize2, PhoneOff, Settings2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/shadcn/utils';
import { DwellTarget } from '../dwell-target';
import { Clock, ConnectionPill, CropMarks, Grain, Wordmark } from '../primitives';
import { type ConsoleTab, useVision } from '../vision-model';
import { Onboarding } from './onboarding';
import { ActivityView, AssistantView, HomeView, SettingsView } from './views';

const TABS: { id: ConsoleTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'assistant', label: 'Assistant', icon: MessageSquareText },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

function BarButton({
  label,
  onActivate,
  children,
}: {
  label: string;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <DwellTarget
      label={label}
      onActivate={onActivate}
      hitSize={64}
      className="bg-ink-2 text-bone-2 hover:bg-ink-3 hover:text-bone rounded-full shadow-[inset_0_0_0_1px_var(--rule)] transition-colors"
    >
      {children}
    </DwellTarget>
  );
}

/** "The Console": full view inside a viewfinder frame. */
export function ConsoleSurface({ previewProgress }: { previewProgress?: number }) {
  const model = useVision();
  const { actions, consoleTab } = model;

  return (
    <div className="pointer-events-none fixed inset-0 grid place-items-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        className="bg-ink-0 pointer-events-auto relative flex flex-col overflow-hidden rounded-[28px] shadow-[inset_0_0_0_1px_var(--rule-strong),var(--shadow-lift)]"
        style={{
          width: 'min(1168px, calc(100vw - 32px))',
          height: 'min(748px, calc(100vh - 32px))',
        }}
      >
        <Grain />
        <CropMarks inset={12} length={20} />

        {model.showOnboarding ? (
          <Onboarding />
        ) : (
          <>
            {/* Top bar */}
            <header className="relative flex h-[92px] shrink-0 items-center gap-5 pr-7 pl-9">
              <Wordmark />
              <ConnectionPill connection={model.connection} />
              <div className="absolute left-1/2 -translate-x-1/2">
                <Clock size={26} />
              </div>
              <div className="ml-auto flex items-center gap-3">
                {model.connection !== 'offline' && (
                  <DwellTarget
                    label="End session"
                    onActivate={actions.endSession}
                    indicator="bar"
                    hitSize={64}
                    className="text-bone-2 hover:bg-ink-2 hover:text-bone mr-2 h-16 gap-2.5 rounded-full px-5 text-[15px] shadow-[inset_0_0_0_1px_var(--rule)] transition-colors"
                  >
                    <PhoneOff className="text-err size-[18px]" strokeWidth={1.9} />
                    End session
                  </DwellTarget>
                )}
                <BarButton label="Minimise to strip" onActivate={actions.closeConsole}>
                  <Minimize2 className="size-[22px]" strokeWidth={1.8} />
                </BarButton>
                <BarButton label="Close to orb" onActivate={actions.collapse}>
                  <X className="size-6" strokeWidth={1.8} />
                </BarButton>
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              {/* Left rail */}
              <nav
                aria-label="Sections"
                className="flex w-[88px] shrink-0 flex-col items-center gap-3 pt-2"
              >
                {TABS.map(({ id, label, icon: Icon }) => {
                  const active = consoleTab === id;
                  return (
                    <div key={id} className="relative">
                      {active && (
                        <motion.span
                          layoutId="rail-indicator"
                          className="bg-ember absolute top-4 bottom-4 -left-[6px] w-[2px] rounded-full shadow-[0_0_10px_var(--ember)]"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      )}
                      <DwellTarget
                        label={label}
                        pressed={active}
                        onActivate={() => actions.setConsoleTab(id)}
                        indicator="ring"
                        hitSize={64}
                        className={cn(
                          'size-[68px] flex-col gap-1.5 rounded-[20px] transition-colors',
                          active
                            ? 'bg-ink-2 text-bone'
                            : 'text-bone-3 hover:bg-ink-1 hover:text-bone-2'
                        )}
                      >
                        <Icon
                          className={cn('size-[22px]', active && 'text-ember-text')}
                          strokeWidth={1.8}
                        />
                        <span className="text-[12px] font-medium">{label}</span>
                      </DwellTarget>
                    </div>
                  );
                })}
              </nav>

              {/* Content */}
              <main className="relative min-h-0 flex-1 pr-9 pb-8 pl-4">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={consoleTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="h-full"
                  >
                    {consoleTab === 'home' && <HomeView previewProgress={previewProgress} />}
                    {consoleTab === 'assistant' && <AssistantView />}
                    {consoleTab === 'activity' && <ActivityView />}
                    {consoleTab === 'settings' && <SettingsView />}
                  </motion.div>
                </AnimatePresence>
              </main>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
