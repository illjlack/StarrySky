const SERVICES = [
  {
    title: "Learn",
    value: "https://learn.liuhuan.help/",
    href: "https://learn.liuhuan.help/",
    state: "learn",
    port: 443,
    group: "pages",
  },
  {
    title: "Questions",
    value: "https://questions.liuhuan.help/",
    href: "https://questions.liuhuan.help/",
    state: "questions",
    port: 443,
    group: "pages",
  },
  {
    title: "Wake Console",
    value: "https://liuhuan.help/wake/",
    href: "https://liuhuan.help/wake/",
    state: "protected",
    port: 443,
    group: "pages",
  },
  {
    title: "Service Guides",
    value: "https://liuhuan.help/guides/",
    href: "https://liuhuan.help/guides/",
    state: "docs",
    port: 443,
    group: "pages",
  },
  {
    title: "x-ui Panel",
    value: "https://panel.liuhuan.help/",
    href: "https://panel.liuhuan.help/",
    state: "panel",
    port: 5555,
    group: "pages",
  },
  {
    title: "MQTT WebSocket",
    value: "wss://mqtt.liuhuan.help/mqtt",
    href: "https://mqtt.liuhuan.help/",
    state: "wss",
    port: 9001,
    group: "connections",
  },
  {
    title: "MQTT TCP",
    value: "mqtt-origin.liuhuan.help:1883",
    href: "https://liuhuan.help/guides/mqtt.html",
    state: "esp",
    port: 1883,
    group: "connections",
  },
  {
    title: "Reality Main",
    value: "liuhuan.help:19622",
    href: "https://liuhuan.help/guides/proxy.html",
    state: "vless",
    port: 19622,
    group: "connections",
  },
  {
    title: "Reality Backup",
    value: "liuhuan.help:8443",
    href: "https://liuhuan.help/guides/proxy.html",
    state: "vless",
    port: 8443,
    group: "connections",
  },
];

const GROUPS = [
  { id: "pages", label: "页面与工具" },
  { id: "connections", label: "连接端点" },
];

const STATE_LABELS = {
  learn: "LEARN",
  questions: "QUESTIONS",
  protected: "PROTECTED",
  docs: "DOCS",
  panel: "PANEL",
  wss: "WSS",
  esp: "MQTT",
  vless: "VLESS",
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const renderService = (service) => {
  const value = escapeHtml(service.value);
  const title = escapeHtml(service.title);
  const actionLabel = service.group === "connections" ? "查看说明" : "打开";

  return `
    <article class="service-card" data-service="${escapeHtml(service.state)}">
      <div class="service-card__meta">
        <span>${escapeHtml(STATE_LABELS[service.state] || service.state)}</span>
        <span>PORT ${escapeHtml(service.port)}</span>
      </div>
      <h3>${title}</h3>
      <code class="service-card__value" data-copy-source>${value}</code>
      <div class="service-card__actions">
        <a href="${escapeHtml(service.href)}" target="_blank" rel="noopener noreferrer">
          ${actionLabel}
        </a>
        <button
          type="button"
          data-copy-value="${value}"
          data-copy-label="${title}"
          aria-label="复制 ${title} 的连接地址"
        >
          复制
        </button>
      </div>
    </article>
  `;
};

export class ServiceDrawer extends HTMLElement {
  constructor() {
    super();
    this._rendered = false;
    this._isOpen = false;
    this._lastFocused = null;
    this._toastTimer = null;
    this._copyResetTimer = null;
    this._handleClick = (event) => this._onClick(event);
    this._handleKeydown = (event) => this._onKeydown(event);
  }

  connectedCallback() {
    if (!this._rendered) this._render();
    this.addEventListener("click", this._handleClick);
    document.addEventListener("keydown", this._handleKeydown);
    this.hide({ restoreFocus: false, emit: false });
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._handleClick);
    document.removeEventListener("keydown", this._handleKeydown);
    window.clearTimeout(this._toastTimer);
    window.clearTimeout(this._copyResetTimer);
    document.documentElement.classList.remove("has-service-drawer-open");
    document.body.classList.remove("has-service-drawer-open");
  }

  get open() {
    return this._isOpen;
  }

  get dialogId() {
    return this._panel?.id || "service-drawer-dialog";
  }

  show(trigger = null) {
    if (this._isOpen || !this._panel || !this._backdrop) return;

    this._lastFocused = trigger instanceof HTMLElement
      ? trigger
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this._isOpen = true;
    this.setAttribute("open", "");
    this._panel.hidden = false;
    this._backdrop.hidden = false;
    this._panel.removeAttribute("inert");
    this._panel.setAttribute("aria-hidden", "false");
    this._backdrop.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("has-service-drawer-open");
    document.body.classList.add("has-service-drawer-open");
    this._emitChange();

    window.requestAnimationFrame(() => {
      this._closeButton?.focus({ preventScroll: true });
    });
  }

  hide({ restoreFocus = true, emit = true } = {}) {
    if (!this._panel || !this._backdrop) return;

    const wasOpen = this._isOpen;
    this._isOpen = false;
    this.removeAttribute("open");
    this._panel.hidden = true;
    this._backdrop.hidden = true;
    this._panel.setAttribute("inert", "");
    this._panel.setAttribute("aria-hidden", "true");
    this._backdrop.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("has-service-drawer-open");
    document.body.classList.remove("has-service-drawer-open");

    if (emit && wasOpen) this._emitChange();
    if (restoreFocus && wasOpen && this._lastFocused?.isConnected) {
      this._lastFocused.focus({ preventScroll: true });
    }
  }

  toggle(trigger = null) {
    if (this._isOpen) {
      this.hide();
    } else {
      this.show(trigger);
    }
  }

  _render() {
    const groups = GROUPS.map((group) => {
      const services = SERVICES
        .filter((service) => service.group === group.id)
        .map(renderService)
        .join("");

      return `
        <section class="service-group" aria-labelledby="service-group-${group.id}">
          <h2 id="service-group-${group.id}">${group.label}</h2>
          <div class="service-list">${services}</div>
        </section>
      `;
    }).join("");

    this.classList.add("service-drawer");
    this.innerHTML = `
      <div
        class="service-drawer__backdrop"
        data-service-backdrop
        aria-hidden="true"
        hidden
      ></div>
      <aside
        class="service-drawer__panel"
        id="service-drawer-dialog"
        data-service-panel
        role="dialog"
        aria-modal="true"
        aria-hidden="true"
        aria-labelledby="service-drawer-title"
        tabindex="-1"
        inert
        hidden
      >
        <header class="service-drawer__header">
          <div>
            <p>SELF-HOSTED SERVICES</p>
            <h1 id="service-drawer-title">服务与连接</h1>
          </div>
          <button
            class="service-drawer__close"
            type="button"
            data-close-services
            aria-label="关闭服务抽屉"
          >
            <span aria-hidden="true">×</span>
            <span>关闭</span>
          </button>
        </header>
        <div class="service-drawer__body">
          ${groups}
        </div>
        <footer class="service-drawer__footer">
          <p>管理入口与连接端点默认收起；访问权限仍由各服务自身控制。</p>
          <kbd>Esc</kbd>
          <span>关闭</span>
        </footer>
      </aside>
      <div
        class="service-drawer__toast"
        data-service-toast
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden
      ></div>
    `;

    this._backdrop = this.querySelector("[data-service-backdrop]");
    this._panel = this.querySelector("[data-service-panel]");
    this._closeButton = this.querySelector("[data-close-services]");
    this._toast = this.querySelector("[data-service-toast]");
    this._rendered = true;
  }

  _onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-close-services]") || target === this._backdrop) {
      this.hide();
      return;
    }

    const copyButton = target.closest("[data-copy-value]");
    if (copyButton instanceof HTMLButtonElement) {
      this._copy(copyButton);
    }
  }

  _onKeydown(event) {
    if (!this._isOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();
      this.hide();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = [...this._panel.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter((element) => (
        element instanceof HTMLElement
        && !element.hidden
        && element.getClientRects().length > 0
      ));

    if (!focusable.length) {
      event.preventDefault();
      this._panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !this._panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this._panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  async _copy(button) {
    const value = button.dataset.copyValue || "";
    const label = button.dataset.copyLabel || "连接地址";
    const source = button.closest(".service-card")?.querySelector("[data-copy-source]");

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else if (!this._copyFromVisibleSource(source)) {
        throw new Error("Clipboard is unavailable");
      }

      this._setCopyFeedback(button, "已复制", `已复制：${label}`);
    } catch {
      this._setCopyFeedback(button, "复制失败", "复制失败，请手动选择连接地址。");
    }
  }

  _copyFromVisibleSource(source) {
    if (!(source instanceof HTMLElement)) return false;

    const selection = window.getSelection();
    if (!selection) return false;

    const savedRanges = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      savedRanges.push(selection.getRangeAt(index));
    }

    const range = document.createRange();
    range.selectNodeContents(source);
    selection.removeAllRanges();
    selection.addRange(range);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      selection.removeAllRanges();
      savedRanges.forEach((savedRange) => selection.addRange(savedRange));
    }

    return copied;
  }

  _setCopyFeedback(button, buttonText, message) {
    window.clearTimeout(this._copyResetTimer);
    const originalText = button.dataset.originalText || button.textContent.trim();
    button.dataset.originalText = originalText;
    button.textContent = buttonText;
    button.dataset.copyState = buttonText === "已复制" ? "copied" : "error";
    this._announce(message);

    this._copyResetTimer = window.setTimeout(() => {
      button.textContent = originalText;
      delete button.dataset.copyState;
    }, 2_000);
  }

  _announce(message) {
    if (!this._toast) return;

    window.clearTimeout(this._toastTimer);
    this._toast.textContent = message;
    this._toast.hidden = false;
    this._toastTimer = window.setTimeout(() => {
      this._toast.hidden = true;
      this._toast.textContent = "";
    }, 2_400);
  }

  _emitChange() {
    this.dispatchEvent(new CustomEvent("service-drawer-change", {
      bubbles: true,
      composed: true,
      detail: { open: this._isOpen },
    }));
  }
}

if (!customElements.get("service-drawer")) {
  customElements.define("service-drawer", ServiceDrawer);
}
