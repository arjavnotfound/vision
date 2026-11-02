from types import SimpleNamespace

import pytest
from google.genai import types as genai_types
from livekit.agents import room_io

import agent as agent_module


class FakeRealtimeSession:
    def __init__(self, mutable: bool) -> None:
        self.realtime_model = SimpleNamespace(
            capabilities=SimpleNamespace(mutable_chat_context=mutable)
        )
        self.sent: list[object] = []

    def _send_client_event(self, event: object) -> None:
        self.sent.append(event)


class FakeSession:
    def __init__(self, rt: FakeRealtimeSession) -> None:
        self.current_agent = SimpleNamespace(realtime_llm_session=rt)
        self.interrupted = False

    async def interrupt(self) -> None:
        self.interrupted = True


@pytest.mark.asyncio
async def test_text_input_is_sent_as_realtime_input_for_gemini_live() -> None:
    rt = FakeRealtimeSession(mutable=False)
    sess = FakeSession(rt)

    await agent_module.text_input_cb(sess, room_io.TextInputEvent(text=" Open YouTube "))

    assert sess.interrupted
    assert len(rt.sent) == 1
    event = rt.sent[0]
    assert isinstance(event, genai_types.LiveClientRealtimeInput)
    assert event.text == "Open YouTube"


@pytest.mark.asyncio
async def test_blank_text_input_is_ignored() -> None:
    rt = FakeRealtimeSession(mutable=False)

    await agent_module.text_input_cb(FakeSession(rt), room_io.TextInputEvent(text="   "))

    assert rt.sent == []


@pytest.mark.asyncio
async def test_mutable_models_use_framework_default(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def fake_default(sess, ev) -> None:
        calls.append(ev.text)

    monkeypatch.setattr(room_io.types, "_default_text_input_cb", fake_default)
    rt = FakeRealtimeSession(mutable=True)

    await agent_module.text_input_cb(FakeSession(rt), room_io.TextInputEvent(text="hi"))

    assert calls == ["hi"]
    assert rt.sent == []
