/* Dashboard state, E-stop demo, and communications log */
window.RoverUI = window.RoverUI || {};

RoverUI.state = {
  isLatched: false,
  distanceTraveled: 42.85
};

RoverUI.appendLog = function (direction, message) {
  const terminal = document.getElementById("logTerminal");
  if (!terminal) return;

  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.className = `log-line ${
    direction === "TX" ? "log-tx" :
    direction === "RX" ? "log-rx" : "log-err"
  }`;

  const prefix = direction === "TX" ? "➔ LAPTOP_TX:" :
    direction === "RX" ? "← ROVER_RX:" : "⚠ SYSTEM:";

  line.textContent = `[${time}] ${prefix} ${message}`;
  terminal.appendChild(line);

  // Keep the log from growing indefinitely in the demo.
  while (terminal.children.length > 250) {
    terminal.removeChild(terminal.firstChild);
  }

  terminal.scrollTop = terminal.scrollHeight;
};

RoverUI.setRoverState = function (text, className) {
  const el = document.getElementById("statRoverState");
  if (!el) return;
  el.textContent = text;
  el.className = `stat-value ${className}`;
};

RoverUI.handleEStopClick = function () {
  const btn = document.getElementById("estop");
  RoverUI.state.isLatched = !RoverUI.state.isLatched;

  if (RoverUI.state.isLatched) {
    btn.classList.add("latched");
    btn.setAttribute("aria-pressed", "true");
    RoverUI.appendLog("ERR", "DEMO: E-STOP PRESSED — simulated lockout only.");
    RoverUI.setRoverState("EMERGENCY STOP (SIMULATED)", "text-offline");
    document.getElementById("statWheelSpeeds").textContent = "0.00 / 0.00 m/s";
  } else {
    btn.classList.remove("latched");
    btn.setAttribute("aria-pressed", "false");
    RoverUI.appendLog("TX", "DEMO: UI E-stop latch cleared; no hardware reset sent.");
    RoverUI.setRoverState("NOMINAL / IDLE (SIMULATED)", "text-online");
  }
};

RoverUI.initDashboard = function () {
  document.getElementById("estop").addEventListener("click", RoverUI.handleEStopClick);

  RoverUI.appendLog("TX", "CONSOLE_INIT_SUCCESS (SIMULATION MODE)");
  RoverUI.appendLog("RX", "STATE_NOMINAL - ODO: 42.85m (SIMULATED)");
};

RoverUI.clearLog = function () {
  const terminal = document.getElementById("logTerminal");
  if (!terminal) return;
  terminal.innerHTML = "";
  RoverUI.appendLog("TX", "LOG CLEARED (SIMULATION MODE)");
};
