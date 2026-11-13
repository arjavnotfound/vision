import subprocess
import sys

# Fresh interpreters: the shim only matters before livekit is first imported.


def _run(code: str) -> str:
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        check=True,
        cwd="src",
    ).stdout.strip()


def test_agent_import_does_not_load_local_models():
    out = _run(
        "import sys, agent; print('livekit.local_inference._native' in sys.modules)"
    )
    assert out.endswith("False")


def test_deferred_models_still_load_on_use():
    out = _run(
        "import lazy_native, importlib\n"
        "from livekit.local_inference import VAD, VAD_WINDOW_SAMPLES, EOT_MAX_SAMPLES\n"
        "native = importlib.import_module('livekit.local_inference._native')\n"
        "assert (VAD_WINDOW_SAMPLES, EOT_MAX_SAMPLES) == "
        "(native.VAD_WINDOW_SAMPLES, native.EOT_MAX_SAMPLES)\n"
        "print(type(VAD()).__module__)"
    )
    assert out.endswith("_native")
