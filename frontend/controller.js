(() => {
  "use strict";
  const SEND_INTERVAL = 50, DEADZONE = 0.08;
  let lastSend = 0, everHadController = false, activeIndex = null;
  let keyboardThrottle = 0, keyboardSteering = 0, keyboardActive = false;
  const pressed = new Set();
  const $ = (id) => document.getElementById(id);
  function text(id, value) { const el = $(id); if (el) el.textContent = value; }
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
    keyboardThrottle = (pressed.has("w") ? 1 : 0) - (pressed.has("s") ? 1 : 0);
    keyboardSteering = (pressed.has("d") ? 1 : 0) - (pressed.has("a") ? 1 : 0);
    keyboardActive = keyboardThrottle !== 0 || keyboardSteering !== 0;
  }
  function transmit(throttle, steering, now) {
    if (now - lastSend < SEND_INTERVAL || !window.RoverAPI) return;
    window.RoverAPI.sendDriveInput(throttle, steering);
    lastSend = now;
  }
  function tick() {
    const now = performance.now(), pad = getPad();
    let throttle = 0, steering = 0;
    if (pad) {
      activeIndex = pad.index; everHadController = true;
      text("statController", "CONNECTED");
      throttle = deadzone(-(pad.axes[1] || 0));
      steering = deadzone(pad.axes[0] || 0);
      keyboardActive = false;
    } else if (keyboardActive) {
      text("statController", "KEYBOARD"); throttle = keyboardThrottle; steering = keyboardSteering;
    } else {
      activeIndex = null;
      text("statController", everHadController ? "DISCONNECTED" : "WAITING FOR INPUT");
    }
    text("throttleStatus", `Throttle: ${throttle.toFixed(2)}`);
    text("steeringStatus", `Steering: ${steering.toFixed(2)}`);
    transmit(throttle, steering, now); // zero commands while idle refresh the ESP32 watchdog
    requestAnimationFrame(tick);
  }
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", " "].includes(key)) event.preventDefault();
    if (key === " " && !event.repeat) { window.RoverAPI?.stop(); pressed.clear(); recalcKeyboard(); return; }
    if (["w", "a", "s", "d"].includes(key)) { pressed.add(key); recalcKeyboard(); }
  });
  window.addEventListener("keyup", (event) => { pressed.delete(event.key.toLowerCase()); recalcKeyboard(); });
  window.addEventListener("blur", () => { pressed.clear(); recalcKeyboard(); window.RoverAPI?.stop(); });
  window.addEventListener("gamepadconnected", (event) => { activeIndex = event.gamepad.index; everHadController = true; text("statController", "CONNECTED"); window.RoverAPI?.log(`Controller connected: ${event.gamepad.id}`); });
  window.addEventListener("gamepaddisconnected", (event) => { if (activeIndex === event.gamepad.index) activeIndex = null; text("statController", "DISCONNECTED"); window.RoverAPI?.sendDriveInput(0, 0); window.RoverAPI?.log(`Controller disconnected: ${event.gamepad.id}`, "warning"); });
  requestAnimationFrame(tick);
  console.log("Wombot controller.js loaded");
})();
