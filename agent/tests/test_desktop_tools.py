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
        assert "paused" in (await tools.pause_face_control(None)) or "pause" in (
            await tools.pause_face_control(None)
        )
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
            await tools2.resume_face_control(None)
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
