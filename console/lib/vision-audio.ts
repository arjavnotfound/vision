import { settingsStore } from '@/lib/settings';

/**
 * VISION's four voice cues: real recorded sounds (Kenney Interface Sounds, CC0), trimmed
 * and set to one loudness by scripts/sounds/normalize-sounds.py. Picks: vision-dev/sounds/picks.json.
 * Played through Web Audio from decoded buffers so the wake sound starts with no delay.
 * Volume and on/off come from Settings (soundVolume, soundsOn).
 */
export type VisionSound = 'wake' | 'listening' | 'done' | 'error';

const SOUNDS: VisionSound[] = ['wake', 'listening', 'done', 'error'];

class VisionAudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<VisionSound, Promise<AudioBuffer | null>>();

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
      this.buffers.clear();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private load(ctx: AudioContext, name: VisionSound) {
    let buffer = this.buffers.get(name);
    if (!buffer) {
      buffer = fetch(`/sounds/${name}.ogg`)
        .then((response) => response.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch((error) => {
          console.warn(`[VISION] Sound ${name} did not load:`, error);
          this.buffers.delete(name);
          return null;
        });
      this.buffers.set(name, buffer);
    }
    return buffer;
  }

  /** Decode all four up front, so the first wake sound is not late. */
  preload() {
    const ctx = this.getContext();
    if (ctx) SOUNDS.forEach((name) => void this.load(ctx, name));
  }

  play(name: VisionSound) {
    const { soundsOn, soundVolume } = settingsStore.get();
    // One line per cue: the QA runs check these instead of listening.
    console.log(`[VISION] sound ${name} ${soundsOn ? `volume ${soundVolume}` : 'off'}`);
    if (!soundsOn) return;
    const ctx = this.getContext();
    if (!ctx) return;
    void this.load(ctx, name).then((buffer) => {
      if (!buffer) return;
      try {
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = soundVolume / 100;
        source.buffer = buffer;
        source.connect(gain).connect(ctx.destination);
        source.start();
      } catch {
        // Autoplay policy or a closed context: no sound this time.
      }
    });
  }
}

export const visionAudio = new VisionAudioEngine();
