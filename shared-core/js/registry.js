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
    if (this.ctx?.map && typeof this.ctx.flyToGlobe === "function") {
      await this.ctx.flyToGlobe(this.ctx.map, { duration: 700 });
    }

    // 2. Wait for starfield to be ready (globe projection + stars must
    //    render before we hide the overlay and fly to Jawa Barat).
    if (this.ctx?.map && typeof this.ctx.addStarfield === "function") {
      await this.ctx.addStarfield(this.ctx.map);
    }

    // 3. Hide loading overlay — globe + stars are now visible.
    this._hideLoading();

    // 4. Fly to Jawa Barat (cinematic, no data dependency).
    if (this.ctx?.map && typeof this.ctx.flyToJabar === "function") {
      await this.ctx.flyToJabar(this.ctx.map, { duration: 2000 });
    }

    // 5. Teardown current mode
    await this.teardown();

    // 6. Set active
    this.currentId = id;
    this._closeMenu();

    // Show the panel skeleton only AFTER the old panel is removed — the
    // old panel stays visible during the fly-out, so showing the skeleton
    // earlier would render two overlapping panels side by side.
    // Track ownership so a LATE _hideLoading from a previous activate
    // (still awaiting postInitFn/addStarfield) cannot hide this one.
    this._skeletonOwnerId = id;
    if (this.ctx?.ui?.PanelSkeleton?.show) {
      this.ctx.ui.PanelSkeleton.show();
    }

    // 7. Toggle active class on menu mode rows
    document.querySelectorAll("#menu-panel .mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === id);
    });

    // Update document title
    document.title = mode.title ? `${mode.title} — LintasPeta` : "LintasPeta";

    // 8. Load module (non-blocking: UI creates immediately, data loads in background)
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

    // 9. Apply the mode's default basemap BEFORE init so layers are
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

    // 10. Init module — UI creates immediately, parquet loads in background
    if (module && typeof module.init === "function") {
      const { map, ui, search } = this.ctx || {};
      if (!map) {
        console.warn("Registry: no map in ctx — cannot init mode");
        return;
      }
      try {
        // module.init() should return quickly (createUI) and load data async.
        // No loading overlay — user already sees globe + stars + fly-to.
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
