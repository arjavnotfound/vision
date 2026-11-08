// Screenshot every Face Control screen and state with the mocked engine (no camera).
//   node scripts/qa/capture-face.js <output dir>
// Wraps `electron . --preview --screenshot-all <dir> --exit-after-screenshot` in app/.

const path = require("path");
const { spawnSync } = require("child_process");

const out = process.argv[2];
if (!out) {
	console.error("Usage: node scripts/qa/capture-face.js <output dir>");
	process.exit(2);
}
const appDir = path.join(__dirname, "..", "..", "app");
const electronExe = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");
const result = spawnSync(electronExe, [".", "--preview", "--screenshot-all", path.resolve(out), "--exit-after-screenshot"], { cwd: appDir, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
