from __future__ import annotations
import asyncio, itertools, json, math, os, subprocess, threading, time
from contextlib import suppress
from pathlib import Path
from typing import Any
import serial
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
ESP32_PORT = os.getenv("ESP32_SERIAL_PORT", "/dev/ttyUSB0")
ESP32_BAUD = int(os.getenv("ESP32_BAUD", "115200"))
PROTOCOL_VERSION = 1
app = FastAPI(title="Wombot Mission Control")
app.mount("/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")

camera_process: subprocess.Popen | None = None
esp_serial: serial.Serial | None = None
serial_lock = threading.Lock()
clients: set[WebSocket] = set()
clients_lock = asyncio.Lock()
command_ids = itertools.count(1)
event_loop: asyncio.AbstractEventLoop | None = None
shutdown_event = threading.Event()

async def broadcast(message: dict[str, Any]) -> None:
    async with clients_lock:
        current = list(clients)
    stale = []
    encoded = json.dumps(message, separators=(",", ":"))
    for client in current:
        try:
            await client.send_text(encoded)
        except Exception:
            stale.append(client)
    if stale:
        async with clients_lock:
            for client in stale:
                clients.discard(client)

def broadcast_from_thread(message: dict[str, Any]) -> None:
    loop = event_loop
    if loop is None or loop.is_closed():
        return
    future = asyncio.run_coroutine_threadsafe(broadcast(message), loop)
    future.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)

def send_to_esp32(command: dict[str, Any]) -> bool:
    device = esp_serial
    if device is None or not device.is_open:
        return False
    try:
        payload = json.dumps(command, separators=(",", ":"), allow_nan=False) + "\n"
        with serial_lock:
            device.write(payload.encode("utf-8"))
            device.flush()
        return True
    except (serial.SerialException, OSError) as exc:
        print(f"ESP32 serial write failed: {exc}")
        broadcast_from_thread({"type": "connection", "component": "esp32", "connected": False, "message": str(exc)})
        return False

def esp_command(cmd: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"v": PROTOCOL_VERSION, "type": "command", "id": next(command_ids), "cmd": cmd, "args": args or {}}

def serial_reader() -> None:
    while not shutdown_event.is_set():
        device = esp_serial
        if device is None or not device.is_open:
            time.sleep(.25)
            continue
        try:
            raw = device.readline()
            if not raw:
                continue
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                print(f"ESP32 non-JSON output: {line}")
                broadcast_from_thread({"type": "log", "level": "warning", "source": "esp32", "message": line})
                continue
            print(f"ESP32: {line}")
            broadcast_from_thread(message)
        except (serial.SerialException, OSError) as exc:
            print(f"ESP32 serial read failed: {exc}")
            broadcast_from_thread({"type": "connection", "component": "esp32", "connected": False, "message": str(exc)})
            time.sleep(1)

def start_camera() -> tuple[bool, str]:
    global camera_process
    if camera_process is not None and camera_process.poll() is None:
        return True, "Camera is already running"
    camera_process = None
    command = ["ffmpeg", "-f", "v4l2", "-input_format", "mjpeg", "-video_size", "1280x720", "-framerate", "30", "-i", "/dev/video0", "-vf", "hflip,vflip,format=yuv420p", "-c:v", "h264_v4l2m2m", "-f", "rtsp", "rtsp://127.0.0.1:8554/camera"]
    try:
        camera_process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
        time.sleep(.15)
        if camera_process.poll() is not None:
            camera_process = None
            return False, "FFmpeg exited during startup; check the Pi terminal for camera/codec errors"
        return True, "Camera publisher started"
    except (OSError, subprocess.SubprocessError) as exc:
        camera_process = None
        return False, str(exc)

def stop_camera() -> tuple[bool, str]:
    global camera_process
    if camera_process is None:
        return True, "Camera is already stopped"
    process, camera_process = camera_process, None
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)
    return True, "Camera publisher stopped"

@app.on_event("startup")
async def startup() -> None:
    global event_loop, esp_serial
    event_loop = asyncio.get_running_loop()
    shutdown_event.clear()
    try:
        esp_serial = serial.Serial(ESP32_PORT, ESP32_BAUD, timeout=.1, write_timeout=.5)
        await asyncio.sleep(2)  # USB serial opening may reset the ESP32
        threading.Thread(target=serial_reader, name="esp32-serial-reader", daemon=True).start()
        print(f"ESP32 serial opened: {ESP32_PORT} at {ESP32_BAUD} baud")
    except (serial.SerialException, OSError) as exc:
        esp_serial = None
        print(f"ESP32 serial unavailable: {exc}; web UI will still start")

@app.on_event("shutdown")
async def shutdown() -> None:
    global esp_serial
    shutdown_event.set()
    send_to_esp32(esp_command("stop"))
    stop_camera()
    if esp_serial is not None:
        with suppress(Exception):
            esp_serial.close()
        esp_serial = None

@app.get("/")
async def root():
    return {"status": "Wombot server is alive", "protocol_version": PROTOCOL_VERSION}

@app.get("/control")
async def control_page():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/health")
async def health():
    device = esp_serial
    return {"server": "ok", "esp32_serial": bool(device is not None and device.is_open), "camera_process": bool(camera_process is not None and camera_process.poll() is None), "protocol_version": PROTOCOL_VERSION}

@app.get("/test")
async def test_page():
    return HTMLResponse("""<!doctype html><html><meta charset='utf-8'><title>Wombot diagnostics</title><body><h1>Wombot diagnostics</h1><pre id='out'>Connecting…</pre><script>const o=document.getElementById('out');const w=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);w.onopen=()=>o.textContent='WebSocket connected';w.onmessage=e=>o.textContent+='\\n'+e.data;w.onclose=()=>o.textContent+='\\nDisconnected';</script></body></html>""")

def finite_number(value: Any) -> float | None:
    if isinstance(value, bool): return None
    try: result = float(value)
    except (TypeError, ValueError): return None
    return result if math.isfinite(result) else None

async def ui_error(ws: WebSocket, message: str, code: str = "INVALID_ARGUMENT") -> None:
    await ws.send_text(json.dumps({"type": "ui_error", "code": code, "message": message}))

async def handle_browser_message(ws: WebSocket, data: dict[str, Any]) -> None:
    kind = data.get("type")
    if kind == "drive":
        throttle, steering = finite_number(data.get("throttle")), finite_number(data.get("steering"))
        if throttle is None or steering is None:
            send_to_esp32(esp_command("stop"))
            await ui_error(ws, "Throttle and steering must be finite numbers.")
            return
        throttle, steering = max(-1., min(1., throttle)), max(-1., min(1., steering))
        left, right = throttle + steering, throttle - steering
        scale = max(1., abs(left), abs(right))
        command = esp_command("drive", {"fl": left/scale, "fr": right/scale, "rl": left/scale, "rr": right/scale})
        if not send_to_esp32(command): await ui_error(ws, "ESP32 serial is unavailable.", "ESP32_UNAVAILABLE")
        return
    if kind in {"stop", "estop", "clear_estop"}:
        args = {"reason": str(data.get("reason", "operator"))} if kind == "estop" else {}
        if not send_to_esp32(esp_command(kind, args)): await ui_error(ws, "ESP32 serial is unavailable.", "ESP32_UNAVAILABLE")
        return
    if kind == "servos":
        pan, tilt = finite_number(data.get("pan_deg")), finite_number(data.get("tilt_deg"))
        if pan is None or tilt is None:
            await ui_error(ws, "Servo command requires numeric pan_deg and tilt_deg.")
            return
        args = {"pan_deg": max(0., min(180., pan)), "tilt_deg": max(0., min(180., tilt))}
        if not send_to_esp32(esp_command("servos", args)): await ui_error(ws, "ESP32 serial is unavailable.", "ESP32_UNAVAILABLE")
        return
    if kind == "led":
        mode = data.get("mode")
        allowed = {"off", "solid", "rainbow", "rgb-wave", "snowflakes", "circulating", "state", "custom"}
        if mode not in allowed:
            await ui_error(ws, "Unsupported LED mode.")
            return
        try:
            brightness = max(0, min(100, int(data.get("brightness", 75))))
            speed = max(0, min(100, int(data.get("speed", 50))))
        except (TypeError, ValueError):
            await ui_error(ws, "LED brightness and speed must be numbers.")
            return
        args: dict[str, Any] = {"mode": mode, "brightness": brightness, "speed": speed}
        colour = data.get("colour")
        if isinstance(colour, str) and len(colour) == 7 and colour.startswith("#"):
            try: args["colour"] = {"r": int(colour[1:3], 16), "g": int(colour[3:5], 16), "b": int(colour[5:7], 16)}
            except ValueError:
                await ui_error(ws, "Invalid hex LED colour.")
                return
        elif isinstance(colour, dict):
            rgb = {}
            for channel in ("r", "g", "b"):
                value = finite_number(colour.get(channel))
                if value is None:
                    await ui_error(ws, "RGB colour requires numeric r, g and b.")
                    return
                rgb[channel] = max(0, min(255, int(value)))
            args["colour"] = rgb
        if mode in {"solid", "custom"} and "colour" not in args:
            await ui_error(ws, "Solid/custom LED mode requires a colour.")
            return
        if not send_to_esp32(esp_command("led", args)): await ui_error(ws, "ESP32 serial is unavailable.", "ESP32_UNAVAILABLE")
        return
    if kind == "camera_on":
        ok, detail = start_camera()
        await broadcast({"type": "camera", "state": "on" if ok else "error", "message": detail})
        if not ok: await ui_error(ws, f"Could not start camera: {detail}", "CAMERA_START_FAILED")
        return
    if kind == "camera_off":
        _, detail = stop_camera()
        await broadcast({"type": "camera", "state": "off", "message": detail})
        return
    if kind == "control_mode":
        await ui_error(ws, "Operating mode is UI-only; protocol v1 does not implement it.", "NOT_IMPLEMENTED")
        return
    if kind == "ping":
        await ws.send_text(json.dumps({"type": "pong", "ts_ms": int(time.monotonic() * 1000)}))
        return
    await ui_error(ws, f"Unknown browser command: {kind!r}", "INVALID_COMMAND")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with clients_lock: clients.add(websocket)
    await websocket.send_text(json.dumps({"type": "connection", "component": "pi", "connected": True}))
    try:
        while True:
            raw = await websocket.receive_text()
            try: data = json.loads(raw)
            except json.JSONDecodeError:
                await ui_error(websocket, "Invalid JSON from browser.", "INVALID_JSON")
                continue
            if not isinstance(data, dict):
                await ui_error(websocket, "Browser message must be a JSON object.")
                continue
            await handle_browser_message(websocket, data)
    except WebSocketDisconnect:
        print("WebSocket client disconnected")
    finally:
        async with clients_lock: clients.discard(websocket)
        # Single-operator assumption: browser disconnect causes a safe stop.
        send_to_esp32(esp_command("stop"))
