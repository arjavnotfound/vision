'use client';

/**
 * Compatibility shim. The camera-iris ApertureCore is retired; the VISION mark
 * (a Landolt C) replaces it with the same props. Existing imports keep working.
 */
export {
  VisionMark as ApertureCore,
  type MarkState as ApertureState,
  type VisionMarkProps as ApertureCoreProps,
} from './vision-mark';
