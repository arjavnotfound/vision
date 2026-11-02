import asyncio
import contextlib
import os
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlencode, urlparse

from livekit.agents import RunContext, function_tool
from livekit.agents.llm import ToolError

from browser import BrowserError, BrowserManager, normalize_target_url
from intent_guard import IntentError, IntentGuard, NeedsConfirmationError


def google_search_url(query: str) -> str:
    query = query.strip()
    if not query:
        raise ValueError("The search query cannot be empty.")
    return f"https://www.google.com/search?{urlencode({'q': query})}"


def bing_search_url(query: str) -> str:
    query = query.strip()
    if not query:
        raise ValueError("The search query cannot be empty.")
    return f"https://www.bing.com/search?{urlencode({'q': query})}"


def duckduckgo_search_url(query: str) -> str:
    query = query.strip()
    if not query:
        raise ValueError("The search query cannot be empty.")
    return f"https://duckduckgo.com/?{urlencode({'q': query})}"


def default_search_url(query: str) -> str:
    provider = os.getenv("VISION_SEARCH_PROVIDER", "bing").lower().strip()
    if provider == "google":
        return google_search_url(query)
    elif provider == "duckduckgo":
        return duckduckgo_search_url(query)
    return bing_search_url(query)


ActionEvent = dict[str, Any]
ActionCallback = Callable[[ActionEvent], Awaitable[None]]

DEDUPE_WINDOW_SECONDS = 3.0


def normalize_tool_arg(value: object) -> str:
    """Normalize a tool argument so trivially different repeats share a cache key."""
    text = re.sub(r"\s+", " ", str(value)).strip()
    if text.casefold() in {"", "none"}:
        return ""
    resolved = normalize_target_url(text)
    if resolved.startswith(("http://", "https://")):
        return resolved.casefold().rstrip("/")
    return text.casefold()


def url_domain(value: str) -> str:
    try:
        netloc = urlparse(value).netloc
    except ValueError:
        return ""
    return netloc.removeprefix("www.")


class ActionGuard:
    """Serialize browser tool calls and collapse identical repeats.

    Realtime models occasionally re-issue the exact same function call (for example
    after an interruption or a slow tool response). Without a guard that opened
    duplicate tabs or repeated clicks. Calls run one at a time, and the same call
    repeated within ``window_seconds`` returns the cached result without acting.
    Failed calls are never cached, so a retry after an error runs again.
    """

    def __init__(
        self,
        window_seconds: float = DEDUPE_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.window_seconds = window_seconds
        self._clock = clock
        self._lock = asyncio.Lock()
        self._recent: dict[tuple[str, tuple[str, ...]], tuple[float, Any]] = {}

    @staticmethod
    def key(tool: str, args: tuple[object, ...]) -> tuple[str, tuple[str, ...]]:
        return tool, tuple(normalize_tool_arg(arg) for arg in args)

    async def run(
        self,
        tool: str,
        args: tuple[object, ...],
        call: Callable[[], Awaitable[Any]],
    ) -> tuple[Any, bool]:
        """Run ``call`` under the lock. Returns ``(result, was_cached)``."""
        key = self.key(tool, args)
        async with self._lock:
            now = self._clock()
            self._recent = {
                k: v
                for k, v in self._recent.items()
                if now - v[0] < self.window_seconds
            }
            cached = self._recent.get(key)
            if cached is not None:
                return cached[1], True

            result = await call()
            self._recent[key] = (self._clock(), result)
            return result, False


class BrowserTools:
    def __init__(
        self,
        browser: BrowserManager,
        action_callback: ActionCallback | None = None,
        guard: ActionGuard | None = None,
        intent: IntentGuard | None = None,
    ) -> None:
        self.browser = browser
        self.action_callback = action_callback
        self.guard = guard or ActionGuard()
        # Noise guard, shared with the desktop tools (one per session).
        self.intent = intent or IntentGuard()
        self._confirmed_target: str | None = None

    async def _emit(self, event: str, action: str, target: str, **extra: Any) -> None:
        if self.action_callback is None:
            return
        payload: ActionEvent = {
            "type": event,
            "action": action,
            "target": target[:160],
            "ts": int(time.time() * 1000),
        }
        for key in ("url", "title", "error", "question"):
            value = extra.get(key)
            if value:
                payload[key] = str(value)[:200]
        with contextlib.suppress(Exception):
            await self.action_callback(payload)

    async def _guarded(
        self,
        action: str,
        target: str,
        args: tuple[object, ...],
        call: Callable[[], Awaitable[Any]],
        *,
        notify: bool = True,
        checked: bool = False,
    ) -> Any:
        """Run one browser call under the guard and publish lifecycle events.

        Reads (``notify=False``) are serialized and deduped but stay silent in the UI.
        Actions are refused when the latest speech was too short or unclear (noise).
        """
        # ``checked``: the stricter "open" check already passed for this request.
        if notify and not checked:
            try:
                self.intent.check_action()
            except IntentError as exc:
                raise ToolError(str(exc)) from exc

        async def _run() -> Any:
            if notify:
                await self._emit("action_start", action, target)
            try:
                result = await call()
            except (BrowserError, ValueError) as exc:
                if notify:
                    await self._emit("action_error", action, target, error=exc)
                raise ToolError(str(exc)) from exc
            if notify:
                info = result if isinstance(result, dict) else {}
                await self._emit(
                    "action_done",
                    action,
                    target,
                    url=info.get("url"),
                    title=info.get("title"),
                )
            return result

        result, _cached = await self.guard.run(action, args, _run)
        return result

    @property
    def tools(self) -> list:
        return [
            self.open_url,
            self.search_the_web,
            self.read_page,
            self.inspect_page,
            self.go_back,
            self.take_screenshot,
            self.click,
            self.confirm_browser_action,
            self.confirm_open,
            self.type_text,
            self.scroll,
            self.press_key,
        ]

    @function_tool()
    async def search_the_web(
        self,
        context: RunContext,
        query: str,
    ) -> dict[str, str]:
        """Open web search results in the agent-controlled browser.

        Use this only when the user needs a general internet search and did not name a
        website, service, or domain. If the user names a destination, open its official
        URL directly with open_url instead. Read or inspect the resulting page before
        answering the user.

        Args:
            query: A concise web search query containing all relevant context.
        """
        await self.require_clear_open(query, f"Search for {query}?")
        return await self._guarded(
            "search",
            query,
            (query,),
            lambda: self.browser.open_url(default_search_url(query)),
            checked=True,
        )

    @function_tool()
    async def open_url(self, context: RunContext, url: str) -> dict[str, str]:
        """Open a website or public webpage directly in the agent-controlled browser.

        Prefer this whenever the user names a website, service, or domain (such as
        Spotify, YouTube, Google, Gmail, GitHub, or any URL). Open it directly without
        searching Google.

        Args:
            url: The destination website name or full URL (e.g. 'https://open.spotify.com' or 'spotify').
        """
        target = url_domain(normalize_target_url(url)) or url
        await self.require_clear_open(target, f"Open {target}?")
        return await self._guarded(
            "open_url", target, (url,), lambda: self.browser.open_url(url), checked=True
        )

    @function_tool()
    async def read_page(self, context: RunContext) -> dict[str, str | bool]:
        """Read the visible text from the current browser page."""
        return await self._guarded(
            "read_page", "", (), self.browser.read_page, notify=False
        )

    @function_tool()
    async def inspect_page(self, context: RunContext) -> dict[str, object]:
        """Inspect the current page, including readable text and interactive element names.

        Use this before clicking or typing so you can choose a visible control by its
        returned name or role.
        """
        return await self._guarded(
            "inspect_page", "", (), self.browser.inspect_page, notify=False
        )

    @function_tool()
    async def go_back(self, context: RunContext) -> dict[str, str]:
        """Go back to the previous page in the agent-controlled browser."""
        return await self._guarded("go_back", "", (), self.browser.go_back)

    @function_tool()
    async def take_screenshot(self, context: RunContext) -> dict[str, str | int | bool]:
        """Capture the current browser page for diagnostics."""
        return await self._guarded(
            "take_screenshot", "", (), self.browser.take_screenshot, notify=False
        )

    @function_tool()
    async def click(self, context: RunContext, target: str) -> dict[str, str]:
        """Click a visible control by its accessible name.

        Execute simple tactical clicks directly and silently without verbal announcements.
        Only speak if an error occurs, if the target is missing, or if confirming consequential actions.

        Args:
            target: The visible or accessible name of the control to click.
        """
        if self._requires_confirmation(target):
            if self._confirmed_target != target.casefold():
                # The overlay shows Yes / No buttons, so the answer can be dwelled too.
                await self._emit("confirm_request", "click", target)
                raise ToolError(
                    f"This action may be consequential. Ask the user to confirm clicking {target!r} before retrying."
                )
            self._confirmed_target = None

        return await self._guarded(
            "click", target, (target,), lambda: self.browser.click(target)
        )

    @function_tool()
    async def confirm_browser_action(self, context: RunContext, target: str) -> str:
        """Authorize one previously discussed consequential browser click.

        Call this only after the user explicitly confirms the exact action.

        Args:
            target: The exact accessible name of the control the user approved.
        """
        self._confirmed_target = target.casefold()
        return f"The user confirmed clicking {target!r}."

    @function_tool()
    async def type_text(
        self,
        context: RunContext,
        target: str,
        text: str,
    ) -> dict[str, str]:
        """Fill a visible text field by its label, placeholder, or accessible name.

        Args:
            target: The label, placeholder, or accessible name of the text field.
            text: The text to enter.
        """
        return await self._guarded(
            "type",
            target,
            (target, text),
            lambda: self.browser.type_text(target, text),
        )

    @function_tool()
    async def scroll(self, context: RunContext, direction: str) -> dict[str, str]:
        """Scroll the current browser page up or down.

        Perform tactical scroll commands silently without verbal announcements (do not say
        'I have scrolled' or 'scrolling down'). Only speak if an error occurs or if the user
        specifically asks for clarification.

        Args:
            direction: Either 'up' or 'down'.
        """
        return await self._guarded(
            "scroll",
            direction,
            (direction,),
            lambda: self.browser.scroll(direction),  # type: ignore[arg-type]
        )

    @function_tool()
    async def press_key(self, context: RunContext, key: str) -> dict[str, str]:
        """Press a keyboard key or shortcut combination in the agent-controlled browser.

        Execute keypresses silently without verbal announcements.

        Args:
            key: Key name or combination (e.g., 'Enter', 'Escape', 'Tab', 'Backspace', 'Space',
                 'ArrowDown', 'ArrowUp', 'Control+a', 'Control+c', 'Control+v').
        """
        return await self._guarded(
            "press_key", key, (key,), lambda: self.browser.press_key(key)
        )

    async def require_clear_open(self, target: str, question: str) -> None:
        """Opening something new needs a clear request, or the user's yes first."""
        try:
            self.intent.check_open(target)
        except NeedsConfirmationError:
            await self._emit("confirm_request", "open", target, question=question)
            raise ToolError(
                f"Not opened: the request was not clearly to open {target!r} (it may have been "
                f"background noise). Ask the user: '{question}' Only after a clear yes, call "
                "confirm_open with the same target and try again. If no, do nothing."
            ) from None
        except IntentError as exc:
            raise ToolError(str(exc)) from exc

    @function_tool()
    async def confirm_open(self, context: RunContext, target: str) -> str:
        """Record the user's clear yes to opening a site, app or search you asked about.

        Args:
            target: Exactly the target you asked about (site, app name or search).
        """
        self.intent.confirm(target)
        return f"Confirmed. Now open {target!r}."

    @staticmethod
    def _requires_confirmation(target: str) -> bool:
        risky_words = {
            "buy",
            "confirm",
            "delete",
            "purchase",
            "remove",
            "send",
            "submit",
        }
        return bool(risky_words.intersection(target.casefold().split()))
