"""Voice and language for the next voice session.

The VISION app owns ``voice-settings.json`` (path in ``VISION_SETTINGS_FILE``) and changes
it from Settings or from the voice tools. The agent reads it when each session starts,
so a change applies to the next session without restarting anything.

Language: Gemini's native-audio Live models pick the spoken language themselves and
switch mid-conversation; the system instruction is what steers the reply language.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

DEFAULT_VOICE = "Aoede"
VOICES = (
    "Aoede", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Zephyr",
    "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
    "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
    "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
    "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
)  # fmt: skip
LANGUAGES = ("auto", "en", "hi")

LANGUAGE_RULES = {
    "auto": (
        "\n# Language\n"
        "Understand English, Hindi and Hinglish (Hindi and English mixed). Reply in the "
        "language the user just spoke: Hindi to Hindi, English to English, Hinglish to "
        "natural Hinglish. Keep URLs, app names and search terms as the user meant them.\n"
    ),
    "en": (
        "\n# Language\n"
        "Always reply in English, even when the user speaks Hindi or Hinglish "
        "(you still understand them).\n"
    ),
    "hi": (
        "\n# Language\n"
        "Always reply in simple, everyday spoken Hindi, even when the user speaks English "
        "or Hinglish (you still understand them). Keep URLs, app names and search terms "
        "as they are.\n"
    ),
}
# Passed to the Live model only for a fixed language; Auto lets the model choose.
LANGUAGE_CODES = {"en": "en-US", "hi": "hi-IN"}


@dataclass(frozen=True)
class VoiceSettings:
    voice: str = DEFAULT_VOICE
    language: str = "auto"

    @property
    def language_rule(self) -> str:
        return LANGUAGE_RULES[self.language]

    @property
    def language_code(self) -> str | None:
        return LANGUAGE_CODES.get(self.language)


def _match_voice(name: str) -> str | None:
    wanted = (name or "").strip().lower()
    return next((v for v in VOICES if v.lower() == wanted), None)


def load_voice_settings(path: str | None = None) -> VoiceSettings:
    """The app's settings file; else the old VISION_VOICE / VISION_LANGUAGE variables."""
    path = path if path is not None else os.getenv("VISION_SETTINGS_FILE", "")
    data: dict = {}
    if path:
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            data = {}
    if not isinstance(data, dict):
        data = {}
    voice = _match_voice(str(data.get("voice") or os.getenv("VISION_VOICE", "")))
    language = str(data.get("language") or "").strip().lower()
    if language not in LANGUAGES:
        env_lang = os.getenv("VISION_LANGUAGE", "").strip().lower()
        language = {"en-us": "en", "en": "en", "hi-in": "hi", "hi": "hi"}.get(
            env_lang, "auto"
        )
    return VoiceSettings(voice=voice or DEFAULT_VOICE, language=language)
