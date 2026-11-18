'use client';

import { Island } from './surfaces/island';

/** The island is VISION's only surface in this window; it sizes its own window. */
export function VisionShell() {
  return <Island />;
}
