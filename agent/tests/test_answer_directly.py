"""Simple things are answered without the browser: time through the local current_time
tool, sums from the model, apps only when asked, the web only for fresh information."""

import os
from datetime import datetime, timedelta, timezone

import pytest
from livekit.agents import AgentSession, inference

from agent import Assistant
from desktop_tools import local_time_text
from prompts import AGENT_INSTRUCTIONS

BROWSER_TOOLS = {
    "open_url", "search_the_web", "read_page", "inspect_page", "click",
    "type_text", "scroll", "press_key", "go_back", "take_screenshot",
}  # fmt: skip


def test_local_time_text_has_weekday_date_time_and_zone() -> None:
    ist = timezone(timedelta(hours=5, minutes=30), "IST")
    text = local_time_text(datetime(2026, 11, 18, 9, 5, tzinfo=ist))
    assert text == "Wednesday 18 November 2026, 09:05 local time (IST, UTC+0530)"


def test_answer_directly_rule_comes_before_the_browser_rules() -> None:
    assert AGENT_INSTRUCTIONS.index("# Answer directly") < AGENT_INSTRUCTIONS.index(
        "# Tools"
    )
    assert "call current_time" in AGENT_INSTRUCTIONS


def test_current_time_is_offered_to_the_model() -> None:
    names = [t.info.name for t in Assistant(llm_override=object()).tools]  # type: ignore[arg-type]
    assert "current_time" in names


# The routing checks run VISION's instructions and real tool schemas on a text model
# (the Live model cannot run text-only turns); every tool is mocked, nothing opens.
live = pytest.mark.skipif(
    not os.getenv("GOOGLE_API_KEY"), reason="needs keys (live LLM eval)"
)


def _llm():
    return inference.LLM(model="openai/gpt-4.1-mini")


def _mocks(calls: list[str]) -> dict:
    def record(name: str, result: str):
        async def mock() -> str:
            calls.append(name)
            return result

        return mock

    names = BROWSER_TOOLS | {"current_time", "open_app"}
    mocks = {n: record(n, "ok") for n in names}
    mocks["current_time"] = record("current_time", local_time_text())
    mocks["search_the_web"] = record(
        "search_the_web", "Delhi: 21 degrees Celsius, clear sky."
    )
    mocks["read_page"] = record("read_page", "Delhi: 21 degrees Celsius, clear sky.")
    return mocks


async def _calls_for(text: str) -> list[str]:
    from livekit.agents.voice.run_result import mock_tools

    calls: list[str] = []
    async with _llm() as model, AgentSession(llm=model) as session:
        await session.start(Assistant(llm_override=model))
        with mock_tools(Assistant, _mocks(calls)):
            result = await session.run(user_input=text)
            await result
    return calls


@live
async def test_time_uses_current_time_and_no_browser() -> None:
    calls = await _calls_for("What time is it?")
    assert "current_time" in calls
    assert not BROWSER_TOOLS & set(calls)


@live
async def test_sum_needs_no_tool() -> None:
    assert await _calls_for("What's 10 plus 10?") == []


@live
async def test_open_calculator_opens_the_app() -> None:
    calls = await _calls_for("Open Calculator.")
    assert calls == ["open_app"]


@live
async def test_weather_still_searches() -> None:
    calls = await _calls_for("What's the weather in Delhi?")
    assert "search_the_web" in calls
