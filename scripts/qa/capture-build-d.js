// Screenshots of the chunk D screens from the temporary harness (app/src/ui/harness-d.html),
// in a hidden window with capturePage. Silent: speech muted, audio muted.
//   app\node_modules\electron\dist\electron.exe scripts/qa/capture-build-d.js <dir>
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const out = path.resolve(process.argv[2] || "vision-dev/evidence/UX/build-D");
const html = path.join(__dirname, "..", "..", "app", "src", "ui", "harness-d.html");
const SHOTS = [
	["calibration-1-centre", "view=calib-center&freeze"],
	["calibration-2-range", "view=calib-range&freeze"],
	["calibration-3-summary", "view=calib-summary&freeze"],
	["calibration-3-details", "view=calib-details&freeze"],
	["calibration-refused-no-face", "view=calib-refused&scene=no-face&freeze"],
	["diagnostics", "view=diagnostics&scene=gesture&freeze"],
	["diagnostics-low-light", "view=diagnostics&scene=low-light&freeze"],
	["first-run-1-welcome", "view=first-run-1&freeze"],
	["first-run-2-camera", "view=first-run-2&freeze"],
	["first-run-3-calibrate", "view=first-run-3&freeze"],
	["first-run-4-try-clicking", "view=first-run-4&freeze"],
	["gesture-card", "view=gesture-card"],
	["mesh", "view=mesh"],
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
	fs.mkdirSync(out, { recursive: true });
	const win = new BrowserWindow({ width: 1280, height: 720, show: false, useContentSize: true, webPreferences: { backgroundThrottling: false } });
	win.webContents.setAudioMuted(true);
	win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) console.log(`[page] ${message}`); });
	for (const [name, query] of SHOTS) {
		await win.loadURL(`${require("url").pathToFileURL(html).href}?${query}`);
		for (let i = 0; i < 50 && !(await win.webContents.executeJavaScript("Boolean(window.__ready)")); i++) await new Promise((r) => setTimeout(r, 100));
		const image = await win.webContents.capturePage();
		fs.writeFileSync(path.join(out, `${name}.png`), image.toPNG());
		console.log(`saved ${name}.png`);
	}
	app.quit();
});
