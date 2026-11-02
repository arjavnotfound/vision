// Preload for the voice assistant window (orb / strip / console).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	isElectron: true,
	/** 'orb' | 'orb-hint' | 'strip' | 'console': resizes the window. */
	setMode: (mode) => ipcRenderer.send('vision-mode', mode),
	/** Subscribe to the global talk hotkey. Returns an unsubscribe function. */
	onActivate: (callback) => {
		const listener = () => callback();
		ipcRenderer.on('vision-activate', listener);
		return () => ipcRenderer.removeListener('vision-activate', listener);
	},
	getHotkey: () => ipcRenderer.invoke('vision-hotkey'),
	/** Always true now: Face Control's Start screen does onboarding. */
	isOneApp: () => ipcRenderer.invoke('vision-one-app'),
	isWakeMode: () => ipcRenderer.invoke('vision-wake-mode'),
	hide: () => ipcRenderer.send('vision-hide'),
	quit: () => ipcRenderer.send('vision-quit'),
	/** Tell Face Control whether the mic is live (it pauses mouth gestures meanwhile). */
	setVoiceState: (state) => ipcRenderer.send('vision-voice-state', state),
	/** LiveKit server URL + token, minted by the main process. */
	getConnectionDetails: (options) => ipcRenderer.invoke('vision-connection-details', options),
});
