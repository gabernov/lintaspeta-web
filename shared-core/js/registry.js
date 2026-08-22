let postInitFn = null;

export function setPostInitFn(fn) {
  postInitFn = fn;
}

export const Registry = {
  modes: new Map(),
  ctx: null,
  currentId: null,

  register(mode) {
    if (!mode || !mode.id || !mode.load) {
      throw new Error("Registry.register() requires mode with id and load");
    }
    this.modes.set(mode.id, mode);
  },

  list() {
    return Array.from(this.modes.values()).map(({ id, title, icon }) => ({ id, title, icon }));
  },

  initMenu({ btnId = "menu-btn", panelId = "menu-panel" } = {}) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;

    const close = () => {
      panel.hidden = true;
      btn.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    };
    const toggle = () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      btn.classList.toggle("open", opening);
      btn.setAttribute("aria-expanded", String(opening));
    };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });

    document.addEventListener("click", (e) => {
      if (!panel.hidden && !panel.contains(e.target)) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  },

  async activate(id) {
    const mode = this.modes.get(id);
    if (!mode) {
      console.warn(`Registry: unknown mode "${id}"`);
      return;
    }

    const firstActivate = !this._hasActivated;
    const switchStartedAt = Date.now();

    // Mode switches park at the globe view while the new mode's data
    // loads — the fly-in only happens once that data is on the map
    // (see below). Skipped on first activate: the page opens at globe.
    if (!firstActivate && this.ctx?.map && typeof this.ctx.flyToGlobe === "function") {
      await this.ctx.flyToGlobe(this.ctx.map, { duration: 700 });
    }

    // First load ONLY: let the sky land for a beat, then a long,
    // smooth dive to Jawa Barat while data streams in behind it.
    if (firstActivate && this.ctx?.map && typeof this.ctx.flyToJabar === "function") {
      await new Promise((r) => setTimeout(r, 700));
      await this.ctx.flyToJabar(this.ctx.map, { duration: 3200 });
    }

    // Teardown current mode
    await this.teardown();

    // Set active
    this.currentId = id;
    this._closeMenu();

    // Deep-link: ?mode=<id> so a refresh reopens the same mode.
    try {
      history.replaceState(null, "", `${location.pathname}?mode=${id}`);
    } catch (e) {}

    // Show the panel skeleton only AFTER the old panel is removed — the
    // old panel stays visible during the fly-out, so showing the skeleton
    // earlier would render two overlapping panels side by side.
    this._skeletonOwnerId = id;
    if (this.ctx?.ui?.PanelSkeleton?.show) {
      this.ctx.ui.PanelSkeleton.show();
    }

    // Toggle active class on menu mode rows
    document.querySelectorAll("#menu-panel .mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === id);
    });

    // Update document title
    document.title = mode.title ? `${mode.title} — LintasPeta` : "LintasPeta";

    // Load module
    let config = null;
    let module = null;
    try {
      const loaded = await mode.load();
      config = loaded?.config ?? null;
      module = loaded?.module ?? loaded ?? null;
    } catch (err) {
      console.warn(`Registry: mode "${id}" load failed (expected in Phase 0):`, err);
      this._toast(`Mode ${mode.title || id} belum dimigrasi (Phase 0)`);
      return;
    }

    this._hasActivated = true;

    // Init module — resolves when the mode's INITIAL DATA is ready
    // (UI mounts immediately inside init; the returned promise covers
    // the parquet download), so switches can wait for it before flying.
    if (module && typeof module.init === "function") {
      const { map, ui, search } = this.ctx || {};
      if (!map) {
        console.warn("Registry: no map in ctx — cannot init mode");
        return;
      }
      try {
        await module.init({ map, data: null, config, ui, search });
        this._loaded = { module, config };
      } catch (err) {
        console.error(`Registry: module.init("${id}") failed:`, err);
        this._toast(`Gagal memuat mode ${mode.title || id}`);
      }
    }

    // Switches: data is on the map — NOW fly to Jawa Barat. A minimum
    // globe dwell keeps the stars moment visible even when parquet
    // comes back instantly from HTTP cache.
    if (!firstActivate && this.ctx?.map && typeof this.ctx.flyToJabar === "function") {
      const MIN_GLOBE_MS = 2500;
      const elapsed = Date.now() - switchStartedAt;
      if (elapsed < MIN_GLOBE_MS) {
        await new Promise((r) => setTimeout(r, MIN_GLOBE_MS - elapsed));
      }
      await this.ctx.flyToJabar(this.ctx.map, { duration: 2000 });
    }

    if (postInitFn && this.ctx?.map) {
      await postInitFn(this.ctx.map);
    }
  },

  _hideLoading(ownerId) {
    if (this.ctx?.ui?.Loading?.hide) {
      this.ctx.ui.Loading.hide();
    }
    // Only hide the skeleton if THIS activate owns it. A previous
    // activate's late-finishing _hideLoading (awaited postInitFn) must
    // not hide the skeleton of the mode that replaced it.
    if (
      this.ctx?.ui?.PanelSkeleton?.hide &&
      (!ownerId || this._skeletonOwnerId === ownerId)
    ) {
      this.ctx.ui.PanelSkeleton.hide();
    }
  },

  async teardown() {
    if (this._loaded?.module && typeof this._loaded.module.teardown === "function") {
      try {
        await this._loaded.module.teardown();
      } catch (err) {
        console.error("Registry: module.teardown() failed:", err);
      }
    }
    this._loaded = null;

    // Clear active button state
    document.querySelectorAll("#menu-panel .mode-btn").forEach((btn) => {
      btn.classList.remove("active");
    });

    this.currentId = null;
  },

  _closeMenu() {
    const panel = document.getElementById("menu-panel");
    const btn = document.getElementById("menu-btn");
    if (panel) panel.hidden = true;
    if (btn) btn.classList.remove("open");
  },

  // Internal: show toast without depending on ui-core.js
  _toast(msg) {
    const { ui } = this.ctx || {};
    if (ui && typeof ui.toast === "function") {
      ui.toast(msg);
      return;
    }
    // Fallback: direct DOM manipulation of the shell toast container
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    const prev = t._toastTimer;
    if (prev) clearTimeout(prev);
    t._toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
  },
};
