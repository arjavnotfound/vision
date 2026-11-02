'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_HOTKEY_LABEL, getElectron } from '@/lib/electron';

/**
 * Hands-free / one-key activation.
 * - In Electron, the main process registers a system-wide `globalShortcut`
 *   (default Ctrl+Alt+Space) and forwards it over IPC, so it works while other
 *   apps have focus.
 * - In a plain browser tab, the same chord works while the page has focus.
 */
export function useActivationHotkey(onActivate: () => void) {
  const callback = useRef(onActivate);
  const [label, setLabel] = useState(DEFAULT_HOTKEY_LABEL);

  useEffect(() => {
    callback.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    const electron = getElectron();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = electron?.onActivate?.(() => callback.current());
      electron
        ?.getHotkey?.()
        .then((value) => value && setLabel(value))
        .catch(() => undefined);
    } catch {
      // IPC unavailable: keyboard fallback below still works.
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && (event.code === 'Space' || event.key === ' ')) {
        event.preventDefault();
        if (!electron?.onActivate) callback.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubscribe?.();
    };
  }, []);

  return label;
}
