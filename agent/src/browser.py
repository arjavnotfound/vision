from __future__ import annotations

import asyncio
import contextlib
import re
import sys
import time
import uuid
from typing import Literal
from urllib.parse import urlparse

from playwright.async_api import (
    Locator,
    Page,
    async_playwright,
)
from playwright.async_api import (
    TimeoutError as PlaywrightTimeoutError,
)


class BrowserError(Exception):
    """A user-facing browser operation failure."""


KNOWN_SITES: dict[str, str] = {
    "spotify": "https://open.spotify.com",
    "spotify web": "https://open.spotify.com",
    "open.spotify.com": "https://open.spotify.com",
    "youtube": "https://www.youtube.com",
    "youtube.com": "https://www.youtube.com",
    "google": "https://www.google.com",
    "google.com": "https://www.google.com",
    "gmail": "https://mail.google.com",
    "mail.google.com": "https://mail.google.com",
    "github": "https://github.com",
    "github.com": "https://github.com",
    "reddit": "https://www.reddit.com",
    "reddit.com": "https://www.reddit.com",
    "netflix": "https://www.netflix.com",
    "netflix.com": "https://www.netflix.com",
    "amazon": "https://www.amazon.com",
    "amazon.com": "https://www.amazon.com",
    "wikipedia": "https://www.wikipedia.org",
    "wikipedia.org": "https://www.wikipedia.org",
    "twitter": "https://x.com",
    "x": "https://x.com",
    "x.com": "https://x.com",
}

KNOWN_KEYS: dict[str, str] = {
    "enter": "Enter",
    "return": "Enter",
    "escape": "Escape",
    "esc": "Escape",
    "tab": "Tab",
    "backspace": "Backspace",
    "delete": "Delete",
    "del": "Delete",
    "space": "Space",
    "spacebar": "Space",
    "arrowup": "ArrowUp",
    "up": "ArrowUp",
    "arrowdown": "ArrowDown",
    "down": "ArrowDown",
    "arrowleft": "ArrowLeft",
    "left": "ArrowLeft",
    "arrowright": "ArrowRight",
    "right": "ArrowRight",
    "pagedown": "PageDown",
    "pageup": "PageUp",
    "home": "Home",
    "end": "End",
}


def normalize_target_url(url: str) -> str:
    cleaned = url.strip()
    lower = cleaned.lower()
    if lower in KNOWN_SITES:
        return KNOWN_SITES[lower]
    for site_key, site_url in KNOWN_SITES.items():
        if lower == site_key or lower.startswith(site_key + "/"):
            remainder = cleaned[len(site_key):]
            return site_url + remainder
    # A bare domain ("web.whatsapp.com", "wikipedia.org/wiki/Eye") gets https://.
    if "://" not in cleaned and re.match(r"^[\w-]+(\.[\w-]+)+(:\d+)?(/\S*)?$", cleaned):
        return "https://" + cleaned
    return cleaned


def normalize_key_stroke(key: str) -> str:
    key_clean = key.strip()
    if not key_clean:
        raise BrowserError("No keyboard key was specified.")

    parts = [p.strip() for p in key_clean.split("+")]
    norm_parts: list[str] = []
    for part in parts:
        p_lower = part.lower()
        if p_lower in {"ctrl", "control"}:
            norm_parts.append("Control")
        elif p_lower in {"alt", "option"}:
            norm_parts.append("Alt")
        elif p_lower == "shift":
            norm_parts.append("Shift")
        elif p_lower in {"meta", "cmd", "command", "win", "windows"}:
            norm_parts.append("Meta")
        elif p_lower in KNOWN_KEYS:
            norm_parts.append(KNOWN_KEYS[p_lower])
        elif len(part) == 1:
            norm_parts.append(part.lower() if len(parts) > 1 else part)
        else:
            # Capitalize standard key names like Enter, Escape
            norm_parts.append(part.capitalize())

    return "+".join(norm_parts)


def _focus_window_with_title(title: str, *, timeout_seconds: float = 2.0) -> bool:
    if sys.platform != "win32":
        return False

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    enum_windows_proc = ctypes.WINFUNCTYPE(
        wintypes.BOOL,
        wintypes.HWND,
        wintypes.LPARAM,
    )

    user32.EnumWindows.argtypes = [enum_windows_proc, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.c_void_p]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    user32.AttachThreadInput.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL
    kernel32.GetCurrentThreadId.restype = wintypes.DWORD

    def find_window() -> int | None:
        matches: list[int] = []

        @enum_windows_proc
        def collect_window(hwnd: int, _: int) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            if title in buffer.value:
                matches.append(hwnd)
                return False
            return True

        user32.EnumWindows(collect_window, 0)
        return matches[0] if matches else None

    deadline = time.monotonic() + timeout_seconds
    hwnd = find_window()
    while hwnd is None and time.monotonic() < deadline:
        time.sleep(0.05)
        hwnd = find_window()
    if hwnd is None:
        return False

    foreground = user32.GetForegroundWindow()
    current_thread = kernel32.GetCurrentThreadId()
    foreground_thread = user32.GetWindowThreadProcessId(foreground, None)
    attached = bool(
        foreground_thread
        and foreground_thread != current_thread
        and user32.AttachThreadInput(current_thread, foreground_thread, True)
    )
    try:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetWindowPos(
            hwnd,
            0,
            0,
            0,
            0,
            0,
            0x0001 | 0x0002 | 0x0040,  # NOSIZE | NOMOVE | SHOWWINDOW
        )
        return bool(user32.SetForegroundWindow(hwnd))
    finally:
        if attached:
            user32.AttachThreadInput(current_thread, foreground_thread, False)


async def _bring_page_window_to_front(page: Page) -> None:
    marker = f"VISION Browser {uuid.uuid4().hex}"
    original_title = ""
    title_changed = False
    try:
        original_title = await page.title()
        await page.evaluate("title => { document.title = title; }", marker)
        title_changed = True
        await page.bring_to_front()
        await asyncio.to_thread(_focus_window_with_title, marker)
    except Exception:
        # Foreground activation is best-effort and must not prevent browser use.
        return
    finally:
        if title_changed:
            with contextlib.suppress(Exception):
                await page.evaluate(
                    "title => { document.title = title; }",
                    original_title,
                )


def _same_destination(current: str, target: str) -> bool:
    try:
        cur, tgt = urlparse(current), urlparse(target)
    except ValueError:
        return False
    return (
        cur.netloc.removeprefix("www.") == tgt.netloc.removeprefix("www.")
        and cur.path.rstrip("/") == tgt.path.rstrip("/")
        and cur.query == tgt.query
    )


class BrowserManager:
    """Own one isolated, visible browser for a LiveKit room."""

    def __init__(self, *, headless: bool = False, timeout_ms: int = 15_000) -> None:
        self._headless = headless
        self._timeout_ms = timeout_ms
        self._playwright = None
        self._browser = None
        self._context = None
        self._page: Page | None = None
        self._lock = asyncio.Lock()
        self._start_lock = asyncio.Lock()

    async def start(self) -> None:
        async with self._start_lock:
            if self._page is not None and not self._page.is_closed():
                return
            if self._context is not None:
                # The user closed our tab (or it crashed): reuse the same context.
                try:
                    await self._adopt_page(await self._context.new_page())
                    return
                except Exception:
                    await self._shutdown()
            await self._launch()

    async def _launch(self) -> None:
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=self._headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-infobars",
            ],
            ignore_default_args=["--enable-automation"],
        )
        self._context = await self._browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        await self._context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            window.chrome = {
                runtime: {}
            };
        """)
        page = await self._context.new_page()
        # Ensure single controlled page: close unintended popups / background tabs
        self._context.on("page", self._handle_extra_page)
        await self._adopt_page(page)

    async def _adopt_page(self, page: Page) -> None:
        page.set_default_timeout(self._timeout_ms)
        self._page = page
        if not self._headless:
            await _bring_page_window_to_front(page)

    async def _handle_extra_page(self, new_page: Page) -> None:
        """Keep exactly one tab: popups are closed and the main page follows them."""
        try:
            if new_page == self._page or self._page is None or self._page.is_closed():
                return
            with contextlib.suppress(Exception):
                await new_page.wait_for_load_state("commit", timeout=3_000)
            popup_url = new_page.url
            await new_page.close()
            if popup_url.startswith(("http://", "https://")):
                await self._page.goto(popup_url, wait_until="domcontentloaded")
        except Exception:
            pass

    async def _shutdown(self) -> None:
        if self._context is not None:
            with contextlib.suppress(Exception):
                await self._context.close()
        if self._browser is not None:
            with contextlib.suppress(Exception):
                await self._browser.close()
        if self._playwright is not None:
            with contextlib.suppress(Exception):
                await self._playwright.stop()
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None

    async def close(self) -> None:
        """Tear down the browser. Only the session shutdown hook calls this."""
        async with self._lock:
            await self._shutdown()

    async def open_url(self, url: str) -> dict[str, str]:
        resolved_url = self._validate_url(url)
        page = await self._get_page()

        async with self._lock:
            # Page reuse: if already at the requested destination, avoid re-navigating.
            # The single persistent page is always navigated; no new tab is opened.
            # (Repeated identical calls are collapsed upstream by tools.ActionGuard.)
            if _same_destination(page.url, resolved_url):
                return {
                    "url": page.url,
                    "title": await page.title(),
                    "status": "already_open",
                }

            try:
                await page.goto(resolved_url, wait_until="domcontentloaded")

                # Anti-CAPTCHA presentation shield: If Google or any search engine
                # triggers a bot challenge or sorry/index page, instantly redirect to
                # clean search results so a CAPTCHA never interrupts a live presentation.
                if "google.com/sorry" in page.url or "captcha" in (await page.title()).lower():
                    from urllib.parse import parse_qs
                    from urllib.parse import urlparse as parse_url
                    parsed = parse_url(page.url)
                    query = None
                    qs = parse_qs(parsed.query)
                    if "continue" in qs:
                        cont_parsed = parse_url(qs["continue"][0])
                        query = parse_qs(cont_parsed.query).get("q", [None])[0]
                    if not query:
                        parsed_original = parse_url(resolved_url)
                        query = parse_qs(parsed_original.query).get("q", [None])[0]

                    if query:
                        fallback_url = f"https://www.bing.com/search?q={query}"
                        await page.goto(fallback_url, wait_until="domcontentloaded")

                return await self._page_summary(page)
            except PlaywrightTimeoutError as exc:
                raise BrowserError("The page took too long to load.") from exc
            except Exception as exc:
                raise BrowserError(f"I could not open that page: {exc}") from exc

    async def read_page(self, *, max_chars: int = 12_000) -> dict[str, str | bool]:
        page = await self._get_page()

        async with self._lock:
            try:
                text = await page.locator("body").inner_text(timeout=self._timeout_ms)
            except PlaywrightTimeoutError as exc:
                raise BrowserError(
                    "The page content was not available in time."
                ) from exc

            text = re.sub(r"\s+", " ", text).strip()
            truncated = len(text) > max_chars
            return {
                "url": page.url,
                "title": await page.title(),
                "text": text[:max_chars],
                "truncated": truncated,
            }

    async def inspect_page(self, *, max_chars: int = 8_000) -> dict[str, object]:
        """Return readable text plus a compact inventory of interactive elements."""
        page = await self._get_page()

        async with self._lock:
            try:
                text = await page.locator("body").inner_text(timeout=self._timeout_ms)
                elements = await page.locator(
                    "button, a, input, textarea, select, [role]"
                ).evaluate_all(
                    """elements => elements
                      .filter(element => {
                        const style = window.getComputedStyle(element);
                        return style.display !== 'none' && style.visibility !== 'hidden';
                      })
                      .slice(0, 80)
                      .map((element, index) => ({
                        index,
                        tag: element.tagName.toLowerCase(),
                        role: element.getAttribute('role') || '',
                        name: (element.getAttribute('aria-label') ||
                          element.getAttribute('title') ||
                          (element.labels && element.labels[0] && element.labels[0].innerText) ||
                          element.getAttribute('placeholder') ||
                          element.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
                        type: element.getAttribute('type') || '',
                      }))"""
                )
            except PlaywrightTimeoutError as exc:
                raise BrowserError("The page could not be inspected in time.") from exc

            text = re.sub(r"\s+", " ", text).strip()
            return {
                "url": page.url,
                "title": await page.title(),
                "text": text[:max_chars],
                "elements": elements,
            }

    async def go_back(self) -> dict[str, str]:
        page = await self._get_page()

        async with self._lock:
            try:
                await page.go_back(wait_until="domcontentloaded")
                return await self._page_summary(page)
            except PlaywrightTimeoutError as exc:
                raise BrowserError("The previous page took too long to load.") from exc
            except Exception as exc:
                raise BrowserError(f"I could not go back: {exc}") from exc

    async def take_screenshot(self) -> dict[str, str | int | bool]:
        page = await self._get_page()

        async with self._lock:
            try:
                image = await page.screenshot(type="png")
                return {
                    "captured": True,
                    "url": page.url,
                    "bytes": len(image),
                }
            except Exception as exc:
                raise BrowserError(f"I could not capture the page: {exc}") from exc

    async def click(self, target: str) -> dict[str, str]:
        page = await self._get_page()

        async with self._lock:
            locator = await self._resolve_target(page, target)
            try:
                await locator.click()
            except PlaywrightTimeoutError as exc:
                raise BrowserError(
                    f"The control {target!r} did not become clickable in time."
                ) from exc
            except Exception as exc:
                raise BrowserError(f"I could not click {target!r}: {exc}") from exc

            with contextlib.suppress(PlaywrightTimeoutError):
                await page.wait_for_load_state("domcontentloaded", timeout=5_000)

            return await self._page_summary(page)

    async def type_text(self, target: str, text: str) -> dict[str, str]:
        page = await self._get_page()

        async with self._lock:
            await page.bring_to_front()
            if not self._headless:
                await _bring_page_window_to_front(page)

            target_clean = (target or "").strip().lower()
            if not target_clean or target_clean in {"focused", "active", "cursor", "current"}:
                try:
                    await page.keyboard.type(text)
                    return {"target": "focused_element", "url": page.url}
                except Exception as exc:
                    raise BrowserError(f"I could not type into the active field: {exc}") from exc

            locator = await self._resolve_textbox(page, target)
            try:
                await locator.fill(text)
            except Exception:
                try:
                    await locator.click()
                    await page.keyboard.type(text)
                except Exception as exc:
                    raise BrowserError(f"I could not type into {target!r}: {exc}") from exc

            return {"target": target, "url": page.url}

    async def scroll(self, direction: Literal["up", "down"]) -> dict[str, str]:
        if direction not in {"up", "down"}:
            raise BrowserError("Scroll direction must be 'up' or 'down'.")

        page = await self._get_page()
        amount = -650 if direction == "up" else 650

        async with self._lock:
            await page.mouse.wheel(0, amount)
            return {"direction": direction, "url": page.url}

    async def press_key(self, key: str) -> dict[str, str]:
        normalized_key = normalize_key_stroke(key)
        page = await self._get_page()

        async with self._lock:
            await page.bring_to_front()
            if not self._headless:
                await _bring_page_window_to_front(page)

            try:
                await page.keyboard.press(normalized_key)
            except Exception as exc:
                raise BrowserError(f"I could not press the {key!r} key: {exc}") from exc

            return {"key": normalized_key, "url": page.url}

    async def _get_page(self) -> Page:
        if self._page is None or self._page.is_closed():
            await self.start()
        assert self._page is not None
        return self._page

    @classmethod
    def _validate_url(cls, url: str) -> str:
        resolved = normalize_target_url(url)
        parsed = urlparse(resolved.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise BrowserError("Only complete http or https URLs can be opened.")
        if parsed.username or parsed.password:
            raise BrowserError("URLs containing embedded credentials are not allowed.")
        return resolved

    @staticmethod
    async def _page_summary(page: Page) -> dict[str, str]:
        return {"url": page.url, "title": await page.title()}

    async def _resolve_target(self, page: Page, target: str) -> Locator:
        for role in ("button", "link", "tab", "menuitem", "checkbox", "radio"):
            locator = page.get_by_role(role, name=target, exact=True)
            if await locator.count():
                return locator.first

            locator = page.get_by_role(role, name=target, exact=False)
            if await locator.count():
                return locator.first

        locator = page.get_by_text(target, exact=True)
        if await locator.count():
            return locator.first

        locator = page.get_by_text(target, exact=False)
        if await locator.count():
            return locator.first

        raise BrowserError(f"I could not find a visible control named {target!r}.")

    async def _resolve_textbox(self, page: Page, target: str) -> Locator:
        for locator in (
            page.get_by_role("textbox", name=target, exact=True),
            page.get_by_role("textbox", name=target, exact=False),
            page.get_by_label(target, exact=True),
            page.get_by_label(target, exact=False),
            page.get_by_placeholder(target, exact=True),
            page.get_by_placeholder(target, exact=False),
        ):
            if await locator.count():
                return locator.first

        normalized_target = target.casefold()
        if any(
            word in normalized_target for word in ("search", "query", "input", "text")
        ):
            for selector in (
                "input[type='search']:visible",
                "input[aria-label*='search' i]:visible",
                "input[placeholder*='search' i]:visible",
                "textarea:visible",
                "input:visible",
            ):
                locator = page.locator(selector)
                if await locator.count():
                    return locator.first

        raise BrowserError(f"I could not find a text field named {target!r}.")
