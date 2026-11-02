#!/usr/bin/env node
/* global process */
// Capture every VISION surface/state from the dev-only /preview route through the
// real Electron window (transparent, frameless), for design QA and docs.
//
//   node scripts/capture_screens.mjs [outDir] [--only <substring>]
//
// Requires the Next dev server on http://localhost:3000 (run.bat or `pnpm dev`).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = path.join(root, 'electron');
const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex !== -1 ? args[onlyIndex + 1] : null;
const outDir = path.resolve(args.find((a, i) => !a.startsWith('--') && i !== onlyIndex + 1) ?? path.join(root, 'docs', 'screens'));
mkdirSync(outDir, { recursive: true });

const STATES = ['idle', 'listening', 'thinking', 'speaking', 'acting', 'error'];
const THEMES = ['ember', 'paper'];
const shots = [];

for (const theme of THEMES) {
	for (const state of STATES) {
		shots.push({ name: `strip-${state}-${theme}`, route: `/preview?surface=strip&state=${state}&theme=${theme}`, size: '640x182' });
		shots.push({ name: `console-${state}-${theme}`, route: `/preview?surface=console&state=${state}&theme=${theme}`, size: '1200x780' });
	}
	shots.push({ name: `orb-idle-${theme}`, route: `/preview?surface=orb&state=idle&theme=${theme}`, size: '380x182' });
	shots.push({ name: `orb-hint-${theme}`, route: `/preview?surface=orb&state=idle&hint=1&dwell=0.62&theme=${theme}`, size: '380x182' });
	for (const tab of ['assistant', 'activity', 'settings']) {
		shots.push({ name: `console-${tab}-${theme}`, route: `/preview?surface=console&state=speaking&tab=${tab}&theme=${theme}`, size: '1200x780' });
	}
	for (const step of [0, 1, 2]) {
		shots.push({ name: `onboarding-${step + 1}-${theme}`, route: `/preview?surface=onboarding&step=${step}&theme=${theme}`, size: '1200x780' });
	}
}
shots.push({ name: 'strip-dwell-ember', route: '/preview?surface=strip&state=listening&dwell=0.7&theme=ember', size: '640x182' });
shots.push({ name: 'mark-states', route: '/preview?surface=marks&theme=ember', size: '1200x620' });
shots.push({ name: 'mark-states-paper', route: '/preview?surface=marks&theme=paper', size: '1200x620' });
shots.push({ name: 'orb-states', route: '/preview?surface=orbs&theme=ember', size: '860x1080' });
shots.push({ name: 'orb-states-paper', route: '/preview?surface=orbs&theme=paper', size: '860x1080' });

// Spawn the Electron binary directly (no shell), so '&' in routes survives on Windows.
const electronBin = createRequire(path.join(electronDir, 'package.json'))('electron');

let failed = 0;
for (const shot of shots) {
	if (only && !shot.name.includes(only)) continue;
	const file = path.join(outDir, `${shot.name}.png`);
	const result = spawnSync(
		electronBin,
		['.', '--screenshot', file, '--exit-after-screenshot', '--route', shot.route, '--size', shot.size, '--delay', '3200'],
		{ cwd: electronDir, encoding: 'utf8', timeout: 60_000 }
	);
	const ok = result.status === 0 && /Screenshot written/.test(result.stdout ?? '');
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${shot.name}`);
}
process.exit(failed ? 1 : 0);
