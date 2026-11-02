"""End-to-end smoke test for the running VISION stack (backend + Next.js).

Drives the real web app in Playwright Chromium with fake media devices, so a WAV
file plays as the microphone (a genuine spoken request to Gemini). Checks:

  1. Dwell on the orb (pointer resting, no click) activates VISION.
  2. The session connects and the agent joins.
  3. The spoken request opens exactly one site; the UI receives action_start /
     action_done and shows the activity row.
  4. Collapsing the strip mutes the mic but keeps the session connected, and
     re-activating reuses the same room (no reconnect).
  5. The strip auto-collapses after ~8s idle without ending the session.
  6. A Quick Command chip sends text to the agent and triggers an action.
  7. The in-page hotkey (Ctrl+Alt+Space) activates from the orb.

Usage (from agent/, with run.bat already running):
    uv run python ../scripts/e2e_smoke.py --voice path/to/say_open_youtube.wav [--shots DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

URL = "http://localhost:3000/"
SETTINGS = {"onboarded": True, "dwellEnabled": True, "dwellMs": 900}

INSTRUMENT = """
() => {
  window.__vision_events = [];
  const hook = () => {
    const room = window.__lk_room;
    if (!room || room.__visionHooked) return;
    room.__visionHooked = true;
    room.on('dataReceived', (payload, _p, _k, topic) => {
      if (topic !== 'vision_events') return;
      try { window.__vision_events.push(JSON.parse(new TextDecoder().decode(payload))); } catch {}
    });
  };
  setInterval(hook, 200);
}
"""

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)
    return ok


def room_info(page: Page) -> dict:
    return page.evaluate(
        """() => { const r = window.__lk_room; if (!r) return {};
        return { state: r.state, sid: r.name,
                 mic: r.localParticipant?.isMicrophoneEnabled ?? null,
                 agents: [...r.remoteParticipants.values()].map(p => p.identity) }; }"""
    )


def surface(page: Page) -> str:
    if page.locator('nav[aria-label="Sections"]').count():
        return "console"
    if page.get_by_role("button", name="Collapse").count():
        return "strip"
    if page.get_by_role("button", name="Talk to VISION", exact=False).count():
        return "orb"
    return "unknown"


def wait_for(fn, timeout: float, interval: float = 0.25):
    deadline = time.monotonic() + timeout
    value = fn()
    while not value and time.monotonic() < deadline:
        time.sleep(interval)
        value = fn()
    return value


def events(page: Page) -> list[dict]:
    return page.evaluate("() => window.__vision_events || []")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True, help="WAV played as the microphone")
    parser.add_argument("--shots", default="", help="Directory for screenshots")
    args = parser.parse_args()
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)

    def shot(page: Page, name: str) -> None:
        if shots:
            page.screenshot(path=str(shots / f"{name}.png"))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-audio-capture={Path(args.voice).resolve()}",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        context = browser.new_context(viewport={"width": 1280, "height": 860})
        context.grant_permissions(["microphone"], origin=URL.rstrip("/"))
        context.add_init_script(
            f"localStorage.setItem('vision.settings.v1', {json.dumps(json.dumps(SETTINGS))});"
        )
        page = context.new_page()
        page.on("console", lambda m: m.type == "error" and print("  [console]", m.text[:160]))
        page.goto(URL)
        page.evaluate(INSTRUMENT)
        page.wait_for_timeout(1500)
        check("starts as the idle orb", surface(page) == "orb", surface(page))

        # 1. Dwell: rest the pointer on the orb, no click.
        orb = page.get_by_role("button", name="Talk to VISION", exact=False)
        box = orb.bounding_box()
        assert box
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(1300)
        check("dwell on the orb activates (strip)", surface(page) == "strip", surface(page))
        page.mouse.move(5, 5)

        # 2. Session + agent.
        joined = wait_for(lambda: room_info(page).get("state") == "connected" and room_info(page).get("agents"), 25)
        info = room_info(page)
        check("session connected and agent joined", info.get("state") == "connected" and bool(joined), json.dumps(info))
        first_room = info.get("sid")
        shot(page, "e2e-strip-live")

        # 3. Spoken "Open YouTube" -> exactly one open_url.
        def opened():
            return [e for e in events(page) if e.get("action") == "open_url" and e.get("type") == "action_done"]

        wait_for(opened, 45)
        evs = events(page)
        starts = [e for e in evs if e.get("type") == "action_start" and e.get("action") == "open_url"]
        dones = opened()
        check(
            "voice request opens one site (one action_start/done)",
            len(starts) == 1 and len(dones) == 1,
            json.dumps(evs)[:400],
        )
        if dones:
            check("action_done carries url/title/ts", all(k in dones[0] for k in ("url", "title", "ts")), json.dumps(dones[0]))
        page.wait_for_timeout(1500)
        shot(page, "e2e-after-open")

        # 4. Collapse: mic muted, session alive, re-activate reuses the room.
        page.get_by_role("button", name="Collapse").click()
        page.wait_for_timeout(1200)
        info = room_info(page)
        check("collapse keeps the session and mutes the mic", surface(page) == "orb" and info.get("state") == "connected" and info.get("mic") is False, json.dumps(info))
        page.get_by_role("button", name="Talk to VISION", exact=False).click()
        page.wait_for_timeout(1200)
        info = room_info(page)
        check("re-activate unmutes instantly, same room", surface(page) == "strip" and info.get("mic") is True and info.get("sid") == first_room, json.dumps(info))

        # 5. Auto-collapse after ~8s idle, still connected.
        page.mouse.move(5, 5)
        collapsed = wait_for(lambda: surface(page) == "orb", 20, 0.5)
        info = room_info(page)
        check("strip auto-collapses after idle, session stays up", bool(collapsed) and info.get("state") == "connected", json.dumps(info))

        # 7. In-page hotkey.
        page.keyboard.press("Control+Alt+Space")
        page.wait_for_timeout(1000)
        check("hotkey activates from the orb", surface(page) == "strip", surface(page))

        # 6. Quick Command chip from the Console.
        page.get_by_role("button", name="Full view").click()
        page.wait_for_timeout(1000)
        before = len(events(page))
        page.get_by_role("button", name="Scroll down").click()
        got = wait_for(lambda: any(e.get("action") == "scroll" for e in events(page)[before:]), 30)
        check("Quick Command chip triggers an action via lk.chat", bool(got), json.dumps(events(page)[before:])[:300])
        page.wait_for_timeout(1200)
        shot(page, "e2e-console")
        info = room_info(page)
        check("still the same session at the end", info.get("sid") == first_room and info.get("state") == "connected", json.dumps(info))

        browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
