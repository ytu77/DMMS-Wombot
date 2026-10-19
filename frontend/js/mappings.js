/* Keyboard and gamepad input mapping editor.
   This edits the displayed mappings only; it does not yet drive the rover. */
RoverUI.mappings = {};

RoverUI.mappings.init = function () {
  const defaults = {
    forward: { keyboard: "w", controller: 12 },
    reverse: { keyboard: "s", controller: 13 },
    left: { keyboard: "a", controller: 14 },
    right: { keyboard: "d", controller: 15 },
    stop: { keyboard: " ", controller: 0 }
  };

  const mappings = JSON.parse(JSON.stringify(defaults));
  const labels = {
    forward: "Forward", reverse: "Reverse", left: "Turn left",
    right: "Turn right", stop: "Stop"
  };

  function formatKey(key) {
    if (key === " ") return "Space";
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  function render() {
    for (const action of Object.keys(mappings)) {
      document.getElementById(`key-${action}`).textContent =
        formatKey(mappings[action].keyboard);
      document.getElementById(`pad-${action}`).textContent =
        `Button ${mappings[action].controller}`;
    }
  }

  function setFeedback(message) {
    document.getElementById("mappingFeedback").textContent = message;
  }

  function startKeyboardRebind(action, button) {
    setFeedback(`Press a keyboard key for "${labels[action]}". Escape cancels.`);
    button.classList.add("listening");
    button.textContent = "Press key…";

    function cleanup() {
      window.removeEventListener("keydown", captureKey, true);
      button.classList.remove("listening");
      button.textContent = "Rebind";
    }

    function captureKey(event) {
      event.preventDefault();
      event.stopPropagation();
      cleanup();

      if (event.key === "Escape") {
        setFeedback("Keyboard remapping cancelled.");
        return;
      }

      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
        setFeedback("Choose a regular key, not a modifier key.");
        return;
      }

      const key = event.key.toLowerCase();
      const duplicate = Object.keys(mappings).find(
        other => other !== action && mappings[other].keyboard === key
      );

      if (duplicate) {
        setFeedback(`That key is already assigned to ${labels[duplicate]}.`);
        return;
      }

      mappings[action].keyboard = key;
      render();
      setFeedback(`${labels[action]} is now mapped to ${formatKey(key)} (local only).`);
    }

    window.addEventListener("keydown", captureKey, true);
  }

  function startControllerRebind(action, button) {
    const gamepads = Array.from(navigator.getGamepads?.() || []).filter(Boolean);
    if (!gamepads.length) {
      setFeedback("No controller detected. Connect a gamepad, then try again.");
      return;
    }

    button.classList.add("listening");
    button.textContent = "Press button…";
    setFeedback(`Press a controller button for "${labels[action]}".`);

    const previouslyPressed = new Set();
    for (const pad of gamepads) {
      pad.buttons.forEach((b, index) => {
        if (b.pressed) previouslyPressed.add(`${pad.index}:${index}`);
      });
    }

    let finished = false;
    let frameId;
    const deadline = performance.now() + 15000;

    function finish(message) {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frameId);
      button.classList.remove("listening");
      button.textContent = "Rebind";
      setFeedback(message);
    }

    function poll() {
      if (finished) return;
      if (performance.now() > deadline) {
        finish("Controller remapping timed out. Try again.");
        return;
      }

      const pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean);
      for (const pad of pads) {
        for (let index = 0; index < pad.buttons.length; index++) {
          const id = `${pad.index}:${index}`;
          const pressed = pad.buttons[index].pressed;

          if (pressed && !previouslyPressed.has(id)) {
            const duplicate = Object.keys(mappings).find(
              other => other !== action && mappings[other].controller === index
            );
            if (duplicate) {
              finish(`Button ${index} is already assigned to ${labels[duplicate]}.`);
              return;
            }

            mappings[action].controller = index;
            render();
            finish(`${labels[action]} mapped to controller button ${index} (local only).`);
            return;
          }

          if (pressed) previouslyPressed.add(id);
          else previouslyPressed.delete(id);
        }
      }

      frameId = requestAnimationFrame(poll);
    }

    frameId = requestAnimationFrame(poll);
  }

  document.querySelectorAll(".rebind-btn").forEach(button => {
    button.addEventListener("click", () => {
      const { action, input } = button.dataset;
      if (input === "keyboard") startKeyboardRebind(action, button);
      else startControllerRebind(action, button);
    });
  });

  document.getElementById("resetMappings").addEventListener("click", () => {
    for (const action of Object.keys(defaults)) {
      mappings[action] = { ...defaults[action] };
    }
    render();
    setFeedback("Default mappings restored locally.");
    RoverUI.appendLog("TX", "INPUT MAPPINGS RESET TO DEFAULTS (LOCAL ONLY)");
  });

  render();
};
