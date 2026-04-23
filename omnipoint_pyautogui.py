#!/usr/bin/env python3
"""
OmniPoint Bridge — Cross-Platform (PyAutoGUI)
=============================================
Drop-in replacement for omnipoint_bridge.py that runs on Windows, macOS,
and Linux (X11). Translates OmniPoint gesture packets into real OS mouse
and keyboard events using PyAutoGUI.

WebSocket protocol is identical to the Linux daemon, so the web app's
HIDBridge.ts works without any change. A plain WebSocket server is used
(no Socket.IO handshake needed) for max compatibility with browsers.

Quick start
-----------
    python -m pip install --no-cache-dir websockets pyautogui pillow
    # macOS users: also grant Terminal/iTerm "Accessibility" + "Screen Recording"
    # Linux users: install scrot + python3-tk + python3-dev (X11 only; Wayland not supported by PyAutoGUI)
    python omnipoint_pyautogui.py --host 0.0.0.0 --port 8765

LAN mode
--------
Pass --host 0.0.0.0 to accept connections from other devices on the same
local network. The web app on another device can then connect to
    ws://<your-pc-lan-ip>:8765
(see README — note that browsers on https:// pages cannot reach ws:// over
LAN due to mixed-content rules, so use http://<lan-ip>:3000 in dev).

Packet schema (same as the JS HIDBridge sends)
----------------------------------------------
    {"event": "motion", "data": {"x": 0..1, "y": 0..1, "pressure": 0..1, "gesture": "..."}}
    {"event": "subscribe", "channel": "motion"}
    {"type": "ping"}                       -> {"type": "pong"}
    {"type": "status"}                     -> {"type": "status", ...}
    {"event": "heartbeat", "type": "ping"} -> {"type": "pong"}
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import platform
import sys
import time
from http import HTTPStatus
from typing import Any

try:
    import websockets
except ImportError:
    sys.exit("Missing dependency: python -m pip install websockets")

try:
    import pyautogui
    pyautogui.FAILSAFE = False  # don't raise on corner-hit
    pyautogui.PAUSE = 0
    PYAUTOGUI_AVAILABLE = True
except Exception as exc:  # pragma: no cover — surfaced via /status
    print(f"[warn] PyAutoGUI unavailable: {exc}", file=sys.stderr)
    pyautogui = None  # type: ignore
    PYAUTOGUI_AVAILABLE = False

VERSION = "2.0.0-pyautogui"
log = logging.getLogger("omnipoint-pyautogui")


# ---------- Screen / session ----------------------------------------------------
def screen_size() -> tuple[int, int]:
    if PYAUTOGUI_AVAILABLE:
        try:
            w, h = pyautogui.size()
            return int(w), int(h)
        except Exception:
            pass
    return 1920, 1080


SCREEN_W, SCREEN_H = screen_size()


def session_info() -> dict[str, Any]:
    return {
        "platform": platform.system(),
        "release": platform.release(),
        "python": platform.python_version(),
        "pyautogui": PYAUTOGUI_AVAILABLE,
    }


# ---------- Mouse driver --------------------------------------------------------
class CrossPlatformMouse:
    """Thin wrapper around PyAutoGUI with click-state tracking + hysteresis."""

    def __init__(self) -> None:
        self.left_down = False
        self.last_click_ts = 0.0
        self.last_right_ts = 0.0
        self.click_cooldown = 0.18  # seconds between same-button clicks
        self.last_x = SCREEN_W // 2
        self.last_y = SCREEN_H // 2

    def move_abs(self, x_norm: float, y_norm: float) -> None:
        if not PYAUTOGUI_AVAILABLE:
            return
        x = int(max(0.0, min(1.0, x_norm)) * (SCREEN_W - 1))
        y = int(max(0.0, min(1.0, y_norm)) * (SCREEN_H - 1))
        if x == self.last_x and y == self.last_y:
            return
        try:
            pyautogui.moveTo(x, y, _pause=False)
        except Exception as exc:
            log.debug("moveTo failed: %s", exc)
            return
        self.last_x, self.last_y = x, y

    def left_click(self) -> None:
        now = time.monotonic()
        if now - self.last_click_ts < self.click_cooldown:
            return
        self.last_click_ts = now
        try:
            pyautogui.click(button="left", _pause=False)
        except Exception as exc:
            log.debug("click failed: %s", exc)

    def right_click(self) -> None:
        now = time.monotonic()
        if now - self.last_right_ts < self.click_cooldown * 2:
            return
        self.last_right_ts = now
        try:
            pyautogui.click(button="right", _pause=False)
        except Exception as exc:
            log.debug("right click failed: %s", exc)

    def button_down(self) -> None:
        if self.left_down or not PYAUTOGUI_AVAILABLE:
            return
        try:
            pyautogui.mouseDown(button="left", _pause=False)
            self.left_down = True
        except Exception as exc:
            log.debug("mouseDown failed: %s", exc)

    def button_up(self) -> None:
        if not self.left_down or not PYAUTOGUI_AVAILABLE:
            return
        try:
            pyautogui.mouseUp(button="left", _pause=False)
        finally:
            self.left_down = False

    def scroll(self, dy: int) -> None:
        if not PYAUTOGUI_AVAILABLE or dy == 0:
            return
        try:
            pyautogui.scroll(int(dy), _pause=False)
        except Exception as exc:
            log.debug("scroll failed: %s", exc)


mouse = CrossPlatformMouse()
log.info("Screen: %dx%d", SCREEN_W, SCREEN_H)


# ---------- Gesture state machine ----------------------------------------------
class GestureRouter:
    """Translate the high-level gesture stream into mouse actions."""

    def __init__(self) -> None:
        self.prev_gesture: str = "none"
        self.drag_active = False

    def handle(self, gesture: str) -> None:
        prev = self.prev_gesture
        self.prev_gesture = gesture

        # Edge-triggered actions (only on transition into the gesture)
        if gesture == "click" and prev != "click":
            mouse.left_click()
        elif gesture == "right_click" and prev != "right_click":
            mouse.right_click()
        elif gesture == "scroll_up":
            mouse.scroll(2)
        elif gesture == "scroll_down":
            mouse.scroll(-2)
        elif gesture == "drag":
            if not self.drag_active:
                mouse.button_down()
                self.drag_active = True
        else:
            # Any non-drag gesture releases the drag
            if self.drag_active:
                mouse.button_up()
                self.drag_active = False


router = GestureRouter()


# ---------- Status payload ------------------------------------------------------
def status_payload() -> dict[str, Any]:
    info = session_info()
    return {
        "type": "status",
        "version": VERSION,
        "ok": PYAUTOGUI_AVAILABLE,
        "evdev": False,        # for compat with the existing UI badges
        "uinput": PYAUTOGUI_AVAILABLE,  # advertise as ready when PyAutoGUI works
        "screen": {"w": SCREEN_W, "h": SCREEN_H},
        "platform": info["platform"],
        "session_type": info["platform"].lower(),
        "message": (
            f"PyAutoGUI bridge ready on {info['platform']}"
            if PYAUTOGUI_AVAILABLE
            else "PyAutoGUI not installed — run: pip install pyautogui pillow"
        ),
    }


# ---------- Packet handler ------------------------------------------------------
def handle_packet(pkt: dict[str, Any]) -> dict[str, Any] | None:
    t = pkt.get("type") or pkt.get("event")
    data = pkt.get("data") if isinstance(pkt.get("data"), dict) else pkt

    if t == "ping":
        return {"type": "pong", "timestamp": pkt.get("timestamp")}
    if t == "heartbeat":
        return {"type": "pong", "timestamp": pkt.get("timestamp")}
    if t == "status":
        return status_payload()
    if t == "subscribe":
        return {"type": "subscribed", "channel": pkt.get("channel", "motion")}

    if t in ("move", "motion"):
        try:
            x = float(data.get("x", 0.5))
            y = float(data.get("y", 0.5))
        except (TypeError, ValueError):
            return None
        mouse.move_abs(x, y)
        gesture = str(data.get("gesture", "none"))
        router.handle(gesture)
        return None

    if t == "click":
        button = str(data.get("button", "left"))
        if button == "right":
            mouse.right_click()
        else:
            mouse.left_click()
        return None
    if t == "down":
        mouse.button_down()
        return None
    if t == "up":
        mouse.button_up()
        return None
    if t == "scroll":
        try:
            dy = int(data.get("dy", 0))
        except (TypeError, ValueError):
            dy = 0
        mouse.scroll(dy)
        return None

    log.debug("Unknown packet: %r", pkt)
    return None


# ---------- WebSocket session ---------------------------------------------------
async def session(ws):
    peer = ws.remote_address
    log.info("Client connected: %s", peer)
    try:
        async for raw in ws:
            try:
                pkt = json.loads(raw)
            except json.JSONDecodeError:
                continue
            reply = handle_packet(pkt)
            if reply is not None:
                try:
                    await ws.send(json.dumps(reply))
                except Exception:
                    break
    except websockets.ConnectionClosed:
        pass
    finally:
        # Always release the mouse button if a drag was active
        mouse.button_up()
        log.info("Client disconnected: %s", peer)


async def http_status_handler(path: str, request_headers):
    """Serve GET /status as JSON on the same port (for browser fetch fallback)."""
    if path == "/status":
        body = json.dumps(status_payload()).encode("utf-8")
        return (
            HTTPStatus.OK,
            [
                ("Content-Type", "application/json"),
                ("Access-Control-Allow-Origin", "*"),
                ("Cache-Control", "no-store"),
                ("Content-Length", str(len(body))),
            ],
            body,
        )
    if path == "/":
        body = (
            f"OmniPoint PyAutoGUI bridge v{VERSION} running on "
            f"{platform.system()}. Connect via ws://<host>:<port>."
        ).encode("utf-8")
        return (
            HTTPStatus.OK,
            [("Content-Type", "text/plain"), ("Content-Length", str(len(body)))],
            body,
        )
    return None  # let websockets handle the upgrade


async def main_async(host: str, port: int) -> None:
    log.info("OmniPoint PyAutoGUI bridge listening on ws://%s:%d", host, port)
    log.info("Session: %s", session_info())
    if not PYAUTOGUI_AVAILABLE:
        log.warning("PyAutoGUI not available — packets will be accepted but no OS events emitted.")
    async with websockets.serve(session, host, port, process_request=http_status_handler):
        await asyncio.Future()


def main() -> None:
    p = argparse.ArgumentParser(description="OmniPoint cross-platform HID bridge (PyAutoGUI)")
    p.add_argument("--host", default="127.0.0.1",
                   help="Bind address. Use 0.0.0.0 to allow LAN connections.")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    try:
        asyncio.run(main_async(args.host, args.port))
    except KeyboardInterrupt:
        log.info("Shutting down.")


if __name__ == "__main__":
    main()
