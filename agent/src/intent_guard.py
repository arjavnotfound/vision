"""Noise guard: room noise must not turn into actions.

Gemini Live gives no confidence score, so the user's own transcript is the signal:

- Short speech (one or two words) that is not a known command ("click", "scroll down",
  "yes") cannot trigger any action: the agent asks the user to repeat.
- Opening a new site or app needs a clear request: an "open / go to / launch / visit /
  search / play ..." verb, or the target named in what the user said. Otherwise the user
  must say (or dwell) yes first; the agent then calls ``confirm_open``.

Typed text and Quick Commands are deliberate, so they always count as clear.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from urllib.parse import urlparse

OPEN_VERBS = re.compile(
    r"\b(open|opening|go to|goto|go on|launch|start|visit|navigate|take me|bring up|pull up|"
    r"show me|play|search|look up|google|find|watch|listen to|check)\b",
    re.IGNORECASE,
)

# One- or two-word commands that are fine on their own.
COMMAND_WORDS = {
    "click",
    "double",
    "right",
    "left",
    "drag",
    "drop",
    "release",
    "scroll",
    "up",
    "down",
    "enter",
    "tab",
    "escape",
    "back",
    "space",
    "delete",
    "backspace",
    "yes",
    "no",
    "yeah",
    "yep",
    "nope",
    "stop",
    "pause",
    "resume",
    "quit",
    "close",
    "minimise",
    "minimize",
    "maximise",
    "maximize",
    "undo",
    "copy",
    "paste",
    "save",
    "next",
    "previous",
    "home",
    "faster",
    "slower",
    "recalibrate",
    "type",
    "press",
    "select",
    "open",
    "play",
}

SHORT_WORDS = 2
RECENT_SECONDS = 20.0
# After "Hey Vision" whatever is said next (a follow-up such as "no" to "Save
# changes?") is meant for VISION, for this long.
WAKE_SECONDS = 15.0
# The wake phrase as Gemini transcribes it: "Hey Vision", "Hi Vision", "Hey Visions",
# "A Vision", "OK Vision". Accepted anywhere in the turn (narration can run into it).
WAKE = re.compile(r"\b(hey|hi|hay|a|ok|okay)[\s,.!-]*visions?\b", re.IGNORECASE)


def has_wake_word(text: str) -> bool:
    return bool(WAKE.search(text or ""))


# One question per request: a reply within this window answers it (never ask twice).
CONFIRM_SECONDS = 30.0
NEGATIVE = re.compile(
    r"\b(no|nope|don't|dont|do not|cancel|stop|never|not now)\b", re.IGNORECASE
)


class IntentError(Exception):
    """The request was not clear enough to act on."""


class NeedsConfirmationError(IntentError):
    def __init__(self, target: str) -> None:
        super().__init__(target)
        self.target = target


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", (text or "").lower())


def _stem(word: str) -> str:
    """'clicked' / 'clicking' / 'clicks' -> 'click' (transcripts often add endings)."""
    for suffix in ("ing", "ed", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


def target_words(target: str) -> list[str]:
    """'https://www.reddit.com/r/x' -> ['reddit']; 'Microsoft Word' -> ['microsoft', 'word']."""
    text = (target or "").strip().lower()
    if "://" in text or re.match(r"^[\w-]+(\.[\w-]+)+(/|$)", text):
        host = urlparse(text if "://" in text else f"https://{text}").netloc
        parts = [
            p
            for p in host.split(".")
            if p
            not in {"www", "com", "org", "net", "in", "co", "io", "app", "web", "m"}
        ]
        return parts[:2]
    return [w for w in _words(text) if len(w) > 2]


def _key(target: str) -> str:
    """Same key for 'reddit', 'reddit.com' and 'https://www.reddit.com/'."""
    return " ".join(target_words(target)) or (target or "").strip().lower()


class IntentGuard:
    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._clock = clock
        self._text = ""
        self._typed = False
        self._at = -1e9
        self._confirmed: set[str] = set()
        self._asked: dict[str, float] = {}
        self._wake_at = -1e9

    def note_user(self, text: str, *, typed: bool = False) -> None:
        text = (text or "").strip()
        if not text:
            return
        if not typed and has_wake_word(text):
            self._wake_at = self._clock()
        self._text = text
        self._typed = typed
        self._at = self._clock()

    def note_wake(self) -> None:
        """The wake word ("Hey Vision") was heard: the next words are intended."""
        self._wake_at = self._clock()

    def _after_wake(self) -> bool:
        return self._clock() - self._wake_at <= WAKE_SECONDS

    @property
    def last_utterance(self) -> str:
        return self._text

    def _recent(self) -> bool:
        return self._clock() - self._at <= RECENT_SECONDS

    def check_action(self) -> None:
        """Any action: refuse when the latest speech was a short non-command."""
        if not self._recent() or self._typed:
            return
        if self._after_wake():
            return
        words = _words(self._text)
        if 0 < len(words) <= SHORT_WORDS and not any(
            w in COMMAND_WORDS or _stem(w) in COMMAND_WORDS for w in words
        ):
            raise IntentError(
                f"Not clear enough to act on (heard only {self._text!r}). "
                "Do nothing; ask the user to say it again."
            )

    def check_open(self, target: str) -> None:
        """Opening a new site or app: needs a clear request, or a confirmed yes."""
        key = _key(target)
        if key in self._confirmed:
            self._confirmed.discard(key)
            self._asked.pop(key, None)
            return
        if self._recent() and self._typed:
            return
        if self._recent():
            words = _words(self._text)
            if OPEN_VERBS.search(self._text) and (
                len(words) >= 2 or self._after_wake()
            ):
                return
            if any(w in words for w in target_words(target)):
                return
        # Already asked about this target: the reply answers it. Never ask twice.
        asked = self._asked.get(key)
        now = self._clock()
        if asked is not None and now - asked <= CONFIRM_SECONDS:
            if self._at > asked and NEGATIVE.search(self._text):
                self._asked.pop(key, None)
                raise IntentError("The user said no. Do not open it.")
            self._asked.pop(key, None)
            return
        self._asked[key] = now
        raise NeedsConfirmationError(target)

    def confirm(self, target: str) -> None:
        self._confirmed.add(_key(target))
