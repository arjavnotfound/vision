"""Load livekit's local VAD / turn-detector models only when something uses them.

``livekit.agents`` imports ``livekit.local_inference`` at import time, and that native
module maps its models in straight away: about 700 MB resident in the always-running
agent process. VISION uses Gemini's own turn detection and no local VAD, so nothing in a
voice session needs them. This module puts a stand-in for ``livekit.local_inference``
in ``sys.modules`` that imports the real native module on first use. Import it before
anything from ``livekit.agents``.

shortcut: the two constants are copied from the native module's stub file; check them
when livekit-local-inference is upgraded (test_lazy_native compares them).
"""

import importlib
import importlib.util
import sys
import types

_NAME = "livekit.local_inference"


def _install() -> None:
    if _NAME in sys.modules:
        return
    spec = importlib.util.find_spec(_NAME)
    if spec is None or not spec.submodule_search_locations:
        return  # not installed: nothing to defer
    shim = types.ModuleType(_NAME)
    shim.__path__ = list(spec.submodule_search_locations)  # finds the real _native
    shim.__spec__ = spec

    def native():
        return importlib.import_module(_NAME + "._native")

    class _Deferred:
        def __new__(cls, *args, **kwargs):
            return getattr(native(), cls.__name__)(*args, **kwargs)

    shim.VAD = type("VAD", (_Deferred,), {})
    shim.EOT = type("EOT", (_Deferred,), {})
    shim.VAD_WINDOW_SAMPLES = 512
    shim.EOT_MAX_SAMPLES = 19200
    shim.init_vad = lambda: native().init_vad()
    shim.init_eot = lambda: native().init_eot()
    sys.modules[_NAME] = shim


_install()
