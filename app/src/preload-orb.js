// Preload for the voice assistant window (orb / strip / console).
const { contextBridge, ipcRenderer } = require('electron');

// Hit regions: the window is click-through except over a visible element (the disc, the
// strip, the console panel). Full-window wrappers and the page itself are padding. Main
// sends the cursor position while it is inside the window: VISION's head pointer moves
// with SetCursorPos, which Electron's forwarded mouse events never see.
ipcRenderer.on('vision-pointer', (_event, x, y) => {
	const el = document.elementFromPoint(x, y);
	const rect = el && el !== document.documentElement && el !== document.body ? el.getBoundingClientRect() : null;
	ipcRenderer.send('vision-hit', Boolean(rect) && (rect.width < window.innerWidth - 1 || rect.height < window.innerHeight - 1));
});

// The window cannot take focus, so a text field asks for the keyboard while in use.
const TEXT_FIELD = 'textarea, [contenteditable=""], [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit])';
const isTextField = (el) => Boolean(el?.closest?.(TEXT_FIELD));
window.addEventListener('pointerdown', (event) => {
	if (isTextField(event.target)) ipcRenderer.send('vision-keyboard', true);
}, true);
window.addEventListener('focusout', (event) => {
	if (isTextField(event.target) && !isTextField(event.relatedTarget)) ipcRenderer.send('vision-keyboard', false);
}, true);

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
