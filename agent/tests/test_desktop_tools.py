"""Desktop tools: one spoken request -> one action, confirmation before closing,
voice control of VISION over the bus, and the key-combo parser."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest
from livekit.agents.llm import ToolError

import desktop
import vision_bus
from desktop_tools import DesktopTools
from tools import ActionGuard


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


class FakeDesktop:
    """Stands in for the ctypes backend: records calls, touches nothing."""

    SW_MINIMIZE = desktop.SW_MINIMIZE

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def click(self, button, count):
        self.calls.append(("click", button, count))

    def mouse_down(self):
        self.calls.append(("down",))

    def mouse_up(self):
        self.calls.append(("up",))

    def release_all(self):
        self.calls.append(("release_all",))

    def scroll(self, direction, steps):
        self.calls.append(("scroll", direction, steps))

    def ensure_user_focus(self):
        self.calls.append(("focus",))
        return "Untitled - Notepad"

    def type_text(self, text):
        self.calls.append(("type", text))

    def press_combo(self, codes):
        self.calls.append(("keys", tuple(codes)))

    def target_window(self):
        return 42

    def window_title(self, hwnd):
        return "Untitled - Notepad"

    def close_window(self, hwnd):
        self.calls.append(("close", hwnd))

    def known_app(self, name):
        return desktop.known_app(name)

    def launch(self, argv):
        self.calls.append(("launch", tuple(argv)))

    def open_from_start_menu(self, name):
        self.calls.append(("start_menu", name))

    def find_window(self, name):
        # Windows 11 Notepad restores an old file tab.
        return (7, "urls.txt - Notepad" if name == "Notepad" else f"{name} window")

    def focus_window(self, hwnd):
        self.calls.append(("focus_window", hwnd))

    controls: ClassVar[list] = []

    def find_controls(self, hwnd):
        return self.controls

    def pick_control(self, spoken, controls):
        return desktop.pick_control(spoken, controls)

    def press_control(self, hwnd, control):
        self.calls.append(("press", hwnd, control.name))


def make(clock=None, bus=vision_bus):
    events: list[dict] = []

    async def on_event(event):
        events.append(event)

    backend = FakeDesktop()
    tools = DesktopTools(
        action_callback=on_event,
        guard=ActionGuard(clock=clock or FakeClock()),
        backend=backend,
        bus=bus,
    )
    return tools, backend, events


def test_parse_combo():
    assert desktop.parse_combo("Ctrl+S") == [0x11, ord("S")]
    assert desktop.parse_combo("alt + tab") == [0x12, 0x09]
    assert desktop.parse_combo("Enter") == [0x0D]
    assert desktop.parse_combo("ArrowDown") == [0x28]
    assert desktop.parse_combo("ctrl shift t") == [0x11, 0x10, ord("T")]
    with pytest.raises(ValueError):
        desktop.parse_combo("ctrl+a+b")
    with pytest.raises(ValueError):
        desktop.parse_combo("hyperdrive")


def test_known_apps():
    assert desktop.known_app("Notepad") == ["notepad.exe"]
    assert desktop.known_app("calculator app") == ["calc.exe"]
    assert desktop.known_app("Some Game") is None


@pytest.mark.asyncio
async def test_one_spoken_request_is_one_action():
    clock = FakeClock()
    tools, backend, events = make(clock)
    await tools.click_here(None, "double")
    await tools.click_here(None, "double")  # the model repeated the call
    assert backend.calls == [("click", "left", 2)]
    await tools.dictate(None, "hello my name is VISION")
    await tools.dictate(None, "hello my name is VISION")
    assert backend.calls.count(("type", "hello my name is VISION")) == 1
    await tools.press_keys(None, "Enter")
    await tools.press_keys(None, "enter")
    assert backend.calls.count(("keys", (0x0D,))) == 1
    clock.now += 5  # a new request later is a new action
    await tools.press_keys(None, "Enter")
    assert backend.calls.count(("keys", (0x0D,))) == 2
    starts = [e for e in events if e["type"] == "action_start"]
    assert len(starts) == 4


@pytest.mark.asyncio
async def test_open_app_uses_known_path_then_start_menu():
    tools, backend, _ = make()
    tools.intent.note_user("open Notepad")
    await tools.open_app(None, "Notepad")
    tools.intent.note_user("open Spotify")
    await tools.open_app(None, "Spotify")
    assert ("launch", ("notepad.exe",)) in backend.calls
    assert ("start_menu", "Spotify") in backend.calls
    # The new window gets focus, so typing right after goes into it.
    assert backend.calls.count(("focus_window", 7)) == 2
    # Notepad restored someone's file: a new blank tab is opened before any dictation.
    assert ("keys", (0x11, ord("N"))) in backend.calls


def test_new_document_only_when_needed():
    assert desktop.new_document_combo("Notepad", "urls.txt - Notepad") == [
        0x11,
        ord("N"),
    ]
    assert desktop.new_document_combo("Notepad", "Untitled - Notepad") is None
    assert desktop.new_document_combo("Calculator", "Calculator") is None


@pytest.mark.asyncio
async def test_close_window_needs_a_yes():
    tools, backend, events = make()
    with pytest.raises(ToolError):
        await tools.close_window(None)
    assert ("close", 42) not in backend.calls
    assert any(e["type"] == "confirm_request" for e in events)
    with pytest.raises(ToolError):
        await tools.press_keys(None, "Alt+F4")
    await tools.confirm_close_window(None)
    await tools.close_window(None)
    assert ("close", 42) in backend.calls
    # The confirmation is used up.
    with pytest.raises(ToolError):
        await tools.close_window(None)


@pytest.mark.asyncio
async def test_drag_and_release_on_shutdown():
    tools, backend, _ = make()
    await tools.start_drag(None)
    tools.release_all()
    assert backend.calls == [("down",), ("release_all",)]


class _BusHandler(BaseHTTPRequestHandler):
    received: ClassVar[list] = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        ok = self.headers.get("x-vision-token") == "t0k"
        _BusHandler.received.append((self.path, body, ok))
        self.send_response(200 if ok else 403)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": ok, "done": body.get("cmd")}).encode())

    def log_message(self, *args):
        pass


@pytest.mark.asyncio
async def test_vision_control_over_the_bus(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), _BusHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setenv("VISION_BUS_PORT", str(server.server_address[1]))
        monkeypatch.setenv("VISION_BUS_TOKEN", "t0k")
        tools, _, _ = make()
        assert "pause" in await tools.set_setting(None, "paused", "on")
        await tools.change_click_mode(None, "dwell")
        await tools.move_control(None, "right click", "brows")
        paths = [(p, b) for p, b, ok in _BusHandler.received if ok]
        assert ("/command", {"cmd": "pause"}) in paths
        assert ("/command", {"cmd": "click-mode", "value": "dwell"}) in paths
        assert (
            "/command",
            {"cmd": "remap", "value": {"action": "rightClick", "to": "brow"}},
        ) in paths
        monkeypatch.setenv("VISION_BUS_TOKEN", "wrong")
        tools2, _, _ = make()
        with pytest.raises(ToolError):
            await tools2.set_setting(None, "paused", "off")
    finally:
        server.shutdown()


@pytest.mark.asyncio
async def test_vision_control_without_launcher(monkeypatch):
    monkeypatch.delenv("VISION_BUS_PORT", raising=False)
    monkeypatch.delenv("VISION_BUS_TOKEN", raising=False)
    tools, _, _ = make()
    with pytest.raises(ToolError, match="not connected"):
        await tools.quit_vision(None)


@pytest.mark.asyncio
async def test_move_control_back_to_a_wink(monkeypatch):
    sent = []

    class Bus:
        async def send_command(self, cmd, value=None):
            sent.append((cmd, value))
            return {"ok": True, "done": "remapped"}

    tools = DesktopTools(
        guard=ActionGuard(clock=FakeClock()), backend=FakeDesktop(), bus=Bus()
    )
    await tools.move_control(None, "right click", "wink")
    await tools.move_control(None, "left click", "dwell")
    await tools.move_control(None, "scroll", "voice")
    assert sent == [
        ("remap", {"action": "rightClick", "to": "rightWink"}),
        ("remap", {"action": "leftClick", "to": "dwell"}),
        ("remap", {"action": "scroll", "to": "voice"}),
    ]
    with pytest.raises(ToolError):
        await tools.move_control(None, "left click", "brows")


C = desktop.Control


def test_match_names_the_way_people_say_them():
    assert desktop.match_score("submit", "Submit") == 4
    assert desktop.match_score("SAVE", "Save draft") == 3
    assert desktop.match_score("downloads", "Open Downloads folder") == 2
    assert desktop.match_score("load", "Downloads") == 1
    assert desktop.match_score("print", "Save") == 0
    found = desktop.rank_controls("submit button", [C("Cancel"), C("Submit")])
    assert [c.name for c in found] == ["Submit"]


def test_prefer_enabled_and_visible_controls():
    hidden, greyed, shown = (
        C("Play", offscreen=True),
        C("Play", enabled=False),
        C("Play"),
    )
    best, others = desktop.pick_control("play", [hidden, greyed, shown])
    assert best is shown and others == []
    # An exact name beats a partial one even when the exact one is scrolled away.
    best, _ = desktop.pick_control("play", [C("Play all"), hidden])
    assert best is hidden


@pytest.mark.asyncio
async def test_click_by_name_presses_the_best_match():
    tools, backend, events = make()
    backend.controls = [C("Save draft"), C("Submit"), C("Delete"), C("Delete")]
    assert await tools.click_by_name(None, "save draft") == "Clicked Save draft."
    assert backend.calls == [("press", 42, "Save draft")]
    assert [e["type"] for e in events][:2] == ["action_start", "action_done"]


@pytest.mark.asyncio
async def test_click_by_name_asks_before_send_buy_delete_or_post():
    tools, backend, events = make()
    backend.controls = [C("Submit"), C("Delete"), C("Post")]
    with pytest.raises(ToolError, match="confirm_click"):
        await tools.click_by_name(None, "submit")
    assert backend.calls == []
    assert events[-1]["type"] == "confirm_request"
    assert events[-1]["question"] == "submit?"
    assert "confirmed" in await tools.confirm_click(None)
    assert await tools.click_by_name(None, "submit") == "Clicked Submit."
    # One yes covers one click.
    with pytest.raises(ToolError, match="confirm_click"):
        await tools.click_by_name(None, "submit")
    with pytest.raises(ToolError, match="confirm_click"):
        await tools.click_by_name(None, "post")
    fresh, _, _ = make()
    with pytest.raises(ToolError, match="No click"):
        await fresh.confirm_click(None)
    assert backend.calls == [("press", 42, "Submit")]


@pytest.mark.asyncio
async def test_click_by_name_says_when_nothing_matches():
    tools, backend, _ = make()
    backend.controls = [C("Submit")]
    with pytest.raises(ToolError, match="I can't find that"):
        await tools.click_by_name(None, "print")
    assert backend.calls == []


@pytest.mark.asyncio
async def test_click_by_name_asks_which_when_several_match():
    tools, backend, _ = make()
    backend.controls = [C("Save draft"), C("Save copy"), C("Archive", enabled=False)]
    with pytest.raises(ToolError, match="Save draft, Save copy"):
        await tools.click_by_name(None, "save")
    with pytest.raises(ToolError, match="greyed out"):
        await tools.click_by_name(None, "archive")
    assert backend.calls == []


@pytest.mark.skipif(not desktop.IS_WINDOWS, reason="needs Windows UI Automation")
def test_uia_clicks_a_button_in_a_hidden_window(tmp_path):
    """Real UIA against an off-screen, never-focused WinForms window."""
    import subprocess
    from pathlib import Path

    log = tmp_path / "pressed.txt"
    log.touch()
    script = Path(__file__).parent / "fixtures" / "uia_test_window.ps1"
    proc = subprocess.Popen(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            str(log),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        hwnd = int(
            next(line for line in proc.stdout if line.startswith("HWND")).split()[1]
        )
        controls = desktop.find_controls(hwnd)
        best, others = desktop.pick_control("Submit button", controls)
        assert best.name == "Submit" and others == []
        assert desktop.press_control(hwnd, best) == "invoke"
        assert desktop.pick_control("archive", controls)[0].enabled is False
        for _ in range(20):
            if log.read_text().strip():
                break
            threading.Event().wait(0.1)
        assert log.read_text().split() == ["Submit"]
    finally:
        proc.kill()


@pytest.mark.asyncio
async def test_show_face_control_asks_vision_to_show_its_window():
    sent = []

    class Bus:
        async def send_command(self, cmd, value=None):
            sent.append((cmd, value))
            return {"ok": True, "done": "show"}

    tools = DesktopTools(
        guard=ActionGuard(clock=FakeClock()), backend=FakeDesktop(), bus=Bus()
    )
    await tools.show_face_control(None)
    assert sent == [("show", None)]


@pytest.mark.asyncio
async def test_retry_camera_asks_vision_to_open_the_camera_again():
    sent = []

    class Bus:
        async def send_command(self, cmd, value=None):
            sent.append((cmd, value))
            return {"ok": True, "done": "retrying camera"}

    tools = DesktopTools(
        guard=ActionGuard(clock=FakeClock()), backend=FakeDesktop(), bus=Bus()
    )
    await tools.retry_camera(None)
    assert sent == [("retry-camera", None)]


class RecordingBus:
    def __init__(self, reply=None):
        self.sent = []
        self.reply = reply or {"ok": True, "done": "ok"}

    async def send_command(self, cmd, value=None):
        self.sent.append((cmd, value))
        if self.reply.get("error"):
            raise vision_bus.VisionBusError(self.reply["error"])
        return self.reply


def bus_tools(bus, backend=None):
    events = []

    async def callback(event):
        events.append(event)

    tools = DesktopTools(
        action_callback=callback,
        guard=ActionGuard(clock=FakeClock()),
        backend=backend or FakeDesktop(),
        bus=bus,
    )
    return tools, events


@pytest.mark.asyncio
async def test_set_setting_sends_whitelisted_settings_to_face_control():
    bus = RecordingBus()
    tools, _ = bus_tools(bus)
    await tools.set_setting(None, "cursor_speed", "Slower")
    await tools.set_setting(None, "dwell", "1.2")
    await tools.set_setting(None, "dwell_time", "1200")
    await tools.set_setting(None, "volume", "quieter")
    await tools.set_setting(None, "face control", "off")
    await tools.set_setting(None, "speed", "7")
    assert bus.sent == [
        ("set-setting", {"name": "cursor_speed", "value": "slower"}),
        ("set-setting", {"name": "dwell_time", "value": "1.2"}),
        ("set-setting", {"name": "dwell_time", "value": "1200"}),
        ("set-setting", {"name": "volume", "value": "quieter"}),
        ("set-setting", {"name": "face_control", "value": "off"}),
        ("set-setting", {"name": "cursor_speed", "value": "7"}),
    ]


@pytest.mark.asyncio
async def test_set_setting_pause_and_resume_use_the_f9_commands():
    bus = RecordingBus()
    tools, _ = bus_tools(bus)
    await tools.set_setting(None, "paused", "on")
    await tools.set_setting(None, "pause", "resume")
    assert bus.sent == [("pause", None), ("resume", None)]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("clicking_mode", "off", "only change"),
        ("wake_sensitivity", "strict", "only change"),
        ("runAtLogin", "on", "only change"),
        ("cursor_speed", "11", "goes from 1 to 10"),
        ("cursor_speed", "0", "goes from 1 to 10"),
        ("dwell_time", "3", "goes from 0.6 to 1.5"),
        ("dwell_time", "5000", "goes from 600 to 1500"),
        ("volume", "0", "goes from 10 to 100"),
        ("volume", "max", "say louder or quieter"),
        ("paused", "maybe", "say off or on"),
        ("face_control", "7", "say off or on"),
    ],
)
async def test_set_setting_refuses_anything_outside_the_whitelist(name, value, message):
    bus = RecordingBus()
    tools, _ = bus_tools(bus)
    with pytest.raises(ToolError, match=message):
        await tools.set_setting(None, name, value)
    assert bus.sent == []


@pytest.mark.asyncio
async def test_set_setting_speaks_face_controls_refusal():
    bus = RecordingBus(
        {
            "ok": True,
            "done": "none",
            "error": "Dwell time is already 1.5s, the longest.",
        }
    )
    tools, events = bus_tools(bus)
    with pytest.raises(ToolError, match="already 1.5s"):
        await tools.set_setting(None, "dwell_time", "longer")
    assert events[-1]["type"] == "action_error"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("title", "exe", "app"),
    [
        (
            "Lofi beats - YouTube - Google Chrome",
            "C:\\Program Files\\chrome.exe",
            "YouTube",
        ),
        (
            "Weather - Google Chrome",
            "C:\\Program Files\\Google\\chrome.exe",
            "the browser",
        ),
        ("Downloads", "C:\\Windows\\explorer.exe", "File Explorer"),
        ("", "C:\\Windows\\explorer.exe", "the desktop"),
        ("Untitled - Paint", "mspaint.exe", "the desktop"),
    ],
)
async def test_what_can_i_say_shows_phrases_for_the_app_in_front(title, exe, app):
    backend = FakeDesktop()
    backend.window_title = lambda _hwnd: title
    backend.window_exe = lambda _hwnd: exe
    tools, events = bus_tools(RecordingBus(), backend)
    line = await tools.what_can_i_say(None)
    card = events[-1]
    assert card["type"] == "help"
    assert card["app"] == app
    assert 4 < len(card["phrases"]) <= 10
    assert "Slower cursor" in card["phrases"]
    assert app in line and len(line) < 120
