// Offline "Vision" keyword spotter (sherpa-onnx, runs on the CPU, no audio leaves the PC).
// Feed it 16 kHz mono Float32 audio; it returns the keywords it heard.
//
// Second check: "vision" inside a longer word or phrase is spotted as that longer keyword
// instead (the spotter reports the longest match ending on the same sound), so
// "television", "division" and "my vision" come back with ok: false. Measured on the T06
// clips, this rejected every listed negative; an energy-based pause check was not
// usable because the spotter's timestamps restart at chunk boundaries.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KeywordSpotter } = require('sherpa-onnx-node');

const RATE = 16000;
const VISION = '▁VI S ION';
const HEY = '▁HE Y';
// ":boost #threshold" make a keyword fire more easily; the default is boost 1, threshold 0.25.
const WAKE = {
	relaxed: [`${VISION} :3.0 #0.08 @vision`, `${HEY} ${VISION} :3.0 #0.08 @hey_vision`],
	normal: [`${VISION} :2.5 #0.12 @vision`, `${HEY} ${VISION} :2.5 #0.12 @hey_vision`],
	strict: [`${HEY} ${VISION} @hey_vision`],
};
// Acted on only right after a wake word ("Vision, stop").
const COMMANDS = ['▁ST O P @stop', '▁CAN CE L @cancel'];
// Words and phrases that end in "vision". Tokens: sentencepiece BPE from the model's bpe.model.
const DECOYS = [
	'▁T E LE VI S ION', '▁DI VI S ION', '▁RE VI S ION', '▁PRO VI S ION', '▁EN VI S ION',
	'▁SU PER VI S ION', '▁MY ▁VI S ION', '▁YOUR ▁VI S ION', '▁THE ▁VI S ION', '▁HIS ▁VI S ION',
	'▁HER ▁VI S ION', '▁OUR ▁VI S ION', '▁A ▁VI S ION', '▁VI SH AL',
].map((tokens, i) => `${tokens} @decoy${i}`);

function keywordsFile(sensitivity) {
	const lines = [...(WAKE[sensitivity] || WAKE.normal), ...COMMANDS, ...DECOYS];
	const file = path.join(os.tmpdir(), `vision-keywords-${sensitivity}.txt`);
	fs.writeFileSync(file, lines.join('\n') + '\n');
	return file;
}

function createWakeSpotter({ modelDir, sensitivity = 'normal' }) {
	const spotter = new KeywordSpotter({
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
		keywordsFile: keywordsFile(sensitivity),
	});
	const stream = spotter.createStream();
	let fed = 0;

	return {
		/** @param {Float32Array} samples 16 kHz mono. @returns keywords heard in this chunk. */
		accept(samples) {
			fed += samples.length;
			stream.acceptWaveform({ sampleRate: RATE, samples });
			const heard = [];
			while (spotter.isReady(stream)) {
				spotter.decode(stream);
				const { keyword } = spotter.getResult(stream);
				if (!keyword) continue;
				spotter.reset(stream);
				const decoy = keyword.startsWith('decoy');
				heard.push({ keyword: decoy ? 'vision' : keyword, ok: !decoy, at: fed / RATE });
			}
			return heard;
		},
	};
}

module.exports = { createWakeSpotter, RATE };
