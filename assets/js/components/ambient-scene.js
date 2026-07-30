const SCENE_MODES = ["auto", "day", "night"];
const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_REFERENCE_UTC = Date.parse("2000-01-06T18:14:00Z");
const MILLISECONDS_PER_DAY = 86_400_000;

const PHASE_LABELS = {
  dawn: "晨光",
  day: "白昼",
  dusk: "暮色",
  night: "夜晚",
};

const MODE_LABELS = {
  auto: "循时",
  day: "白昼",
  night: "夜晚",
};

const MODE_ICONS = {
  auto: "◐",
  day: "☀",
  night: "●",
};

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeMode(value) {
  return SCENE_MODES.includes(value) ? value : "auto";
}

function phaseForMinute(minuteOfDay) {
  if (minuteOfDay >= 300 && minuteOfDay < 450) {
    return "dawn";
  }

  if (minuteOfDay >= 450 && minuteOfDay < 1050) {
    return "day";
  }

  if (minuteOfDay >= 1050 && minuteOfDay < 1170) {
    return "dusk";
  }

  return "night";
}

function phaseProgress(phase, minuteOfDay) {
  switch (phase) {
    case "dawn":
      return clamp((minuteOfDay - 300) / 150);
    case "day":
      return clamp((minuteOfDay - 450) / 600);
    case "dusk":
      return clamp((minuteOfDay - 1050) / 120);
    default: {
      const minutesSinceNightfall =
        minuteOfDay >= 1170 ? minuteOfDay - 1170 : minuteOfDay + 270;
      return clamp(minutesSinceNightfall / 570);
    }
  }
}

function moonPhaseForDate(date) {
  const daysSinceReference =
    (date.getTime() - NEW_MOON_REFERENCE_UTC) / MILLISECONDS_PER_DAY;
  const ageDays = positiveModulo(daysSinceReference, SYNODIC_MONTH_DAYS);

  return {
    fraction: ageDays / SYNODIC_MONTH_DAYS,
    ageDays,
  };
}

function smoothStep(edgeStart, edgeEnd, value) {
  const progress = clamp((value - edgeStart) / (edgeEnd - edgeStart));
  return progress * progress * (3 - 2 * progress);
}

class AmbientScene extends HTMLElement {
  static get observedAttributes() {
    return ["mode"];
  }

  constructor() {
    super();

    this._built = false;
    this._connected = false;
    this._reflectingMode = false;
    this._mode = normalizeMode(this.getAttribute("mode"));
    this._minuteTimer = null;
    this._motionPreference = null;
    this._moonCanvas = null;
    this._lastMoonSignature = "";
    this._lastSnapshot = null;
    this._parallaxFrame = null;
    this._parallaxTarget = 0;

    this._handleDocumentClick = this._handleDocumentClick.bind(this);
    this._handleModeRequest = this._handleModeRequest.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
    this._handleMotionPreference = this._handleMotionPreference.bind(this);
    this._handlePointerMove = this._handlePointerMove.bind(this);
    this._handlePointerLeave = this._handlePointerLeave.bind(this);
  }

  connectedCallback() {
    if (this._connected) {
      return;
    }

    if (!this._built) {
      this._buildScene();
    }

    this._connected = true;
    this._mode = normalizeMode(this.getAttribute("mode"));

    document.addEventListener("click", this._handleDocumentClick);
    document.addEventListener("scene-mode-request", this._handleModeRequest);
    document.addEventListener(
      "visibilitychange",
      this._handleVisibilityChange,
    );
    document.addEventListener("pointermove", this._handlePointerMove, {
      passive: true,
    });
    document.addEventListener("pointerleave", this._handlePointerLeave);

    if (typeof window.matchMedia === "function") {
      this._motionPreference = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );

      if (typeof this._motionPreference.addEventListener === "function") {
        this._motionPreference.addEventListener(
          "change",
          this._handleMotionPreference,
        );
      } else if (typeof this._motionPreference.addListener === "function") {
        this._motionPreference.addListener(this._handleMotionPreference);
      }
    }

    this._applyMotionPreference();
    this._syncModeControls();
    this._updateFromLocalTime(new Date(), true);
    this._scheduleMinuteUpdate();
  }

  disconnectedCallback() {
    this._connected = false;
    this._clearMinuteTimer();

    document.removeEventListener("click", this._handleDocumentClick);
    document.removeEventListener("scene-mode-request", this._handleModeRequest);
    document.removeEventListener(
      "visibilitychange",
      this._handleVisibilityChange,
    );
    document.removeEventListener("pointermove", this._handlePointerMove);
    document.removeEventListener("pointerleave", this._handlePointerLeave);

    if (this._parallaxFrame !== null) {
      window.cancelAnimationFrame(this._parallaxFrame);
      this._parallaxFrame = null;
    }

    if (this._motionPreference) {
      if (typeof this._motionPreference.removeEventListener === "function") {
        this._motionPreference.removeEventListener(
          "change",
          this._handleMotionPreference,
        );
      } else if (typeof this._motionPreference.removeListener === "function") {
        this._motionPreference.removeListener(this._handleMotionPreference);
      }
    }

    this._motionPreference = null;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (
      name !== "mode" ||
      oldValue === newValue ||
      this._reflectingMode
    ) {
      return;
    }

    this._applyMode(normalizeMode(newValue), {
      emit: this._connected,
      reflect: false,
    });
  }

  get mode() {
    return this._mode;
  }

  set mode(value) {
    this.setMode(value);
  }

  setMode(value, options = {}) {
    return this._applyMode(normalizeMode(value), {
      emit: options.emit !== false,
      reflect: options.reflect !== false,
    });
  }

  _buildScene() {
    this.setAttribute("aria-hidden", "true");

    const oilTexture = this._createLayer(
      "ambient-scene__layer ambient-scene__oil-texture ambient-scene__oil-texture--horizontal",
      "oil-texture",
    );

    const celestialLayer = this._createLayer(
      "ambient-scene__layer ambient-scene__celestial-layer",
      "celestial-layer",
    );
    const sun = document.createElement("span");
    sun.className = "ambient-scene__sun";
    sun.setAttribute("part", "sun");

    const moon = document.createElement("canvas");
    moon.className = "ambient-scene__moon";
    moon.setAttribute("part", "moon");
    moon.setAttribute("aria-hidden", "true");
    moon.width = 192;
    moon.height = 192;
    celestialLayer.append(sun, moon);
    this._moonCanvas = moon;

    const farClouds = this._createLayer(
      "ambient-scene__layer ambient-scene__cloud-layer ambient-scene__cloud-layer--far",
      "cloud-layer-far",
    );
    const nearClouds = this._createLayer(
      "ambient-scene__layer ambient-scene__cloud-layer ambient-scene__cloud-layer--near",
      "cloud-layer-near",
    );

    const farTrees = this._createLayer(
      "ambient-scene__layer ambient-scene__tree-layer ambient-scene__tree-layer--far",
      "tree-layer-far",
    );
    const nearTrees = this._createSlotLayer({
      className:
        "ambient-scene__layer ambient-scene__tree-layer ambient-scene__tree-layer--near",
      part: "tree-layer-near",
      slotClass: "ambient-scene__tree-slot",
      modifier: "near",
      count: 7,
    });

    const ground = this._createLayer(
      "ambient-scene__layer ambient-scene__ground",
      "ground",
    );
    const grass = this._createSlotLayer({
      className:
        "ambient-scene__layer ambient-scene__grass-layer",
      part: "grass-layer",
      slotClass: "ambient-scene__grass-slot",
      modifier: "ground",
      count: 12,
    });

    this.replaceChildren(
      oilTexture,
      celestialLayer,
      farClouds,
      nearClouds,
      farTrees,
      nearTrees,
      ground,
      grass,
    );

    this._built = true;
  }

  _createLayer(className, part) {
    const layer = document.createElement("div");
    layer.className = className;
    layer.setAttribute("part", part);
    layer.setAttribute("aria-hidden", "true");
    return layer;
  }

  _createSlotLayer({
    className,
    part,
    slotClass,
    modifier,
    count,
  }) {
    const layer = this._createLayer(className, part);

    for (let index = 1; index <= count; index += 1) {
      const slot = document.createElement("span");
      slot.className = [
        slotClass,
        `${slotClass}--${modifier}`,
        `${slotClass}--${index}`,
      ].join(" ");
      slot.dataset.slot = String(index);
      slot.setAttribute("aria-hidden", "true");
      layer.append(slot);
    }

    return layer;
  }

  _applyMode(nextMode, { emit = true, reflect = true } = {}) {
    const changed = nextMode !== this._mode;
    this._mode = nextMode;

    if (reflect && this.getAttribute("mode") !== nextMode) {
      this._reflectingMode = true;
      this.setAttribute("mode", nextMode);
      this._reflectingMode = false;
    }

    if (!this._connected) {
      return this._mode;
    }

    this._syncModeControls();
    this._updateFromLocalTime(new Date(), true);

    if (changed && emit) {
      this.dispatchEvent(
        new CustomEvent("scene-mode-change", {
          bubbles: true,
          composed: true,
          detail: {
            mode: this._mode,
            phase: this.dataset.phase,
            clockPhase: this.dataset.clockPhase,
          },
        }),
      );
    }

    return this._mode;
  }

  _handleDocumentClick(event) {
    const eventTarget =
      event.target instanceof Element
        ? event.target.closest("[data-scene-mode]")
        : null;

    if (!eventTarget || eventTarget.matches(":disabled")) {
      return;
    }

    const declaredMode = eventTarget.getAttribute("data-scene-mode");
    const nextMode = SCENE_MODES.includes(declaredMode)
      ? declaredMode
      : SCENE_MODES[
          (SCENE_MODES.indexOf(this._mode) + 1) % SCENE_MODES.length
        ];

    this.setMode(nextMode);
  }

  _handleModeRequest(event) {
    const requestedMode = event.detail?.mode;
    if (SCENE_MODES.includes(requestedMode)) {
      this.setMode(requestedMode);
    }
  }

  _syncModeControls() {
    this.dataset.sceneMode = this._mode;
    document.documentElement.dataset.sceneMode = this._mode;

    document
      .querySelectorAll(
        'button[data-scene-mode], [role="button"][data-scene-mode]',
      )
      .forEach((control) => {
        const declaredMode = control.getAttribute("data-scene-mode");
        const isDedicatedControl = SCENE_MODES.includes(declaredMode);

        control.dataset.sceneModeCurrent = this._mode;

        if (isDedicatedControl) {
          control.setAttribute(
            "aria-pressed",
            String(declaredMode === this._mode),
          );
          return;
        }

        control.removeAttribute("aria-pressed");
        control.setAttribute(
          "aria-label",
          `昼夜显示：${MODE_LABELS[this._mode]}，点击切换`,
        );

        const label = control.querySelector("[data-scene-mode-label]");
        const icon = control.querySelector(".scene-mode-icon");

        if (label) {
          label.textContent = MODE_LABELS[this._mode];
        }

        if (icon) {
          icon.textContent = MODE_ICONS[this._mode];
        }
      });
  }

  _updateFromLocalTime(date, forceMoonRender = false) {
    const minuteOfDay =
      date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const dayProgress = minuteOfDay / 24;
    const clockPhase = phaseForMinute(minuteOfDay * 60);
    const phase =
      this._mode === "auto"
        ? clockPhase
        : this._mode === "day"
          ? "day"
          : "night";
    const sceneMinute =
      this._mode === "day"
        ? 720
        : this._mode === "night"
          ? 0
          : minuteOfDay * 60;
    const currentPhaseProgress = phaseProgress(
      phase,
      sceneMinute,
    );
    const moon = moonPhaseForDate(date);
    const celestial = this._celestialPosition(minuteOfDay * 60);
    const lightLevel = this._lightLevel(
      phase,
      currentPhaseProgress,
    );

    this.dataset.phase = phase;
    this.dataset.clockPhase = clockPhase;
    this.dataset.minuteOfDay = (minuteOfDay * 60).toFixed(3);
    this.dataset.dayProgress = dayProgress.toFixed(6);
    this.dataset.moonPhase = moon.fraction.toFixed(6);

    const root = document.documentElement;
    root.dataset.scenePhase = phase;
    root.dataset.clockPhase = clockPhase;

    const variables = {
      "--scene-minute-of-day": (minuteOfDay * 60).toFixed(3),
      "--scene-day-progress": dayProgress.toFixed(6),
      "--scene-day-progress-percent": `${(dayProgress * 100).toFixed(4)}%`,
      "--scene-phase-progress": currentPhaseProgress.toFixed(6),
      "--scene-sun-x": `${celestial.sunX.toFixed(3)}%`,
      "--scene-sun-y": `${celestial.sunY.toFixed(3)}%`,
      "--scene-moon-x": `${celestial.moonX.toFixed(3)}%`,
      "--scene-moon-y": `${celestial.moonY.toFixed(3)}%`,
      "--scene-light-level": lightLevel.toFixed(4),
      "--scene-moon-phase": moon.fraction.toFixed(6),
      "--scene-moon-age-days": moon.ageDays.toFixed(4),
    };

    [this, root].forEach((target) => {
      Object.entries(variables).forEach(([name, value]) => {
        target.style.setProperty(name, value);
      });
    });

    document.querySelectorAll("[data-phase-label]").forEach((label) => {
      label.textContent = PHASE_LABELS[phase];
    });

    document
      .querySelectorAll(".day-track [data-day-progress]")
      .forEach((indicator) => {
        const percentage = dayProgress * 100;
        indicator.dataset.dayProgress = dayProgress.toFixed(6);
        indicator.style.setProperty(
          "--scene-day-progress",
          dayProgress.toFixed(6),
        );
        indicator.style.setProperty(
          "--scene-day-progress-percent",
          `${percentage.toFixed(4)}%`,
        );
        indicator.style.width = `${percentage.toFixed(4)}%`;
      });

    this._drawMoon(date, moon, forceMoonRender);

    this._lastSnapshot = {
      timestamp: date.getTime(),
      phase,
      clockPhase,
      mode: this._mode,
      minuteOfDay: minuteOfDay * 60,
      dayProgress,
      phaseProgress: currentPhaseProgress,
      moonPhase: moon.fraction,
      moonAgeDays: moon.ageDays,
    };

    this.dispatchEvent(
      new CustomEvent("scene-time-change", {
        bubbles: true,
        composed: true,
        detail: { ...this._lastSnapshot },
      }),
    );
  }

  _celestialPosition(clockMinute) {
    const visualMinute =
      this._mode === "day"
        ? 720
        : this._mode === "night"
          ? 0
          : clockMinute;

    const sunIsUp = visualMinute >= 300 && visualMinute <= 1170;
    const sunProgress = clamp((visualMinute - 300) / 870);
    const sunX = 5 + sunProgress * 90;
    const sunY = sunIsUp
      ? 72 - Math.sin(Math.PI * sunProgress) * 58
      : 112;

    const minutesSinceMoonrise =
      visualMinute >= 1170 ? visualMinute - 1170 : visualMinute + 270;
    const moonIsUp = visualMinute >= 1170 || visualMinute <= 300;
    const moonProgress = clamp(minutesSinceMoonrise / 570);
    const moonX = 5 + moonProgress * 90;
    const moonY = moonIsUp
      ? 72 - Math.sin(Math.PI * moonProgress) * 58
      : 112;

    return {
      sunX,
      sunY,
      moonX,
      moonY,
    };
  }

  _lightLevel(phase, progress) {
    if (this._mode === "day") {
      return 1;
    }

    if (this._mode === "night") {
      return 0.08;
    }

    switch (phase) {
      case "dawn":
        return 0.18 + progress * 0.77;
      case "day":
        return 0.95;
      case "dusk":
        return 0.9 - progress * 0.72;
      default:
        return 0.08;
    }
  }

  _drawMoon(date, phase, force = false) {
    const canvas = this._moonCanvas;
    if (!canvas) {
      return;
    }

    const devicePixelRatio = clamp(window.devicePixelRatio || 1, 1, 3);
    const size = Math.round(192 * devicePixelRatio);
    const signature = `${Math.round(phase.fraction * 100_000)}:${size}`;

    if (!force && signature === this._lastMoonSignature) {
      return;
    }

    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }

    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false,
    });

    if (!context) {
      return;
    }

    context.clearRect(0, 0, size, size);

    const image = context.createImageData(size, size);
    const pixels = image.data;
    const center = (size - 1) / 2;
    const radius = size * 0.43;
    const phaseAngle = phase.fraction * Math.PI * 2;
    const lightX = Math.sin(phaseAngle);
    const lightZ = -Math.cos(phaseAngle);

    for (let y = 0; y < size; y += 1) {
      const normalizedY = (y - center) / radius;

      for (let x = 0; x < size; x += 1) {
        const normalizedX = (x - center) / radius;
        const distanceSquared =
          normalizedX * normalizedX + normalizedY * normalizedY;

        if (distanceSquared > 1.02) {
          continue;
        }

        const pixelIndex = (y * size + x) * 4;
        const normalZ = Math.sqrt(Math.max(0, 1 - distanceSquared));
        const lightDot = normalizedX * lightX + normalZ * lightZ;
        const illumination = smoothStep(-0.018, 0.018, lightDot);
        const limbShade = 0.72 + normalZ * 0.28;
        const edgeAlpha = clamp((1 - Math.sqrt(distanceSquared)) * radius + 0.5);

        const shadowRed = 72;
        const shadowGreen = 86;
        const shadowBlue = 112;
        const lightRed = 255;
        const lightGreen = 246;
        const lightBlue = 207;

        pixels[pixelIndex] = Math.round(
          (shadowRed + (lightRed - shadowRed) * illumination) * limbShade,
        );
        pixels[pixelIndex + 1] = Math.round(
          (shadowGreen + (lightGreen - shadowGreen) * illumination) *
            limbShade,
        );
        pixels[pixelIndex + 2] = Math.round(
          (shadowBlue + (lightBlue - shadowBlue) * illumination) * limbShade,
        );
        pixels[pixelIndex + 3] = Math.round(
          255 * edgeAlpha * (0.2 + illumination * 0.8),
        );
      }
    }

    context.putImageData(image, 0, 0);
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(238, 244, 255, 0.66)";
    context.lineWidth = Math.max(1, devicePixelRatio);
    context.stroke();

    canvas.dataset.moonPhase = phase.fraction.toFixed(6);
    canvas.dataset.moonAgeDays = phase.ageDays.toFixed(3);
    canvas.dataset.moonDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");

    this._lastMoonSignature = signature;
  }

  _handleVisibilityChange() {
    if (document.hidden) {
      this._clearMinuteTimer();
      return;
    }

    this._updateFromLocalTime(new Date(), true);
    this._scheduleMinuteUpdate();
  }

  _scheduleMinuteUpdate() {
    this._clearMinuteTimer();

    if (!this._connected || document.hidden) {
      return;
    }

    const millisecondsToNextMinute =
      60_000 - (Date.now() % 60_000) + 30;

    this._minuteTimer = window.setTimeout(() => {
      this._updateFromLocalTime(new Date());
      this._scheduleMinuteUpdate();
    }, millisecondsToNextMinute);
  }

  _clearMinuteTimer() {
    if (this._minuteTimer !== null) {
      window.clearTimeout(this._minuteTimer);
      this._minuteTimer = null;
    }
  }

  _handleMotionPreference() {
    this._applyMotionPreference();
  }

  _handlePointerMove(event) {
    if (this._motionPreference?.matches || !Number.isFinite(event.clientX)) {
      return;
    }

    const viewportWidth = Math.max(1, window.innerWidth);
    const normalized = clamp(event.clientX / viewportWidth, 0, 1) - 0.5;
    const maximumShift = viewportWidth <= 700 ? 26 : 16;
    this._parallaxTarget = normalized * maximumShift * -2;

    if (this._parallaxFrame !== null) {
      return;
    }

    this._parallaxFrame = window.requestAnimationFrame(() => {
      this.style.setProperty(
        "--scene-parallax-x",
        `${this._parallaxTarget.toFixed(2)}px`,
      );
      this._parallaxFrame = null;
    });
  }

  _handlePointerLeave() {
    this._parallaxTarget = 0;
    this.style.setProperty("--scene-parallax-x", "0px");
  }

  _applyMotionPreference() {
    const reducedMotion = Boolean(this._motionPreference?.matches);
    const root = document.documentElement;
    const value = reducedMotion ? "true" : "false";
    const motionFactor = reducedMotion ? "999999" : "1";

    this.dataset.reducedMotion = value;
    root.dataset.reducedMotion = value;
    this.style.setProperty("--scene-motion-factor", motionFactor);
    root.style.setProperty("--scene-motion-factor", motionFactor);

    if (reducedMotion) {
      this._handlePointerLeave();
    }
  }
}

if (!customElements.get("ambient-scene")) {
  customElements.define("ambient-scene", AmbientScene);
}

export { AmbientScene, moonPhaseForDate };
