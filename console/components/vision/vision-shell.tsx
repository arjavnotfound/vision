'use client';

import { AnimatePresence } from 'motion/react';
import { ConsoleSurface } from './console/console';
import { FloatingOrb } from './surfaces/orb';
import { useVision } from './vision-model';

/**
 * Renders the current surface. Orb and strip are ONE element (the floating orb,
 * closed or open), so it grows instead of swapping and the mark never restarts.
 */
export function VisionShell() {
  const { surface } = useVision();
  return (
    <AnimatePresence initial={false}>
      {surface === 'console' ? (
        <ConsoleSurface key="console" />
      ) : (
        <FloatingOrb key="float" open={surface === 'strip'} />
      )}
    </AnimatePresence>
  );
}
