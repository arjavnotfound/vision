// Hands-free first run: fresh profile, synthetic face, fake camera, no input at all.
// Asserts the first run moves Welcome -> Camera -> Calibration by itself and logs each
// spoken line. Writes screenshots to the given folder.
//   node scripts/qa/first-run-e2e.js <out-dir> [--real-camera] [--assistant]
// --assistant: the one-app first run (Start screen) instead of the face-only one.
// --hide-face-at-calibrate: the face leaves at the calibrate step for 10 s; calibration
//   must wait for it (screenshot of the waiting state), then start once it is back.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const out = path.resolve(process.argv[2] || ".");
const appDir = path.join(__dirname, "..", "..", "app");
const electronExe = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-firstrun-"));
const port = 9400 + Math.floor(Math.random() * 400);
const assistant = process.argv.includes("--assistant");
const hideFace = process.argv.includes("--hide-face-at-calibrate");
const prefix = assistant ? "t11-firstrun-assistant" : "t11-firstrun";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	fs.mkdirSync(out, { recursive: true });
	const mainLog = path.join(runDir, "main.log");
	const child = spawn(electronExe, [".", "--synthetic-face"], {
		cwd: appDir,
		env: {
			...process.env, VISION_FAKE_INPUT: path.join(runDir, "driver.log"), VISION_USER_DATA_DIR: path.join(runDir, "userData"),
			VISION_REMOTE_DEBUG_PORT: String(port), VISION_QA_SILENT: "1", VISION_QA_HEADLESS_BROWSER: "1",
			...(assistant ? {} : { VISION_NO_ASSISTANT: "1" }),
			...(process.argv.includes("--real-camera") ? {} : { VISION_QA_FAKE_CAMERA: "1" }),
		},
		stdio: ["ignore", fs.openSync(mainLog, "w"), fs.openSync(mainLog, "a")],
	});
	let page;
	for (let i = 0; i < 120 && !page; i++) {
		try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page" && /ui\/index\.html/.test(t.url)); } catch (_e) { /* not up */ }
		if (!page) await sleep(500);
	}
	if (!page) throw new Error("app window not found");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r));
	let id = 0;
	const pending = new Map();
	ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
	const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
	const shot = async (name) => fs.writeFileSync(path.join(out, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
	const where = () => ev(`(() => { const sub = document.querySelector(".screen .brand__sub")?.textContent ?? document.querySelector(".screen")?.getAttribute("aria-label"); const step = document.querySelector(".steps__item.is-current")?.textContent; return sub ? sub + " / " + step : "main"; })()`);

	const t0 = Date.now();
	const timeline = [];
	let failed = false;
	try {
		for (let i = 0; i < 60 && !(await ev("window.__visionReady === true")); i++) await sleep(500);
		await ev(`globalThis.__syntheticFaceOverride = { leftEye: 0.3, rightEye: 0.3, mouth: 0.05, brow: 0.22, pitch: 0 }; true`);
		let last = "";
		const shots = { "Face control / 1 · WELCOME": "1-welcome", "Start VISION / undefined": "1-start", "Face control / 2 · CAMERA": "2-camera", "Calibration / 1 · CENTER": "3-calibration-started" };
		while (Date.now() - t0 < 60000) {
			const now = await where();
			if (now !== last) {
				last = now;
				timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)} s  ${now}`);
				if (shots[now]) { await sleep(600); await shot(`${prefix}-${shots[now]}.png`); }
				if (hideFace && now === "Face control / 3 · CALIBRATE") {
					await ev(`globalThis.__syntheticFaceOverride = "none"; true`);
					timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)} s  face removed`);
					await sleep(10000);
					const still = await where();
					const label = await ev(`document.querySelector(".onboarding__next")?.textContent`);
					timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)} s  after 10 s with no face: ${still} (${label})`);
					if (still !== now) failed = true;
					await shot(`${prefix}-3a-calibrate-waiting-for-face.png`);
					await ev(`globalThis.__syntheticFaceOverride = { leftEye: 0.3, rightEye: 0.3, mouth: 0.05, brow: 0.22, pitch: 0 }; true`);
					timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)} s  face back`);
				}
				if (now.startsWith("Calibration")) break;
			}
			await sleep(200);
		}
		const steps = timeline.map((l) => l.replace(/^.*s {2}/, ""));
		const expected = assistant ? ["Start VISION / undefined", "Calibration / 1 · CENTER"] : ["Face control / 1 · WELCOME", "Face control / 2 · CAMERA", "Calibration / 1 · CENTER"];
		const ok = expected.every((s) => steps.includes(s));
		failed = failed || !ok;
		console.log(timeline.join("\n"));
		console.log(`${ok ? "PASS" : "FAIL"}  first run reached calibration with no input`);
	} finally {
		await sleep(500);
		const spoken = fs.readFileSync(mainLog, "utf8").split(/\r?\n/).filter((l) => l.includes("[speak]") || l.includes("[first-run]"));
		const driver = fs.existsSync(path.join(runDir, "driver.log")) ? fs.readFileSync(path.join(runDir, "driver.log"), "utf8").trim() : "";
		console.log(spoken.join("\n"));
		fs.writeFileSync(path.join(out, `${prefix}${hideFace ? "-noface" : ""}-log.txt`), [...timeline, "", ...spoken, "", `input events sent by the test: none`].join("\n"));
		child.kill();
		ws.close();
		if (driver) console.log(`driver log (VISION's own output, not test input): ${driver.split("\n").length} lines`);
		process.exitCode = failed ? 1 : 0;
	}
})().catch((e) => { console.error(e); process.exit(1); });
