(() => {
  "use strict";

  const SEND_INTERVAL = 50, DEADZONE = 0.08;
  let lastSend = 0, everHadController = false, activeIndex = null;
  let wasStopButtonPressed = false; 
  let ignoreInputsUntilRelease = false;

  let keyboardThrottle = 0, keyboardSteering = 0, keyboardActive = false;
  
  // Tracking states for Pan/Tilt servos (0 - 180 degrees)
  let currentPan = 90, currentTilt = 90;
  
  // Rebind tracking parameters
  let rebindingTarget = null; // Contains: { action, inputType }

  const pressed = new Set();
  const $ = (id) => document.getElementById(id);
  function text(id, value) { const el = $(id); if (el) el.textContent = value; }

  // Default keybind configurations
  const DEFAULTS = {
    keyboard: {
      forward: "w",
      reverse: "s",
      left: "a",
      right: "d",
      stop: " ",
      pan_up: "i",
      pan_down: "k",
      pan_left: "j",
      pan_right: "l"
    },
    controller: {
      forward: "12",   // D-Pad Up
      reverse: "13",   // D-Pad Down
      left: "14",      // D-Pad Left
      right: "15",     // D-Pad Right
      stop: "9",       // Start
      pan_up: "3",     // Y / Triangle
      pan_down: "0",   // A / Cross
      pan_left: "2",   // X / Square
      pan_right: "1"   // B / Circle
    }
  };

  // Load user mappings from localStorage or fallback to defaults
  let mappings = JSON.parse(localStorage.getItem("rover_input_mappings")) || JSON.parse(JSON.stringify(DEFAULTS));

  // Render current active mappings onto HTML text targets
  function updateUI() {
    Object.keys(mappings.keyboard).forEach(action => {
      const el = $(`key-${action}`);
      if (el) el.textContent = mappings.keyboard[action] === " " ? "Space" : mappings.keyboard[action].toUpperCase();
    });
    Object.keys(mappings.controller).forEach(action => {
      const el = $(`pad-${action}`);
      if (el) el.textContent = `Button ${mappings.controller[action]}`;
    });
  }

  function saveMappings() {
    localStorage.setItem("rover_input_mappings", JSON.stringify(mappings));
    updateUI();
  }

  function deadzone(value) {
    if (!Number.isFinite(value) || Math.abs(value) < DEADZONE) return 0;
    return Math.sign(value) * (Math.abs(value) - DEADZONE) / (1 - DEADZONE);
  }

  function getPad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (activeIndex !== null && pads[activeIndex]?.connected) return pads[activeIndex];
    for (const pad of pads) if (pad?.connected) return pad;
    return null;
  }

  function recalcKeyboard() {
    keyboardThrottle = (pressed.has(mappings.keyboard.forward) ? 1 : 0) - (pressed.has(mappings.keyboard.reverse) ? 1 : 0);
    keyboardSteering = (pressed.has(mappings.keyboard.right) ? 1 : 0) - (pressed.has(mappings.keyboard.left) ? 1 : 0);
    keyboardActive = keyboardThrottle !== 0 || keyboardSteering !== 0 ||
                     pressed.has(mappings.keyboard.pan_up) || pressed.has(mappings.keyboard.pan_down) ||
                     pressed.has(mappings.keyboard.pan_left) || pressed.has(mappings.keyboard.pan_right);
  }

  function transmit(throttle, steering, now) {
    if (now - lastSend < SEND_INTERVAL || !window.RoverAPI) return;
    window.RoverAPI.sendDriveInput(throttle, steering);
    lastSend = now;
  }

  function tick() {
    const now = performance.now(), pad = getPad();
    let throttle = 0, steering = 0;
    let panDelta = 0, tiltDelta = 0;
    let stopButtonIsCurrentlyPressed = false;

    // Freeze telemetry modifications if actively listening to bind inputs
    if (rebindingTarget) {
      if (pad) {
        pad.buttons.forEach((btn, idx) => {
          if (btn.pressed && rebindingTarget.inputType === "controller") {
            mappings.controller[rebindingTarget.action] = String(idx);
            rebindingTarget = null;
            ignoreInputsUntilRelease = true;
            saveMappings();
          }
        });
      }
      requestAnimationFrame(tick);
      return;
    }

    if (ignoreInputsUntilRelease) {
      // Check if any controller buttons are currently pressed
      let anyControllerButtonPressed = false;
      if (pad) {
        anyControllerButtonPressed = pad.buttons.some(btn => btn.pressed);
      }
      
      // If absolutely everything has been released, turn off the safety cooldown
      if (pressed.size === 0 && !anyControllerButtonPressed) {
        ignoreInputsUntilRelease = false;
      }
      
      // Suppress inputs and bypass this frame cycle execution safely
      text("throttleStatus", "Throttle: 0.00");
      text("steeringStatus", "Steering: 0.00");
      transmit(0, 0, now);
      requestAnimationFrame(tick);
      return;
    }

    if (pad) {
      activeIndex = pad.index; everHadController = true;
      text("statController", "CONNECTED");

      // Analog Stick Mapping: Left Stick (Axes 0 & 1) handles movement drive
      throttle = deadzone(-(pad.axes[1] || 0));
      steering = deadzone(pad.axes[0] || 0);

      // Analog Stick Mapping: Right Stick (Axes 2 & 3) handles panning servos
      const rx = deadzone(pad.axes[2] || 0);
      const ry = deadzone(-(pad.axes[3] || 0)); // Invert Y axis for look-up standard

      if (rx !== 0) panDelta = rx * 3;
      if (ry !== 0) tiltDelta = ry * 3;

      // Digital Buttons & D-Pad Fallbacks Mapping
      pad.buttons.forEach((btn, index) => {
        if (!btn.pressed) return;
        const btnStr = String(index);

        if (btnStr === mappings.controller.forward && throttle === 0) throttle = 1;
        if (btnStr === mappings.controller.reverse && throttle === 0) throttle = -1;
        if (btnStr === mappings.controller.left && steering === 0) steering = -1;
        if (btnStr === mappings.controller.right && steering === 0) steering = 1;

        if (btnStr === mappings.controller.pan_up && ry === 0) tiltDelta = 2;
        if (btnStr === mappings.controller.pan_down && ry === 0) tiltDelta = -2;
        if (btnStr === mappings.controller.pan_left && rx === 0) panDelta = -2;
        if (btnStr === mappings.controller.pan_right && rx === 0) panDelta = 2;

        if (btnStr === mappings.controller.stop) {
          stopButtonIsCurrentlyPressed = true;
          
          // ONLY click if it wasn't already held down in the last frame
          if (!wasStopButtonPressed) {
            $("estop")?.click(); 
            // pressed.clear();
            recalcKeyboard();
          }
        }
      });

      wasStopButtonPressed = stopButtonIsCurrentlyPressed;

      keyboardActive = false;
    } else if (keyboardActive) {
      text("statController", "KEYBOARD");
      throttle = keyboardThrottle;
      steering = keyboardSteering;

      // Keyboard Panning Handling
      if (pressed.has(mappings.keyboard.pan_up)) tiltDelta = 2;
      if (pressed.has(mappings.keyboard.pan_down)) tiltDelta = -2;
      if (pressed.has(mappings.keyboard.pan_left)) panDelta = -2;
      if (pressed.has(mappings.keyboard.pan_right)) panDelta = 2;
    } else {
      activeIndex = null;
      text("statController", everHadController ? "DISCONNECTED" : "WAITING FOR INPUT");
    }

    // if (activeKeys.has(mappings.keyboard.stop)) {
    //   if (window.RoverAPI?.emergencyStop) window.RoverAPI.emergencyStop(); // UPDATED FROM .stop()
    //   return;
    // }

    text("throttleStatus", `Throttle: ${throttle.toFixed(2)}`);
    text("steeringStatus", `Steering: ${steering.toFixed(2)}`);
    
    // Transmit drive parameters via telemetry loop
    transmit(throttle, steering, now);

    // Process and clamp camera values (0-180 degrees)
    if (panDelta !== 0 || tiltDelta !== 0) {
      currentPan = Math.max(0, Math.min(180, currentPan + panDelta));
      currentTilt = Math.max(0, Math.min(90, currentTilt + tiltDelta));
      if (window.RoverAPI?.setServos) {
        window.RoverAPI.setServos(Math.round(currentPan), Math.round(currentTilt));
      }
    }

    requestAnimationFrame(tick);
  }

  // --- Keyboard Events Matrix ---
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
    const key = event.key.toLowerCase();

    // Interrupt event execution if intercepting rebind targets
    if (rebindingTarget && rebindingTarget.inputType === "keyboard") {
      event.preventDefault();
      mappings.keyboard[rebindingTarget.action] = key;
      rebindingTarget = null;
      ignoreInputsUntilRelease = true;
      saveMappings();
      recalcKeyboard();
      return;
    }

    // Dynamic checks match current mapping variables dynamically instead of strict literals
    const controlledActions = Object.values(mappings.keyboard);
    if (controlledActions.includes(key)) event.preventDefault();

    if (key === mappings.keyboard.stop) {
      event.preventDefault(); // Stop the webpage from scrolling down when pressing Space
      
      if (!event.repeat) {    // Blocks the browser's automatic rapid-fire repetition
        $("estop")?.click(); 
        // wasStopButtonPressed = stopButtonIsCurrentlyPressed;
        recalcKeyboard();     // Updates layout calculations safely
      }
      return;
    }
    // wasStopButtonPressed = stopButtonIsCurrentlyPressed;

    pressed.add(key);
    recalcKeyboard();
  });

  window.addEventListener("keyup", (event) => {
    pressed.delete(event.key.toLowerCase());
    recalcKeyboard();
  });

  // --- Click Listeners for Rebind UI Buttons ---
  document.addEventListener("click", (event) => {
    const btn = event.target.closest(".rebind-btn");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    const inputType = btn.getAttribute("data-input");

    rebindingTarget = { action, inputType };

    const label = btn.previousElementSibling;
    if (label) label.textContent = "...PRESS KEY/BTN...";
  });

  $("resetMappings")?.addEventListener("click", () => {
    mappings = JSON.parse(JSON.stringify(DEFAULTS));
    saveMappings();
    pressed.clear();
    recalcKeyboard();
  });

  window.addEventListener("blur", () => {
    pressed.clear();
    recalcKeyboard();
    window.RoverAPI?.stop();
  });

  window.addEventListener("gamepadconnected", (event) => {
    activeIndex = event.gamepad.index;
    everHadController = true;
    text("statController", "CONNECTED");
    window.RoverAPI?.log(`Controller connected: ${event.gamepad.id}`);
  });

  window.addEventListener("gamepaddisconnected", (event) => {
    if (activeIndex === event.gamepad.index) activeIndex = null;
    text("statController", "DISCONNECTED");
    window.RoverAPI?.sendDriveInput(0, 0);
    window.RoverAPI?.log(`Controller disconnected: ${event.gamepad.id}`, "warning");
  });

  // Initialize script states
  updateUI();
  requestAnimationFrame(tick);
  console.log("Wombot controller.js with Rebinding & Right-Stick Pan loaded");
})();
