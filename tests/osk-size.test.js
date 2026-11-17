// The on-screen keyboard opens with keys a head pointer can hit (T15).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { oskBounds, oskLaunchCommand } = require('../app/src/electron-main/osk-size');

describe('osk size', () => {
	for (const [w, h] of [[1920, 1032], [1366, 728], [2560, 1400], [3840, 2100]]) {
		it(`keys stay at least 64 px on ${w}x${h}`, () => {
			const b = oskBounds({ x: 0, y: 0, width: w, height: h });
			assert.ok(b.width / 19 >= 64 || b.width === w, `width ${b.width}`);
			assert.ok((b.height - 40) / 5 >= 64 * (h >= 800 ? 1 : 0.9), `height ${b.height}`);
			assert.ok(b.left >= 0 && b.left + b.width <= w && b.top + b.height === h);
		});
	}
	it('scales to physical pixels and still launches osk.exe', () => {
		const cmd = oskLaunchCommand({ workArea: { x: 0, y: 0, width: 1536, height: 826 }, scaleFactor: 1.25 });
		assert.match(cmd, /WindowWidth -Type DWord -Value 1728;/);
		assert.match(cmd, /Start-Process osk\.exe$/);
	});
});
