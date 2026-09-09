let lastSendTime = 0;
const SEND_INTERVAL = 50; // 50 ms = 20 Hz

const DEADZONE = 0.08;

function applyDeadzone(value) {
    if (Math.abs(value) < DEADZONE) {
        return 0;
    }

    return value;
}

console.log("controller.js loaded");

let controller = null;
let controllerWasDetected = false;

function findController() {
    const gamepads = navigator.getGamepads();

    for (const gamepad of gamepads) {
        if (gamepad && gamepad.connected) {
            return gamepad;
        }
    }

    return null;
}

function readController() {

    controller = findController();

    if (controller) {

        controllerWasDetected = true;

        document.getElementById("controllerStatus").textContent =
            "Controller: 🟢 Connected";

        const throttle = applyDeadzone(-controller.axes[1]);
        const steering = applyDeadzone(controller.axes[0]);

        document.getElementById("throttleStatus").textContent =
            `Throttle: ${throttle.toFixed(2)}`;

        document.getElementById("steeringStatus").textContent =
            `Steering: ${steering.toFixed(2)}`;

        const now = performance.now();

        if (now - lastSendTime >= SEND_INTERVAL) {

            if (typeof sendDriveInput === "function") {
                sendDriveInput(throttle, steering);
            }

            lastSendTime = now;
        }

        console.log(
            `Throttle: ${throttle.toFixed(2)} | ` +
            `Steering: ${steering.toFixed(2)}`
        );

    } else {

        if (controllerWasDetected) {
            document.getElementById("controllerStatus").textContent =
                "Controller: 🔴 Disconnected";
        } else {
            document.getElementById("controllerStatus").textContent =
                "Controller: 🟡 Waiting...";
        }

        document.getElementById("throttleStatus").textContent =
            "Throttle: 0.00";

        document.getElementById("steeringStatus").textContent =
            "Steering: 0.00";
    }

    requestAnimationFrame(readController);
}

window.addEventListener("gamepadconnected", (event) => {

    console.log("Controller connected:", event.gamepad.id);

    controller = event.gamepad;
    controllerWasDetected = true;

    document.getElementById("controllerStatus").textContent =
        "Controller: 🟢 Connected";
});

window.addEventListener("gamepaddisconnected", (event) => {

    console.log("Controller disconnected:", event.gamepad.id);

    controller = null;

    document.getElementById("controllerStatus").textContent =
        "Controller: 🔴 Disconnected";

    document.getElementById("throttleStatus").textContent =
        "Throttle: 0.00";

    document.getElementById("steeringStatus").textContent =
        "Steering: 0.00";
});

requestAnimationFrame(readController);