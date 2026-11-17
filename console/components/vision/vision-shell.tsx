'use client';

import { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { requestWindowMode } from '@/lib/window-mode';
import { ConsoleSurface } from './console/console';
import { Island } from './surfaces/island';
import { useVision } from './vision-model';

/** The island, or the console (settings) when it is open. The island sizes its own window. */
export function VisionShell() {
  const { surface } = useVision();
  useEffect(() => {
    if (surface === 'console') requestWindowMode('console');
  }, [surface]);
  return (
    <AnimatePresence initial={false}>
      {surface === 'console' ? <ConsoleSurface key="console" /> : <Island key="island" />}
    </AnimatePresence>
  );
}
