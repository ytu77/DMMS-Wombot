/* LED preview and control-mode UI.
   These controls are local previews until a rover communication layer is added. */
RoverUI.options = {};

RoverUI.options.init = function () {
  const ledMode = document.getElementById("ledMode");
  const ledColour = document.getElementById("ledColour");
  const ledPreview = document.getElementById("ledPreview");
  const ledPreviewText = document.getElementById("ledPreviewText");
  const customControls = document.getElementById("customColourControls");
  const brightness = document.getElementById("ledBrightness");
  const speed = document.getElementById("ledSpeed");

  function updateLedPreview() {
    const mode = ledMode.value;
    const colour = ledColour.value;

    ledPreview.classList.remove("rgb-wave", "snowflakes", "circulating");
    ledPreview.style.background = "";
    ledPreview.style.color = "";
    customControls.hidden = mode !== "custom";
    ledPreview.style.opacity = Number(brightness.value) / 100;

    if (mode === "state") {
      ledPreview.style.color = "#00e676";
      ledPreviewText.textContent = "NOMINAL";
    } else if (mode === "rgb-wave") {
      ledPreview.classList.add("rgb-wave");
      ledPreviewText.textContent = "RGB WAVE";
    } else if (mode === "snowflakes") {
      ledPreview.classList.add("snowflakes");
      ledPreviewText.textContent = "SNOWFLAKES";
    } else if (mode === "circulating") {
      ledPreview.classList.add("circulating");
      ledPreviewText.textContent = "CIRCULATING";
    } else {
      ledPreview.style.background = colour;
      ledPreview.style.color = "#fff";
      ledPreviewText.textContent = colour.toUpperCase();
    }

    document.getElementById("ledColourHex").textContent = colour.toUpperCase();
  }

  ledMode.addEventListener("change", updateLedPreview);
  ledColour.addEventListener("input", updateLedPreview);
  brightness.addEventListener("input", () => {
    document.getElementById("brightnessValue").textContent = `${brightness.value}%`;
    updateLedPreview();
  });
  speed.addEventListener("input", () => {
    document.getElementById("speedValue").textContent = `${speed.value}%`;
    ledPreview.style.animationDuration =
      `${Math.max(0.5, 6 - Number(speed.value) * 0.055)}s`;
  });

  document.getElementById("applyLedSettings").addEventListener("click", () => {
    const settings = {
      mode: ledMode.value,
      colour: ledColour.value,
      brightness: Number(brightness.value),
      speed: Number(speed.value)
    };
    document.getElementById("ledFeedback").textContent =
      `Local preview set to ${settings.mode}; ${settings.brightness}% brightness. No hardware command sent.`;
    RoverUI.appendLog("TX", `LED SETTINGS PREVIEW: ${JSON.stringify(settings)}`);
    // TODO: send settings to the rover and wait for its acknowledgement.
  });

  const controlMode = document.getElementById("controlMode");
  const modeDescription = document.getElementById("modeDescription");
  const descriptions = {
    interactive: ["Interactive control", "Rover will not move and is safe to interact with."],
    manual: ["Manual control", "Rover driven directly from operator commands."],
    automatic: ["Automatic control", "Rover undertakes predetermined movement sequence (burnouts)."]
  };

  controlMode.addEventListener("change", () => {
    const [title, description] = descriptions[controlMode.value];
    modeDescription.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = description;
    modeDescription.append(heading, paragraph);
  });

  document.getElementById("applyMode").addEventListener("click", () => {
    const selected = controlMode.value;
    document.getElementById("modeFeedback").textContent =
      `Selected ${selected} mode locally. Rover has not been commanded.`;
    RoverUI.appendLog("TX", `CONTROL MODE SELECTED: ${selected} (LOCAL ONLY)`);
    // TODO: send mode command and only show active status after rover confirmation.
  });

  document.getElementById("backToDashboard").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  updateLedPreview();
};
