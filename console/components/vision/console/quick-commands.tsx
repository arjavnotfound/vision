'use client';

import { ArrowDown, CloudSun, Globe, Play, Volume2 } from 'lucide-react';
import { DwellTarget } from '../dwell-target';
import { useVision } from '../vision-model';

export const QUICK_COMMANDS = [
  { label: 'Search the web', text: 'Search the web for me.', icon: Globe },
  { label: 'Open YouTube', text: 'Open YouTube.', icon: Play },
  { label: 'Read this page aloud', text: 'Read this page aloud.', icon: Volume2 },
  { label: "What's the weather", text: "What's the weather today?", icon: CloudSun },
  { label: 'Scroll down', text: 'Scroll down.', icon: ArrowDown },
] as const;

/**
 * Large dwell chips that send a typed command to the agent (lk.chat).
 * No speaking or typing needed, and they make demos deterministic.
 */
export function QuickCommands({ previewProgress }: { previewProgress?: number }) {
  const { actions } = useVision();
  return (
    <div className="grid grid-cols-5 gap-3">
      {QUICK_COMMANDS.map(({ label, text, icon: Icon }, index) => (
        <DwellTarget
          key={label}
          label={label}
          onActivate={() => actions.sendCommand(text)}
          indicator="bar"
          hitSize={64}
          previewProgress={index === 1 ? previewProgress : undefined}
          className="bg-ink-2 text-bone hover:bg-ink-3 h-16 w-full justify-start gap-3 overflow-hidden rounded-[18px] pr-3 pl-4 text-left shadow-[inset_0_0_0_1px_var(--rule)] transition-colors"
        >
          <Icon className="text-ember-text size-[18px] shrink-0" strokeWidth={2} />
          <span className="line-clamp-2 text-[15px] leading-[1.2] font-medium">{label}</span>
        </DwellTarget>
      ))}
    </div>
  );
}
