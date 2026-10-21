from fastapi import FastAPI, WebSocket
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import subprocess
import json
from starlette.websockets import WebSocketDisconnect

import os
import threading
import time
import serial

import asyncio

app = FastAPI()
camera_process = None

app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")

ESP32_PORT = os.getenv("ESP32_SERIAL_PORT", "/dev/ttyUSB0")
ESP32_BAUD = 115200

esp_serial = None
serial_lock = threading.Lock()


def send_to_esp32(command: dict) -> bool:
    """Send one newline-terminated JSON command to the ESP32."""
    if esp_serial is None or not esp_serial.is_open:
        print("ESP32 serial unavailable; command not sent")
        return False

    payload = json.dumps(command, separators=(",", ":")) + "\n"

    try:
        with serial_lock:
            esp_serial.write(payload.encode("utf-8"))
            esp_serial.flush()
        return True
    except (serial.SerialException, OSError) as exc:
        print(f"ESP32 serial write failed: {exc}")
        return False


def serial_reader():
    """Print newline-terminated status messages from the ESP32."""
    while True:
        if esp_serial is None or not esp_serial.is_open:
            time.sleep(0.5)
            continue

        try:
            line = esp_serial.readline().decode(
                "utf-8", errors="replace"
            ).strip()

            if line:
                print(f"ESP32: {line}")

        except (serial.SerialException, OSError) as exc:
            print(f"ESP32 serial read failed: {exc}")
            time.sleep(1)


@app.on_event("startup")
async def connect_esp32():
    global esp_serial

    try:
        esp_serial = serial.Serial(
            ESP32_PORT,
            ESP32_BAUD,
            timeout=0.1,
        )

        # Opening USB serial may reset the ESP32.
        await asyncio.sleep(2)

        threading.Thread(
            target=serial_reader,
            daemon=True,
        ).start()

        print(f"ESP32 serial connected: {ESP32_PORT}")

    except (serial.SerialException, OSError) as exc:
        esp_serial = None
        print(f"ESP32 serial unavailable: {exc}")
        print("Web interface will start without motor control.")

@app.get("/control")
async def control_page():
    return FileResponse("frontend/index.html")

def start_camera():
    global camera_process

    if camera_process is not None:
        return

    camera_process = subprocess.Popen([
        "ffmpeg",
        "-f", "v4l2",
        "-input_format", "mjpeg",
        "-video_size", "1280x720",
        "-framerate", "30",
        "-i", "/dev/video0",
        "-vf", "hflip,vflip,format=yuv420p",
        "-c:v", "h264_v4l2m2m",
        "-f", "rtsp",
        "rtsp://127.0.0.1:8554/camera"
    ])


def stop_camera():
    global camera_process

    if camera_process is not None:
        camera_process.terminate()
        camera_process.wait()
        camera_process = None


@app.get("/")
async def root():
    return {"status": "Wombot server is alive!"}


@app.get("/test")
async def test_page():
    return HTMLResponse("""
<!DOCTYPE html>
<html>
<head>
    <title>Wombot Control</title>

    <style>
        body {
            font-family: Arial, sans-serif;
            background: #222;
            color: white;
            margin: 20px;
        }

        .container {
            display: flex;
            gap: 20px;
            align-items: flex-start;
        }

        .camera {
            width: 70%;
        }

        .camera iframe {
            width: 100%;
            aspect-ratio: 16 / 9;
            border: none;
        }

        .controls {
            width: 30%;
        }

        button {
            padding: 10px 20px;
            font-size: 16px;
        }

        #status {
            font-weight: bold;
        }
    </style>
</head>

<body>

    <h1>Wombot Control</h1>

    <div class="container">

        <div class="camera">
            <h2>Camera</h2>

            <iframe
                id="cameraFeed"
                src="http://10.42.0.1:8889/camera"
                style="display: none;">
            </iframe>
        </div>

        <div class="controls">

            <h2>Connection</h2>

            <p id="status">Connecting...</p>

            <h2>Camera</h2>

            <p id="cameraStatus">🔴 Camera OFF</p>

            <button onclick="cameraOn()">Camera ON</button>
            <button onclick="cameraOff()">Camera OFF</button>

            <h3>Received:</h3>
            <pre id="output"></pre>

        </div>

    </div>

    <script>

        const ws = new WebSocket(
            "ws://" + location.host + "/ws"
        );

        ws.onopen = () => {
            document.getElementById("status").textContent =
                "Connected to Pi!";
        };

        ws.onmessage = (event) => {

            document.getElementById("output").textContent +=
                event.data + "\\n";

            if (event.data === "Camera ON") {
                document.getElementById("cameraStatus").textContent =
                    "🟢 Camera ON";

                document.getElementById("cameraFeed").style.display =
                    "block";
            }

            if (event.data === "Camera OFF") {
                document.getElementById("cameraStatus").textContent =
                    "🔴 Camera OFF";

                document.getElementById("cameraFeed").style.display =
                    "none";
            }
        };

        ws.onclose = () => {
            document.getElementById("status").textContent =
                "Disconnected";
        };

        function sendMessage() {
            const message =
                document.getElementById("message").value;

            ws.send(message);
        }

	function cameraOn() {
	    ws.send("camera_on");
	}

	function cameraOff() {
	    ws.send("camera_off");
	}

    </script>

</body>
</html>
    """)



@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket client connected")

    try:
        while True:
            message = await websocket.receive_text()

            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                print("Invalid WebSocket JSON:", message)
                continue

            command_type = data.get("type")

            if command_type == "drive":
                try:
                    throttle = float(data.get("throttle", 0))
                    steering = float(data.get("steering", 0))
                except (TypeError, ValueError):
                    send_to_esp32({"type": "stop"})
                    continue

                import math

                if not math.isfinite(throttle) or not math.isfinite(steering):
                    send_to_esp32({"type": "stop"})
                    continue

                # Clamp browser inputs to their expected range.
                throttle = max(-1.0, min(1.0, throttle))
                steering = max(-1.0, min(1.0, steering))

                # Differential steering:
                # positive steering turns towards the right.
                left = throttle + steering
                right = throttle - steering

                # Preserve the ratio while keeping all outputs in range.
                scale = max(1.0, abs(left), abs(right))
                left /= scale
                right /= scale

                wheel_command = {
                    "type": "drive",
                    "fl": left,
                    "fr": right,
                    "rl": left,
                    "rr": right,
                }

                if not send_to_esp32(wheel_command):
                    print("Drive command dropped: ESP32 unavailable")

            elif command_type in ("stop", "estop"):
                # The current ESP32 implementation stops on either command.
                send_to_esp32({"type": command_type})

            elif command_type == "camera_on":
                start_camera()
                await websocket.send_text("Camera ON")

            elif command_type == "camera_off":
                stop_camera()
                await websocket.send_text("Camera OFF")

            else:
                print("Unknown WebSocket command:", command_type)

    except WebSocketDisconnect:
        print("WebSocket client disconnected")

    finally:
        # Stop the rover if the operator's browser disconnects.
        send_to_esp32({"type": "stop"})
