// Spoken instructions (Windows voices through the browser's speech synthesis, offline).
// Used by the one-app flow so nobody has to read small text from a distance.

let muted = false;

export function setSpeechMuted(value) {
	muted = Boolean(value);
	if (muted) cancelSpeech();
}

export function speak(text, { interrupt = true } = {}) {
	if (muted || !text || typeof speechSynthesis === "undefined") return;
	try {
		if (interrupt) speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.rate = 1;
		utterance.lang = "en-US";
		speechSynthesis.speak(utterance);
	} catch (error) {
		console.warn("Speech failed:", error);
	}
}

export function cancelSpeech() {
	try {
		speechSynthesis?.cancel();
	} catch (_error) {
		// no speech engine
	}
}
