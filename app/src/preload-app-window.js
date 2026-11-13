// This script is injected into the MAIN APP WINDOW, before other scripts,
// with privileged access to the electron API, which it should expose in a limited way.
// That said, mouse control is pretty powerful, so it's important to keep it secure.

const { contextBridge, ipcRenderer } = require('electron');


contextBridge.exposeInMainWorld("electronAPI", {
	moveMouse: (x, y) => {
		ipcRenderer.send('moveMouse', x, y, performance.now());
	},

	setMouseButtonState: (button, down) => {
		return ipcRenderer.invoke('setMouseButtonState', button, down);
	},

	onShortcut: (callback) => {
		const listener = (_event, data) => { callback(data); };
		ipcRenderer.on("shortcut", listener);
		return () => { ipcRenderer.removeListener("shortcut", listener); };
	},

	notifyToggleState: (nowEnabled) => {
		ipcRenderer.send('notifyToggleState', nowEnabled);
	},

	updateInputFeedback: (data) => {
		ipcRenderer.send('updateInputFeedback', data);
	},

	setOptions: (optionsPatch) => {
		ipcRenderer.send('setOptions', optionsPatch);
	},

	getOptions: () => {
		return ipcRenderer.invoke('getOptions');
	},

	// isPackaged: app.isPackaged, // can't require electron's app module here
	// isPackaged: !!process.defaultApp, // nope, doesn't exist
	getIsPackaged: () => ipcRenderer.invoke('getIsPackaged'),

	getPlatform: () => process.platform,

	getVirtualDisplayBounds: () => ipcRenderer.invoke('getVirtualDisplayBounds'),

	onVirtualDisplayBoundsChanged: (callback) => {
		const listener = (_event, bounds) => { callback(bounds); };
		ipcRenderer.on('virtualDisplayBoundsChanged', listener);
		return () => { ipcRenderer.removeListener('virtualDisplayBoundsChanged', listener); };
	},

	// New UI: window and app commands (not tracking).
	windowControl: (action) => ipcRenderer.invoke('windowControl', action),

	appCommand: (command) => ipcRenderer.invoke('appCommand', command),

	getAppVersion: () => ipcRenderer.invoke('getAppVersion'),

	// QA hooks (only answered when the app runs with the fake input driver).
	qa: (command) => ipcRenderer.invoke('qa', command),

	// true while the face window is on screen (not hidden or minimised).
	onWindowShown: (callback) => {
		const listener = (_event, shown) => { callback(shown); };
		ipcRenderer.on('windowShown', listener);
		return () => { ipcRenderer.removeListener('windowShown', listener); };
	},

	onUiCommand: (callback) => {
		const listener = (_event, command) => { callback(command); };
		ipcRenderer.on('uiCommand', listener);
		return () => { ipcRenderer.removeListener('uiCommand', listener); };
	},

	openCameraSettings: (deviceId) => {
		return ipcRenderer.invoke('openCameraSettings', deviceId);
	},

	openOnScreenKeyboard: () => {
		return ipcRenderer.invoke('openOnScreenKeyboard');
	},

	scrollMouse: (deltaY) => {
		return ipcRenderer.invoke('scrollMouse', deltaY);
	},

	// Adaptive control map: a re-routed gesture clicks at the cursor ('left' | 'right').
	mappedClick: (button) => ipcRenderer.invoke('mappedClick', button),

	// Recovery: face lost -> let go of any held button (releasing is always allowed).
	releaseButtons: (reason) => ipcRenderer.invoke('releaseButtons', reason),

	// VISION bus (link to the voice assistant): status, and commands with a reply.
	onBusState: (callback) => {
		const listener = (_event, state) => { callback(state); };
		ipcRenderer.on('busState', listener);
		return () => { ipcRenderer.removeListener('busState', listener); };
	},
	requestBusState: () => ipcRenderer.invoke('getBusState'),
	replyBusCommand: (id, result) => {
		ipcRenderer.send(`busReply:${id}`, result);
	},
});
