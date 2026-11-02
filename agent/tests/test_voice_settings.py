import json

from voice_settings import LANGUAGE_RULES, load_voice_settings


def write(tmp_path, data):
    path = tmp_path / "voice-settings.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


def test_defaults_to_aoede_and_auto(tmp_path, monkeypatch):
    monkeypatch.delenv("VISION_VOICE", raising=False)
    monkeypatch.delenv("VISION_LANGUAGE", raising=False)
    settings = load_voice_settings(str(tmp_path / "missing.json"))
    assert (settings.voice, settings.language) == ("Aoede", "auto")
    # Auto: no fixed language code, the model picks; the prompt says to mirror the user.
    assert settings.language_code is None
    assert "Hinglish" in settings.language_rule


def test_reads_the_app_settings_file(tmp_path):
    settings = load_voice_settings(write(tmp_path, {"voice": "puck", "language": "hi"}))
    assert settings.voice == "Puck"
    assert settings.language_code == "hi-IN"
    assert settings.language_rule == LANGUAGE_RULES["hi"]


def test_unknown_values_fall_back(tmp_path, monkeypatch):
    monkeypatch.delenv("VISION_VOICE", raising=False)
    monkeypatch.delenv("VISION_LANGUAGE", raising=False)
    settings = load_voice_settings(
        write(tmp_path, {"voice": "Robot", "language": "fr"})
    )
    assert (settings.voice, settings.language) == ("Aoede", "auto")


def test_old_env_variables_still_work(monkeypatch):
    monkeypatch.setenv("VISION_VOICE", "Kore")
    monkeypatch.setenv("VISION_LANGUAGE", "en-US")
    settings = load_voice_settings("")
    assert (settings.voice, settings.language) == ("Kore", "en")


def test_broken_file_is_ignored(tmp_path, monkeypatch):
    monkeypatch.delenv("VISION_VOICE", raising=False)
    path = tmp_path / "voice-settings.json"
    path.write_text("{not json", encoding="utf-8")
    assert load_voice_settings(str(path)).voice == "Aoede"
