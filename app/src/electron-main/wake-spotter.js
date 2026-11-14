// Offline "Vision" keyword spotter (sherpa-onnx, runs on the CPU, no audio leaves the PC).
// Feed it 16 kHz mono Float32 audio; it returns the keywords it heard.
//
// Second checks, both measured on the T06/T06a clips:
// - "vision" inside a longer word or phrase is spotted as that longer keyword instead
//   (the spotter reports the longest match ending on the same sound), so "television",
//   "division" and "my vision" come back with ok: false.
// - Names that start like it ("Vishnu", "Vishal", "Vishwas") fire "vision", and a decoy
//   can't win because "vision" completes first. A "vision" hit is held for HOLD_S, then a
//   second spotter that knows only those names runs over the second before the hit and
//   the hold; a name there rejects it. Measured on the T06a clips with 20 ms chunks:
//   Vishnu woke 5/8 without the hold and 1-2/8 with 0.1 s; longer holds were no better.
//   The same second spotter also listens for "Hey Vision" when a decoy fires, because
//   "hey" is sometimes heard as "a" or "di" ("a vision", "division").
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KeywordSpotter } = require('sherpa-onnx-node');

const RATE = 16000;
const VISION = '▁VI S ION';
const HEY = '▁HE Y';
// "#threshold" (default 0.25) and ":boost" (default 1). A higher boost measured worse in
// noise and music (T06a eval), so only the threshold is lowered.
const WAKE = {
	relaxed: [`${VISION} :1.5 #0.08 @vision`, `${HEY} ${VISION} :1.5 #0.08 @hey_vision`],
	normal: [`${VISION} #0.12 @vision`, `${HEY} ${VISION} #0.12 @hey_vision`],
	strict: [`${HEY} ${VISION} @hey_vision`],
};
// Acted on only right after a wake word ("Vision, stop").
const COMMANDS = ['▁ST O P @stop', '▁CAN CE L @cancel'];
// Words and phrases that end in "vision". Tokens: sentencepiece BPE from the model's bpe.model.
// "the" and "a" get a lower boost: at full boost, quiet before a plain "Vision" was heard
// as "the"/"a" often enough to lose 1 wake in 10 (T06a lead-phase.js).
const DECOYS = [
	'▁T E LE VI S ION', '▁DI VI S ION', '▁RE VI S ION', '▁PRO VI S ION', '▁EN VI S ION',
	'▁SU PER VI S ION', '▁MY ▁VI S ION', '▁YOUR ▁VI S ION', '▁THE ▁VI S ION :0.5', '▁HIS ▁VI S ION',
	'▁HER ▁VI S ION', '▁OUR ▁VI S ION', '▁A ▁VI S ION :0.5', '▁VI SH AL',
].map((tokens, i) => `${tokens} @decoy${i}`);
// Heard by the verifier only.
const NAMES = ['▁VI SH N U @vishnu', '▁VI SH AL @vishal', '▁VI SH W AS @vishwas'];
// The names check looks at the second before the hit (longer windows measured no better
// and cost more: 2 s took 63 ms per hit, this about 35 ms).
const VERIFY_WINDOW_S = 1;
const VERIFY_FLUSH_S = 0.4;
const RING_S = 2;
const HOLD_S = 0.1;
// The spotter misfires on digital silence (a muted or gated mic): a quiet-room floor of
// noise (about -66 dBFS) under the audio fixes it and changes nothing at real levels.
const DITHER = 0.0005;

// sherpa reads the keywords from a file when the spotter is made; the file is removed after.
function makeSpotter(modelDir, keywords) {
	const file = path.join(os.tmpdir(), `vision-keywords-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
	fs.writeFileSync(file, `${keywords.join('\n')}\n`);
	try {
		return new KeywordSpotter({
			featConfig: { sampleRate: RATE, featureDim: 80 },
			modelConfig: {
				transducer: {
					encoder: path.join(modelDir, 'encoder.int8.onnx'),
					decoder: path.join(modelDir, 'decoder.int8.onnx'),
					joiner: path.join(modelDir, 'joiner.int8.onnx'),
				},
				tokens: path.join(modelDir, 'tokens.txt'),
				numThreads: 1,
				provider: 'cpu',
				debug: 0,
			},
			keywordsFile: file,
		});
	} finally {
		fs.rmSync(file, { force: true });
	}
}

function decodeAll(spotter, stream) {
	const heard = [];
	while (spotter.isReady(stream)) {
		spotter.decode(stream);
		const { keyword } = spotter.getResult(stream);
		if (!keyword) continue;
		spotter.reset(stream);
		heard.push(keyword);
	}
	return heard;
}

function createWakeSpotter({ modelDir, sensitivity = 'normal', wake = WAKE[sensitivity] || WAKE.normal, decoys = DECOYS, names = NAMES, holdS = HOLD_S }) {
	const spotter = makeSpotter(modelDir, [...wake, ...COMMANDS, ...decoys]);
	const verifier = makeSpotter(modelDir, [...names, `${HEY} ${VISION} @hey_vision`]);
	const stream = spotter.createStream();
	const ring = new Float32Array(RING_S * RATE);
	let fed = 0;
	let seed = 1;
	let held = null;
	// Uniform noise with an RMS of DITHER.
	const dither = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return DITHER * Math.sqrt(3) * ((seed / 2147483648) * 2 - 1);
	};

	// Runs the second spotter from a second before the hit to now; returns what it heard.
	function check(hitFed = fed) {
		const from = Math.max(0, fed - ring.length, hitFed - VERIFY_WINDOW_S * RATE);
		const audio = new Float32Array(fed - from + Math.round(VERIFY_FLUSH_S * RATE)); // trailing quiet flushes the decoder
		for (let i = from; i < fed; i++) audio[i - from] = ring[i % ring.length];
		for (let i = fed - from; i < audio.length; i++) audio[i] = dither();
		const stream2 = verifier.createStream();
		stream2.acceptWaveform({ sampleRate: RATE, samples: audio });
		stream2.inputFinished();
		return decodeAll(verifier, stream2);
	}
	const isName = (hitFed) => check(hitFed).some((k) => k !== 'hey_vision');

	return {
		/**
		 * @param {Float32Array} input 16 kHz mono.
		 * @returns keywords heard; late: seconds of audio since the hit (held ones).
		 */
		accept(input) {
			const samples = new Float32Array(input.length);
			for (let i = 0; i < input.length; i++) {
				samples[i] = input[i] + dither();
				ring[(fed + i) % ring.length] = samples[i];
			}
			fed += samples.length;
			stream.acceptWaveform({ sampleRate: RATE, samples });
			const heard = [];
			if (held && fed - held.fed >= holdS * RATE) {
				heard.push({ ...held.hit, ok: !isName(held.fed), late: (fed - held.fed) / RATE });
				held = null;
			}
			for (const keyword of decodeAll(spotter, stream)) {
				const at = fed / RATE;
				if (keyword.startsWith('decoy')) {
					// "Hey Vision" is sometimes heard as "a vision" or "division".
					const hey = check().includes('hey_vision');
					heard.push(hey ? { keyword: 'hey_vision', ok: true, at } : { keyword: 'vision', ok: false, at });
				} else if (keyword === 'vision') {
					if (holdS > 0) held = held || { hit: { keyword, ok: true, at }, fed };
					else heard.push({ keyword, ok: !isName(), at });
				} else heard.push({ keyword, ok: true, at });
			}
			return heard;
		},
	};
}

module.exports = { createWakeSpotter, RATE, WAKE, DECOYS, NAMES };
