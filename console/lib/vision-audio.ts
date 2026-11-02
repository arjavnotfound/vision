/**
 * Synthesizes a high-fidelity crystalline chime ("Ting") using the Web Audio API.
 * Requires zero external audio assets, operates with zero latency, and provides a
 * calm, reassuring tactile feedback signal when VISION performs an action.
 */
class VisionAudioEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Plays a delicate, crystalline "Ting" chime confirming an action was completed.
   */
  playTing(type: 'action' | 'connect' | 'notice' = 'action') {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);

      if (type === 'action') {
        // High-pitched crystalline metallic bell ("Ting")
        // Primary bell oscillator (G6 / 1568 Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1568, now);
        osc1.frequency.exponentialRampToValueAtTime(1584, now + 0.05);

        gain1.gain.setValueAtTime(0.001, now);
        gain1.gain.linearRampToValueAtTime(0.12, now + 0.004);
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

        // Overtone sparkle (D7 / 2349 Hz)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2349, now);
        gain2.gain.setValueAtTime(0.001, now);
        gain2.gain.linearRampToValueAtTime(0.05, now + 0.003);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

        osc1.connect(gain1);
        osc2.connect(gain2);
        gain1.connect(masterGain);
        gain2.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.38);
        osc2.stop(now + 0.22);
      } else if (type === 'connect') {
        // Gentle ascending two-tone cue
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.1);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.38);
      }
    } catch {
      // Audio context autoplay policy handled gracefully
    }
  }
}

export const visionAudio = new VisionAudioEngine();
