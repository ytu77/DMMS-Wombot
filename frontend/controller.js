const DEADZONE = 0.08;

function applyDeadzone(value) {
    if (Math.abs(value) < DEADZONE) {
        return 0;
    }

    return value;
}

console.log("controller.js loaded");

let controller = null;

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

        const throttle = applyDeadzone(-controller.axes[1]);
        const steering = applyDeadzone(controller.axes[0]);

        if (typeof sendDriveInput === "function") {
            sendDriveInput(throttle, steering);
        }

        console.log(
            `Throttle: ${throttle.toFixed(2)} | ` +
            `Steering: ${steering.toFixed(2)}`
        );
    }

    requestAnimationFrame(readController);
}

window.addEventListener("gamepadconnected", (event) => {
    console.log("Controller connected:", event.gamepad.id);
});

window.addEventListener("gamepaddisconnected", (event) => {
    console.log("Controller disconnected:", event.gamepad.id);
});

requestAnimationFrame(readController);