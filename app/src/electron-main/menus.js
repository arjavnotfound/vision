const { app, dialog, Menu } = require('electron');
const { readFile, writeFile, copyFile } = require('fs').promises;
const { join } = require('path');

const { t } = require('./i18n');

const isMac = process.platform === 'darwin';

let currentMenu = null;
let uiMode = { legacy: false, getAppWindow: () => null };

/** Called by electron-main: which UI is shown (affects "About"). */
function setMenuUIMode(mode) {
	uiMode = { ...uiMode, ...mode };
}

const REPO_URL = 'https://github.com/arjavnotfound/VISION-Research-Prototype';

function settingsPath() {
	return join(app.getPath('userData'), 'vision-settings.json');
}

async function exportSettings() {
	const defaultPath = join(app.getPath('documents'), 'vision-settings.json');
	const { filePath } = await dialog.showSaveDialog({
		title: t("desktop.menu.exportSettings", { defaultValue: 'Export Settings' }),
		buttonLabel: t("desktop.menu.export", { defaultValue: 'Export' }),
		defaultPath,
		filters: [{ name: t("common.fileTypeJson", { defaultValue: 'JSON' }), extensions: ['json'] }],
	});
	if (!filePath) return;
	try {
		await copyFile(settingsPath(), filePath);
	} catch (error) {
		await dialog.showErrorBox(t("desktop.menu.exportSettings", { defaultValue: 'Export Settings' }), t("desktop.menu.exportSettingsError", { defaultValue: 'Failed to export settings.' }) + '\n\n' + error.message);
	}
}

async function importSettings() {
	const { canceled, filePaths } = await dialog.showOpenDialog({
		title: t("desktop.importSettings.title", { defaultValue: 'Import Settings' }),
		buttonLabel: t("desktop.menu.import", { defaultValue: 'Import' }),
		defaultPath: app.getPath('documents'),
		properties: ['openFile'],
		filters: [{ name: t("common.fileTypeJson", { defaultValue: 'JSON' }), extensions: ['json'] }],
	});
	if (canceled) return;
	const [filePath] = filePaths;
	let json;
	try {
		json = await readFile(filePath, 'utf8');
	} catch (error) {
		await dialog.showErrorBox(t("desktop.importSettings.title", { defaultValue: 'Import Settings' }), t("desktop.menu.importReadError", { defaultValue: 'Failed to read selected file.' }) + '\n\n' + error.message);
		return;
	}
	// Backup settings
	try {
		const backupPath = settingsPath().replace(/\.json$/, `-backup-${new Date().toISOString().replace(/:/g, '')}.json`);
		await copyFile(settingsPath(), backupPath);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			await dialog.showErrorBox(t("desktop.importSettings.title", { defaultValue: 'Import Settings' }), t("desktop.menu.importBackupError", { defaultValue: 'Failed to backup current settings before import.' }) + '\n\n' + error.message);
			return;
		}
	}
	try {
		await writeFile(settingsPath(), json);
	} catch (error) {
		await dialog.showErrorBox(t("desktop.importSettings.title", { defaultValue: 'Import Settings' }), t("desktop.menu.importError", { defaultValue: 'Failed to import settings.' }) + '\n\n' + error.message);
		return;
	}
	app.relaunch(); // overkill! TODO: apply the settings without restarting the app
	app.quit(); // required for the app to actually restart
}

function showAbout() {
	const win = uiMode.getAppWindow();
	if (!uiMode.legacy && win && !win.isDestroyed()) {
		win.show();
		win.webContents.send('uiCommand', 'about');
		return;
	}
	dialog.showMessageBox({
		type: 'info',
		title: t("desktop.about.title", { defaultValue: 'About VISION' }),
		message: 'VISION Face Control',
		detail: `Version ${require('./version').getVersion()}\n\nControl your computer with your head and face.\n\nOpen-source credits: MediaPipe Face Mesh, TensorFlow.js, clmtrackr and jsfeat.`,
	});
}

function createMenu() {
	const aboutItem = {
		label: t("desktop.about.title", { defaultValue: 'About VISION' }),
		click: showAbout,
	};

	const template = [
		// { role: 'appMenu' }
		...(isMac
			? [{
				label: app.name,
				submenu: [
					aboutItem,
					{ type: 'separator' },
					{ role: 'services' },
					{ type: 'separator' },
					{ role: 'hide' },
					{ role: 'hideOthers' },
					{ role: 'unhide' },
					{ type: 'separator' },
					{ role: 'quit' }
				]
			}]
			: []),
		// { role: 'fileMenu' }
		{
			label: t("desktop.menu.file", { defaultValue: 'File' }),
			submenu: [
				{
					label: t("desktop.menu.exportSettings", { defaultValue: 'Export Settings' }),
					click: exportSettings,
				},
				{
					label: t("desktop.menu.importSettings", { defaultValue: 'Import Settings' }),
					click: importSettings,
				},
				{ type: 'separator' },
				isMac ? { role: 'close' } : { role: 'quit' }
			]
		},
		// { role: 'editMenu' }
		{
			label: t("desktop.menu.edit", { defaultValue: 'Edit' }),
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				...(isMac
					? [
						{ role: 'pasteAndMatchStyle' },
						{ role: 'delete' },
						{ role: 'selectAll' },
						{ type: 'separator' },
						{
							label: t("desktop.menu.speech", { defaultValue: 'Speech' }),
							submenu: [
								{ role: 'startSpeaking' },
								{ role: 'stopSpeaking' }
							]
						}
					]
					: [
						{ role: 'delete' },
						{ type: 'separator' },
						{ role: 'selectAll' },
						{ type: 'separator' },
						{
							label: t("desktop.menu.openOnScreenKeyboard", { defaultValue: 'On-Screen Keyboard' }),
							click: () => {
								if (process.platform === 'win32') {
									const { spawn } = require('child_process');
									const proc = spawn('powershell.exe', [
										'-NoProfile',
										'-ExecutionPolicy', 'Bypass',
										'-Command', 'Start-Process osk.exe'
									], { detached: true, stdio: 'ignore' });
									proc.unref();
								}
							}
						}
					])
			]
		},
		// { role: 'viewMenu' }
		{
			label: t("desktop.menu.view", { defaultValue: 'View' }),
			submenu: [
				{ role: 'reload' },
				{ role: 'forceReload' },
				// role 'toggleDevTools' isn't working on Windows since switching to a custom titlebar
				// { role: 'toggleDevTools' },
				{
					label: t("desktop.menu.toggleDevtools", { defaultValue: 'Toggle Developer Tools' }),
					click: async () => {
						const { BrowserWindow } = require('electron');
						const mainWindow = BrowserWindow.getAllWindows().find(window => !window.getTitle().includes('Screen Overlay'));
						if (mainWindow) {
							if (mainWindow.webContents.isDevToolsOpened()) {
								mainWindow.webContents.closeDevTools();
							} else {
								mainWindow.webContents.openDevTools({ mode: 'detach' });
							}
						}
					},
				}, {
					label: t("desktop.menu.toggleScreenOverlayDevtools", { defaultValue: 'Toggle Developer Tools (Screen Overlay)' }),
					click: async () => {
						const { BrowserWindow } = require('electron');
						const screenOverlayWindow = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('Screen Overlay'));
						if (screenOverlayWindow) {
							if (screenOverlayWindow.webContents.isDevToolsOpened()) {
								screenOverlayWindow.webContents.closeDevTools();
							} else {
								screenOverlayWindow.webContents.openDevTools({ mode: 'detach' });
							}
						}
					},
				},
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' }
			]
		},
		// { role: 'windowMenu' }
		{
			label: t("desktop.menu.window", { defaultValue: 'Window' }),
			submenu: [
				{ role: 'minimize' },
				{ role: 'zoom' },
				...(isMac
					? [
						{ type: 'separator' },
						{ role: 'front' },
						{ type: 'separator' },
						{ role: 'window' }
					]
					: [
						{ role: 'close' }
					])
			]
		},
		{
			role: 'help',
			submenu: [
				{
					label: t("desktop.menu.homePage", { defaultValue: 'Home Page' }),
					click: async () => {
						const { shell } = require('electron');
						await shell.openExternal(REPO_URL);
					},
				},
				{
					label: t("desktop.menu.githubRepository", { defaultValue: 'GitHub Repository' }),
					click: async () => {
						const { shell } = require('electron');
						await shell.openExternal(REPO_URL);
					},
				},
				...(isMac
					? [] : [
						aboutItem,
					]
				),
			],
		}
	];
	const menu = Menu.buildFromTemplate(template);
	return menu;
};

function updateMenu() {
	currentMenu = createMenu();
	Menu.setApplicationMenu(currentMenu);
}

module.exports = { updateMenu, exportSettings, importSettings, setMenuUIMode };
