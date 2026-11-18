import { type IslandMode, getElectron } from './electron';

let current: IslandMode | null = null;

/**
 * Tell main what the island shows. The idle bar and the caption pill share one window
 * (main only moves its dwell and fade zone); the menu gets its own size and is the only
 * time the window takes the mouse, so a change is sent at once.
 */
export function requestWindowMode(mode: IslandMode) {
  const electron = getElectron();
  if (!electron?.setMode || mode === current) return;
  current = mode;
  electron.setMode(mode);
}
