# OmniPoint Bridge Daemons

Local WebSocket → OS HID translator. The web app runs vision in your browser
and sends gesture packets here; this daemon moves your real cursor.

Two bridges ship in this folder — pick **one**:

| Bridge                      | Platform              | Backend             | Recommended for          |
| --------------------------- | --------------------- | ------------------- | ------------------------ |
| `omnipoint_pyautogui.py` ✨ | Win / macOS / Linux   | PyAutoGUI           | **Most users**           |
| `omnipoint_bridge.py`       | Linux only            | evdev + `/dev/uinput` | Linux power users        |

Both speak the **same WebSocket protocol**, so the web app's bridge URL
(`ws://localhost:8765`) works against either one without changes.

---

## ✨ Cross-platform bridge (recommended)

Works on Windows, macOS, and Linux (X11). Single command to install.

```bash
cd bridge
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
python omnipoint_pyautogui.py --host 127.0.0.1 --port 8765
```

Open the web app, head to `/demo`, set **Bridge URL** to
`ws://127.0.0.1:8765`, then **TEST BRIDGE**. Green LED = ready.

### LAN mode (control your PC from your phone)

Run the bridge on your PC bound to all interfaces:

```bash
python omnipoint_pyautogui.py --host 0.0.0.0 --port 8765
```

Then open the demo on your phone (same Wi-Fi):

```
http://<your-pc-lan-ip>:3000/demo
```

Set **Bridge URL** in the demo to `ws://<your-pc-lan-ip>:8765`. Your
phone's camera detects gestures, the bridge moves your PC cursor.

> **Browser quirk**: cameras only work on `http://localhost`, `https://`,
> or `http://<ip>` (most modern Chromium). If the page is HTTPS, the
> bridge URL must be `wss://` too — see SSH tunnel option in the demo.

### Platform notes

- **macOS** — grant your terminal app **Accessibility** + **Screen
  Recording** permission in System Settings → Privacy & Security.
- **Linux** — works on X11. PyAutoGUI does **not** support Wayland; if
  you're on Wayland, switch to an X11 session or use the evdev daemon
  below.
- **Windows** — works out of the box. Run as the same user that's logged
  into the desktop.

---

## Linux evdev daemon (legacy / power users)

Lower latency and Wayland-compatible (since uinput is below the display
server), but Linux-only and needs `sudo modprobe uinput` once per boot.

```bash
cd bridge
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

sudo modprobe uinput
python3 omnipoint_bridge.py --host 127.0.0.1 --port 8765
```

If the socket connects but the pointer does not move, verify
`ls -l /dev/uinput` and add your user to the `input` group.

---

## Autostart (Linux, systemd --user)

See `systemd/omnipoint-bridge.service`:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/omnipoint-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now omnipoint-bridge
```

## Protocol

JSON over WebSocket. See the docstring at the top of either bridge file
for the full packet spec.
