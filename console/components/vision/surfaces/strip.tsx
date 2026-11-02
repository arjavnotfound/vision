'use client';

import { FloatingOrb } from './orb';

/**
 * Active strip. It is the floating orb, opened: it grows to the left from the
 * orb with the mark anchored on the right. Kept as a wrapper for existing callers.
 */
export function StripSurface({ previewProgress }: { previewProgress?: number }) {
  return <FloatingOrb open previewProgress={previewProgress} />;
}
