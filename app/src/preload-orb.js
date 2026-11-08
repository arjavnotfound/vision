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
	hide: () => ipcRenderer.send('vision-hide'),
	quit: () => ipcRenderer.send('vision-quit'),
	/** Tell Face Control whether the mic is live (it pauses mouth gestures meanwhile). */
	setVoiceState: (state) => ipcRenderer.send('vision-voice-state', state),
	/** LiveKit server URL + token, minted by the main process. */
	getConnectionDetails: (options) => ipcRenderer.invoke('vision-connection-details', options),
	/** { voice, language, hasKeys, voices, keyFields }. */
	getVoiceConfig: () => ipcRenderer.invoke('vision-voice-config'),
	/** { voice?, language? }: applies to the next voice session. */
	setVoiceConfig: (change) => ipcRenderer.invoke('vision-voice-config-set', change),
	/** Stored encrypted by the main process; starts the voice agent. */
	saveVoiceKeys: (keys) => ipcRenderer.invoke('vision-voice-keys-save', keys),
	onVoiceConfigChanged: (callback) => {
		const listener = (_event, config) => callback(config);
		ipcRenderer.on('vision-voice-config-changed', listener);
		return () => ipcRenderer.removeListener('vision-voice-config-changed', listener);
	},
});
