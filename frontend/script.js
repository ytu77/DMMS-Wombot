(() => {
  "use strict";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  const $ = (id) => document.getElementById(id);
  let estopLatched = false, cameraFrame = null, latestTelemetryAt = 0;

  function log(message, level = "info") {
    const terminal = $("logTerminal");
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (terminal) {
      const row = document.createElement("div");
      row.className = `log-line log-${level}`;
      row.textContent = line;
      terminal.appendChild(row);
      terminal.scrollTop = terminal.scrollHeight;
      while (terminal.children.length > 200) terminal.removeChild(terminal.firstChild);
    }
    if (level === "error") console.error(line); else console.log(line);
  }
  function setText(id, value) { const node = $(id); if (node) node.textContent = value; }
  function sendCommand(command) {
    if (socket.readyState !== WebSocket.OPEN) { log("Cannot send: Pi WebSocket is disconnected.", "error"); return false; }
    socket.send(JSON.stringify(command)); log(`TX ${JSON.stringify(command)}`); return true;
  }
  function clamp(value, min, max) { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0; }
  function sendDriveInput(throttle, steering) {
    if (estopLatched) return false;
    return sendCommand({ type: "drive", throttle: clamp(Number(throttle), -1, 1), steering: clamp(Number(steering), -1, 1) });
  }
  function updateEstop() {
    const button = $("estop");
    if (button) {
      button.setAttribute("aria-pressed", String(estopLatched));
      button.classList.toggle("latched", estopLatched);
      button.textContent = estopLatched ? "E-Stop Latched · Reset" : "E-Stop";
    }
    if (estopLatched) setText("statRoverState", "E-STOP LATCHED");
  }
  function setCamera(on) {
    const canvas = $("placeholderStream");
    if (!canvas) return;
    if (on && !cameraFrame) {
      cameraFrame = document.createElement("iframe");
      cameraFrame.src = `http://${location.hostname}:8889/camera`;
      cameraFrame.title = "Wombot camera stream";
      cameraFrame.allow = "autoplay; fullscreen";
      Object.assign(cameraFrame.style, { width: "100%", height: "100%", minHeight: "240px", border: "0", background: "#000", display: "block" });
      canvas.hidden = true; canvas.insertAdjacentElement("afterend", cameraFrame);
    } else if (!on) {
      if (cameraFrame) cameraFrame.remove();
      cameraFrame = null; canvas.hidden = false;
    }
    setText("statusText", on ? "CAM REQUESTED" : "CAM OFF");
    const dot = $("liveDot"); if (dot) dot.classList.toggle("live", on);
    const button = $("feedSwitch"); if (button) { button.classList.toggle("active", on); button.setAttribute("aria-pressed", String(on)); }
  }
  function handleTelemetry(message) {
    latestTelemetryAt = Date.now();
    const data = message.data || {}, wheels = data.wheels || {};
    const values = [wheels.fl?.rpm, wheels.rl?.rpm, wheels.fr?.rpm, wheels.rr?.rpm].map(Number);
    if (values.every(Number.isFinite)) setText("statWheelSpeeds", `${((values[0] + values[1]) / 2).toFixed(1)} / ${((values[2] + values[3]) / 2).toFixed(1)} RPM`);
    const odo = data.odometry;
    if (odo && Number.isFinite(Number(odo.x_m)) && Number.isFinite(Number(odo.y_m))) setText("statDistance", `${Math.hypot(Number(odo.x_m), Number(odo.y_m)).toFixed(2)} m`);
    if (data.state && !estopLatched) setText("statRoverState", String(data.state).toUpperCase());
    if (data.estop_latched !== undefined) { estopLatched = Boolean(data.estop_latched); updateEstop(); }
  }
  function onMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { log(`RX non-JSON: ${raw}`, "warning"); return; }
    log(`RX ${JSON.stringify(message)}`);
    switch (message.type) {
      case "connection":
        if (message.component === "pi") setText("statRoverComms", message.connected ? "PI CONNECTED" : "PI DISCONNECTED");
        else if (message.component === "esp32") setText("statRoverComms", message.connected ? "ESP32 CONNECTED" : "ESP32 DISCONNECTED");
        break;
      case "ack":
        log(`ACK #${message.id ?? "?"}: ${String(message.status || "unknown").toUpperCase()}${message.error ? ` — ${message.error.code}: ${message.error.message}` : ""}`, message.status === "rejected" ? "error" : "info");
        if (message.error?.code === "ESTOP_LATCHED") { estopLatched = true; updateEstop(); }
        break;
      case "telemetry": handleTelemetry(message); break;
      case "event":
        log(`ESP32 event: ${message.event || "unknown"}`, "warning");
        if (message.event === "estop_activated") estopLatched = true;
        if (message.event === "estop_cleared") estopLatched = false;
        updateEstop(); break;
      case "camera": setCamera(message.state === "on"); if (message.message) log(message.message, message.state === "error" ? "error" : "info"); break;
      case "ui_error": log(`${message.code || "ERROR"}: ${message.message || "Unknown error"}`, "error"); break;
      case "log": log(`${message.source || "system"}: ${message.message || ""}`, message.level || "info"); break;
      case "pong": break;
      default: log(`Unhandled message type: ${message.type || "missing"}`, "warning");
    }
  }
  socket.addEventListener("open", () => { setText("statRoverComms", "PI CONNECTED · ESP32 CHECKING"); log("Connected to Pi WebSocket."); sendCommand({ type: "ping" }); });
  socket.addEventListener("message", (event) => onMessage(event.data));
  socket.addEventListener("close", () => { setText("statRoverComms", "PI DISCONNECTED"); setText("statRoverState", "LINK LOST"); log("WebSocket lost; ESP32 watchdog should stop the rover.", "error"); });
  socket.addEventListener("error", () => log("WebSocket error.", "error"));

  window.RoverAPI = {
    sendCommand, sendDriveInput,
    stop: () => sendCommand({ type: "stop" }),
    emergencyStop: () => sendCommand({ type: "estop", reason: "operator" }),
    clearEstop: () => sendCommand({ type: "clear_estop" }),
    setServos: (pan_deg, tilt_deg) => sendCommand({ type: "servos", pan_deg, tilt_deg }),
    setLED: (settings) => sendCommand({ type: "led", ...settings }),
    log, getSocketState: () => socket.readyState
  };
  // Compatibility for existing frontend modules.
  window.sendCommand = sendCommand;
  window.sendDriveInput = sendDriveInput;
  window.RoverUI = { clearLog: () => { const terminal = $("logTerminal"); if (terminal) terminal.replaceChildren(); } };

  $("feedSwitch")?.addEventListener("click", () => sendCommand({ type: $("feedSwitch").getAttribute("aria-pressed") === "true" ? "camera_off" : "camera_on" }));
  $("estop")?.addEventListener("click", () => {
    if (!estopLatched) { estopLatched = true; updateEstop(); sendCommand({ type: "estop", reason: "operator" }); }
    else if (confirm("Reset software E-stop? Ensure the rover is safe. Motors remain stopped until a new drive command.")) sendCommand({ type: "clear_estop" });
  });
  $("applyLedSettings")?.addEventListener("click", () => {
    const mode = $("ledMode")?.value || "state";
    const colour = $("ledColour")?.value || "#00e676";
    const settings = { mode: mode === "custom" ? "solid" : mode, colour, brightness: Number($("ledBrightness")?.value ?? 75), speed: Number($("ledSpeed")?.value ?? 50) };
    const sent = sendCommand({ type: "led", ...settings });
    setText("ledFeedback", sent ? "Lighting command sent; waiting for ESP32 acknowledgement." : "Not sent: Pi connection unavailable.");
  });
  $("applyMode")?.addEventListener("click", () => setText("modeFeedback", "UI-only for now; operating modes are not implemented in protocol v1."));
  $("ledColour")?.addEventListener("input", (event) => { setText("ledColourHex", event.target.value.toUpperCase()); const preview = $("ledPreview"); if (preview) preview.style.background = event.target.value; });
  for (const [rangeId, labelId] of [["ledBrightness", "brightnessValue"], ["ledSpeed", "speedValue"]]) $(rangeId)?.addEventListener("input", (event) => setText(labelId, `${event.target.value}%`));
  setInterval(() => { if (latestTelemetryAt && Date.now() - latestTelemetryAt > 2000 && !estopLatched) setText("statRoverState", "TELEMETRY STALE"); }, 500);
  console.log("Wombot script.js loaded");
})();
