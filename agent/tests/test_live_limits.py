"""Gemini Live limits: the realtime model keeps sessions within limits."""

from agent import Assistant


class _FakeBrowser:
    async def close(self) -> None:
        pass


def test_realtime_model_uses_context_compression(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    assistant = Assistant(browser=_FakeBrowser())
    assert assistant.llm._opts.context_window_compression.sliding_window is not None
