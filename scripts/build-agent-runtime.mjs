#!/usr/bin/env node
// Builds build/agent-runtime: a standalone CPython 3.13 (python-build-standalone, the
// builds uv uses) with the agent's locked dependencies installed into it. The installer
// ships it, so users need no Python, uv or Node. Needs uv on PATH.
//
//   node scripts/build-agent-runtime.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build', 'agent-runtime');
const requirements = path.join(root, 'build', 'agent-requirements.txt');
const PYTHON = '3.13';

const uv = (...args) => execFileSync('uv', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

uv('python', 'install', PYTHON);
const pythonDir = path.dirname(uv('python', 'find', '--no-project', PYTHON));
console.log(`Python ${PYTHON} from ${pythonDir}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.cpSync(pythonDir, out, { recursive: true });
// uv marks its Pythons as externally managed; this copy is ours to install into.
fs.rmSync(path.join(out, 'Lib', 'EXTERNALLY-MANAGED'), { force: true });

uv('export', '--project', 'agent', '--no-dev', '--frozen', '--no-hashes', '--no-emit-project', '-o', requirements);
const python = path.join(out, process.platform === 'win32' ? 'python.exe' : 'bin/python3');
uv('pip', 'install', '--python', python, '-r', requirements);
// Not needed at runtime.
fs.rmSync(path.join(out, 'Lib', 'site-packages', 'pip'), { recursive: true, force: true });

const check = execFileSync(python, ['-E', '-s', '-c', 'import livekit.agents, livekit.plugins.google, playwright, dotenv; print("ok")'], { encoding: 'utf8' }).trim();
if (check !== 'ok') throw new Error(`runtime self-check failed: ${check}`);
console.log(`Agent runtime ready: ${out}`);
