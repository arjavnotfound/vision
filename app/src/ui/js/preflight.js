// Start-screen status from the launcher's preflight plus live checks (pure, unit tested).
// Dots: true = ok (green), false = problem (red), null = still checking (grey).
// `line`: one short spoken sentence when something is wrong; face control always works.

export function preflightReport({ preflight, cameraStatus, micOk, internet, assistantSeen }) {
	const pf = preflight ?? {};
	const camera = cameraStatus === "on" ? true : cameraStatus === "error" || pf.camera === false ? false : null;
	const mic = micOk === false || pf.mic === false ? false : micOk === true ? true : null;
	const online = internet ?? pf.internet ?? null;
	const voiceBroken = online === false || pf.keys === false || mic === false;
	const assistant = voiceBroken ? false : assistantSeen ? true : null;

	const problems = [];
	if (camera === false) problems.push("No camera found. Plug in the webcam.");
	if (online === false) {
		problems.push("No internet. Voice is off, face control still works.");
	} else if (pf.keys === false) {
		problems.push("Voice keys are missing. Voice is off, face control still works.");
	} else if (mic === false) {
		problems.push("No microphone. Voice is off, face control still works.");
	} else if (pf.build === "building" && !assistantSeen) {
		problems.push("Preparing the voice assistant. This takes about a minute.");
	}
	return { dots: { camera, mic, internet: online, assistant }, line: problems.length ? problems.join(" ") : null };
}
