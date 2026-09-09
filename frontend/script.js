const socket = new WebSocket(
    `ws://${window.location.host}/ws`
);

socket.onopen = () => {
    console.log("Connected to Wombot");
};

socket.onmessage = (event) => {
    console.log("Pi:", event.data);
};

function sendCommand(command) {
    socket.send(JSON.stringify(command));
}

function sendDriveInput(throttle, steering) {
    if (socket.readyState !== WebSocket.OPEN) {
        return;
    }

    const command = {
        type: "drive",
        throttle: throttle,
        steering: steering
    };

    socket.send(JSON.stringify(command));
}