# Wombot troubleshooting guide

This guide covers common problems with the Wombot Raspberry Pi deployment.

## Device and network assumptions

Examples assume:

- Raspberry Pi 4 Model B running Debian 13 (Trixie) / Raspberry Pi OS.
- Linux account `team_wombot` and repository `/home/team_wombot/DMMS-Wombot`.
- Wi-Fi interface `wlan0`; Ethernet interface `eth0`.
- Wi-Fi AP `Wombot`, address `10.42.0.1/24`.
- FastAPI/Uvicorn TCP port `8000`.
- MediaMTX RTSP TCP port `8554`.
- MediaMTX WebRTC TCP `8889`, UDP `8189`.
- USB camera usually `/dev/video0`.
- MediaMTX binary `/usr/local/bin/mediamtx`, config `/etc/mediamtx.yml`.

Adjust paths, usernames, interfaces and ports if your installation differs.

---

## 1. Start with a complete health check

```bash
echo "========== OS =========="
cat /etc/os-release | grep -E 'PRETTY_NAME|VERSION='
echo
echo "========== NETWORK =========="
ip -br addr
nmcli general status
nmcli device status
nmcli connection show --active
echo
echo "========== SERVICES =========="
sudo systemctl --no-pager --full status NetworkManager wombot mediamtx
echo
echo "========== LISTENING PORTS =========="
sudo ss -lntup | grep -E ':(8000|8554|8888|8889|8189)\b' || true
echo
echo "========== CAMERA DEVICES =========="
ls -l /dev/video* 2>/dev/null || true
echo
echo "========== BACKEND LOGS =========="
sudo journalctl -u wombot -n 50 --no-pager
echo
echo "========== MEDIAMTX LOGS =========="
sudo journalctl -u mediamtx -n 50 --no-pager
```

A healthy baseline should show `wlan0` with `10.42.0.1/24`, the `Wombot` connection active, both services running, Uvicorn listening on `8000`, MediaMTX listening on its configured ports, and a camera node when the USB camera is connected. Not every port must appear if its protocol is disabled; check the MediaMTX config and logs.

---

## 2. The Wombot Wi-Fi network does not appear

Check Wi-Fi state:

```bash
nmcli radio wifi
nmcli device status
ip link show wlan0
```

Enable Wi-Fi if needed:

```bash
sudo nmcli radio wifi on
```

Inspect the AP profile and active connections:

```bash
nmcli connection show Wombot
nmcli connection show --active
```

Activate it:

```bash
sudo nmcli connection up Wombot
```

This may interrupt SSH if you are connected through Wi-Fi. Prefer Ethernet or a local console when changing the AP.

Check important profile settings:

```bash
nmcli -f connection.id,connection.interface-name,connection.autoconnect,802-11-wireless.ssid,802-11-wireless.mode,802-11-wireless.band,ipv4.method,ipv4.addresses,ipv6.method connection show Wombot
```

Expected essentials: SSID `Wombot`, interface `wlan0`, mode `ap`, IPv4 method `shared`, address `10.42.0.1/24`, IPv6 method `disabled`.

If incorrect, inspect first, then correct:

```bash
sudo nmcli connection modify Wombot \
  connection.interface-name wlan0 \
  connection.autoconnect yes \
  802-11-wireless.ssid Wombot \
  802-11-wireless.mode ap \
  802-11-wireless.band bg \
  ipv4.method shared \
  ipv4.addresses 10.42.0.1/24 \
  ipv6.method disabled
sudo nmcli connection up Wombot
```

Avoid creating duplicate AP profiles with the same SSID.

---

## 3. Phone connects to Wombot but cannot open the control page

A phone may report “no internet”. That is normal for a standalone rover AP; local access should still work.

Confirm the phone gets an address in `10.42.0.0/24`, with gateway `10.42.0.1`.

On the Pi:

```bash
ip -br addr show wlan0
curl -v --max-time 5 http://127.0.0.1:8000/control
curl -v --max-time 5 http://10.42.0.1:8000/control
```

Check Uvicorn's bind address:

```bash
sudo systemctl cat wombot
sudo ss -lntp | grep ':8000'
```

Uvicorn should use `--host 0.0.0.0 --port 8000`. If it only binds to `127.0.0.1`, other devices cannot reach it.

Inspect logs and restart:

```bash
sudo journalctl -u wombot -n 100 --no-pager
sudo systemctl restart wombot
```

On the phone visit exactly:

```text
http://10.42.0.1:8000/control
```

If localhost works but the AP address does not, inspect addresses and firewall rules:

```bash
ip -br addr
sudo nft list ruleset
```

NetworkManager's `ipv4.method shared` configures DHCP/NAT and related firewall rules. Do not flush nftables or add broad accept rules as a first response.

---

## 4. FastAPI backend does not start

Check service state, logs and unit:

```bash
sudo systemctl status wombot --no-pager --full
sudo journalctl -u wombot -b --no-pager
sudo systemctl cat wombot
```

Check expected files:

```bash
ls -la /home/team_wombot/DMMS-Wombot/pi
ls -la /home/team_wombot/DMMS-Wombot/pi/backend
ls -la /home/team_wombot/DMMS-Wombot/pi/.venv/bin/uvicorn
```

The expected entry point is `pi/backend/main.py`, imported as `backend.main:app`. A typical unit section:

```ini
[Service]
User=team_wombot
Group=team_wombot
WorkingDirectory=/home/team_wombot/DMMS-Wombot/pi
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=/home/team_wombot/DMMS-Wombot/pi
ExecStart=/home/team_wombot/DMMS-Wombot/pi/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

If your entry point differs, adjust `ExecStart`.

To test manually, stop the service first to avoid a port conflict:

```bash
sudo systemctl stop wombot
cd /home/team_wombot/DMMS-Wombot/pi
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Stop with `Ctrl+C`, then:

```bash
sudo systemctl start wombot
```

Check packages and syntax:

```bash
cd /home/team_wombot/DMMS-Wombot/pi
.venv/bin/python -m pip list
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m compileall -q backend
```

After editing a unit file:

```bash
sudo systemctl daemon-reload
sudo systemctl restart wombot
```

---

## 5. MediaMTX does not start

Check status, logs, binary and config:

```bash
sudo systemctl status mediamtx --no-pager --full
sudo journalctl -u mediamtx -b --no-pager
sudo systemctl cat mediamtx
ls -l /usr/local/bin/mediamtx /etc/mediamtx.yml
```

To expose configuration errors, stop the service and run MediaMTX in the foreground:

```bash
sudo systemctl stop mediamtx
sudo /usr/local/bin/mediamtx /etc/mediamtx.yml
```

Stop with `Ctrl+C`, then:

```bash
sudo systemctl start mediamtx
```

Do not run the foreground process and systemd service simultaneously.

Check port conflicts:

```bash
sudo ss -lntup | grep -E ':(8554|8888|8889|8189)\b'
pgrep -a mediamtx
```

Do not kill processes blindly; identify which process owns the listener. MediaMTX config keys can change between releases. If logs report an unknown or invalid field, compare the config with documentation for the exact installed version.

---

## 6. USB camera is missing

```bash
ls -l /dev/video*
lsusb
```

If no video device appears, check the cable, power and USB port. Watch kernel messages while reconnecting:

```bash
sudo dmesg --follow
```

Stop with `Ctrl+C`. Install tools if needed:

```bash
sudo apt-get update
sudo apt-get install -y v4l-utils
```

Inspect the camera:

```bash
v4l2-ctl --device=/dev/video0 --all
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

Some USB cameras expose multiple video nodes. Confirm which node supports capture rather than assuming `/dev/video0` is correct.

---

## 7. FFmpeg fails to start or publish video

Check camera modes and available encoders:

```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext
ffmpeg -hide_banner -encoders | grep -E '264|v4l2'
```

Do not assume `h264_v4l2m2m` is available or functional on the installed OS/kernel.

With MediaMTX running, this is an example diagnostic publisher using software H.264:

```bash
ffmpeg -f v4l2 \
  -input_format mjpeg \
  -video_size 1280x720 \
  -framerate 30 \
  -i /dev/video0 \
  -an \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -pix_fmt yuv420p \
  -f rtsp rtsp://127.0.0.1:8554/camera
```

This is not guaranteed to be optimal. Confirm the camera supports the requested MJPEG mode, resolution and frame rate. Software encoding can heavily load a Pi 4.

While FFmpeg runs, test `http://10.42.0.1:8889/camera`. Stop FFmpeg with `Ctrl+C`.

Common errors:
- `No such file or directory`: check `/dev/video0`.
- `Device or resource busy`: another process may own the camera.
- `Invalid argument`: requested format, resolution or frame rate may be unsupported.
- `Unknown encoder`: selected encoder is unavailable.
- RTSP connection refused: MediaMTX may be stopped or RTSP disabled.

Check processes:

```bash
pgrep -a ffmpeg
```

---

## 8. MediaMTX page opens but video does not play

The WebRTC page can load even when no stream is being published. Confirm FFmpeg is running and inspect MediaMTX logs:

```bash
sudo journalctl -u mediamtx -n 100 --no-pager
pgrep -a ffmpeg
```

Check listeners:

```bash
sudo ss -lntp | grep -E ':(8554|8889)\b'
sudo ss -lnup | grep ':8189'
```

The WebRTC advertised host list should include the address used by the browser:

```yaml
webrtcAdditionalHosts:
  - 10.42.0.1
```

If the AP address changes, update this value. The browser needs both the WebRTC HTTP endpoint and the negotiated ICE media path. A page loading successfully does not prove UDP media traffic works.

For an initial test, connect the browser directly to the `Wombot` AP. If testing over another network, ensure MediaMTX advertises an address reachable from that client.

---

## 9. ESP32 serial connection unavailable

A serial error does not necessarily mean FastAPI failed. The backend can be designed to start with the ESP32 disconnected.

```bash
ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true
ls -l /dev/serial/by-id/ 2>/dev/null || true
lsusb
id team_wombot
```

The account commonly needs `dialout` for serial and `video` for camera access:

```bash
sudo usermod -aG dialout team_wombot
sudo usermod -aG video team_wombot
```

Group changes take effect after a new login or reboot. Prefer a stable `/dev/serial/by-id/` path if available. Device names such as `/dev/ttyUSB0` can change; some boards appear as `/dev/ttyACM0`.

---

## 10. Services do not start after reboot

```bash
systemctl is-enabled NetworkManager mediamtx wombot
sudo systemctl status NetworkManager mediamtx wombot --no-pager
sudo journalctl -b -u NetworkManager -u mediamtx -u wombot --no-pager
```

Enable and start:

```bash
sudo systemctl enable NetworkManager mediamtx wombot
sudo systemctl start NetworkManager
sudo systemctl start mediamtx
sudo systemctl start wombot
```

If a unit changed:

```bash
sudo systemctl daemon-reload
sudo systemctl restart mediamtx wombot
```

Check paths and permissions. Expected startup sequence:

1. NetworkManager activates the AP.
2. MediaMTX starts.
3. FastAPI starts.

The backend should tolerate an unplugged ESP32 or unavailable camera without crashing.

---

## 11. Useful restart and recovery commands

```bash
sudo systemctl restart wombot
sudo systemctl restart mediamtx
sudo systemctl restart mediamtx wombot

# Follow logs live
sudo journalctl -fu wombot
sudo journalctl -fu mediamtx

# Reboot
sudo reboot
```

---

## 12. Diagnostic bundle to share when asking for help

Share the output after removing private information. Never share Wi-Fi passwords, private keys, tokens or `.env` files.

```bash
echo "========== NETWORK =========="
ip -br addr
nmcli general status
nmcli device status
nmcli connection show --active
echo
echo "========== SERVICE STATUS =========="
sudo systemctl --no-pager --full status NetworkManager mediamtx wombot
echo
echo "========== PORTS =========="
sudo ss -lntup | grep -E ':(8000|8554|8888|8889|8189)\b' || true
echo
echo "========== CAMERA =========="
ls -l /dev/video* 2>/dev/null || true
ls -l /dev/serial/by-id/ 2>/dev/null || true
echo
echo "========== BACKEND LOG =========="
sudo journalctl -u wombot -n 60 --no-pager
echo
echo "========== MEDIAMTX LOG =========="
sudo journalctl -u mediamtx -n 60 --no-pager
```

---

## Safety reminders

- Keep a physical emergency stop independent of the browser, Wi-Fi and FastAPI.
- The ESP32 should enforce a motor command timeout/deadman independently of the Pi.
- Do not expose the rover control API directly to the public internet.
- Avoid `sudo nft flush ruleset`, broad firewall changes, or deleting NetworkManager profiles as generic troubleshooting steps.
- Do not run duplicate FFmpeg or MediaMTX processes while their systemd services are active.
- Back up configuration files before changing systemd units, NetworkManager profiles or MediaMTX configuration.
