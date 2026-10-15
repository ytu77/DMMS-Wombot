const socket = new WebSocket(
    `ws://${window.location.host}/ws`
);

const connectionStatus = document.getElementById("connectionStatus");
const cameraContainer = document.getElementById("cameraContainer");

socket.onopen = () => {
    console.log("Connected to Wombot");
    connectionStatus.textContent = "Connected to Wombot";
};

socket.onclose = () => {
    console.log("Disconnected from Wombot");
    connectionStatus.textContent = "Disconnected — refresh to reconnect";
};

socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    connectionStatus.textContent = "Connection error";
};

function sendCommand(command) {
    if (socket.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not connected");
        return;
    }

    socket.send(JSON.stringify(command));
}

function sendDriveInput(throttle, steering) {
    sendCommand({
        type: "drive",
        throttle: throttle,
        steering: steering
    });
}

function showCamera() {
    cameraContainer.innerHTML = "";

    const frame = document.createElement("iframe");
    frame.src = `http://${window.location.hostname}:8889/camera`;
    frame.title = "Wombot camera feed";
    frame.style.width = "100%";
    frame.style.maxWidth = "960px";
    frame.style.aspectRatio = "16 / 9";
    frame.style.border = "1px solid #888";
    frame.style.backgroundColor = "#000";

    cameraContainer.appendChild(frame);
}

function hideCamera() {
    cameraContainer.innerHTML = "";
}

socket.onmessage = (event) => {
    console.log("Pi:", event.data);

    if (event.data === "Camera ON") {
        showCamera();
    } else if (event.data === "Camera OFF") {
        hideCamera();
    }
};

document.getElementById("cameraOn").addEventListener("click", () => {
    sendCommand({ type: "camera_on" });
});

document.getElementById("cameraOff").addEventListener("click", () => {
    sendCommand({ type: "camera_off" });
});

console.log("Wombot script.js loaded");