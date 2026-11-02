"""Render a short preview of every Gemini voice into console/public/voices/<Voice>.wav.

Dev-only, run once (the files are committed, so previews work offline with no keys):

    cd agent && uv run python ../scripts/make-voice-previews.py

Needs GOOGLE_API_KEY (read from agent/.env.local). Gemini TTS uses the same voices as
Gemini Live.
"""

from __future__ import annotations

import os
import pathlib
import sys
import time
import wave

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent" / "src"))
from voice_settings import VOICES  # noqa: E402

TEXT = "Hi, I'm VISION. नमस्ते, मैं आपकी मदद कर सकता हूँ।"
MODEL = os.getenv("VISION_TTS_MODEL", "gemini-2.5-flash-preview-tts")
OUT = ROOT / "console" / "public" / "voices"


def main() -> None:
    load_dotenv(ROOT / "agent" / ".env.local")
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for voice in VOICES:
        target = OUT / f"{voice}.wav"
        if (only and voice not in only) or (not only and target.exists()):
            continue
        response = render(client, voice)
        pcm = response.candidates[0].content.parts[0].inline_data.data
        with wave.open(str(target), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(24000)
            out.writeframes(pcm)
        print(f"{voice}: {len(pcm) / 48000:.1f}s", flush=True)
        # Free tier: 3 TTS requests a minute.
        time.sleep(21)


def render(client: genai.Client, voice: str):
    for attempt in range(5):
        try:
            return client.models.generate_content(
                model=MODEL,
                contents=f"Say warmly and briefly: {TEXT}",
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=voice
                            )
                        )
                    ),
                ),
            )
        except errors.ClientError as exc:
            if exc.code != 429 or attempt == 4:
                raise
            time.sleep(30)
    raise RuntimeError("unreachable")


if __name__ == "__main__":
    main()
