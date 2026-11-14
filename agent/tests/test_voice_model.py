"""Voice model setting and fallback: order, error mapping and the connect retry,
with mocked Gemini Live connection errors."""

import contextlib
import logging

import pytest
from google.genai import errors

from voice_model import (
    VOICE_MODELS,
    FallbackRealtimeModel,
    should_fall_back,
    voice_models,
)


def _api_error(code: int, message: str) -> errors.APIError:
    # What google-genai raises when Gemini Live closes the socket at setup.
    return errors.APIError(code, {"message": message, "status": None})


NOT_FOUND = _api_error(
    1008,
    "models/gemini-invalid-model is not found for API version v1beta, or is not "
    "supported for bidiGenerateContent.",
)
QUOTA = _api_error(
    1011, "You exceeded your current quota, please check your plan and billing details."
)
UNAVAILABLE = _api_error(1011, "The service is currently unavailable.")
BAD_KEY = _api_error(1007, "API key not valid. Please pass a valid API key.")
BAD_ARG = _api_error(1007, "Request contains an invalid argument.")


def test_models_come_from_env_in_order_without_repeats() -> None:
    assert voice_models("a, b,,a , c") == ["a", "b", "c"]


def test_models_default_when_unset() -> None:
    assert voice_models("") == list(VOICE_MODELS)
    assert len(VOICE_MODELS) >= 2


@pytest.mark.parametrize("error", [NOT_FOUND, QUOTA, UNAVAILABLE])
def test_missing_unavailable_and_quota_fall_back(error) -> None:
    assert should_fall_back(error)


@pytest.mark.parametrize("error", [BAD_KEY, BAD_ARG, RuntimeError("boom")])
def test_other_errors_do_not_fall_back(error) -> None:
    assert not should_fall_back(error)


def _fake_connect(failures: dict[str, Exception], calls: list[str]):
    @contextlib.asynccontextmanager
    async def connect(*, model, config):
        calls.append(model)
        if model in failures:
            raise failures[model]
        yield f"session:{model}"

    return connect


@pytest.fixture
def model(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    return lambda names: FallbackRealtimeModel(names)


async def test_falls_back_once_and_stays_on_the_working_model(model, caplog) -> None:
    m = model(["gemini-invalid-model", "gemini-3.8-live", "gemini-2.5-x"])
    calls: list[str] = []
    connect = m._connect_with_fallback(
        _fake_connect({"gemini-invalid-model": NOT_FOUND}, calls)
    )
    with caplog.at_level(logging.INFO, logger="vision.agent"):
        async with connect(model=m._opts.model, config=None) as session:
            assert session == "session:gemini-3.8-live"
    assert calls == ["gemini-invalid-model", "gemini-3.8-live"]
    assert m._opts.model == "gemini-3.8-live"
    assert "voice model in use: gemini-3.8-live" in caplog.text
    # A reconnect (GoAway resume) asks for the current model and goes straight to it.
    async with connect(model=m._opts.model, config=None) as session:
        assert session == "session:gemini-3.8-live"
    assert calls[-1] == "gemini-3.8-live" and len(calls) == 3


async def test_non_fallback_error_is_raised_without_trying_the_next(model) -> None:
    m = model(["gemini-3.8-live", "gemini-3.1-flash-live-preview"])
    calls: list[str] = []
    connect = m._connect_with_fallback(
        _fake_connect({"gemini-3.8-live": BAD_KEY}, calls)
    )
    with pytest.raises(errors.APIError):
        async with connect(model=m._opts.model, config=None):
            pass
    assert calls == ["gemini-3.8-live"]


async def test_total_failure_raises_the_last_error(model) -> None:
    m = model(["a-model", "b-model"])
    calls: list[str] = []
    connect = m._connect_with_fallback(
        _fake_connect({"a-model": QUOTA, "b-model": UNAVAILABLE}, calls)
    )
    with pytest.raises(errors.APIError, match="unavailable"):
        async with connect(model=m._opts.model, config=None):
            pass
    assert calls == ["a-model", "b-model"]


def test_chat_context_capability_follows_the_model(model) -> None:
    m = model(["gemini-3.8-live", "gemini-2.5-flash-native-audio-preview-12-2025"])
    assert not m.capabilities.mutable_chat_context
    m._use("gemini-2.5-flash-native-audio-preview-12-2025")
    assert m.capabilities.mutable_chat_context and m.capabilities.mutable_instructions
    assert m.model == "gemini-2.5-flash-native-audio-preview-12-2025"
