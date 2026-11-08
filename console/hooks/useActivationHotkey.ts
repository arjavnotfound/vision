'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_HOTKEY_LABEL, getElectron } from '@/lib/electron';

/**
 * Hands-free / one-key activation.
 * - In Electron, the main process registers a system-wide `globalShortcut`
 *   (first free of Ctrl+Alt+Space and its fallbacks) and forwards it over IPC, so it works while other
 *   apps have focus.
 * - In a plain browser tab, the same chord works while the page has focus.
 */
export function useActivationHotkey(onActivate: () => void) {
  const callback = useRef(onActivate);
  // Empty until the main process says which chord it registered ('' = none).
  const [label, setLabel] = useState('');

  useEffect(() => {
    callback.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    const electron = getElectron();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = electron?.onActivate?.(() => callback.current());
      if (electron?.getHotkey) {
        electron
          .getHotkey()
          .then((value) => setLabel(value ?? ''))
          .catch(() => undefined);
      } else {
        setLabel(DEFAULT_HOTKEY_LABEL);
      }
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
