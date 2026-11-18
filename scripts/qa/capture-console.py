"""Screenshot every island view from the /preview route.

    uv run --project agent python scripts/qa/capture-console.py <output dir> [--theme ember|paper]

Starts `next dev` for console/ on port 3999 (dev builds always include /preview; the
static export only does when built with VISION_ENABLE_PREVIEW=1), screenshots each
/preview?surface=... page in a throwaway Google Chrome via Playwright, then stops the
server. Nothing touches the real app or its profile.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 3999
BASE = f"http://localhost:{PORT}"
LINE_TONES = ["idle", "accent", "warn", "dim"]
CAPTIONS = ["wake", "listening", "understood", "acting", "confirm", "help", "speaking", "offline"]
POSITIONS = ["top-center", "top-right", "bottom-center"]
ISLAND = (380, 80)  # the island window
MENU = (340, 520)  # the menu window


def jobs(theme: str) -> list[tuple[str, str, int, int]]:
    """(name, query, width, height) for every island view, laid out as in its window."""
    q = "surface=island&anchor=1"
    out = [(f"resting-{p}", f"{q}&view=resting&position={p}", *ISLAND) for p in POSITIONS]
    out += [
        ("resting-dwell-ring", f"{q}&view=resting&dwell=0.6", *ISLAND),
        ("resting-faded-near-cursor", f"{q}&view=resting&near=1", *ISLAND),
        ("resting-paused", f"{q}&view=resting&face=paused", *ISLAND),
        ("resting-unseen", f"{q}&view=resting&face=unseen", *ISLAND),
        ("resting-voice-off", f"{q}&view=resting&voice=nokeys", *ISLAND),
        ("menu", f"{q}&view=menu", *MENU),
        ("menu-paused", f"{q}&view=menu&face=paused", *MENU),
        ("menu-voice-keys-missing", f"{q}&view=menu&voice=nokeys", *MENU),
        ("menu-voice-offline", f"{q}&view=menu&voice=offline", *MENU),
        ("menu-dwell-on-talk", f"{q}&view=menu&dwell=0.5", *MENU),
        ("menu-bottom-center", f"{q}&view=menu&position=bottom-center", *MENU),
    ]
    out += [(f"caption-{v}", f"{q}&view={v}", *ISLAND) for v in CAPTIONS]
    out += [(f"fullscreen-line-{t}", f"{q}&view=sliver&tone={t}", *ISLAND) for t in LINE_TONES]
    return [(f"island-{name}-{theme}", f"{query}&theme={theme}", w, h) for name, query, w, h in out]


def wait_for_server(timeout_s: float) -> None:
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"{BASE}/preview?surface=island", timeout=60) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(1)
    raise SystemExit(f"console dev server did not answer on {BASE} within {timeout_s:.0f} s")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("--theme", choices=["ember", "paper"], default="ember")
    parser.add_argument("--hotkey", default="", help="talk hotkey the live app registered, e.g. Ctrl+Shift+Space")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    # node directly (no shell), so killing this pid's tree stops the server.
    server = subprocess.Popen(
        ["node", "node_modules/next/dist/bin/next", "dev", "-p", str(PORT)],
        cwd=ROOT / "console",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_server(180)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            for name, query, width, height in jobs(args.theme):
                page = browser.new_page(viewport={"width": width, "height": height})
                # A desktop-like backdrop, so the transparent window reads as it does over an app.
                page.add_init_script("document.addEventListener('DOMContentLoaded', () => document.body.style.background = '#3a3f47')")
                hotkey = f"&hotkey={urllib.parse.quote(args.hotkey)}" if args.hotkey else ""
                page.goto(f"{BASE}/preview?{query}{hotkey}", wait_until="networkidle")
                page.wait_for_timeout(900)  # let entry animations settle
                page.screenshot(path=str(out / f"{name}.png"))
                page.close()
                print(f"captured {name}.png")
            browser.close()
    finally:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(server.pid)], capture_output=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
