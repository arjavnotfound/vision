"""Screenshot every console surface and state from the /preview route.

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
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 3999
BASE = f"http://localhost:{PORT}"
STATES = ["idle", "listening", "thinking", "speaking", "acting", "error", "offline"]
TABS = ["home", "assistant", "activity", "settings"]


def jobs(theme: str) -> list[tuple[str, str, int, int]]:
    """(name, query, width, height) for every surface, as in the preview gallery."""
    out = [("orb-hint", "surface=orb&anchor=1&hint=1", 380, 182)]
    out += [(f"orb-{s}", f"surface=orb&anchor=1&state={s}", 380, 182) for s in STATES]
    out += [(f"strip-{s}", f"surface=strip&state={s}", 640, 182) for s in STATES]
    out += [(f"console-{s}", f"surface=console&state={s}", 1200, 780) for s in STATES]
    out += [(f"console-tab-{t}", f"surface=console&tab={t}&state=speaking", 1200, 780) for t in TABS]
    out += [(f"onboarding-{n}", f"surface=onboarding&step={n}", 1200, 780) for n in range(3)]
    return [(f"{name}-{theme}", f"{query}&theme={theme}", w, h) for name, query, w, h in out]


def wait_for_server(timeout_s: float) -> None:
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"{BASE}/preview?surface=orb", timeout=60) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(1)
    raise SystemExit(f"console dev server did not answer on {BASE} within {timeout_s:.0f} s")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("--theme", choices=["ember", "paper"], default="ember")
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
            browser = p.chromium.launch(channel="chrome")
            for name, query, width, height in jobs(args.theme):
                page = browser.new_page(viewport={"width": width, "height": height})
                page.goto(f"{BASE}/preview?{query}", wait_until="networkidle")
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
