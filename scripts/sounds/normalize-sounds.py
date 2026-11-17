"""Build VISION's voice cues from picks.json: trim silence, soften the edges, set one loudness.

Usage: python -I scripts/sounds/normalize-sounds.py vision-dev/sounds/picks.json
Needs ffmpeg on PATH. Paths in picks.json are relative to the repo root. Prints one line
per sound (duration, peak, LUFS) and fails if a result is off target or clips.
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PEAK_MAX_DB = -1.0


def run(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *args], capture_output=True, text=True)


def measure(path):
    # Looped 16x: integrated loudness needs 400 ms gating blocks, and the wake ping is 90 ms.
    err = run(["-stream_loop", "15", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    lufs = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])
    peak = float(re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", err)[-1])
    dur = float(re.search(r"Duration: (\d+):(\d+):([\d.]+)", run(["-i", str(path)]).stderr).group(3))
    return lufs, peak, dur


def main(picks_path):
    picks = json.loads(Path(picks_path).read_text(encoding="utf-8"))
    target = float(picks["target_lufs"])
    out_dir = ROOT / picks["out_dir"]
    out_dir.mkdir(parents=True, exist_ok=True)
    # Trim silence, 3 ms fade in (no click), 15 ms fade out. asetpts: the fades go by timestamps.
    shape = ("asetpts=N/SR/TB,silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
             "silenceremove=start_periods=1:start_threshold=-50dB,afade=t=in:d=0.015,areverse,asetpts=N/SR/TB,afade=t=in:d=0.003")
    ok = True
    for pick in picks["picks"]:
        src, dst = ROOT / pick["original"], out_dir / pick["file"]
        tmp = dst.with_suffix(".tmp.wav")
        run(["-y", "-i", str(src), "-ac", "1", "-ar", "48000", "-af", shape, str(tmp)])
        lufs, peak, _ = measure(tmp)
        gain = min(target - lufs, PEAK_MAX_DB - peak)
        run(["-y", "-i", str(tmp), "-af", f"volume={gain:.2f}dB", "-c:a", "libvorbis", "-q:a", "5", str(dst)])
        tmp.unlink()
        lufs, peak, dur = measure(dst)
        good = abs(lufs - target) <= 1.5 and peak <= PEAK_MAX_DB + 0.3
        ok &= good
        print(f"{pick['role']:<10} {dst.name:<14} {dur * 1000:4.0f} ms  peak {peak:5.1f} dBFS  {lufs:5.1f} LUFS  {'ok' if good else 'OFF TARGET'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
