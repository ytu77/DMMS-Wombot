from fastapi import FastAPI, WebSocket
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import subprocess

app = FastAPI()
camera_process = None

app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")


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
        "-vf", "format=yuv420p",
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

    while True:
        message = await websocket.receive_text()

        if message == "camera_on":
            start_camera()
            await websocket.send_text("Camera ON")

        elif message == "camera_off":
            stop_camera()
            await websocket.send_text("Camera OFF")

        else:
            print("Pi received:", message)

            await websocket.send_text(
                f"Pi received: {message}"
            )
