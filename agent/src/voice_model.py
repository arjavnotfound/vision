"""Which Gemini Live model the voice runs on, and the fallback when one is unavailable.

The ordered list comes from ``VISION_VOICE_MODELS`` (comma separated) or ``VOICE_MODELS``.
When opening a session fails because a model is missing, unavailable or out of quota,
the session moves on to the next model in the list and stays on it. Any other error
(bad key, bad request) is the same on every model and is raised as before.
"""

from __future__ import annotations

import contextlib
import dataclasses
import logging
import os

from livekit.plugins import google

logger = logging.getLogger("vision.agent")

# Measured in T07 (vision-dev/reports/T07-report.md): the GA model, then the preview it
# replaced, then the older 2.5 family in case the whole 3.x family is down.
VOICE_MODELS = (
    "gemini-3.8-live",
    "gemini-3.1-flash-live-preview",
    "gemini-2.5-flash-native-audio-preview-12-2025",
)

# Lower-case pieces of the errors Gemini Live gives at setup for each case.
_FALLBACK_SIGNS = (
    "not found",  # 1008 "models/x is not found for API version v1beta"
    "not_found",
    "is not supported",  # "... or is not supported for bidiGenerateContent"
    "unavailable",  # 1011/503 "The service is currently unavailable"
    "overloaded",
    "quota",  # 1011 "You exceeded your current quota"
    "resource_exhausted",
    "rate limit",
)
_FALLBACK_CODES = {404, 429, 503}


def voice_models(env: str | None = None) -> list[str]:
    raw = os.getenv("VISION_VOICE_MODELS", "") if env is None else env
    names = [n.strip() for n in raw.split(",") if n.strip()]
    return list(dict.fromkeys(names)) or list(VOICE_MODELS)


def should_fall_back(error: BaseException) -> bool:
    """True for errors that another model may not have: missing, unavailable, quota."""
    if getattr(error, "code", None) in _FALLBACK_CODES:
        return True
    text = str(error).lower()
    if "api key" in text:  # a bad key fails on every model
        return False
    return any(sign in text for sign in _FALLBACK_SIGNS)


def mutable_context(model: str) -> bool:
    # The 3.x Live models (3.1 preview, 3.8) accept no chat or instruction edits
    # mid-session; the plugin only knows the "3.1" name. Only 2.5 is mutable.
    return "2.5" in model


class FallbackRealtimeModel(google.realtime.RealtimeModel):
    """Gemini Live with an ordered list of models: on a fallback error at connect,
    retry once on the next model."""

    def __init__(self, models: list[str], **kwargs) -> None:
        if not models:
            raise ValueError("at least one voice model is needed")
        super().__init__(model=models[0], **kwargs)
        self.models = list(models)
        self._use(models[0])

    def _use(self, name: str) -> None:
        self._opts.model = name
        mutable = mutable_context(name)
        self._capabilities = dataclasses.replace(
            self._capabilities,
            mutable_chat_context=mutable,
            mutable_instructions=mutable,
        )

    def session(self, **kwargs):
        sess = super().session(**kwargs)
        live = sess._client.aio.live
        live.connect = self._connect_with_fallback(live.connect)
        return sess

    def _connect_with_fallback(self, connect):
        @contextlib.asynccontextmanager
        async def fallback_connect(*, model: str, config):
            start = self.models.index(model) if model in self.models else 0
            names = self.models[start:] or [model]
            async with contextlib.AsyncExitStack() as stack:
                for i, name in enumerate(names):
                    try:
                        session = await stack.enter_async_context(
                            connect(model=name, config=config)
                        )
                    except Exception as error:
                        if i + 1 < len(names) and should_fall_back(error):
                            logger.warning(
                                "VISION voice model %s failed (%s); trying %s",
                                name,
                                str(error).splitlines()[0][:200],
                                names[i + 1],
                            )
                            continue
                        raise
                    if name != self._opts.model:
                        self._use(name)  # resumes and reconnects stay on it
                    logger.info("VISION voice model in use: %s", name)
                    break
                yield session

        return fallback_connect
