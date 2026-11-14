// Lowers other apps' audio while VISION listens or speaks, and puts it back after.
// Windows' own communications ducking is a user setting that is often off ("Do
// nothing"), so this sets each other app's session volume on the default speakers
// through the Windows audio session API (koffi, no extra package).
//
// The original levels are written to a file before anything changes, and restored from
// it on the next start if VISION stopped without restoring (crash, power loss). A level
// the user changed while ducked is left as they set it.
const fs = require('fs');

const S_OK = 0;
const CLSCTX_ALL = 23;
const COINIT_APARTMENTTHREADED = 2;
const E_RENDER = 0;
const E_CONSOLE = 0;
const DUCKED = 0.25;

let api = null;
function load() {
	if (api !== null) return api;
	api = false;
	if (process.platform !== 'win32') return api;
	const koffi = require('koffi');
	const ole32 = koffi.load('ole32.dll');
	koffi.struct('VISION_GUID', { a: 'uint32', b: 'uint16', c: 'uint16', d: koffi.array('uint8', 8) });
	const guid = (text) => {
		const h = text.replace(/-/g, '');
		return { a: parseInt(h.slice(0, 8), 16), b: parseInt(h.slice(8, 12), 16), c: parseInt(h.slice(12, 16), 16), d: [...Buffer.from(h.slice(16), 'hex')] };
	};
	const P = (sig) => koffi.proto(sig); // x64: one calling convention
	api = {
		koffi,
		CoInitializeEx: ole32.func('int __stdcall CoInitializeEx(void *reserved, uint32 flags)'),
		CoCreateInstance: ole32.func('int __stdcall CoCreateInstance(VISION_GUID *clsid, void *outer, uint32 ctx, VISION_GUID *iid, _Out_ void **out)'),
		CoTaskMemFree: ole32.func('void __stdcall CoTaskMemFree(void *p)'),
		ids: {
			enumerator: guid('BCDE0395-E52F-467C-8E3D-C4579291692E'),
			IMMDeviceEnumerator: guid('A95664D2-9614-4F35-A746-DE8DB63617E6'),
			IAudioSessionManager2: guid('77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F'),
			IAudioSessionControl2: guid('BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D'),
			ISimpleAudioVolume: guid('87CE5498-68D6-44E5-9215-6DA47EF883D8'),
		},
		QueryInterface: P('int QI(void *self, VISION_GUID *iid, _Out_ void **out)'),
		Release: P('uint32 Release(void *self)'),
		GetDefaultAudioEndpoint: P('int GetDefault(void *self, int flow, int role, _Out_ void **device)'),
		Activate: P('int Activate(void *self, VISION_GUID *iid, uint32 ctx, void *params, _Out_ void **out)'),
		GetSessionEnumerator: P('int GetEnum(void *self, _Out_ void **out)'),
		GetCount: P('int GetCount(void *self, _Out_ int *count)'),
		GetSession: P('int GetSession(void *self, int i, _Out_ void **out)'),
		GetSessionInstanceIdentifier: P('int GetId(void *self, _Out_ void **id)'),
		GetProcessId: P('int GetPid(void *self, _Out_ uint32 *pid)'),
		IsSystemSoundsSession: P('int IsSystem(void *self)'),
		SetMasterVolume: P('int SetVol(void *self, float level, void *context)'),
		GetMasterVolume: P('int GetVol(void *self, _Out_ float *level)'),
	};
	return api;
}

// Calls method <index> of a COM object's vtable.
function com(obj, index, proto, ...args) {
	const { koffi } = api;
	const vtable = koffi.decode(obj, 'void *');
	const fn = koffi.decode(vtable, index * 8, 'void *');
	return koffi.call(fn, proto, obj, ...args);
}

/** Every audio session on the default speakers: { id, pid, level, set(level) }. Caller releases. */
function sessions() {
	const a = load();
	if (!a) return { list: [], release() {} };
	a.CoInitializeEx(null, COINIT_APARTMENTTHREADED);
	const held = [];
	const keep = (p) => (held.push(p), p);
	const out = [null];
	const list = [];
	try {
		if (a.CoCreateInstance(a.ids.enumerator, null, CLSCTX_ALL, a.ids.IMMDeviceEnumerator, out) !== S_OK) return { list, release() {} };
		const enumerator = keep(out[0]);
		if (com(enumerator, 4, a.GetDefaultAudioEndpoint, E_RENDER, E_CONSOLE, out) !== S_OK) throw new Error('no speakers');
		const device = keep(out[0]);
		if (com(device, 3, a.Activate, a.ids.IAudioSessionManager2, CLSCTX_ALL, null, out) !== S_OK) throw new Error('no session manager');
		const manager = keep(out[0]);
		if (com(manager, 5, a.GetSessionEnumerator, out) !== S_OK) throw new Error('no sessions');
		const sessionList = keep(out[0]);
		const count = [0];
		com(sessionList, 3, a.GetCount, count);
		for (let i = 0; i < count[0]; i++) {
			if (com(sessionList, 4, a.GetSession, i, out) !== S_OK) continue;
			const control = keep(out[0]);
			if (com(control, 0, a.QueryInterface, a.ids.IAudioSessionControl2, out) !== S_OK) continue;
			const control2 = keep(out[0]);
			if (com(control2, 0, a.QueryInterface, a.ids.ISimpleAudioVolume, out) !== S_OK) continue;
			const volume = keep(out[0]);
			if (com(control2, 15, a.IsSystemSoundsSession) === S_OK) continue;
			const pid = [0];
			com(control2, 14, a.GetProcessId, pid);
			if (com(control2, 13, a.GetSessionInstanceIdentifier, out) !== S_OK) continue;
			const id = a.koffi.decode.string16(out[0]);
			a.CoTaskMemFree(out[0]);
			const level = [0];
			com(volume, 4, a.GetMasterVolume, level);
			list.push({ id, pid: pid[0], level: level[0], set: (value) => com(volume, 3, a.SetMasterVolume, value, null) === S_OK });
		}
	} catch (_error) {
		// no speakers or the audio service is restarting: nothing to duck
	}
	return {
		list,
		release() {
			for (const p of held.reverse()) com(p, 2, a.Release);
		},
	};
}

const near = (a, b) => Math.abs(a - b) < 0.005;

/**
 * file: where the original levels are kept while ducked.
 * ownPids(): VISION's own processes (its voice and sounds stay at full level).
 * listSessions: for tests.
 */
function createAudioDuck({ file, ownPids, log = console.log, listSessions = sessions }) {
	let ducked = null;

	function restore() {
		let saved = ducked;
		if (!saved) {
			try {
				saved = JSON.parse(fs.readFileSync(file, 'utf8'));
			} catch {
				return;
			}
		}
		const { list, release } = listSessions();
		let restored = 0;
		try {
			for (const s of list) {
				const entry = saved.find((e) => e.id === s.id);
				if (entry && near(s.level, entry.ducked) && s.set(entry.level)) restored++;
			}
		} finally {
			release();
		}
		ducked = null;
		fs.rmSync(file, { force: true });
		log(`[VISION] Other apps' audio restored (${restored} of ${saved.length})`);
	}

	function duck() {
		if (ducked) return;
		const own = new Set(ownPids());
		const started = Date.now();
		const { list, release } = listSessions();
		try {
			const others = list.filter((s) => !own.has(s.pid) && s.pid !== 0 && s.level > 0);
			const entries = others.map((s) => ({ id: s.id, level: s.level, ducked: s.level * DUCKED }));
			// Saved first: a crash after this point is undone on the next start.
			fs.writeFileSync(file, JSON.stringify(entries));
			others.forEach((s, i) => s.set(entries[i].ducked));
			ducked = entries;
			log(`[VISION] Other apps' audio lowered (${entries.length} sessions, ${Date.now() - started} ms)`);
		} finally {
			release();
		}
	}

	// Left over from a run that ended while ducked.
	if (fs.existsSync(file)) restore();

	return {
		set(on) {
			try {
				if (on) duck();
				else if (ducked) restore();
			} catch (error) {
				log(`[VISION] Audio ducking failed: ${error?.message || error}`);
			}
		},
		restore: () => ducked && restore(),
	};
}

module.exports = { createAudioDuck, sessions };
