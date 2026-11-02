import asyncio

import pytest
from livekit.agents.llm import ToolError

from browser import BrowserError
from tools import ActionGuard, BrowserTools, normalize_tool_arg


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


class FakeBrowser:
    """Records calls; stands in for BrowserManager without launching Chromium."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple]] = []
        self.fail_next = False
        self.in_flight = 0
        self.max_in_flight = 0

    async def _record(self, name: str, *args: object) -> dict[str, str]:
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            await asyncio.sleep(0.01)
            self.calls.append((name, args))
            if self.fail_next:
                self.fail_next = False
                raise BrowserError("boom")
            return {"url": f"https://{name}.test/", "title": name.title()}
        finally:
            self.in_flight -= 1

    async def open_url(self, url: str) -> dict[str, str]:
        return await self._record("open_url", url)

    async def scroll(self, direction: str) -> dict[str, str]:
        return await self._record("scroll", direction)

    async def click(self, target: str) -> dict[str, str]:
        return await self._record("click", target)


def _tools(clock: FakeClock | None = None) -> tuple[BrowserTools, FakeBrowser, list]:
    browser = FakeBrowser()
    events: list[dict] = []

    async def on_event(event: dict) -> None:
        events.append(event)

    guard = ActionGuard(clock=clock or FakeClock())
    return BrowserTools(browser, action_callback=on_event, guard=guard), browser, events


def test_normalize_tool_arg_collapses_equivalent_urls() -> None:
    assert normalize_tool_arg("YouTube") == normalize_tool_arg("https://www.youtube.com/")
    assert normalize_tool_arg("  Hello   World ") == "hello world"
    assert normalize_tool_arg("Down") == normalize_tool_arg("down")


@pytest.mark.asyncio
async def test_repeated_call_within_window_runs_once() -> None:
    clock = FakeClock()
    tools, browser, events = _tools(clock)

    async def open_youtube(url: str):
        return await tools._guarded(
            "open_url", "youtube.com", (url,), lambda: browser.open_url(url)
        )

    first = await open_youtube("youtube")
    clock.now += 1.5
    second = await open_youtube("https://www.youtube.com")

    assert browser.calls == [("open_url", ("youtube",))]
    assert second == first
    # Only one start/done pair: the duplicate is silent.
    assert [e["type"] for e in events] == ["action_start", "action_done"]


@pytest.mark.asyncio
async def test_same_call_after_window_runs_again() -> None:
    clock = FakeClock()
    tools, browser, _ = _tools(clock)

    await tools._guarded("scroll", "down", ("down",), lambda: browser.scroll("down"))
    clock.now += 3.5
    await tools._guarded("scroll", "down", ("down",), lambda: browser.scroll("down"))

    assert len(browser.calls) == 2


@pytest.mark.asyncio
async def test_different_args_are_not_deduped() -> None:
    tools, browser, _ = _tools()

    await tools._guarded("scroll", "down", ("down",), lambda: browser.scroll("down"))
    await tools._guarded("scroll", "up", ("up",), lambda: browser.scroll("up"))

    assert [c[1] for c in browser.calls] == [("down",), ("up",)]


@pytest.mark.asyncio
async def test_concurrent_duplicates_are_serialized_and_collapsed() -> None:
    tools, browser, events = _tools()

    async def call():
        return await tools._guarded(
            "click", "Go", ("Go",), lambda: browser.click("Go")
        )

    results = await asyncio.gather(call(), call(), call())

    assert browser.calls == [("click", ("Go",))]
    assert browser.max_in_flight == 1
    assert results[0] == results[1] == results[2]
    assert sum(e["type"] == "action_start" for e in events) == 1


@pytest.mark.asyncio
async def test_different_calls_never_overlap() -> None:
    tools, browser, _ = _tools()

    await asyncio.gather(
        tools._guarded("click", "A", ("A",), lambda: browser.click("A")),
        tools._guarded("click", "B", ("B",), lambda: browser.click("B")),
        tools._guarded("scroll", "down", ("down",), lambda: browser.scroll("down")),
    )

    assert len(browser.calls) == 3
    assert browser.max_in_flight == 1


@pytest.mark.asyncio
async def test_errors_are_not_cached_and_emit_action_error() -> None:
    tools, browser, events = _tools()
    browser.fail_next = True

    with pytest.raises(ToolError):
        await tools._guarded("click", "Go", ("Go",), lambda: browser.click("Go"))
    await tools._guarded("click", "Go", ("Go",), lambda: browser.click("Go"))

    assert len(browser.calls) == 2
    assert [e["type"] for e in events] == [
        "action_start",
        "action_error",
        "action_start",
        "action_done",
    ]
    assert events[1]["error"] == "boom"


@pytest.mark.asyncio
async def test_action_done_payload_is_small_and_complete() -> None:
    tools, browser, events = _tools()

    await tools._guarded(
        "open_url", "youtube.com", ("youtube",), lambda: browser.open_url("youtube")
    )

    done = events[-1]
    assert done["type"] == "action_done"
    assert done["action"] == "open_url"
    assert done["target"] == "youtube.com"
    assert done["url"] == "https://open_url.test/"
    assert done["title"] == "Open_Url"
    assert isinstance(done["ts"], int)
    assert set(done) <= {"type", "action", "target", "url", "title", "ts", "error"}


@pytest.mark.asyncio
async def test_silent_reads_emit_no_events() -> None:
    tools, browser, events = _tools()

    await tools._guarded(
        "read_page", "", (), lambda: browser.open_url("x"), notify=False
    )

    assert events == []
