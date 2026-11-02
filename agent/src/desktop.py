"""Windows desktop input for VISION: mouse at the cursor, keys, typing, windows, apps.

Plain ``ctypes`` + ``user32`` (no extra packages). Everything here acts on the real
desktop, not only the Playwright browser. On other platforms every call raises
``DesktopError`` so the agent can say it is not available.
"""

from __future__ import annotations

import contextlib
import ctypes
import os
import re
import subprocess
import sys
import time
from ctypes import wintypes

IS_WINDOWS = sys.platform == "win32"


class DesktopError(Exception):
    pass


# ---------------------------------------------------------------- key names (pure)

VK = {
    "backspace": 0x08,
    "tab": 0x09,
    "enter": 0x0D,
    "return": 0x0D,
    "shift": 0x10,
    "ctrl": 0x11,
    "control": 0x11,
    "alt": 0x12,
    "pause": 0x13,
    "capslock": 0x14,
    "escape": 0x1B,
    "esc": 0x1B,
    "space": 0x20,
    "pageup": 0x21,
    "pagedown": 0x22,
    "end": 0x23,
    "home": 0x24,
    "left": 0x25,
    "up": 0x26,
    "right": 0x27,
    "down": 0x28,
    "printscreen": 0x2C,
    "insert": 0x2D,
    "delete": 0x2E,
    "del": 0x2E,
    "win": 0x5B,
    "windows": 0x5B,
    "super": 0x5B,
    "meta": 0x5B,
    "cmd": 0x5B,
    "f1": 0x70,
    "f2": 0x71,
    "f3": 0x72,
    "f4": 0x73,
    "f5": 0x74,
    "f6": 0x75,
    "f7": 0x76,
    "f8": 0x77,
    "f9": 0x78,
    "f10": 0x79,
    "f11": 0x7A,
    "f12": 0x7B,
}
ALIASES = {
    "arrowleft": "left",
    "arrowright": "right",
    "arrowup": "up",
    "arrowdown": "down",
    "page up": "pageup",
    "page down": "pagedown",
    "escape key": "escape",
    "enter key": "enter",
    "control key": "ctrl",
    "windows key": "win",
}
MODIFIERS = {0x10, 0x11, 0x12, 0x5B}
EXTENDED = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B}


def parse_combo(combo: str) -> list[int]:
    """'Ctrl+S' -> [VK_CONTROL, ord('S')]. Modifiers first, one main key at most."""
    text = (combo or "").strip().lower()
    if not text:
        raise ValueError("No key given.")
    text = ALIASES.get(text, text)
    parts = [p.strip() for p in re.split(r"\s*\+\s*|\s+plus\s+", text) if p.strip()]
    if len(parts) == 1 and " " in parts[0] and parts[0] not in VK:
        parts = parts[0].split()
    codes: list[int] = []
    for part in parts:
        part = ALIASES.get(part, part)
        if part in VK:
            code = VK[part]
        elif len(part) == 1 and (part.isalnum()):
            code = ord(part.upper())
        else:
            raise ValueError(f"Unknown key: {part!r}.")
        if code in codes:
            continue
        codes.append(code)
    mains = [c for c in codes if c not in MODIFIERS]
    if len(mains) > 1:
        raise ValueError(f"Press one key at a time, not {combo!r}.")
    return [c for c in codes if c in MODIFIERS] + mains


# Apps that open reliably by name without the Start menu.
KNOWN_APPS = {
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe"],
    "calc": ["calc.exe"],
    "paint": ["mspaint.exe"],
    "file explorer": ["explorer.exe"],
    "explorer": ["explorer.exe"],
    "files": ["explorer.exe"],
    "my computer": ["explorer.exe"],
    "this pc": ["explorer.exe"],
    "command prompt": ["cmd.exe", "/k"],
    "task manager": ["taskmgr.exe"],
    "settings": ["explorer.exe", "ms-settings:"],
    "word": ["cmd.exe", "/c", "start", "", "winword"],
    "microsoft word": ["cmd.exe", "/c", "start", "", "winword"],
    "excel": ["cmd.exe", "/c", "start", "", "excel"],
    "powerpoint": ["cmd.exe", "/c", "start", "", "powerpnt"],
    "wordpad": ["cmd.exe", "/c", "start", "", "wordpad"],
    "on-screen keyboard": ["osk.exe"],
    "on screen keyboard": ["osk.exe"],
    "keyboard": ["osk.exe"],
}


# After opening, start a blank document if the app restored old ones (Windows 11
# Notepad reopens previous tabs; dictation must never type into someone's file).
NEW_DOCUMENT = {"notepad": "ctrl+n", "notepad.exe": "ctrl+n"}


def new_document_combo(name: str, window_title: str) -> list[int] | None:
    key = re.sub(r"\s+", " ", (name or "").strip().lower()).removesuffix(" app")
    combo = NEW_DOCUMENT.get(key)
    if not combo or (window_title or "").lower().startswith("untitled"):
        return None
    return parse_combo(combo)


def known_app(name: str) -> list[str] | None:
    key = re.sub(r"\s+", " ", (name or "").strip().lower()).removesuffix(" app")
    return KNOWN_APPS.get(key)


# ---------------------------------------------------------------- Win32

if IS_WINDOWS:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    ULONG_PTR = ctypes.c_size_t

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = (
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        )

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = (
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        )

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = (
            ("uMsg", wintypes.DWORD),
            ("wParamL", wintypes.WORD),
            ("wParamH", wintypes.WORD),
        )

    class _INPUTUNION(ctypes.Union):
        _fields_ = (("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT))

    class INPUT(ctypes.Structure):
        _fields_ = (("type", wintypes.DWORD), ("u", _INPUTUNION))

    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.SendInput.restype = wintypes.UINT
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowTextLengthW.argtypes = (wintypes.HWND,)
    user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    user32.IsWindowVisible.argtypes = (wintypes.HWND,)
    user32.IsIconic.argtypes = (wintypes.HWND,)
    user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
    user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
    user32.GetWindowThreadProcessId.argtypes = (
        wintypes.HWND,
        ctypes.POINTER(wintypes.DWORD),
    )
    user32.PostMessageW.argtypes = (
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    )
    user32.GetWindowLongW.argtypes = (wintypes.HWND, ctypes.c_int)
    user32.GetAsyncKeyState.argtypes = (ctypes.c_int,)
    user32.GetAsyncKeyState.restype = ctypes.c_short
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = (WNDENUMPROC, wintypes.LPARAM)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.QueryFullProcessImageNameW.argtypes = (
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    )
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x0008, 0x0010
MOUSEEVENTF_WHEEL = 0x0800
KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE = 0x0001, 0x0002, 0x0004
WHEEL_DELTA = 120
SW_MINIMIZE, SW_MAXIMIZE, SW_RESTORE = 6, 3, 9
WM_CLOSE = 0x0010
GWL_EXSTYLE, WS_EX_TOOLWINDOW = -20, 0x00000080
VISION_EXES = {"electron.exe"}  # VISION's own windows (Face Control, the orb overlay)


def _require_windows() -> None:
    if not IS_WINDOWS:
        raise DesktopError("Desktop control only works on Windows.")


def _send(inputs: list) -> None:
    array = (INPUT * len(inputs))(*inputs)
    sent = user32.SendInput(len(inputs), array, ctypes.sizeof(INPUT))
    if sent != len(inputs):
        raise DesktopError("Windows blocked the input (a system dialog may be open).")


def _mouse(flags: int, data: int = 0):
    return INPUT(
        type=INPUT_MOUSE,
        u=_INPUTUNION(
            mi=MOUSEINPUT(0, 0, ctypes.c_ulong(data & 0xFFFFFFFF).value, flags, 0, 0)
        ),
    )


def _key(vk: int, up: bool = False):
    flags = (KEYEVENTF_KEYUP if up else 0) | (
        KEYEVENTF_EXTENDEDKEY if vk in EXTENDED else 0
    )
    return INPUT(type=INPUT_KEYBOARD, u=_INPUTUNION(ki=KEYBDINPUT(vk, 0, flags, 0, 0)))


def _unicode(ch_code: int, up: bool = False):
    return INPUT(
        type=INPUT_KEYBOARD,
        u=_INPUTUNION(
            ki=KEYBDINPUT(
                0, ch_code, KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0), 0, 0
            )
        ),
    )


# ---- mouse (always at the current cursor position: the head points, the voice acts)

_held: dict[str, bool] = {"left": False}


def click(button: str = "left", count: int = 1) -> None:
    _require_windows()
    down, up = (
        (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
        if button == "right"
        else (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
    )
    for i in range(count):
        _send([_mouse(down), _mouse(up)])
        if i + 1 < count:
            time.sleep(0.06)


def mouse_down() -> None:
    _require_windows()
    _send([_mouse(MOUSEEVENTF_LEFTDOWN)])
    _held["left"] = True


def mouse_up() -> None:
    _require_windows()
    _send([_mouse(MOUSEEVENTF_LEFTUP)])
    _held["left"] = False


def is_holding() -> bool:
    return _held["left"]


def release_all() -> None:
    """Failsafe: let go of any button VISION's voice pressed (or that is stuck down)."""
    if not IS_WINDOWS:
        return
    for vk, flag in ((0x01, MOUSEEVENTF_LEFTUP), (0x02, MOUSEEVENTF_RIGHTUP)):
        if (vk == 0x01 and _held.get("left")) or user32.GetAsyncKeyState(vk) & 0x8000:
            with contextlib.suppress(DesktopError):
                _send([_mouse(flag)])
    _held["left"] = False


def scroll(direction: str, steps: int = 3) -> None:
    _require_windows()
    steps = max(1, min(int(steps), 15))
    amount = WHEEL_DELTA * steps * (1 if direction == "up" else -1)
    _send([_mouse(MOUSEEVENTF_WHEEL, amount)])


# ---- keyboard


def press_combo(codes: list[int]) -> None:
    _require_windows()
    events = [_key(c) for c in codes] + [_key(c, up=True) for c in reversed(codes)]
    _send(events)


def type_text(text: str) -> None:
    _require_windows()
    # One character per SendInput with a short gap: Windows 11 Notepad (and other
    # WinUI apps) garble bursts of unicode key events (seen: "hello NNNNNNNNNNN").
    for ch in text.replace("\r\n", "\n"):
        if ch == "\n":
            _send([_key(0x0D), _key(0x0D, up=True)])
        else:
            data = ch.encode("utf-16-le")
            events = []
            for i in range(0, len(data), 2):
                code = int.from_bytes(data[i : i + 2], "little")
                events += [_unicode(code), _unicode(code, up=True)]
            _send(events)
        time.sleep(0.012)


# ---- windows


def window_title(hwnd) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def window_exe(hwnd) -> str:
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    handle = kernel32.OpenProcess(
        0x1000, False, pid.value
    )  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(1024)
        buffer = ctypes.create_unicode_buffer(size.value)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return os.path.basename(buffer.value).lower()
        return ""
    finally:
        kernel32.CloseHandle(handle)


def is_vision_window(hwnd) -> bool:
    return window_exe(hwnd) in VISION_EXES


def list_windows() -> list[tuple[int, str]]:
    """Visible top-level app windows, front to back, excluding VISION's own."""
    _require_windows()
    found: list[tuple[int, str]] = []

    def callback(hwnd, _lparam):
        if (
            user32.IsWindowVisible(hwnd)
            and not user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW
        ):
            title = window_title(hwnd)
            if (
                title
                and title not in {"Program Manager", "Windows Input Experience"}
                and not is_vision_window(hwnd)
            ):
                found.append((hwnd, title))
        return True

    user32.EnumWindows(WNDENUMPROC(callback), 0)
    return found


def focus_window(hwnd) -> bool:
    _require_windows()
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.08)
    if user32.GetForegroundWindow() == hwnd:
        return True
    # Windows may refuse to hand over focus; a tap of Alt unlocks it. Only as a
    # fallback: the Alt tap also shows menu key-tips in the app that had focus.
    _send([_key(0x12), _key(0x12, up=True)])
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.12)
    return user32.GetForegroundWindow() == hwnd


def target_window():
    """The window the user means: the foreground one, unless that is VISION itself
    (dwelling on the orb focuses it), then the next app window behind it."""
    _require_windows()
    hwnd = user32.GetForegroundWindow()
    if hwnd and not is_vision_window(hwnd) and window_title(hwnd):
        return hwnd
    windows = list_windows()
    return windows[0][0] if windows else None


def ensure_user_focus() -> str:
    """Before typing or pressing keys: make sure keys go to the user's app, not VISION."""
    hwnd = target_window()
    if hwnd is None:
        raise DesktopError("There is no open window to type into.")
    if user32.GetForegroundWindow() != hwnd:
        focus_window(hwnd)
    return window_title(hwnd)


def find_window(name: str):
    needle = (name or "").strip().lower()
    if not needle:
        return None
    windows = list_windows()
    for hwnd, title in windows:
        if title.lower() == needle:
            return hwnd, title
    for hwnd, title in windows:
        if needle in title.lower():
            return hwnd, title
    words = needle.split()
    for hwnd, title in windows:
        if all(w in title.lower() for w in words):
            return hwnd, title
    return None


def show_window(hwnd, command: int) -> None:
    user32.ShowWindow(hwnd, command)


def close_window(hwnd) -> None:
    user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)


def launch(argv: list[str]) -> None:
    flags = (
        getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if argv[0].lower() == "cmd.exe" and "/k" not in argv
        else 0
    )
    subprocess.Popen(argv, close_fds=True, creationflags=flags)


def open_from_start_menu(name: str) -> None:
    """Win key, type the name, Enter."""
    press_combo([VK["win"]])
    time.sleep(0.6)
    type_text(name)
    time.sleep(0.9)
    press_combo([VK["enter"]])
