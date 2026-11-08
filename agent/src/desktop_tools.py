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
from typing import Any

from livekit.agents import RunContext, function_tool
from livekit.agents.llm import ToolError

import desktop
import vision_bus
from intent_guard import IntentError, IntentGuard, NeedsConfirmationError
from tools import ActionCallback, ActionGuard
from voice_settings import VOICES

DRAG_AUTO_RELEASE_SECONDS = 20.0
APP_WINDOW_WAIT_SECONDS = 4.0


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
            self.click_here,
            self.start_drag,
            self.drop,
            self.scroll_here,
            self.open_app,
            self.switch_to,
            self.minimize_window,
            self.maximize_window,
            self.close_window,
            self.confirm_close_window,
            self.dictate,
            self.press_keys,
            self.pause_face_control,
            self.resume_face_control,
            self.recalibrate_face,
            self.change_cursor_speed,
            self.change_click_mode,
            self.move_control,
            self.change_voice,
            self.change_language,
            self.quit_vision,
        ]

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
    async def pause_face_control(self, context: RunContext) -> str:
        """Pause head tracking (the cursor stops following the head). Same as F9."""
        return await self._vision("pause", label="pause tracking")

    @function_tool()
    async def resume_face_control(self, context: RunContext) -> str:
        """Resume head tracking."""
        return await self._vision("resume", label="resume tracking")

    @function_tool()
    async def recalibrate_face(self, context: RunContext) -> str:
        """Run VISION's face calibration again (about a minute, guided on screen)."""
        return await self._vision("recalibrate", label="recalibrate")

    @function_tool()
    async def change_cursor_speed(self, context: RunContext, direction: str) -> str:
        """Make the head-controlled cursor faster or slower.

        Args:
            direction: 'faster' or 'slower'.
        """
        direction = (direction or "").strip().lower()
        if direction not in {"faster", "slower"}:
            raise ToolError("Say faster or slower.")
        return await self._vision("speed", direction, label=f"cursor {direction}")

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
        """Quit VISION completely (face control and voice). Only when the user asks to quit VISION."""
        self.release_all()
        return await self._vision("quit", label="quit")
