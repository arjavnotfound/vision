const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  /** 'orb' | 'strip' | 'console' — resizes the overlay window. */
  setMode: (mode) => ipcRenderer.send('vision-mode', mode),
  /** Subscribe to the global activation hotkey. Returns an unsubscribe function. */
  onActivate: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('vision-activate', listener);
    return () => ipcRenderer.removeListener('vision-activate', listener);
  },
  getHotkey: () => ipcRenderer.invoke('vision-hotkey'),
  /** True when started from VISION.bat: Face Control's Start screen does onboarding. */
  isOneApp: () => ipcRenderer.invoke('vision-one-app'),
  isWakeMode: () => ipcRenderer.invoke('vision-wake-mode'),
  hide: () => ipcRenderer.send('vision-hide'),
  quit: () => ipcRenderer.send('vision-quit'),
  /** Tell Face Control whether the mic is live (it pauses mouth gestures meanwhile). */
  setVoiceState: (state) => ipcRenderer.send('vision-voice-state', state),
});
