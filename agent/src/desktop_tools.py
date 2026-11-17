"""Hands-free desktop tools: voice mouse, apps and windows, dictation, keys, and voice
control of VISION Face Control (over the VISION bus).

The head points, the voice acts: mouse tools act at the CURRENT cursor position.
Every call runs behind an ActionGuard (one at a time, identical repeats within 3 s run
once), so one spoken request is one action. Closing a window needs a spoken (or dwelled)
yes first, like consequential browser clicks.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

from livekit.agents import RunContext, function_tool
from livekit.agents.llm import ToolError

import desktop
import vision_bus
from intent_guard import IntentError, IntentGuard, NeedsConfirmationError
from tools import ActionCallback, ActionGuard, BrowserTools
from voice_settings import VOICES

DRAG_AUTO_RELEASE_SECONDS = 20.0
APP_WINDOW_WAIT_SECONDS = 4.0

# set_setting: the only VISION settings voice may change, and the words each accepts.
# Face Control checks every value again before it applies it (the same steppers as Settings).
SETTINGS = {
    "cursor_speed": {"faster", "slower"},
    "dwell_time": {"longer", "shorter"},
    "paused": {"on", "off"},
    "face_control": {"on", "off"},
    "volume": {"louder", "quieter"},
}
SETTING_ALIASES = {
    "speed": "cursor_speed", "cursor": "cursor_speed", "sensitivity": "cursor_speed",
    "dwell": "dwell_time", "pause": "paused", "tracking": "face_control",
}  # fmt: skip
SETTING_RANGES = {"cursor_speed": (1, 10), "volume": (10, 100)}

# "Vision, what can I say?": a few phrases for the app in front, then VISION's own.
GENERAL_PHRASES = ["Slower cursor", "Longer dwell", "Pause face control", "Quieter"]
APP_PHRASES = {
    "YouTube": [
        "Play or pause",
        "Next video",
        "Full screen",
        "Search YouTube for cats",
    ],
    "the browser": ["Open YouTube", "Search for the weather", "Scroll down", "Go back"],
    "File Explorer": ["Open Downloads", "Click Documents", "Go back", "Scroll down"],
    "the desktop": [
        "Open Chrome",
        "Open File Explorer",
        "What time is it",
        "Switch to Chrome",
    ],
}
BROWSER_EXES = {"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "chromium.exe"}


def app_in_front(title: str, exe: str) -> str:
    title = (title or "").lower()
    exe = (exe or "").lower().replace("/", "\\").rsplit("\\", 1)[-1]
    if "youtube" in title:
        return "YouTube"
    if exe in BROWSER_EXES:
        return "the browser"
    if exe == "explorer.exe" and title:
        return "File Explorer"
    return "the desktop"


def local_time_text(now: datetime | None = None) -> str:
    now = now or datetime.now().astimezone()
    return now.strftime(f"%A %d %B %Y, %H:%M local time ({now.tzname()}, UTC%z)")


class DesktopTools:
    def __init__(
        self,
        action_callback: ActionCallback | None = None,
        guard: ActionGuard | None = None,
        backend: Any = desktop,
        bus: Any = vision_bus,
        intent: IntentGuard | None = None,
    ) -> None:
        self.intent = intent or IntentGuard()
        self.action_callback = action_callback
        self.guard = guard or ActionGuard()
        self.backend = backend
        self.bus = bus
        self._pending_close: str | None = None
        self._confirmed_close: str | None = None
        self._pending_click: str | None = None
        self._confirmed_click: str | None = None
        self._drag_release: asyncio.TimerHandle | None = None

    # ------------------------------------------------------------ plumbing

    async def _emit(self, event: str, action: str, target: str, **extra: Any) -> None:
        if self.action_callback is None:
            return
        payload: dict[str, Any] = {
            "type": event,
            "action": action,
            "target": target[:160],
            "ts": int(time.time() * 1000),
        }
        for key, value in extra.items():
            if value:
                payload[key] = str(value)[:200]
        with contextlib.suppress(Exception):
            await self.action_callback(payload)

    async def _act(
        self,
        action: str,
        target: str,
        args: tuple[object, ...],
        call: Callable[[], Any],
        *,
        dedupe: bool = True,
        checked: bool = False,
    ) -> Any:
        """Run one blocking desktop call in a thread, with action_start/done/error events."""
        if not checked:
            self._check_clear()

        async def run() -> Any:
            await self._emit("action_start", action, target)
            try:
                result = await asyncio.to_thread(call)
            except (
                desktop.DesktopError,
                vision_bus.VisionBusError,
                ValueError,
                OSError,
            ) as exc:
                await self._emit("action_error", action, target, error=exc)
                raise ToolError(str(exc)) from exc
            await self._emit("action_done", action, target)
            return result if result is not None else f"Done: {action} {target}".strip()

        if not dedupe:
            return await run()
        result, _cached = await self.guard.run(action, args, run)
        return result

    def _check_clear(self) -> None:
        try:
            self.intent.check_action()
        except IntentError as exc:
            raise ToolError(str(exc)) from exc

    async def _vision(self, cmd: str, value: Any = None, label: str = "") -> str:
        target = label or cmd
        self._check_clear()

        async def run() -> str:
            await self._emit("action_start", "vision", target)
            try:
                reply = await self.bus.send_command(cmd, value)
            except vision_bus.VisionBusError as exc:
                await self._emit("action_error", "vision", target, error=exc)
                raise ToolError(str(exc)) from exc
            await self._emit("action_done", "vision", target)
            return f"Face control: {reply.get('done', cmd)}."

        result, _cached = await self.guard.run(f"vision:{cmd}", (value,), run)
        return result

    def release_all(self) -> None:
        """Shutdown failsafe: never leave a button held by a voice drag."""
        if self._drag_release:
            self._drag_release.cancel()
            self._drag_release = None
        with contextlib.suppress(Exception):
            self.backend.release_all()

    @property
    def tools(self) -> list:
        return [
            self.current_time,
            self.click_here,
            self.start_drag,
            self.drop,
            self.scroll_here,
            self.open_app,
            self.switch_to,
            self.click_by_name,
            self.minimize_window,
            self.maximize_window,
            self.close_window,
            self.confirm_close_window,
            self.dictate,
            self.press_keys,
            self.set_setting,
            self.what_can_i_say,
            self.confirm_click,
            self.recalibrate_face,
            self.show_face_control,
            self.retry_camera,
            self.change_click_mode,
            self.move_control,
            self.change_voice,
            self.change_language,
            self.quit_vision,
        ]

    # ------------------------------------------------------------ answers

    @function_tool()
    async def current_time(self, context: RunContext) -> str:
        """The local date, time, weekday and time zone on this computer. Use it for any
        question about the time, today's date or day. Opens nothing."""
        return local_time_text()

    # ------------------------------------------------------------ voice mouse

    @function_tool()
    async def click_here(self, context: RunContext, kind: str = "left") -> str:
        """Click the mouse wherever the cursor is now, anywhere on the desktop.

        The user points with their head and says "click", "double click" or "right click".
        Act immediately and silently.

        Args:
            kind: 'left', 'double' or 'right'.
        """
        kind = (kind or "left").strip().lower()
        if kind not in {"left", "double", "right"}:
            raise ToolError("Use left, double or right.")
        button = "right" if kind == "right" else "left"
        count = 2 if kind == "double" else 1
        return await self._act(
            "click", f"{kind} click", (kind,), lambda: self.backend.click(button, count)
        )

    @function_tool()
    async def start_drag(self, context: RunContext) -> str:
        """Press and hold the left mouse button at the cursor to start dragging.

        The user then moves the cursor with their head and says "drop". The button is
        released automatically after 20 seconds as a safety net.
        """
        result = await self._act("drag", "start drag", (), self.backend.mouse_down)
        loop = asyncio.get_running_loop()
        if self._drag_release:
            self._drag_release.cancel()
        self._drag_release = loop.call_later(
            DRAG_AUTO_RELEASE_SECONDS, self.release_all
        )
        return result

    @function_tool()
    async def drop(self, context: RunContext) -> str:
        """Release the held mouse button at the cursor (finishes a drag)."""
        if self._drag_release:
            self._drag_release.cancel()
            self._drag_release = None
        return await self._act("drag", "drop", (), self.backend.mouse_up)

    @function_tool()
    async def scroll_here(
        self, context: RunContext, direction: str, steps: int = 3
    ) -> str:
        """Scroll whatever is under the cursor, anywhere on the desktop. Act silently.

        Args:
            direction: 'up' or 'down'.
            steps: How far, 1 to 10 (about three lines each). Default 3.
        """
        direction = (direction or "").strip().lower()
        if direction not in {"up", "down"}:
            raise ToolError("Say up or down.")
        return await self._act(
            "scroll",
            direction,
            (direction, steps),
            lambda: self.backend.scroll(direction, steps),
        )

    # ------------------------------------------------------------ apps and windows

    @function_tool()
    async def open_app(self, context: RunContext, name: str) -> str:
        """Open a desktop app such as Notepad, Word, Calculator, Paint or File Explorer.

        Use this for apps on the computer, not for websites (use open_url for those).

        Args:
            name: The app's name, for example 'Notepad'.
        """
        name = (name or "").strip()
        if not name:
            raise ToolError("Which app?")
        try:
            self.intent.check_open(name)
        except NeedsConfirmationError:
            question = f"Open {name}?"
            await self._emit("confirm_request", "open", name, question=question)
            raise ToolError(
                f"Not opened: the request was not clearly to open {name!r} (it may have been "
                f"background noise). Ask the user: '{question}' Only after a clear yes, call "
                "confirm_open with the same name and try again. If no, do nothing."
            ) from None
        except IntentError as exc:
            raise ToolError(str(exc)) from exc

        def run() -> str:
            argv = self.backend.known_app(name)
            if argv:
                self.backend.launch(argv)
            else:
                self.backend.open_from_start_menu(name)
            # Wait for the window and focus it, so "open Notepad and type hello"
            # types into Notepad and not into whatever was in front before.
            deadline = time.monotonic() + APP_WINDOW_WAIT_SECONDS
            while time.monotonic() < deadline:
                match = self.backend.find_window(name)
                if match:
                    self.backend.focus_window(match[0])
                    fresh = desktop.new_document_combo(name, match[1])
                    if fresh:
                        self.backend.press_combo(fresh)
                        time.sleep(0.4)
                    return f"Opened {match[1]}."
                time.sleep(0.25)
            return f"Opened {name}."

        return await self._act("open_app", name, (name,), run, checked=True)

    @function_tool()
    async def switch_to(self, context: RunContext, app_or_window: str) -> str:
        """Bring an open window to the front, by app name or part of its title.

        Args:
            app_or_window: For example 'Notepad', 'YouTube' or 'Calculator'.
        """

        def run() -> str:
            match = self.backend.find_window(app_or_window)
            if not match:
                titles = [t for _h, t in self.backend.list_windows()[:6]]
                raise desktop.DesktopError(
                    f"No open window matches {app_or_window!r}. Open windows: {', '.join(titles) or 'none'}."
                )
            hwnd, title = match
            self.backend.focus_window(hwnd)
            return f"Switched to {title}."

        return await self._act("switch_to", app_or_window, (app_or_window,), run)

    @function_tool()
    async def click_by_name(self, context: RunContext, name: str) -> str:
        """Click a button, link, tab, menu item or list item by the words on it, in the
        current window of ANY app (desktop apps and browsers): "click Submit", "press
        Play", "open Downloads". Matches loosely and ignores case. Act straight away.
        If it fails, say the reason in a few words; when nothing matches say exactly
        "I can't find that." When several differently named controls match, ask which
        one, naming them.

        Args:
            name: The words on the control, for example 'Submit' or 'Downloads'.
        """
        spoken = (name or "").strip()
        if not spoken:
            raise ToolError("Say the name of the button to click.")
        if BrowserTools._requires_confirmation(spoken):
            if self._confirmed_click != spoken.casefold():
                self._pending_click = spoken.casefold()
                await self._emit(
                    "confirm_request", "click", spoken, question=f"{spoken}?"
                )
                raise ToolError(
                    f"Not clicked yet: {spoken!r} may send, buy, delete or post. Ask the "
                    "user to confirm, and after a clear yes call confirm_click, then retry."
                )
            self._confirmed_click = None

        def run() -> str:
            hwnd = self.backend.target_window()
            if hwnd is None:
                raise desktop.DesktopError(
                    "I can't find that. There is no open window."
                )
            best, others = self.backend.pick_control(
                spoken, self.backend.find_controls(hwnd)
            )
            if best is None:
                raise desktop.DesktopError("I can't find that.")
            if others:
                names = ", ".join(c.name for c in [best, *others][:4])
                raise desktop.DesktopError(
                    f"Not clicked yet: several match ({names}). Ask the user which one."
                )
            if not best.enabled:
                raise desktop.DesktopError(f"{best.name} is greyed out right now.")
            self.backend.press_control(hwnd, best)
            return f"Clicked {best.name}."

        return await self._act("click_by_name", spoken, (spoken.lower(),), run)

    def _window_command(self, label: str, command: int) -> Callable[[], str]:
        def run() -> str:
            hwnd = self.backend.target_window()
            if hwnd is None:
                raise desktop.DesktopError("There is no open window.")
            title = self.backend.window_title(hwnd)
            self.backend.show_window(hwnd, command)
            return f"{label} {title}."

        return run

    @function_tool()
    async def minimize_window(self, context: RunContext) -> str:
        """Minimise the current window (the app the user is working in, never VISION)."""
        return await self._act(
            "window",
            "minimise",
            (),
            self._window_command("Minimised", desktop.SW_MINIMIZE),
        )

    @function_tool()
    async def maximize_window(self, context: RunContext) -> str:
        """Maximise the current window."""
        return await self._act(
            "window",
            "maximise",
            (),
            self._window_command("Maximised", desktop.SW_MAXIMIZE),
        )

    @function_tool()
    async def close_window(self, context: RunContext) -> str:
        """Close the current window. ALWAYS needs the user's spoken or dwelled "yes" first.

        The first call does not close anything: it returns the window's title so you can ask
        "Close <title>? Unsaved work may be lost." After the user says yes, call
        confirm_close_window, then call close_window again.
        """
        hwnd = await asyncio.to_thread(self.backend.target_window)
        if hwnd is None:
            raise ToolError("There is no open window to close.")
        title = await asyncio.to_thread(self.backend.window_title, hwnd)
        if self._confirmed_close != title:
            self._pending_close = title
            await self._emit(
                "confirm_request", "close_window", title, question=f"Close {title}?"
            )
            raise ToolError(
                f"Not closed yet. Ask the user: 'Close {title}? Unsaved work may be lost.' Wait for yes."
            )
        self._confirmed_close = None
        self._pending_close = None

        def run() -> str:
            self.backend.close_window(hwnd)
            return f"Closed {title}."

        return await self._act("close_window", title, (title,), run, dedupe=False)

    @function_tool()
    async def confirm_click(self, context: RunContext) -> str:
        """Record that the user clearly said yes to the send / buy / delete / post click you
        asked about. Then call click_by_name again."""
        if not self._pending_click:
            raise ToolError("No click is waiting for confirmation.")
        self._confirmed_click, self._pending_click = self._pending_click, None
        return "The user confirmed. Call click_by_name again now."

    @function_tool()
    async def confirm_close_window(self, context: RunContext) -> str:
        """Record that the user clearly said yes to closing the window you asked about."""
        if not self._pending_close:
            raise ToolError("No window close is waiting for confirmation.")
        self._confirmed_close = self._pending_close
        return f"The user confirmed closing {self._pending_close!r}. Call close_window now."

    # ------------------------------------------------------------ typing and keys

    @function_tool()
    async def dictate(self, context: RunContext, text: str) -> str:
        """Type text into whatever app has focus (dictation), for example after "type: hello".

        Type exactly the words the user dictated, with normal capitalisation and punctuation.
        Use this for desktop apps (Notepad, Word, a chat box). For a field in the agent's own
        browser page, use type_text instead.

        Args:
            text: The text to type.
        """
        if not text:
            raise ToolError("Nothing to type.")

        def run() -> str:
            title = self.backend.ensure_user_focus()
            self.backend.type_text(text)
            return f"Typed into {title}."

        return await self._act("type", text[:40], (text,), run)

    @function_tool()
    async def press_keys(self, context: RunContext, combo: str) -> str:
        """Press a key or shortcut in the app that has focus, anywhere on the desktop.

        Examples: 'Enter', 'Tab', 'Escape', 'Backspace', 'Ctrl+S', 'Ctrl+Z', 'Alt+Tab',
        'Alt+F4' (closing: ask first), 'Win'. Act silently.

        Args:
            combo: Keys joined with '+'.
        """
        try:
            codes = desktop.parse_combo(combo)
        except ValueError as exc:
            raise ToolError(str(exc)) from exc
        if codes == desktop.parse_combo("alt+f4"):
            raise ToolError(
                "Alt+F4 closes the window. Use close_window so the user can confirm."
            )

        def run() -> str:
            self.backend.ensure_user_focus()
            self.backend.press_combo(codes)
            return f"Pressed {combo}."

        return await self._act("press_keys", combo, (combo,), run)

    # ------------------------------------------------------------ VISION itself

    @function_tool()
    async def set_setting(self, context: RunContext, name: str, value: str) -> str:
        """Change one VISION setting. Act silently; if it fails, say the reason once.

        Args:
            name: One of:
                'cursor_speed' ("slower cursor", "speed 3"): 'faster', 'slower' or 1-10.
                'dwell_time' (how long resting clicks, "longer dwell"): 'longer',
                    'shorter', or seconds 0.6-1.5.
                'paused' ("pause", "stop the cursor", "resume"): 'on' pauses, 'off' resumes.
                'face_control' ("face control off"): 'on' or 'off'.
                'volume' (VISION's voice, "quieter"): 'louder', 'quieter' or 10-100.
            value: The word or number, as above.
        """
        key = (name or "").strip().lower().replace("-", "_").replace(" ", "_")
        key = SETTING_ALIASES.get(key, key)
        if key not in SETTINGS:
            raise ToolError(
                "I can only change cursor speed, dwell time, pause, face control and volume."
            )
        label = key.replace("_", " ")
        text = str(value if value is not None else "").strip().lower()
        if key == "paused" and text in {"resume", "resumed", "start"}:
            text = "off"
        if text not in SETTINGS[key]:
            try:
                number = float(text.removesuffix("s").strip())
            except ValueError:
                number = None
            if key == "dwell_time":
                # Spoken in seconds; Face Control stores 100 ms steps.
                low, high = (
                    (0.6, 1.5) if number is not None and number < 10 else (600, 1500)
                )
            else:
                low, high = SETTING_RANGES.get(key, (None, None))
            if number is None or low is None:
                words = " or ".join(sorted(SETTINGS[key]))
                raise ToolError(f"For {label} say {words}.")
            if not low <= number <= high:
                raise ToolError(f"{label.capitalize()} goes from {low:g} to {high:g}.")
            text = f"{number:g}"
        if key == "paused":
            # Same command as F9 and the island menu.
            cmd = "pause" if text == "on" else "resume"
            return await self._vision(cmd, label=f"{cmd} tracking")
        return await self._vision(
            "set-setting", {"name": key, "value": text}, label=f"{label} {text}"
        )

    @function_tool()
    async def what_can_i_say(self, context: RunContext) -> str:
        """The user asks "what can I say?", "help" or "what can you do?": show the phrases
        for the app in front on VISION's island. Then say the short line this returns."""

        def front() -> str:
            hwnd = self.backend.target_window()
            if hwnd is None:
                return "the desktop"
            exe = getattr(self.backend, "window_exe", lambda _h: "")(hwnd)
            return app_in_front(self.backend.window_title(hwnd), exe)

        app = await asyncio.to_thread(front)
        phrases = APP_PHRASES[app] + GENERAL_PHRASES
        if self.action_callback is not None:
            card = {"type": "help", "app": app, "phrases": phrases}
            with contextlib.suppress(Exception):
                await self.action_callback({**card, "ts": int(time.time() * 1000)})
        first = " or ".join(p.lower() for p in APP_PHRASES[app][:2])
        return f"Say only: In {app} you can say {first}. More ideas are on the card."

    @function_tool()
    async def recalibrate_face(self, context: RunContext) -> str:
        """Run VISION's face calibration again (about a minute, guided on screen)."""
        return await self._vision("recalibrate", label="recalibrate")

    @function_tool()
    async def show_face_control(self, context: RunContext) -> str:
        """Bring back VISION's face control window when it is hidden or minimised
        ("show face control", "where is VISION", "open VISION")."""
        return await self._vision("show", label="show face control")

    @function_tool()
    async def retry_camera(self, context: RunContext) -> str:
        """Try to open the camera again now ("try the camera", "the camera is not
        working"). VISION also retries by itself every few seconds."""
        return await self._vision("retry-camera", label="try the camera")

    @function_tool()
    async def change_click_mode(self, context: RunContext, mode: str) -> str:
        """Change how the face clicks.

        Args:
            mode: 'wink' (wink to click), 'dwell' (rest the cursor to click) or 'mouth' (open mouth to click).
        """
        mode = (mode or "").strip().lower()
        if mode not in {"wink", "dwell", "mouth"}:
            raise ToolError("Use wink, dwell or mouth.")
        return await self._vision("click-mode", mode, label=f"{mode} click")

    @function_tool()
    async def move_control(self, context: RunContext, action: str, to: str) -> str:
        """Move one action to a different input, when the user asks or a gesture is not working.

        Args:
            action: 'right click', 'left click' or 'scroll'.
            to: Right click: 'wink' (right wink), 'brows' or 'voice'. Left click: 'wink'
                (left wink) or 'dwell'. Scroll: 'mouth' (open mouth + tilt head) or 'voice'.
        """
        action_key = {
            "right click": "rightClick",
            "left click": "leftClick",
            "click": "leftClick",
            "scroll": "scroll",
        }.get((action or "").strip().lower())
        wink = {"rightClick": "rightWink", "leftClick": "leftWink"}.get(
            action_key or ""
        )
        to_key = {
            "brows": "brow",
            "eyebrows": "brow",
            "brow": "brow",
            "voice": "voice",
            "dwell": "dwell",
            "wink": wink,
            "winking": wink,
            "mouth": "mouth",
        }.get((to or "").strip().lower())
        allowed = {
            "rightClick": {"rightWink", "brow", "voice"},
            "leftClick": {"leftWink", "dwell"},
            "scroll": {"mouth", "voice"},
        }
        if not action_key or not to_key or to_key not in allowed[action_key]:
            raise ToolError(
                "Right click: wink, brows or voice. Left click: wink or dwell. "
                "Scroll: mouth or voice."
            )
        return await self._vision(
            "remap", {"action": action_key, "to": to_key}, label=f"{action} to {to}"
        )

    @function_tool()
    async def change_voice(self, context: RunContext, voice: str) -> str:
        """Change VISION's speaking voice. It takes effect from the next conversation.

        Args:
            voice: One of Aoede (default), Puck, Charon, Kore, Fenrir, Leda, Orus, Zephyr,
                Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina,
                Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar,
                Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia,
                Sadaltager, Sulafat. If the user does not name one, pick a different one.
        """
        name = next(
            (v for v in VOICES if v.lower() == (voice or "").strip().lower()), None
        )
        if not name:
            raise ToolError("That voice does not exist. Pick one from the list.")
        await self._vision("voice-settings", {"voice": name}, label=f"voice {name}")
        return (
            f"Voice set to {name}. Tell the user it applies from the next conversation."
        )

    @function_tool()
    async def change_language(self, context: RunContext, language: str) -> str:
        """Change the language VISION replies in ("speak Hindi", "detect my language").
        It takes effect from the next conversation.

        Args:
            language: 'auto' (reply in whatever the user speaks, including Hinglish),
                'english' or 'hindi'.
        """
        code = {
            "auto": "auto", "detect": "auto", "automatic": "auto",
            "english": "en", "en": "en", "hindi": "hi", "hi": "hi",
        }.get((language or "").strip().lower())  # fmt: skip
        if not code:
            raise ToolError("Use auto, english or hindi.")
        await self._vision(
            "voice-settings", {"language": code}, label=f"language {code}"
        )
        return f"Language set to {language}. Tell the user it applies from the next conversation."

    @function_tool()
    async def quit_vision(self, context: RunContext) -> str:
        """Quit VISION completely (face control and voice). Only when the user asks to quit VISION.
        VISION then asks the user to confirm on screen; tell them to rest on Quit."""
        self.release_all()
        return await self._vision("quit", label="quit")
