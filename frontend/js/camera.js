/* Camera placeholder and feed visibility toggle.
   Replace this placeholder drawing with your actual stream integration later. */
RoverUI.camera = {
  isFeedActive: true,
  angle: 0,
  canvas: null,
  ctx: null
};

RoverUI.camera.toggleFeed = function () {
  const camera = RoverUI.camera;
  camera.isFeedActive = !camera.isFeedActive;

  const button = document.getElementById("feedSwitch");
  const canvas = camera.canvas;
  const liveDot = document.getElementById("liveDot");
  const statusText = document.getElementById("statusText");

  button.classList.toggle("active", camera.isFeedActive);
  button.setAttribute("aria-pressed", String(camera.isFeedActive));
  canvas.classList.toggle("feed-off", !camera.isFeedActive);
  liveDot.classList.toggle("offline", !camera.isFeedActive);
  statusText.textContent = camera.isFeedActive
    ? "CAM LIVE"
    : "CAM OFF";

  RoverUI.appendLog("TX", camera.isFeedActive
    ? "UI: STREAM_ON selected (placeholder only)"
    : "UI: STREAM_OFF selected (placeholder only)");
};

RoverUI.camera.resize = function () {
  const camera = RoverUI.camera;
  if (!camera.canvas || !camera.ctx) return;

  const rect = camera.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  camera.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  camera.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  camera.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

RoverUI.camera.draw = function () {
  const camera = RoverUI.camera;
  const canvas = camera.canvas;
  const ctx = camera.ctx;

  if (camera.isFeedActive && canvas && ctx) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;

    for (let x = 0; x < width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(camera.angle);
    const radius = Math.min(width, height) * 0.15;
    ctx.strokeStyle = "#00ff66";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(0,255,102,0.1)";
    ctx.fillRect(-radius * 0.25, -radius * 0.25, radius * 0.5, radius * 0.5);
    ctx.restore();

    camera.angle += 0.015;
  }

  requestAnimationFrame(camera.draw);
};

RoverUI.camera.init = function () {
  const camera = RoverUI.camera;
  camera.canvas = document.getElementById("placeholderStream");
  camera.ctx = camera.canvas.getContext("2d");

  document.getElementById("feedSwitch").addEventListener("click", camera.toggleFeed);
  window.addEventListener("resize", camera.resize);

  // ResizeObserver handles changes when the grid changes without a window resize.
  if ("ResizeObserver" in window) {
    new ResizeObserver(camera.resize).observe(camera.canvas);
  }

  camera.resize();
  camera.draw();
};
