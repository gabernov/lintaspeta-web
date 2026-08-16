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

    // 1. Show loading overlay + animate camera out to globe (awaited so
    //    the new module's fitBounds doesn't cancel the zoom-out).
    if (this.ctx?.ui?.Loading?.show) {
      this.ctx.ui.Loading.show(`Memuat ${mode.title || id}…`);
    }
    // Show the panel skeleton right away so the info area never goes
    // blank while the old panel is torn down and the new one is built.
    if (this.ctx?.ui?.PanelSkeleton?.show) {
      this.ctx.ui.PanelSkeleton.show();
    }
    if (this.ctx?.map && typeof this.ctx.flyToGlobe === "function") {
      await this.ctx.flyToGlobe(this.ctx.map, { duration: 700 });
    }

    // 2. Teardown current mode
    await this.teardown();

    // 3. Set active
    this.currentId = id;
    this._closeMenu();

    // 4. Toggle active class on menu mode rows
    document.querySelectorAll("#menu-panel .mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === id);
    });

    // Update document title
    document.title = mode.title ? `${mode.title} — LintasPeta` : "LintasPeta";

    // 5. Load module
    let config = null;
    let module = null;
    try {
      const loaded = await mode.load();
      config = loaded?.config ?? null;
      module = loaded?.module ?? loaded ?? null;
    } catch (err) {
      console.warn(`Registry: mode "${id}" load failed (expected in Phase 0):`, err);
      this._toast(`Mode ${mode.title || id} belum dimigrasi (Phase 0)`);
      this._hideLoading();
      return;
    }

    // 6. Apply the mode's default basemap BEFORE init so layers are
    //    added to the correct style and fitBounds isn't interrupted.
    //    Skipped on the very first activate: the shell has already set
    //    the theme-matched basemap, forcing the mode default here would
    //    undo the user's theme choice.
    const isInitial = !this._hasActivated;
    this._hasActivated = true;
    if (
      !isInitial &&
      config?.defaultBasemap &&
      typeof this.ctx?.setBasemap === "function"
    ) {
      const currentBasemap =
        this.ctx.getBasemapStyle?.() ??
        document.querySelector(".basemap-item.active")?.dataset.style;
      if (currentBasemap !== config.defaultBasemap) {
        await this.ctx.setBasemap(config.defaultBasemap);
      }
    }

    // 7. Init module
    if (module && typeof module.init === "function") {
      const { map, ui, search } = this.ctx || {};
      if (!map) {
        console.warn("Registry: no map in ctx — cannot init mode");
        this._hideLoading();
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

    if (postInitFn && this.ctx?.map) {
      await postInitFn(this.ctx.map);
    }

    this._hideLoading();
  },

  _hideLoading() {
    if (this.ctx?.ui?.Loading?.hide) {
      this.ctx.ui.Loading.hide();
    }
    if (this.ctx?.ui?.PanelSkeleton?.hide) {
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
