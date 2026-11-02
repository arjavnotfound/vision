// Tray icon for "hide to tray": tracking keeps running while the window is hidden.

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

// The VISION mark. Windows picks the right size from the .ico for the tray.
const TRAY_ICON = path.join(__dirname, '../../images/vision', process.platform === 'win32' ? 'vision.ico' : 'vision-app-icon-32.png');

// `iconPath` is accepted for compatibility but the VISION mark is always used.
function createTray({ iconPath: _iconPath, getWindow, toggleTracking, sendCommand }) {
	let tray;
	try {
		tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
	} catch (error) {
		console.error('Could not create tray icon:', error);
		return null;
	}
	const show = () => {
		const win = getWindow();
		if (!win) return;
		if (win.isMinimized()) win.restore();
		win.show();
		win.focus();
	};
	tray.setToolTip('VISION');
	tray.setContextMenu(Menu.buildFromTemplate([
		{ label: 'Show VISION', click: show },
		{ label: 'Pause / resume tracking (F9)', click: toggleTracking },
		{ label: 'Calibrate…', click: () => sendCommand('calibrate') },
		{ label: 'Back to Start (next person)', click: () => sendCommand('reset') },
		{ type: 'separator' },
		// When started from VISION.bat, quitting here also stops the voice assistant.
		{ label: 'Quit VISION', role: 'quit' },
	]));
	tray.on('click', show);
	return tray;
}

module.exports = { createTray };
