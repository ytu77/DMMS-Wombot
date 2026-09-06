from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse

app = FastAPI()


@app.get("/")
async def root():
    return {"status": "Wombot server is alive!"}


@app.get("/test")
async def test_page():
    return HTMLResponse("""
<!DOCTYPE html>
<html>
<head>
    <title>Wombot WebSocket Test</title>
</head>
<body>
    <h1>Wombot WebSocket Test</h1>

    <p id="status">Connecting...</p>

    <input id="message" value="Hello Pi!">
    <button onclick="sendMessage()">Send</button>

    <h3>Received:</h3>
    <pre id="output"></pre>

    <script>
        const ws = new WebSocket("ws://10.42.0.1:8000/ws");

        ws.onopen = () => {
            document.getElementById("status").textContent =
                "Connected to Pi!";
        };

        ws.onmessage = (event) => {
            document.getElementById("output").textContent +=
                event.data + "\\n";
        };

        ws.onclose = () => {
            document.getElementById("status").textContent =
                "Disconnected";
        };

        function sendMessage() {
            const message = document.getElementById("message").value;
            ws.send(message);
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
        await websocket.send_text(f"Pi received: {message}")
