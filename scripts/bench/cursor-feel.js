// Cursor-feel harness CLI: baseline vs a One Euro grid on synthetic head motion.
//   node scripts/bench/cursor-feel.js
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "..", "core", "src");
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

(async () => {
	const { gridSearch, NOISE_LEVELS_DEG, STEP_SIZES_DEG, FRAME_HZ: FPS } = await load("filters/feel-metrics.js");
	const { HEAD_TILT_FILTER } = await load("pose/head-tilt.js");
	const fmt = (m) => `jitter px ${m.jitter.map((v) => v.toFixed(2)).join("/")}  lag ms ${m.lag.map((v) => (v === Infinity ? ">10000" : v.toFixed(0))).join("/")}`;

	const { baseline, results } = gridSearch();
	console.log(`noise deg ${NOISE_LEVELS_DEG.join("/")}, steps deg ${STEP_SIZES_DEG.join("/")}, ${FPS} Hz`);
	console.log(`baseline ${JSON.stringify(HEAD_TILT_FILTER)}\n  ${fmt(baseline)}`);
	const wins = results.filter((r) => r.win);
	console.log(`clear wins (>=10% on all cases): ${wins.length} of ${results.length}`);
	for (const r of wins.slice(0, 10)) console.log(`  ${JSON.stringify(r.params)}\n    ${fmt(r)}`);
	// Pareto view: best lag at no more jitter than baseline, and best jitter at no more lag.
	const sum = (a) => a.reduce((x, y) => x + y, 0);
	const noWorseJ = results.filter((r) => r.jitter.every((v, i) => v <= baseline.jitter[i]));
	const noWorseL = results.filter((r) => r.lag.every((v, i) => v <= baseline.lag[i]));
	const bestLag = noWorseJ.sort((a, b) => sum(a.lag) - sum(b.lag))[0];
	const bestJit = noWorseL.sort((a, b) => sum(a.jitter) - sum(b.jitter))[0];
	if (bestLag) console.log(`fastest at <= baseline jitter ${JSON.stringify(bestLag.params)}\n  ${fmt(bestLag)}`);
	if (bestJit) console.log(`steadiest at <= baseline lag ${JSON.stringify(bestJit.params)}\n  ${fmt(bestJit)}`);
})();
