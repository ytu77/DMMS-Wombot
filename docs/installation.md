# Raspberry Pi installation guide

## Target setup

This installer is based on the Wombot device configuration established so far:

- Raspberry Pi 4 Model B, Debian 13 (Trixie) / Raspberry Pi OS.
- NetworkManager manages `wlan0`.
- AP SSID/profile: `Wombot`.
- AP address: `10.42.0.1/24`, NetworkManager `ipv4.method shared`.
- USB camera: `/dev/video0`.
- FastAPI: TCP port `8000`.
- MediaMTX RTSP: TCP port `8554`.
- MediaMTX WebRTC: TCP `8889`, UDP `8189`.
- MediaMTX version defaults to `v1.20.1`, matching the version previously installed on the device.

## Required repository layout

The installer expects:

```text
DMMS-Wombot/
└── pi/
    ├── backend/main.py
    ├── frontend/
    ├── requirements.txt
    ├── install.sh
    └── .venv/       # created automatically
```

The FastAPI import path is `backend.main:app`. If the app entry point differs, edit `ExecStart` in `pi/install.sh`.

## Install

From the normal Linux project account:

```bash
cd ~/DMMS-Wombot
sudo ./pi/install.sh
```

The installer installs Debian packages, prepares `pi/.venv`, installs Python requirements, configures NetworkManager, installs MediaMTX if absent, and installs/enables the systemd services.

### Wi-Fi password

An existing `Wombot` profile is reused and its saved password is retained. On a fresh device, set a password (8+ characters):

```bash
sudo env AP_PASSWORD='replace-with-a-strong-password' ./pi/install.sh
```

Do not commit real passwords to Git.

### MediaMTX version

Default is `v1.20.1`. To change it:

```bash
sudo env MEDIAMTX_VERSION=v1.20.1 ./pi/install.sh
```

The binary is not replaced if it already exists. To force replacement:

```bash
sudo env FORCE_MEDIAMTX_INSTALL=1 ./pi/install.sh
```

An existing `/etc/mediamtx.yml` is preserved. Check its WebRTC configuration includes:

```yaml
webrtcAdditionalHosts:
  - 10.42.0.1
```

## Reboot and test

```bash
sudo reboot
```

Connect a phone/laptop to `Wombot`, then open:

- Control UI: `http://10.42.0.1:8000/control`
- Direct video test: `http://10.42.0.1:8889/camera`

The direct video URL is useful for testing MediaMTX independently of the frontend.

## Camera architecture

```text
USB camera (/dev/video0)
        |
        v
FFmpeg launched by FastAPI on Camera ON
        |
        | RTSP publish
        v
MediaMTX at 127.0.0.1:8554/camera
        |
        | WebRTC
        v
Browser at 10.42.0.1:8889/camera
```

MediaMTX does not launch FFmpeg. The backend should start the camera publisher when requested and stop it on Camera OFF. The backend must publish to `rtsp://127.0.0.1:8554/camera`.

Do not assume `h264_v4l2m2m` is available. Check the Pi's encoders and camera modes:

```bash
ffmpeg -hide_banner -encoders | grep -E '264|v4l2'
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

## Diagnostics

```bash
sudo systemctl status wombot mediamtx --no-pager
sudo journalctl -u wombot -n 80 --no-pager
sudo journalctl -u mediamtx -n 80 --no-pager
sudo ss -lntup | grep -E ':(8000|8554|8888|8889)\\b'
ip -br addr
nmcli device status
nmcli connection show --active
nmcli connection show Wombot
ls -l /dev/video*
```

Restart services:

```bash
sudo systemctl restart mediamtx
sudo systemctl restart wombot
```

Bring up the AP manually (may drop SSH if you are connected through that interface):

```bash
sudo nmcli connection up Wombot
```

Update Python dependencies after pulling the Git revision you want:

```bash
cd ~/DMMS-Wombot
./pi/update.sh
```

## Important notes

- NetworkManager shared mode manages DHCP/NAT for the AP. Avoid adding manual nftables rules without evidence they are needed.
- The installer does not force an AP reconnect during installation, to avoid dropping an active SSH session. Reboot or manually activate the AP afterwards.
- `After=network-online.target` orders service startup but does not create the AP. NetworkManager autoconnect is responsible for that.
- The installer adds the project user to `video` and `dialout`; reboot/new login applies group changes.
- Check the actual ESP32 serial device; it may be `/dev/ttyUSB0` or `/dev/ttyACM0`. Prefer `/dev/serial/by-id/` for a stable path.
- Keep a physical emergency stop and firmware-side motor timeout. Do not rely on a browser connection for motor safety.
