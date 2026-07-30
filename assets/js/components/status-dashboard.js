const DEFAULT_ENDPOINT = "/api/status";
const POLL_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clampPercent = (value) => {
  const number = numberOrNull(value);
  return number === null ? null : Math.min(100, Math.max(0, number));
};

const formatPercent = (value) => {
  const number = clampPercent(value);
  return number === null ? "--" : `${number.toFixed(1)}%`;
};

const formatBytes = (value) => {
  const bytes = numberOrNull(value);
  if (bytes === null || bytes < 0) return "--";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  const precision = amount >= 100 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
};

const formatUptime = (value) => {
  const seconds = numberOrNull(value);
  if (seconds === null || seconds < 0) return "--";

  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return "不到 1 分钟";
};

const formatUpdateTime = (value) => {
  const timestamp = numberOrNull(value);
  const date = timestamp === null
    ? new Date()
    : new Date(timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp);

  if (Number.isNaN(date.getTime())) return "刚刚";

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
};

export class StatusDashboard extends HTMLElement {
  static get observedAttributes() {
    return ["endpoint"];
  }

  constructor() {
    super();
    this._rendered = false;
    this._timer = null;
    this._controller = null;
    this._loading = false;
    this._hasData = false;
    this._lastUpdatedAt = 0;
    this._handleOnline = () => this.refresh();
    this._handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible"
        && Date.now() - this._lastUpdatedAt >= POLL_INTERVAL_MS
      ) {
        this.refresh();
      }
    };
  }

  connectedCallback() {
    if (!this._rendered) this._render();
    this._start();
  }

  disconnectedCallback() {
    this._stop();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (
      name === "endpoint"
      && oldValue !== newValue
      && this.isConnected
      && this._rendered
    ) {
      this._restart();
    }
  }

  get endpoint() {
    return this.getAttribute("endpoint")?.trim() || DEFAULT_ENDPOINT;
  }

  async refresh() {
    if (this._loading || !this.isConnected) return;

    this._loading = true;
    this.setAttribute("aria-busy", "true");
    if (!this._hasData) this._setState("loading", "正在读取服务器状态…");

    const controller = new AbortController();
    this._controller = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(this.endpoint, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Status endpoint returned ${response.status}`);
      }

      const payload = await response.json();
      if (!payload?.system || typeof payload.system !== "object") {
        throw new TypeError("Status payload does not include system data");
      }

      if (this._controller !== controller || !this.isConnected) return;

      this._applyPayload(payload);
      this._hasData = true;
      this._lastUpdatedAt = Date.now();
      this._setState(
        "ready",
        `已更新 · ${formatUpdateTime(payload.generatedAt)}`,
      );
    } catch {
      if (this._controller !== controller || !this.isConnected) return;

      const message = this._hasData
        ? "暂时无法刷新，正在显示上次数据；稍后会自动重试。"
        : "暂时无法读取服务器状态，稍后会自动重试。";
      this._setState(this._hasData ? "stale" : "error", message);
    } finally {
      window.clearTimeout(timeout);
      if (this._controller === controller) {
        this._controller = null;
        this._loading = false;
        this.removeAttribute("aria-busy");
      }
    }
  }

  _render() {
    this.classList.add("status-dashboard");
    this.setAttribute("role", "region");
    this.setAttribute("aria-label", "服务器资源状态");

    this.innerHTML = `
      <div class="status-dashboard__meta">
        <span class="status-dashboard__signal" aria-hidden="true"></span>
        <span data-status-message role="status" aria-live="polite">正在读取服务器状态…</span>
      </div>
      <div class="status-grid">
        <article class="status-card" data-status-card="cpu">
          <span class="status-card__label">CPU</span>
          <strong class="status-card__value" data-status-value="cpu">--</strong>
          <progress class="status-card__bar" data-status-bar="cpu" max="100" value="0">
            0%
          </progress>
          <small class="status-card__detail" data-status-detail="cpu">处理器使用率</small>
        </article>
        <article class="status-card" data-status-card="memory">
          <span class="status-card__label">内存</span>
          <strong class="status-card__value" data-status-value="memory">--</strong>
          <progress class="status-card__bar" data-status-bar="memory" max="100" value="0">
            0%
          </progress>
          <small class="status-card__detail" data-status-detail="memory">-- / --</small>
        </article>
        <article class="status-card" data-status-card="disk">
          <span class="status-card__label">磁盘</span>
          <strong class="status-card__value" data-status-value="disk">--</strong>
          <progress class="status-card__bar" data-status-bar="disk" max="100" value="0">
            0%
          </progress>
          <small class="status-card__detail" data-status-detail="disk">-- / --</small>
        </article>
        <article class="status-card" data-status-card="load">
          <span class="status-card__label">系统负载</span>
          <strong class="status-card__value" data-status-value="load">--</strong>
          <small class="status-card__detail" data-status-detail="load">1 / 5 / 15 分钟</small>
        </article>
        <article class="status-card" data-status-card="uptime">
          <span class="status-card__label">运行时长</span>
          <strong class="status-card__value" data-status-value="uptime">--</strong>
          <small class="status-card__detail" data-status-detail="uptime">系统持续在线时间</small>
        </article>
      </div>
    `;

    this._message = this.querySelector("[data-status-message]");
    this._values = Object.fromEntries(
      [...this.querySelectorAll("[data-status-value]")].map((element) => [
        element.dataset.statusValue,
        element,
      ]),
    );
    this._details = Object.fromEntries(
      [...this.querySelectorAll("[data-status-detail]")].map((element) => [
        element.dataset.statusDetail,
        element,
      ]),
    );
    this._bars = Object.fromEntries(
      [...this.querySelectorAll("[data-status-bar]")].map((element) => [
        element.dataset.statusBar,
        element,
      ]),
    );
    this._rendered = true;
    this._setState("loading", "正在读取服务器状态…");
  }

  _applyPayload(payload) {
    const system = payload.system;
    const cpu = clampPercent(system.cpuPercent);
    const memory = clampPercent(system.memory?.percent);
    const disk = clampPercent(system.disk?.percent);
    const loads = Array.isArray(system.load)
      ? system.load.slice(0, 3).map(numberOrNull)
      : [];

    this._setMetric("cpu", formatPercent(cpu));
    this._setMetric("memory", formatPercent(memory));
    this._setMetric("disk", formatPercent(disk));
    this._setMetric(
      "load",
      loads[0] === null || loads[0] === undefined ? "--" : loads[0].toFixed(2),
    );
    this._setMetric("uptime", formatUptime(system.uptimeSeconds));

    this._setProgress("cpu", cpu);
    this._setProgress("memory", memory);
    this._setProgress("disk", disk);

    const usedMemory = formatBytes(system.memory?.used);
    const totalMemory = formatBytes(system.memory?.total);
    const usedDisk = formatBytes(system.disk?.used);
    const totalDisk = formatBytes(system.disk?.total);

    this._details.memory.textContent = `${usedMemory} / ${totalMemory}`;
    this._details.disk.textContent = `${usedDisk} / ${totalDisk}`;
    this._details.load.textContent = loads.length
      ? `${loads.map((load) => load === null ? "--" : load.toFixed(2)).join(" / ")} · 1 / 5 / 15 分钟`
      : "1 / 5 / 15 分钟";
  }

  _setMetric(name, value) {
    if (this._values[name]) this._values[name].textContent = value;
  }

  _setProgress(name, value) {
    const progress = this._bars[name];
    if (!progress) return;

    const safeValue = value ?? 0;
    progress.value = safeValue;
    progress.textContent = formatPercent(value);
    progress.setAttribute("aria-label", `${name} ${formatPercent(value)}`);
  }

  _setState(state, message) {
    this.dataset.state = state;
    if (this._message) this._message.textContent = message;
  }

  _start() {
    this._stop();
    this.refresh();
    this._timer = window.setInterval(() => this.refresh(), POLL_INTERVAL_MS);
    window.addEventListener("online", this._handleOnline);
    document.addEventListener("visibilitychange", this._handleVisibilityChange);
  }

  _stop() {
    if (this._timer !== null) {
      window.clearInterval(this._timer);
      this._timer = null;
    }

    this._controller?.abort();
    this._controller = null;
    this._loading = false;
    window.removeEventListener("online", this._handleOnline);
    document.removeEventListener("visibilitychange", this._handleVisibilityChange);
  }

  _restart() {
    this._stop();
    this._start();
  }
}

if (!customElements.get("status-dashboard")) {
  customElements.define("status-dashboard", StatusDashboard);
}
