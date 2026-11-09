# Wombot software architecture

## Components

```text
Phone/laptop browser
  |                         |
  | HTTP/WebSocket          | WebRTC video
  v                         v
FastAPI :8000           MediaMTX :8889 / UDP :8189
  |                         ^
  |                         |
  +-- FFmpeg camera publisher
  |   RTSP -> 127.0.0.1:8554/camera
  |
  +-- USB serial <----> ESP32
                          |
                          +-- motor control, encoders, I/O

USB camera /dev/video0 ---> FFmpeg
```

## Responsibilities

**Raspberry Pi:** hosts FastAPI, serves the control UI, manages camera publishing, communicates with the ESP32 and provides the operator Wi-Fi AP.

**MediaMTX:** receives RTSP from FFmpeg and makes the stream available through WebRTC. It does not own the camera and does not launch FFmpeg.

**ESP32:** handles time-critical motor and I/O functions, validates commands and enforces its own command timeout.

## Startup

1. NetworkManager activates the `Wombot` AP.
2. MediaMTX starts and listens for RTSP/WebRTC.
3. FastAPI starts and serves the control UI.
4. On Camera ON, FastAPI launches FFmpeg to publish the camera stream.
5. The browser receives video from MediaMTX and sends control requests to FastAPI.

The backend should still start if the ESP32 is disconnected; it should report serial unavailability without taking down the UI.

## Safety and resilience

- Browser disconnection must not leave motors running indefinitely.
- ESP32 firmware must stop outputs after a command/deadman timeout.
- Physical emergency stop must independently disable motor power or the relevant enable line.
- Camera failure must not take down Wi-Fi or the backend.
- Do not expose the rover control API directly to the public internet.
