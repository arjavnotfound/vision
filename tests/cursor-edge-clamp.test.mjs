// The head-tracked cursor must stop on the screen's last pixel, not one past it:
// at x = width the desktop overlay finds no element and dwell clicking never starts.
import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

it("clamps the cursor inside the screen", () => {
	const src = fs.readFileSync(new URL("../core/vision.js", import.meta.url), "utf8");
	assert.match(src, /mouseX = Math\.min\(Math\.max\(screenOffsetX, mouseX\), screenOffsetX \+ screenWidth - 1\)/);
	assert.match(src, /mouseY = Math\.min\(Math\.max\(screenOffsetY, mouseY\), screenOffsetY \+ screenHeight - 1\)/);
});
