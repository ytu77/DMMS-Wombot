let controller = null;

window.addEventListener("gamepadconnected", (event) => {
    controller = event.gamepad;

    console.log(
        "Controller connected:",
        controller.id
    );
});

window.addEventListener("gamepaddisconnected", () => {
    controller = null;

    console.log("Controller disconnected");
});

function readController() {

    if (!controller) {
        requestAnimationFrame(readController);
        return;
    }

    const gamepads = navigator.getGamepads();

    const updatedController = gamepads[controller.index];

    if (!updatedController) {
        requestAnimationFrame(readController);
        return;
    }

    controller = updatedController;

    const leftX = controller.axes[0];
    const leftY = controller.axes[1];

    console.log(
        `Left stick: X=${leftX.toFixed(2)}, Y=${leftY.toFixed(2)}`
    );

    requestAnimationFrame(readController);
}

requestAnimationFrame(readController);