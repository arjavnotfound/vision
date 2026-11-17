// The installer's firewall rule (assets/installer.nsh), checked by dry run only.
// This machine's firewall is never touched: the harness is compiled with
// VISION_FIREWALL_DRYRUN_ONLY, which compiles the ExecShell out and writes the command
// lines to a file instead.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const NSH = path.join(__dirname, '..', 'assets', 'installer.nsh');

function findMakensis() {
	const cache = path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
	try {
		for (const dir of fs.readdirSync(cache).filter((d) => d.startsWith('nsis-'))) {
			for (const sub of fs.readdirSync(path.join(cache, dir))) {
				const exe = path.join(cache, dir, sub, 'makensis.exe');
				if (fs.existsSync(exe)) return exe;
			}
		}
	} catch (_error) {
		// no electron-builder cache
	}
	return null;
}

describe('installer firewall rule', () => {
	const text = fs.readFileSync(NSH, 'utf8');

	it('allows only the bundled agent python, inbound, on private networks', () => {
		assert.match(text, /add rule name="\$\{VISION_FW_RULE\}" dir=in action=allow program="\$\{VISION_FW_PROGRAM\}" profile=private enable=yes/);
		assert.match(text, /VISION_FW_PROGRAM "\$INSTDIR\\resources\\agent-runtime\\python\.exe"/);
		assert.match(text, /!macro customUnInstall[\s\S]*VISION_FW_DELETE/);
		assert.match(text, /ExecShell "runas"/, 'one UAC prompt; a declined prompt does not fail the install');
	});

	const makensis = process.platform === 'win32' ? findMakensis() : null;
	it('dry run: the compiled installer would run exactly these netsh commands', { skip: !makensis && 'makensis not in the electron-builder cache' }, () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-fw-'));
		const out = path.join(dir, 'netsh.txt');
		const exe = path.join(dir, 'fw-dryrun.exe');
		fs.writeFileSync(path.join(dir, 'harness.nsi'), [
			'!define VISION_FIREWALL_DRYRUN_ONLY',
			'!include LogicLib.nsh',
			'!macro _isUpdated _a _b _t _f',
			'  StrCmp "a" "b" `${_t}` `${_f}`',
			'!macroend',
			"!define isUpdated `'' isUpdated ''`",
			`!include "${NSH}"`,
			`OutFile "${exe}"`,
			'RequestExecutionLevel user',
			'SilentInstall silent',
			'InstallDir "$LOCALAPPDATA\\Programs\\VISION"',
			'Section',
			'  !insertmacro customInstall',
			'  !insertmacro customUnInstall',
			'SectionEnd',
		].join('\r\n'));
		const built = spawnSync(makensis, ['/V2', path.join(dir, 'harness.nsi')], { encoding: 'utf8' });
		assert.equal(built.status, 0, built.stdout + built.stderr);
		const ran = spawnSync(exe, ['/S'], { env: { ...process.env, VISION_FIREWALL_DRYRUN: out } });
		assert.equal(ran.status, 0);
		const lines = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/);
		const program = path.join(process.env.LOCALAPPDATA, 'Programs', 'VISION', 'resources', 'agent-runtime', 'python.exe');
		assert.equal(lines.length, 2);
		assert.equal(lines[0].replace(/^.*cmd\.exe \/c /i, ''),
			`netsh advfirewall firewall delete rule name="VISION voice assistant" >nul 2>&1 & netsh advfirewall firewall add rule name="VISION voice assistant" dir=in action=allow program="${program}" profile=private enable=yes`);
		assert.equal(lines[1].replace(/^.*cmd\.exe \/c /i, ''), 'netsh advfirewall firewall delete rule name="VISION voice assistant"');
		// The real branch (ExecShell runas) must compile too; it is built, never run.
		const real = fs.readFileSync(path.join(dir, 'harness.nsi'), 'utf8')
			.replace('!define VISION_FIREWALL_DRYRUN_ONLY', '!define UNINSTALL_REGISTRY_KEY "Software\\VISION-dryrun"')
			.replace(exe, path.join(dir, 'fw-real-never-run.exe'));
		fs.writeFileSync(path.join(dir, 'real.nsi'), real);
		const builtReal = spawnSync(makensis, ['/V2', path.join(dir, 'real.nsi')], { encoding: 'utf8' });
		assert.equal(builtReal.status, 0, builtReal.stdout + builtReal.stderr);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
