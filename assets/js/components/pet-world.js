const DEFAULT_MANIFESTS = Object.freeze({
  noirrose: "/assets/pets/noirrose/pet.json",
  miemieyan: "/assets/pets/miemieyan/pet.json",
});

const packageCache = new Map();
const imageCache = new Map();
let nextInstanceId = 0;

const clamp = (value, minimum, maximum) =>
  Math.min(Math.max(value, minimum), maximum);

const randomBetween = (minimum, maximum) =>
  minimum + Math.random() * (maximum - minimum);

function chooseWeightedAction(
  actions,
  {
    blockedIds = [],
    avoidIds = [],
    random = Math.random,
  } = {},
) {
  const blocked = new Set(blockedIds.filter(Boolean));
  const avoided = new Set(avoidIds.filter(Boolean));
  const eligible = actions.filter(
    (action) => action.randomWeight > 0 && !blocked.has(action.id),
  );
  const preferred = eligible.filter((action) => !avoided.has(action.id));
  const pool = preferred.length > 0 ? preferred : eligible;
  const totalWeight = pool.reduce(
    (sum, action) => sum + action.randomWeight,
    0,
  );

  if (totalWeight <= 0) {
    return null;
  }

  const randomValue = Number(random());
  let cursor =
    clamp(
      Number.isFinite(randomValue) ? randomValue : 0,
      0,
      1 - Number.EPSILON,
    ) * totalWeight;
  for (const action of pool) {
    cursor -= action.randomWeight;
    if (cursor < 0) {
      return action;
    }
  }
  return pool.at(-1) ?? null;
}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function requiredInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function cachedPromise(cache, key, factory) {
  if (cache.has(key)) {
    return cache.get(key);
  }

  let promise;
  promise = Promise.resolve()
    .then(factory)
    .catch((error) => {
      if (cache.get(key) === promise) {
        cache.delete(key);
      }
      throw error;
    });
  cache.set(key, promise);
  return promise;
}

function normalizeManifest(rawManifest, manifestUrl) {
  if (!isRecord(rawManifest) || rawManifest.manifestVersion !== 2) {
    throw new TypeError(`${manifestUrl} is not a manifestVersion 2 pet`);
  }

  const id = requiredString(rawManifest.id, "id");
  const displayName = requiredString(rawManifest.displayName, "displayName");
  const description =
    typeof rawManifest.description === "string" ? rawManifest.description : "";
  const spritesheetPath = requiredString(
    rawManifest.spritesheetPath,
    "spritesheetPath",
  );

  if (!isRecord(rawManifest.atlas)) {
    throw new TypeError("atlas must be an object");
  }

  const atlas = Object.freeze({
    columns: requiredInteger(rawManifest.atlas.columns, "atlas.columns", 1, 64),
    rows: requiredInteger(rawManifest.atlas.rows, "atlas.rows", 1, 64),
    cellWidth: requiredInteger(
      rawManifest.atlas.cellWidth,
      "atlas.cellWidth",
      1,
      2048,
    ),
    cellHeight: requiredInteger(
      rawManifest.atlas.cellHeight,
      "atlas.cellHeight",
      1,
      2048,
    ),
    previewFrame: Object.freeze({
      row: requiredInteger(
        rawManifest.atlas.previewFrame?.row,
        "atlas.previewFrame.row",
        0,
        63,
      ),
      column: requiredInteger(
        rawManifest.atlas.previewFrame?.column,
        "atlas.previewFrame.column",
        0,
        63,
      ),
    }),
  });

  if (
    atlas.previewFrame.row >= atlas.rows ||
    atlas.previewFrame.column >= atlas.columns
  ) {
    throw new RangeError("atlas.previewFrame is outside the atlas");
  }

  if (!Array.isArray(rawManifest.actions) || rawManifest.actions.length > 64) {
    throw new TypeError("actions must be an array with at most 64 entries");
  }

  const actions = [];
  const actionsById = new Map();

  rawManifest.actions.forEach((rawAction, actionIndex) => {
    if (!isRecord(rawAction)) {
      throw new TypeError(`actions[${actionIndex}] must be an object`);
    }

    const actionId = requiredString(
      rawAction.id,
      `actions[${actionIndex}].id`,
    );
    if (actionsById.has(actionId)) {
      throw new TypeError(`duplicate action id: ${actionId}`);
    }

    const defaultRow =
      rawAction.row === undefined
        ? null
        : requiredInteger(
            rawAction.row,
            `actions[${actionIndex}].row`,
            0,
            atlas.rows - 1,
          );

    if (
      !Array.isArray(rawAction.frames) ||
      rawAction.frames.length < 1 ||
      rawAction.frames.length > 64
    ) {
      throw new TypeError(
        `actions[${actionIndex}].frames must contain 1 to 64 entries`,
      );
    }

    const frames = rawAction.frames.map((rawFrame, frameIndex) => {
      if (!isRecord(rawFrame)) {
        throw new TypeError(
          `actions[${actionIndex}].frames[${frameIndex}] must be an object`,
        );
      }

      const row =
        rawFrame.row === undefined
          ? defaultRow
          : requiredInteger(
              rawFrame.row,
              `actions[${actionIndex}].frames[${frameIndex}].row`,
              0,
              atlas.rows - 1,
            );

      if (row === null) {
        throw new TypeError(
          `actions[${actionIndex}].frames[${frameIndex}] needs a row`,
        );
      }

      return Object.freeze({
        row,
        column: requiredInteger(
          rawFrame.column,
          `actions[${actionIndex}].frames[${frameIndex}].column`,
          0,
          atlas.columns - 1,
        ),
        durationMs: requiredInteger(
          rawFrame.durationMs,
          `actions[${actionIndex}].frames[${frameIndex}].durationMs`,
          16,
          60_000,
        ),
      });
    });

    const action = Object.freeze({
      id: actionId,
      label:
        typeof rawAction.label === "string" && rawAction.label.trim() !== ""
          ? rawAction.label
          : actionId,
      frames: Object.freeze(frames),
      loop: rawAction.loop === true,
      menu: rawAction.menu === true,
      randomWeight: clamp(
        Number.isInteger(rawAction.randomWeight) ? rawAction.randomWeight : 0,
        0,
        1000,
      ),
    });

    actions.push(action);
    actionsById.set(action.id, action);
  });

  const bindings = Object.create(null);
  if (!isRecord(rawManifest.bindings)) {
    throw new TypeError("bindings must be an object");
  }

  for (const [binding, actionId] of Object.entries(rawManifest.bindings)) {
    if (typeof actionId !== "string" || !actionsById.has(actionId)) {
      throw new TypeError(`binding ${binding} references an unknown action`);
    }
    bindings[binding] = actionId;
  }

  return Object.freeze({
    id,
    displayName,
    description,
    manifestUrl,
    spritesheetUrl: new URL(spritesheetPath, manifestUrl).href,
    atlas,
    actions: Object.freeze(actions),
    actionsById,
    bindings: Object.freeze(bindings),
  });
}

async function loadImageSource(imageUrl) {
  return cachedPromise(imageCache, imageUrl, async () => {
    const response = await fetch(imageUrl, {
      credentials: "same-origin",
      headers: { Accept: "image/avif,image/webp,image/*" },
    });
    if (!response.ok) {
      throw new Error(`Unable to load spritesheet (${response.status})`);
    }

    const blob = await response.blob();
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(blob);
      } catch {
        // Safari versions with partial WebP ImageBitmap support use the image fallback.
      }
    }

    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener(
        "error",
        () => reject(new Error("Unable to decode spritesheet")),
        { once: true },
      );
      // Use the same-origin URL instead of a blob URL so the page's
      // `img-src 'self' data:` policy also permits the fallback.
      image.src = imageUrl;
    });
    return image;
  });
}

async function loadPetPackage(manifestPath) {
  const manifestUrl = new URL(manifestPath, document.baseURI).href;
  return cachedPromise(packageCache, manifestUrl, async () => {
    const response = await fetch(manifestUrl, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Unable to load pet manifest (${response.status})`);
    }

    const manifest = normalizeManifest(await response.json(), manifestUrl);
    const image = await loadImageSource(manifest.spritesheetUrl);
    const imageWidth = image.width ?? image.naturalWidth;
    const imageHeight = image.height ?? image.naturalHeight;
    const expectedWidth = manifest.atlas.columns * manifest.atlas.cellWidth;
    const expectedHeight = manifest.atlas.rows * manifest.atlas.cellHeight;

    if (imageWidth !== expectedWidth || imageHeight !== expectedHeight) {
      throw new RangeError(
        `${manifest.displayName} spritesheet is ${imageWidth}x${imageHeight}; ` +
          `expected ${expectedWidth}x${expectedHeight}`,
      );
    }

    return Object.freeze({ manifest, image });
  });
}

function makeElement(tagName, className, attributes = {}) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function safeClassSuffix(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

class PetController {
  constructor(world, petPackage, index, total) {
    this.world = world;
    this.petPackage = petPackage;
    this.manifest = petPackage.manifest;
    this.index = index;
    this.total = total;
    this.instanceId = ++nextInstanceId;

    this.x = 0;
    this.y = 0;
    this.width = this.world.suggestedPetWidth();
    this.height =
      (this.width * this.manifest.atlas.cellHeight) /
      this.manifest.atlas.cellWidth;
    this.previousMaximumX = 0;
    this.state = "idle";
    this.currentAction = null;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.animationOnce = false;
    this.nextAutoAt = Number.POSITIVE_INFINITY;
    this.lastAutoActionId = null;
    this.lastWasWalk = false;
    this.moveTargetX = 0;
    this.moveDirection = 0;
    this.moveSpeed = 0;
    this.pointerSession = null;
    this.drop = null;

    this.root = makeElement(
      "div",
      `pet-world__pet pet-world__pet--${safeClassSuffix(this.manifest.id)}`,
      {
        "data-pet-id": this.manifest.id,
        role: "group",
        "aria-label": this.manifest.displayName,
      },
    );
    this.root.classList.add("is-ready", "is-idle");

    this.canvas = makeElement("canvas", "pet-world__canvas", {
      role: "button",
      tabindex: "0",
      "aria-label": `点击让 ${this.manifest.displayName} 随机做动作，拖动可移动`,
    });
    this.canvas.width = this.manifest.atlas.cellWidth;
    this.canvas.height = this.manifest.atlas.cellHeight;
    this.canvas.title = `${this.manifest.displayName}：点击随机动作，拖动可移动`;

    this.context = this.canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!this.context) {
      throw new Error("Canvas 2D is not available");
    }
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = "high";

    this.status = makeElement(
      "span",
      "pet-world__status pet-world__status--pet",
      {
        id: `pet-world-status-${this.instanceId}`,
        "aria-live": "polite",
      },
    );
    this.canvas.setAttribute("aria-describedby", this.status.id);

    this.root.append(this.canvas, this.status);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onCanvasKeyDown = this.onCanvasKeyDown.bind(this);
    this.onContextMenu = (event) => event.preventDefault();

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("keydown", this.onCanvasKeyDown);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);

    this.applySuggestedSize();
    this.renderPreview();
  }

  mount(stage) {
    stage.append(this.root);
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("keydown", this.onCanvasKeyDown);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.root.remove();
  }

  applySuggestedSize() {
    const suggestedWidth = this.world.suggestedPetWidth();
    const suggestedHeight =
      (suggestedWidth * this.manifest.atlas.cellHeight) /
      this.manifest.atlas.cellWidth;
    this.root.style.setProperty("--pet-width", `${suggestedWidth}px`);
    this.root.style.setProperty("--pet-height", `${suggestedHeight}px`);
    this.root.style.setProperty(
      "--pet-aspect",
      `${this.manifest.atlas.cellWidth} / ${this.manifest.atlas.cellHeight}`,
    );
  }

  measure() {
    this.applySuggestedSize();
    const bounds = this.canvas.getBoundingClientRect();
    const fallbackWidth = this.world.suggestedPetWidth();
    const fallbackHeight =
      (fallbackWidth * this.manifest.atlas.cellHeight) /
      this.manifest.atlas.cellWidth;

    this.width = bounds.width >= 32 ? bounds.width : fallbackWidth;
    this.height = bounds.height >= 32 ? bounds.height : fallbackHeight;
  }

  layout(initial = false) {
    const stage = this.world.stageBounds();
    this.measure();
    const maximumX = Math.max(0, stage.width - this.width);

    if (initial) {
      const initialFractions =
        this.total === 2
          ? [0.2, 0.72]
          : Array.from(
              { length: this.total },
              (_, itemIndex) => (itemIndex + 1) / (this.total + 1),
            );
      const center = stage.width * initialFractions[this.index];
      this.x = clamp(center - this.width / 2, 0, maximumX);
      this.y = this.groundY(stage);
    } else {
      const previousMaximum = this.previousMaximumX;
      const ratio = previousMaximum > 0 ? this.x / previousMaximum : 0.5;
      const targetRatio =
        previousMaximum > 0
          ? this.moveTargetX / previousMaximum
          : ratio;
      this.x = clamp(ratio * maximumX, 0, maximumX);
      if (this.state === "dragging" || this.state === "dropping") {
        this.y = clamp(this.y, 0, Math.max(0, stage.height - this.height));
      } else {
        this.y = this.groundY(stage);
      }
      this.moveTargetX = clamp(targetRatio * maximumX, 0, maximumX);

      if (this.state === "dropping") {
        const targetY = this.groundY(stage);
        const distance = Math.abs(targetY - this.y);
        if (this.world.reducedMotion || distance < 1) {
          this.y = targetY;
          this.enterIdle(performance.now(), 6000, 12_000);
        } else {
          this.drop = {
            fromY: this.y,
            toY: targetY,
            elapsed: 0,
            duration: clamp(160 + distance * 0.45, 180, 360),
          };
        }
      }
    }

    this.previousMaximumX = maximumX;
    this.applyPosition();
  }

  groundY(stage = this.world.stageBounds()) {
    const visualFootCorrection =
      (this.height * 5) / this.manifest.atlas.cellHeight;
    return Math.max(
      0,
      stage.height -
        this.height -
        this.world.groundOffset +
        visualFootCorrection,
    );
  }

  applyPosition() {
    this.root.style.setProperty("--pet-x", `${this.x.toFixed(2)}px`);
    this.root.style.setProperty("--pet-y", `${this.y.toFixed(2)}px`);
  }

  start(now) {
    this.enterIdle(now, 4500 + this.index * 1700, 8500 + this.index * 1900);
  }

  setState(nextState) {
    if (this.state === nextState) {
      return;
    }

    this.root.classList.remove(
      "is-idle",
      "is-moving",
      "is-acting",
      "is-dragging",
      "is-dropping",
    );
    this.state = nextState;
    this.root.dataset.state = nextState;
    this.root.classList.add(`is-${nextState}`);
  }

  emit(type, detail = {}) {
    this.world.dispatchEvent(
      new CustomEvent(type, {
        bubbles: true,
        detail: {
          petId: this.manifest.id,
          displayName: this.manifest.displayName,
          ...detail,
        },
      }),
    );
  }

  renderPreview() {
    this.drawFrame(this.manifest.atlas.previewFrame);
  }

  drawFrame(frame) {
    const { atlas } = this.manifest;
    this.context.clearRect(0, 0, atlas.cellWidth, atlas.cellHeight);
    this.context.drawImage(
      this.petPackage.image,
      frame.column * atlas.cellWidth,
      frame.row * atlas.cellHeight,
      atlas.cellWidth,
      atlas.cellHeight,
      0,
      0,
      atlas.cellWidth,
      atlas.cellHeight,
    );
  }

  stopCurrentAction(interrupted = true) {
    if (!this.currentAction) {
      return;
    }
    const action = this.currentAction;
    this.currentAction = null;
    this.emit("pet-action-end", {
      actionId: action.id,
      actionLabel: action.label,
      interrupted,
    });
  }

  setAction(actionId, { once = false, now = performance.now() } = {}) {
    const action = this.manifest.actionsById.get(actionId);
    if (!action) {
      return false;
    }

    if (this.currentAction) {
      this.stopCurrentAction(true);
    }

    this.currentAction = action;
    this.frameIndex = 0;
    this.frameElapsed = 0;
    this.animationOnce = once;
    this.drawFrame(action.frames[0]);
    this.emit("pet-action-start", {
      actionId: action.id,
      actionLabel: action.label,
      startedAt: now,
    });
    return true;
  }

  enterIdle(
    now = performance.now(),
    minimumDelay = 5200,
    maximumDelay = 11_500,
  ) {
    this.setState("idle");
    this.drop = null;
    const idleId = this.manifest.bindings.idle;
    if (!idleId || !this.setAction(idleId, { once: false, now })) {
      this.stopCurrentAction(true);
      this.renderPreview();
    }
    this.nextAutoAt = now + randomBetween(minimumDelay, maximumDelay);
  }

  playManualAction(actionId) {
    if (this.state === "dragging" || this.state === "dropping") {
      return false;
    }
    const action = this.manifest.actionsById.get(actionId);
    if (!action) {
      return false;
    }

    this.setState("acting");
    this.lastWasWalk = false;
    this.nextAutoAt = Number.POSITIVE_INFINITY;
    this.status.textContent = `${action.label}`;
    return this.setAction(action.id, { once: true });
  }

  playRandomManualAction() {
    if (
      this.pointerSession ||
      this.state === "dragging" ||
      this.state === "dropping"
    ) {
      return false;
    }

    const action = this.chooseRandomAction();
    return action ? this.playManualAction(action.id) : false;
  }

  advanceAnimation(delta, now, reducedMotion) {
    if (
      !this.currentAction ||
      this.state === "dragging" ||
      this.state === "dropping" ||
      (reducedMotion && this.state === "idle")
    ) {
      return;
    }

    this.frameElapsed += delta;
    let guard = 0;

    while (this.currentAction && guard < 64) {
      guard += 1;
      const frame = this.currentAction.frames[this.frameIndex];
      if (this.frameElapsed < frame.durationMs) {
        break;
      }

      this.frameElapsed -= frame.durationMs;
      const lastFrame =
        this.frameIndex >= this.currentAction.frames.length - 1;

      if (lastFrame) {
        if (this.currentAction.loop && !this.animationOnce) {
          this.frameIndex = 0;
        } else {
          const finishedAction = this.currentAction;
          this.currentAction = null;
          this.emit("pet-action-end", {
            actionId: finishedAction.id,
            actionLabel: finishedAction.label,
            interrupted: false,
          });

          if (this.state === "acting") {
            this.lastAutoActionId = finishedAction.id;
            this.lastWasWalk = false;
            this.enterIdle(now, 5000, 12_500);
          }
          break;
        }
      } else {
        this.frameIndex += 1;
      }

      if (this.currentAction) {
        this.drawFrame(this.currentAction.frames[this.frameIndex]);
      }
    }
  }

  chooseRandomAction() {
    return chooseWeightedAction(this.manifest.actions, {
      blockedIds: [
        this.manifest.bindings.idle,
        this.manifest.bindings.moveLeft,
        this.manifest.bindings.moveRight,
      ],
      avoidIds: [
        this.lastAutoActionId,
        this.currentAction?.id,
      ],
    });
  }

  startRandomAction(now) {
    const action = this.chooseRandomAction();
    if (!action) {
      this.nextAutoAt = now + randomBetween(5500, 11_000);
      return false;
    }

    this.setState("acting");
    this.lastWasWalk = false;
    this.nextAutoAt = Number.POSITIVE_INFINITY;
    return this.setAction(action.id, { once: true, now });
  }

  startWalk(now) {
    const stage = this.world.stageBounds();
    const maximumX = Math.max(0, stage.width - this.width);
    const candidates = [];

    const rightId = this.manifest.bindings.moveRight;
    if (
      rightId &&
      this.manifest.actionsById.has(rightId) &&
      maximumX - this.x >= 18
    ) {
      candidates.push({ direction: 1, actionId: rightId });
    }

    const leftId = this.manifest.bindings.moveLeft;
    if (
      leftId &&
      this.manifest.actionsById.has(leftId) &&
      this.x >= 18
    ) {
      candidates.push({ direction: -1, actionId: leftId });
    }

    if (candidates.length === 0) {
      this.nextAutoAt = now + randomBetween(5500, 10_500);
      return false;
    }

    const candidate =
      candidates[Math.floor(Math.random() * candidates.length)];
    const available =
      candidate.direction > 0 ? maximumX - this.x : this.x;
    const desiredDistance = clamp(
      stage.width * randomBetween(0.06, 0.18),
      30,
      170,
    );
    const distance = Math.min(available, desiredDistance);

    if (distance < 14) {
      this.nextAutoAt = now + randomBetween(5500, 10_500);
      return false;
    }

    this.setState("moving");
    this.moveDirection = candidate.direction;
    this.moveTargetX = clamp(
      this.x + candidate.direction * distance,
      0,
      maximumX,
    );
    this.moveSpeed = randomBetween(38, 64);
    this.nextAutoAt = Number.POSITIVE_INFINITY;
    this.lastWasWalk = true;
    this.setAction(candidate.actionId, { once: false, now });
    this.emit("pet-move", {
      phase: "start",
      direction: candidate.direction > 0 ? "right" : "left",
      fromX: this.x,
      toX: this.moveTargetX,
    });
    return true;
  }

  runAutomaticChoice(now, roamingEnabled) {
    const roll = Math.random();
    if (roll < 0.64) {
      this.lastWasWalk = false;
      this.nextAutoAt = now + randomBetween(4800, 10_500);
      return;
    }

    if (roll < 0.86) {
      this.startRandomAction(now);
      return;
    }

    if (roamingEnabled && !this.lastWasWalk && this.startWalk(now)) {
      return;
    }

    this.lastWasWalk = false;
    this.nextAutoAt = now + randomBetween(5200, 11_000);
  }

  tick(now, delta, { reducedMotion, roamingEnabled }) {
    if (this.state === "moving") {
      const nextX =
        this.x + this.moveDirection * this.moveSpeed * (delta / 1000);
      const reached =
        this.moveDirection > 0
          ? nextX >= this.moveTargetX
          : nextX <= this.moveTargetX;
      this.x = reached ? this.moveTargetX : nextX;
      this.applyPosition();

      if (reached) {
        this.emit("pet-move", {
          phase: "end",
          direction: this.moveDirection > 0 ? "right" : "left",
          x: this.x,
        });
        this.enterIdle(now, 6000, 13_000);
      }
    } else if (this.state === "dropping" && this.drop) {
      this.drop.elapsed += delta;
      const progress = clamp(this.drop.elapsed / this.drop.duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.y =
        this.drop.fromY + (this.drop.toY - this.drop.fromY) * eased;
      this.applyPosition();
      if (progress >= 1) {
        this.enterIdle(now, 6000, 12_000);
      }
    }

    this.advanceAnimation(delta, now, reducedMotion);

    if (
      !reducedMotion &&
      this.state === "idle" &&
      !this.pointerSession &&
      now >= this.nextAutoAt
    ) {
      this.runAutomaticChoice(now, roamingEnabled);
    }
  }

  onReducedMotionChanged(reducedMotion) {
    this.root.classList.toggle("is-reduced-motion", reducedMotion);
    if (reducedMotion && this.state === "moving") {
      this.enterIdle(performance.now());
    }
    if (reducedMotion && this.state === "idle" && this.currentAction) {
      this.frameIndex = 0;
      this.frameElapsed = 0;
      this.drawFrame(this.currentAction.frames[0]);
    }
  }

  onRoamingChanged(enabled) {
    if (!enabled && this.state === "moving") {
      this.enterIdle(performance.now());
    }
  }

  onPointerDown(event) {
    if (
      this.pointerSession ||
      event.isPrimary === false ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    this.pointerSession = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: this.x,
      originY: this.y,
      dragging: false,
    };

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been cancelled by the browser.
    }
    event.preventDefault();
  }

  onPointerMove(event) {
    const session = this.pointerSession;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }

    let deltaX = event.clientX - session.startClientX;
    let deltaY = event.clientY - session.startClientY;
    if (!session.dragging && Math.hypot(deltaX, deltaY) >= 7) {
      session.originX = this.x - deltaX;
      session.originY = this.y - deltaY;
      session.dragging = true;
      this.beginDrag();
    }

    if (!session.dragging) {
      return;
    }

    const stage = this.world.stageBounds();
    this.x = clamp(
      session.originX + deltaX,
      0,
      Math.max(0, stage.width - this.width),
    );
    this.y = clamp(
      session.originY + deltaY,
      0,
      Math.max(0, stage.height - this.height),
    );
    this.applyPosition();
    event.preventDefault();
  }

  onPointerUp(event) {
    const session = this.pointerSession;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }

    this.releasePointer(event.pointerId);
    this.pointerSession = null;
    if (session.dragging) {
      this.beginDrop();
    } else {
      this.playRandomManualAction();
    }
    event.preventDefault();
  }

  onPointerCancel(event) {
    const session = this.pointerSession;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    this.releasePointer(event.pointerId);
    this.pointerSession = null;
    if (session.dragging) {
      this.beginDrop();
    }
  }

  releasePointer(pointerId) {
    try {
      if (this.canvas.hasPointerCapture(pointerId)) {
        this.canvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Nothing remains to release.
    }
  }

  beginDrag() {
    this.setState("dragging");
    const idleId = this.manifest.bindings.idle;
    if (idleId) {
      this.setAction(idleId, { once: false });
      this.frameIndex = 0;
      this.frameElapsed = 0;
      this.drawFrame(this.currentAction.frames[0]);
    } else {
      this.stopCurrentAction(true);
      this.renderPreview();
    }
    this.emit("pet-drag-start", { x: this.x, y: this.y });
  }

  beginDrop() {
    const targetY = this.groundY();
    this.emit("pet-drag-end", { x: this.x, y: this.y });

    if (this.world.reducedMotion || Math.abs(targetY - this.y) < 1) {
      this.y = targetY;
      this.applyPosition();
      this.enterIdle(performance.now(), 6000, 12_000);
      return;
    }

    this.setState("dropping");
    const distance = Math.abs(targetY - this.y);
    this.drop = {
      fromY: this.y,
      toY: targetY,
      elapsed: 0,
      duration: clamp(160 + distance * 0.45, 180, 360),
    };
  }

  onCanvasKeyDown(event) {
    if (
      !event.repeat &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      this.playRandomManualAction();
    }
  }
}

class PetWorld extends HTMLElement {
  static get observedAttributes() {
    return [
      "noirrose",
      "miemieyan",
      "pet-size",
      "ground-offset",
      "roam",
    ];
  }

  constructor() {
    super();
    this.controllers = [];
    this.connected = false;
    this.loadToken = 0;
    this.rafId = 0;
    this.lastFrameTime = 0;
    this.resizeObserver = null;
    this.motionQuery = null;
    this.reducedMotion = false;
    this.roamingEnabled = true;

    this.onAnimationFrame = this.onAnimationFrame.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onMotionPreferenceChange =
      this.onMotionPreferenceChange.bind(this);
  }

  connectedCallback() {
    if (this.connected) {
      return;
    }
    this.connected = true;
    this.classList.add("pet-world");
    this.setAttribute("aria-label", "页面宠物");
    this.setAttribute("aria-busy", "true");

    this.stage = makeElement("div", "pet-world__stage");
    this.worldStatus = makeElement(
      "div",
      "pet-world__status pet-world__status--world",
      {
        role: "status",
        "aria-live": "polite",
      },
    );
    this.stage.append(this.worldStatus);
    this.replaceChildren(this.stage);

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.motionQuery.matches;
    this.roamingEnabled = this.readRoamingEnabled();
    this.classList.toggle("is-reduced-motion", this.reducedMotion);
    this.stage.classList.toggle("is-reduced-motion", this.reducedMotion);

    if ("addEventListener" in this.motionQuery) {
      this.motionQuery.addEventListener(
        "change",
        this.onMotionPreferenceChange,
      );
    } else {
      this.motionQuery.addListener(this.onMotionPreferenceChange);
    }

    document.addEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
    window.addEventListener("resize", this.onResize, { passive: true });

    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.stage);
    }

    this.loadPets();
  }

  disconnectedCallback() {
    this.connected = false;
    this.loadToken += 1;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastFrameTime = 0;

    document.removeEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
    window.removeEventListener("resize", this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.motionQuery) {
      if ("removeEventListener" in this.motionQuery) {
        this.motionQuery.removeEventListener(
          "change",
          this.onMotionPreferenceChange,
        );
      } else {
        this.motionQuery.removeListener(this.onMotionPreferenceChange);
      }
    }

    for (const controller of this.controllers) {
      controller.destroy();
    }
    this.controllers = [];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.connected || oldValue === newValue) {
      return;
    }

    if (name === "noirrose" || name === "miemieyan") {
      this.loadPets();
      return;
    }

    if (name === "roam") {
      this.roamingEnabled = this.readRoamingEnabled();
      for (const controller of this.controllers) {
        controller.onRoamingChanged(this.roamingEnabled);
      }
      return;
    }

    this.onResize();
  }

  get groundOffset() {
    const value = Number.parseFloat(this.getAttribute("ground-offset"));
    return Number.isFinite(value) ? clamp(value, 0, 240) : 4;
  }

  readRoamingEnabled() {
    const value = this.getAttribute("roam");
    return (
      value === null ||
      !["false", "off", "0"].includes(value.trim().toLowerCase())
    );
  }

  suggestedPetWidth() {
    const requested = Number.parseFloat(this.getAttribute("pet-size"));
    if (Number.isFinite(requested)) {
      return clamp(requested, 72, 240);
    }
    if (window.innerWidth <= 640) {
      return clamp(window.innerWidth * 0.27, 92, 122);
    }
    return clamp(window.innerWidth * 0.085, 116, 148);
  }

  stageBounds() {
    const bounds = this.stage?.getBoundingClientRect();
    return {
      width: bounds?.width > 0 ? bounds.width : window.innerWidth,
      height: bounds?.height > 0 ? bounds.height : window.innerHeight,
    };
  }

  async loadPets() {
    const token = ++this.loadToken;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastFrameTime = 0;

    for (const controller of this.controllers) {
      controller.destroy();
    }
    this.controllers = [];
    this.classList.remove("is-ready", "has-error");
    this.stage?.classList.remove("is-ready", "has-error");
    this.setAttribute("aria-busy", "true");
    if (this.worldStatus) {
      this.worldStatus.textContent = "";
    }

    const manifestPaths = [
      this.getAttribute("noirrose") || DEFAULT_MANIFESTS.noirrose,
      this.getAttribute("miemieyan") || DEFAULT_MANIFESTS.miemieyan,
    ];
    const results = await Promise.allSettled(
      manifestPaths.map((path) => loadPetPackage(path)),
    );

    if (!this.connected || token !== this.loadToken) {
      return;
    }

    const loadedPackages = [];
    const errors = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        loadedPackages.push(result.value);
      } else {
        errors.push(result.reason);
      }
    }

    loadedPackages.forEach((petPackage, index) => {
      const controller = new PetController(
        this,
        petPackage,
        index,
        loadedPackages.length,
      );
      controller.mount(this.stage);
      this.controllers.push(controller);
    });

    this.stage.append(this.worldStatus);
    this.setAttribute("aria-busy", "false");

    if (errors.length > 0) {
      this.classList.add("has-error");
      this.stage.classList.add("has-error");
      this.worldStatus.textContent = errors
        .map((error) => error?.message || "宠物加载失败")
        .join("；");
      this.dispatchEvent(
        new CustomEvent("pet-error", {
          bubbles: true,
          detail: { errors },
        }),
      );
    }

    if (this.controllers.length === 0) {
      return;
    }

    this.classList.add("is-ready");
    this.stage.classList.add("is-ready");
    const now = performance.now();
    for (const controller of this.controllers) {
      controller.layout(true);
      controller.onReducedMotionChanged(this.reducedMotion);
      controller.start(now);
    }

    this.dispatchEvent(
      new CustomEvent("pet-ready", {
        bubbles: true,
        detail: {
          pets: this.controllers.map((controller) => ({
            id: controller.manifest.id,
            displayName: controller.manifest.displayName,
          })),
        },
      }),
    );
    this.rafId = requestAnimationFrame(this.onAnimationFrame);
  }

  onAnimationFrame(now) {
    if (!this.connected) {
      return;
    }
    this.rafId = requestAnimationFrame(this.onAnimationFrame);

    if (document.hidden) {
      this.lastFrameTime = now;
      return;
    }

    const delta =
      this.lastFrameTime === 0
        ? 0
        : clamp(now - this.lastFrameTime, 0, 50);
    this.lastFrameTime = now;

    const options = {
      reducedMotion: this.reducedMotion,
      roamingEnabled: this.roamingEnabled,
    };
    for (const controller of this.controllers) {
      controller.tick(now, delta, options);
    }
  }

  onVisibilityChange() {
    this.lastFrameTime = 0;
  }

  onResize() {
    for (const controller of this.controllers) {
      controller.layout(false);
    }
  }

  onMotionPreferenceChange(event) {
    this.reducedMotion = event.matches;
    this.classList.toggle("is-reduced-motion", this.reducedMotion);
    this.stage.classList.toggle("is-reduced-motion", this.reducedMotion);
    for (const controller of this.controllers) {
      controller.onReducedMotionChanged(this.reducedMotion);
    }
  }

  play(petId, actionId) {
    const controller = this.controllers.find(
      (candidate) => candidate.manifest.id === petId,
    );
    return controller?.playManualAction(actionId) ?? false;
  }

  playRandom(petId) {
    const controller = this.controllers.find(
      (candidate) => candidate.manifest.id === petId,
    );
    return controller?.playRandomManualAction() ?? false;
  }

  setRoaming(enabled) {
    this.roamingEnabled = Boolean(enabled);
    for (const controller of this.controllers) {
      controller.onRoamingChanged(this.roamingEnabled);
    }
  }

  getPetStates() {
    return this.controllers.map((controller) => ({
      id: controller.manifest.id,
      displayName: controller.manifest.displayName,
      state: controller.state,
      actionId: controller.currentAction?.id ?? null,
      x: controller.x,
      y: controller.y,
      menuOpen: false,
    }));
  }
}

if (!customElements.get("pet-world")) {
  customElements.define("pet-world", PetWorld);
}

export { PetWorld, chooseWeightedAction, normalizeManifest };
export default PetWorld;
