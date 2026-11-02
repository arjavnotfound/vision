"""Client for the VISION bus: the localhost channel to VISION Face Control.

The launcher (C:\\VISION\\VISION.bat) sets ``VISION_BUS_PORT`` and ``VISION_BUS_TOKEN``
for every process it starts. Without them (for example ``run.bat`` on its own) the
VISION-control tools report that Face Control is not connected.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Any


class VisionBusError(Exception):
    pass


def bus_config() -> tuple[int, str] | None:
    port = os.getenv("VISION_BUS_PORT", "").strip()
    token = os.getenv("VISION_BUS_TOKEN", "").strip()
    if not port.isdigit() or not token:
        return None
    return int(port), token


def _post(
    port: int, token: str, path: str, payload: dict[str, Any], timeout: float
) -> dict[str, Any]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "x-vision-token": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8") or "{}")
        except ValueError:
            body = {}
        raise VisionBusError(body.get("error") or f"HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise VisionBusError("VISION Face Control is not reachable.") from exc


async def send_command(
    cmd: str, value: Any = None, timeout: float = 4.0
) -> dict[str, Any]:
    """Send one command to Face Control and return its reply (``{"ok": True, "done": ...}``)."""
    config = bus_config()
    if config is None:
        raise VisionBusError(
            "Face control is not connected (VISION was not started from VISION.bat)."
        )
    port, token = config
    payload: dict[str, Any] = {"cmd": cmd}
    if value is not None:
        payload["value"] = value
    reply = await asyncio.to_thread(_post, port, token, "/command", payload, timeout)
    if not reply.get("ok", False):
        raise VisionBusError(
            str(reply.get("error") or "Face control refused the command.")
        )
    if reply.get("error"):
        raise VisionBusError(str(reply["error"]))
    return reply
