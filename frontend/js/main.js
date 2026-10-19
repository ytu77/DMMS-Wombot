/* Application entry point */
document.addEventListener("DOMContentLoaded", () => {
  RoverUI.initDashboard();
  RoverUI.camera.init();
  RoverUI.options.init();
  RoverUI.mappings.init();

  // Demo-only telemetry simulation. Remove this interval when real telemetry is connected.
  window.setInterval(() => {
    if (RoverUI.state.isLatched) return;

    const leftSpeed = (1.2 + Math.random() * 0.1).toFixed(2);
    const rightSpeed = (1.2 + Math.random() * 0.1).toFixed(2);

    document.getElementById("statWheelSpeeds").textContent =
      `${leftSpeed} / ${rightSpeed} m/s`;

    RoverUI.state.distanceTraveled += 0.05;
    document.getElementById("statDistance").textContent =
      `${RoverUI.state.distanceTraveled.toFixed(2)} m`;

    const rand = Math.random();
    if (rand > 0.7) {
      RoverUI.appendLog("TX", "SIMULATED INPUT - THROTTLE: 0.85");
    } else if (rand > 0.4) {
      RoverUI.appendLog("RX", `SIMULATED ODOMETRY - ${RoverUI.state.distanceTraveled.toFixed(2)}m`);
    }
  }, 2000);
});
