# DMMS Wombot

Monorepo for the Wombot rover: Raspberry Pi application, ESP32 firmware and shared documentation.

```text
DMMS-Wombot/
├── README.md
├── .gitignore
├── pi/
│   ├── backend/
│   ├── frontend/
│   ├── camera/
│   ├── config/
│   ├── tests/
│   ├── requirements.txt
│   ├── install.sh
│   ├── update.sh
│   └── services/
├── esp32/Wombot/
├── config/
└── docs/
```

## Install on the Pi

```bash
cd ~/DMMS-Wombot
sudo ./pi/install.sh
sudo reboot
```

Connect to Wi-Fi `Wombot` and visit `http://10.42.0.1:8000/control`.

Direct MediaMTX WebRTC player: `http://10.42.0.1:8889/camera`.

## Camera pipeline

The FastAPI backend starts/stops FFmpeg when Camera ON/OFF is requested. FFmpeg publishes to `rtsp://127.0.0.1:8554/camera`; MediaMTX serves it to browsers over WebRTC. MediaMTX does not start FFmpeg itself.

Check that `pi/backend/main.py` serves the frontend from `pi/frontend` and that its camera publisher targets the RTSP URL above.

## Safety

Use a physical emergency stop and firmware-side motor command timeout. Do not expose the control API to the public internet.
