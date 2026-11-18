// Preload for the island window.
const { contextBridge, ipcRenderer } = require('electron');

// The window is click-through except while the menu is open, and never takes focus. Main
// watches the cursor and sends what the page needs: near (fade), dwell progress (the fill
// ring) and menu open/close.
const on = (channel, map = (value) => value) => (callback) => {
	const listener = (_event, value) => callback(map(value));
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('electronAPI', {
	isElectron: true,
	/** 'idle' | 'caption' | 'menu': what the island shows (the window takes the mouse only for 'menu'). */
	setMode: (mode) => ipcRenderer.send('vision-mode', mode),
	/** 'top-center' | 'top-right' | 'bottom-center'. */
	setPosition: (position) => ipcRenderer.send('vision-position', position),
	/** The cursor is within 80 px of the island: it fades. */
	onNear: on('vision-near', Boolean),
	/** Dwell progress on the island, 0..1. */
	onDwell: on('vision-dwell', Number),
	/** 'open' (dwell or menu hotkey) | 'close' (left alone or cursor far away). */
	onMenu: on('vision-menu', String),
	/** Open the VISION window on a page: 'settings' | 'diagnostics' | 'help' | ... */
	navigate: (page) => ipcRenderer.send('vision:navigate', page),
	/** 'hey-vision' | 'vision'. */
	setWakePhrase: (phrase) => ipcRenderer.send('vision-wake-phrase', phrase),
	/** Show Face Control's window (without taking focus). */
	showFace: () => ipcRenderer.send('vision-show-face'),
	/** Open the one Settings view (in the face window). */
	openSettings: (section) => ipcRenderer.send('vision-open-settings', section),
	/** { dwellTime, wakeSensitivity, islandEdge, islandPosition?, wakePhrase?, migrated } from the settings file. */
	getSettings: () => ipcRenderer.invoke('vision-settings-get'),
	/** Hand the old localStorage settings to main once; returns the merged settings. */
	migrateSettings: (old) => ipcRenderer.invoke('vision-settings-migrate', old),
	onSettings: (callback) => {
		const listener = (_event, settings) => callback(settings);
		ipcRenderer.on('vision-settings', listener);
		return () => ipcRenderer.removeListener('vision-settings', listener);
	},
	/** Pause or resume face control. */
	togglePause: () => ipcRenderer.send('vision-toggle-pause'),
	/** true while a full-screen app is in front and the island is a line at the top. */
	onFullScreen: (callback) => {
		const listener = (_event, on) => callback(Boolean(on));
		ipcRenderer.on('vision-fullscreen', listener);
		return () => ipcRenderer.removeListener('vision-fullscreen', listener);
	},
	/** { tracking, seen, eyesResume } whenever it changes. */
	onFaceStatus: (callback) => {
		const listener = (_event, status) => callback(status);
		ipcRenderer.on('vision-face-status', listener);
		return () => ipcRenderer.removeListener('vision-face-status', listener);
	},
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
	/** { connected, live, open }: live tells Face Control the mic is on (mouth gestures pause); open: a voice session is showing (a wake phrase is ignored). */
	setVoiceState: (state) => ipcRenderer.send('vision-voice-state', state),
	/** Wake word: 16 kHz mono mic audio for the local spotter (it never leaves the PC). */
	sendWakeAudio: (samples, end) => ipcRenderer.send('vision-wake-audio', samples, end),
	/** ms from the end of the chunk the wake word was heard in to the connect sound (main.log). */
	reportWakeSound: (ms) => ipcRenderer.send('vision-wake-sound', ms),
	setWakeSensitivity: (sensitivity) => ipcRenderer.send('vision-wake-sensitivity', sensitivity),
	/** { keyword, ok, end, action: 'wake' | 'stop' | 'menu' }. */
	onWake: (callback) => {
		const listener = (_event, heard) => callback(heard);
		ipcRenderer.on('vision-wake', listener);
		return () => ipcRenderer.removeListener('vision-wake', listener);
	},
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
