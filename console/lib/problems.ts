/**
 * Problems VISION says out loud: once each, in one plain sentence. While a problem lasts it
 * is not said again; it is said again only after it cleared and came back.
 */
export const PROBLEM_TEXT = {
  voice: 'Voice is offline. Face control still works.',
  mic: 'I can’t hear you. The microphone is missing or turned off. Face control still works.',
} as const;

export type Problem = keyof typeof PROBLEM_TEXT;

const active = new Set<Problem>();

function speakLine(text: string) {
  try {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
  } catch {
    // no speech engine: the island still shows it
  }
}

/** Say the problem unless it is already active. Returns true when it was said. */
export function reportProblem(problem: Problem, say: (text: string) => void = speakLine): boolean {
  if (active.has(problem)) return false;
  active.add(problem);
  console.warn(`[VISION] problem: ${problem}`);
  say(PROBLEM_TEXT[problem]);
  return true;
}

export function clearProblem(problem: Problem): void {
  active.delete(problem);
}
