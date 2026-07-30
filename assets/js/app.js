import "./components/ambient-scene.js?v=20260730-3";
import "./components/service-drawer.js?v=20260730-5";
import "./components/pet-world.js?v=20260730-3";

const onReady = (callback) => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
};

const setupLocalClock = () => {
  const clock = document.querySelector("[data-local-time]");
  const date = document.querySelector("[data-local-date]");
  const years = document.querySelectorAll("[data-current-year]");

  if (!clock && !date && !years.length) return;

  const update = () => {
    const now = new Date();

    if (clock) {
      clock.textContent = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now);
      clock.setAttribute("datetime", now.toISOString());
    }

    if (date) {
      date.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    }

    years.forEach((element) => {
      element.textContent = String(now.getFullYear());
    });
  };

  const scheduleMinuteUpdates = () => {
    update();
    window.setInterval(update, 60_000);
  };

  update();
  const millisecondsUntilNextMinute = (
    (60 - new Date().getSeconds()) * 1000
  ) - new Date().getMilliseconds();
  window.setTimeout(scheduleMinuteUpdates, millisecondsUntilNextMinute);
};

const setupServiceDrawer = () => {
  const drawer = document.querySelector("service-drawer");
  if (!drawer) return;

  const triggers = [
    ...new Set(document.querySelectorAll(
      "#service-drawer-toggle, [data-open-services]",
    )),
  ];

  triggers.forEach((trigger) => {
    trigger.setAttribute("aria-controls", drawer.dialogId);
    trigger.setAttribute("aria-expanded", String(drawer.open));
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.addEventListener("click", () => drawer.toggle(trigger));
  });

  drawer.addEventListener("service-drawer-change", (event) => {
    const isOpen = Boolean(event.detail?.open);
    triggers.forEach((trigger) => {
      trigger.setAttribute("aria-expanded", String(isOpen));
    });
  });
};

const setupTimeModeBridge = () => {
  const timeMode = document.querySelector("#time-mode");
  const scene = document.querySelector("ambient-scene");

  if (!timeMode || !scene || timeMode.matches("[data-scene-mode]")) return;

  const modes = ["auto", "day", "night"];
  let currentMode = scene.mode || scene.getAttribute("mode") || "auto";

  window.addEventListener("scene-mode-change", (event) => {
    if (modes.includes(event.detail?.mode)) currentMode = event.detail.mode;
  });

  timeMode.addEventListener("click", () => {
    const index = Math.max(0, modes.indexOf(currentMode));
    currentMode = modes[(index + 1) % modes.length];
    scene.setMode?.(currentMode);
  });
};

onReady(() => {
  setupLocalClock();
  setupServiceDrawer();
  setupTimeModeBridge();
});
