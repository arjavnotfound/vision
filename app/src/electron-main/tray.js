// Tray icon: tracking keeps running while the window is hidden. The island is the hands-free way back.

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

// The VISION mark. Windows picks the right size from the .ico for the tray.
const TRAY_ICON = path.join(__dirname, '../../images/vision', process.platform === 'win32' ? 'vision.ico' : 'vision-app-icon-32.png');

function createTray({ getWindow, toggleTracking, sendCommand }) {
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
	// UX spec 10: Show VISION, Pause / Resume and Quit only.
	tray.setContextMenu(Menu.buildFromTemplate([
		{ label: 'Show VISION', click: show },
		{ label: 'Pause or resume face control (F9)', click: toggleTracking },
		{ type: 'separator' },
		// Asks first, in the face window (dwell-safe Quit / Cancel). will-quit stops the agent.
		{ label: 'Quit VISION…', click: () => sendCommand('quit') },
	]));
	tray.on('click', show);
	return tray;
}

module.exports = { createTray };
