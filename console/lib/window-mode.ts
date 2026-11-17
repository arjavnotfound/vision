import { type OverlayMode, getElectron } from './electron';

const ORDER: Record<OverlayMode, number> = { island: 0, 'island-open': 1, console: 2 };
// Longer than the island's collapse spring, so the morph is never clipped.
const SHRINK_DELAY_MS = 680;

let current: OverlayMode = 'island';
let timer: ReturnType<typeof setTimeout> | undefined;

/** Resize the Electron window: growing happens at once, shrinking after the collapse. */
export function requestWindowMode(mode: OverlayMode) {
  const electron = getElectron();
  if (!electron?.setMode) return;
  clearTimeout(timer);
  if (ORDER[mode] >= ORDER[current]) {
    current = mode;
    electron.setMode(mode);
    return;
  }
  timer = setTimeout(() => {
    current = mode;
    electron.setMode?.(mode);
  }, SHRINK_DELAY_MS);
}
