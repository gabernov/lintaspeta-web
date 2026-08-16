let toastTimer = null;

export function toast(msg, ms = 3000) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

/* ─── Loading overlay with stage watchdog ────────────────────
   Every loading phase calls Loading.setStage() so the shell knows what
   is happening. A watchdog re-arms on each heartbeat() (real progress);
   if a stage stalls past warningMs a "slow" hint appears, and past the
   deadline the overlay flips to a stuck/error state with a retry button
   — users are never left staring at a silent spinner. */
let stageTimer = null;
let stageWarned = false;

function clearStageTimer() {
  if (stageTimer) {
    clearTimeout(stageTimer);
    stageTimer = null;
  }
}

function resetStageUI() {
  const el = document.getElementById("loading");
  const warning = document.getElementById("load-warning");
  const errorBox = document.getElementById("load-error");
  const retry = document.getElementById("load-retry");
  if (el) el.classList.remove("is-stuck", "is-error");
  if (warning) warning.textContent = "";
  if (errorBox) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
  }
  if (retry) retry.style.display = "none";
}

export const Loading = {
  show(text) {
    const el = document.getElementById("loading");
    const status = document.getElementById("load-status");
    if (el) el.classList.remove("hidden");
    if (status && text) status.textContent = text;
    resetStageUI();
    this.setStage();
  },

  hide() {
    const el = document.getElementById("loading");
    const status = document.getElementById("load-status");
    if (el) el.classList.add("hidden");
    if (status) status.textContent = "";
    this.clearStage();
  },

  /* Mark the current phase and (re)arm the watchdog. Call right before
     a long operation; call heartbeat() whenever real progress arrives
     (e.g. bytes downloaded, batch parsed) to prove it's not stuck. */
  setStage(warningMs = 12000, stuckMs = 40000) {
    clearStageTimer();
    stageWarned = false;
    resetStageUI();

    const el = document.getElementById("loading");
    const warning = document.getElementById("load-warning");
    const errorBox = document.getElementById("load-error");
    const retry = document.getElementById("load-retry");

    stageTimer = setTimeout(() => {
      if (!stageWarned) {
        stageWarned = true;
        if (warning) warning.textContent = "Masih memuat… koneksi mungkin lambat.";
      }
      stageTimer = setTimeout(() => {
        if (el) el.classList.add("is-stuck", "is-error");
        if (errorBox) {
          errorBox.textContent = "Pemuatan terhenti. Periksa koneksi internet Anda, lalu coba lagi.";
        }
        if (retry) retry.style.display = "inline-flex";
      }, Math.max(0, stuckMs - warningMs));
    }, warningMs);
  },

  /* Real progress signal — resets the stall timers and dismisses the
     "stuck" state (e.g. a byte made it through, a batch was parsed). */
  heartbeat() {
    clearStageTimer();
    const el = document.getElementById("loading");
    if (el) el.classList.remove("is-stuck");
    this.setStage();
  },

  clearStage() {
    clearStageTimer();
    stageWarned = false;
  },

  /* Hard error — show the message and always reveal the retry button. */
  fail(msg) {
    const el = document.getElementById("loading");
    const errorBox = document.getElementById("load-error");
    const retry = document.getElementById("load-retry");
    if (el) el.classList.add("is-error");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = msg || "Terjadi kesalahan saat memuat data.";
    }
    if (retry) retry.style.display = "inline-flex";
    this.clearStage();
  }
};

/* ─── Panel skeleton — placeholder for the info panel ─────────
   Keeps the info area visually occupied while a mode's data loads,
   so switching modes never flashes an empty region. Mounted once on
   <body> (like #panel) so it shares the same stacking context.

   Visibility is derived from the REAL panel, not from timing/events:
   a MutationObserver watches <body> and the skeleton shows only while
   #panel is ABSENT from the DOM. This is race-free — whenever a mode
   mounts its panel the skeleton disappears immediately, and it cannot
   linger past a mode switch or overlap the real panel. */
let skeletonEl = null;
let skeletonActive = false;

function syncSkeleton() {
  if (!skeletonEl) return;
  const panelExists = !!document.getElementById("panel");
  skeletonEl.classList.toggle("visible", skeletonActive && !panelExists);
}

// Watch for #panel appearing/disappearing; re-evaluate skeleton each time.
new MutationObserver(syncSkeleton).observe(document.body, {
  childList: true,
  subtree: true,
});

export const PanelSkeleton = {
  show() {
    skeletonActive = true;
    if (!skeletonEl) {
      skeletonEl = document.createElement("div");
      skeletonEl.id = "panel-skeleton";
      skeletonEl.setAttribute("aria-hidden", "true");
      skeletonEl.innerHTML = `
        <div class="skel-row skel-row--title"></div>
        <div class="skel-stats">
          <div class="skel-row skel-row--stat"></div>
          <div class="skel-row skel-row--stat"></div>
          <div class="skel-row skel-row--stat"></div>
        </div>
        <div class="skel-row"></div>
        <div class="skel-row"></div>
        <div class="skel-row skel-row--short"></div>
      `;
      document.body.appendChild(skeletonEl);
    }
    syncSkeleton();
  },
  hide() {
    skeletonActive = false;
    syncSkeleton();
  }
};

export function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

export function initCollapsible(rootEl) {
  rootEl.querySelectorAll("[data-collapse-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.collapseTarget
        ? rootEl.querySelector(btn.dataset.collapseTarget)
        : btn.nextElementSibling;
      if (target) {
        target.classList.toggle("collapsed");
        btn.setAttribute("aria-expanded", String(!target.classList.contains("collapsed")));
      }
    });
  });
}

/* ─── Shared search bar controller ───────────────────────────
   One searchbar lives in the shell. Each mode registers a handler:
     registerSearch({
       placeholder: 'Cari jalan...',
       onQuery: async (q) => [{ id, title, subtitle, action }],
     })
   onSelect is invoked with the picked item; it should flyTo/open popup.
   The shared controller owns the DOM (input, dropdown, clear,
   keyboard nav). Registering a new handler replaces the previous. */
let currentSearchHandler = null;
let searchResults = [];
let searchActiveIndex = -1;
let searchDebounceTimer = null;

export function registerSearch(handler) {
  currentSearchHandler = handler;

  const input = document.getElementById("search-input");
  const dropdown = document.getElementById("search-dropdown");
  const clear = document.getElementById("search-clear");
  if (!input || !dropdown) return;

  input.placeholder = handler?.placeholder || "Cari...";
  hideSearchDropdown();
  if (clear) clear.style.display = "none";

  const render = () => {
    if (!searchResults.length) {
      dropdown.style.display = "none";
      return;
    }
    dropdown.innerHTML = searchResults
      .map((r, i) =>
        `<div class="search-item${i === searchActiveIndex ? " active" : ""}" data-idx="${i}">
           <div class="s-name">${escHtml(r.title)}</div>
           ${r.subtitle ? `<div class="s-meta">${escHtml(r.subtitle)}</div>` : ""}
         </div>`)
      .join("");
    dropdown.style.display = "block";
    const active = dropdown.querySelector(".search-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  };

  const runQuery = async (q) => {
    if (!handler || !q.trim()) {
      searchResults = [];
      searchActiveIndex = -1;
      hideSearchDropdown();
      return;
    }
    try {
      const results = await handler.onQuery(q.trim());
      searchResults = results || [];
      searchActiveIndex = searchResults.length ? 0 : -1;
      render();
    } catch (e) {
      console.error("Search error:", e);
      searchResults = [];
      hideSearchDropdown();
    }
  };

  const onInput = () => {
    const q = input.value;
    if (clear) clear.style.display = q ? "flex" : "none";
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => runQuery(q), 250);
  };

  const select = (item) => {
    hideSearchDropdown();
    input.value = "";
    if (clear) clear.style.display = "none";
    item.action();
  };

  const onKeyDown = (e) => {
    if (dropdown.style.display !== "block" || !searchResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      searchActiveIndex = (searchActiveIndex + 1) % searchResults.length;
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      searchActiveIndex = (searchActiveIndex - 1 + searchResults.length) % searchResults.length;
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchResults[searchActiveIndex]) select(searchResults[searchActiveIndex]);
    } else if (e.key === "Escape") {
      hideSearchDropdown();
    }
  };

  input.oninput = onInput;
  input.onkeydown = onKeyDown;
  dropdown.onclick = (e) => {
    const item = e.target.closest(".search-item");
    if (item) {
      const idx = Number(item.dataset.idx);
      if (searchResults[idx]) select(searchResults[idx]);
    }
  };
  if (clear) clear.onclick = () => { input.value = ""; onInput(); };
  document.onclick = (e) => {
    if (!e.target.closest("#search-box")) hideSearchDropdown();
  };
}

function hideSearchDropdown() {
  const dropdown = document.getElementById("search-dropdown");
  if (dropdown) dropdown.style.display = "none";
}

export function getSearchHandler() { return currentSearchHandler; }

/* ─── Mobile bottom sheet — shared by all modes ──────────────
   Turns #panel into a draggable bottom sheet on ≤600px screens:
   • tap the grab handle / header → toggle open/collapsed
   • swipe the handle area up/down → open/collapsed with drag follow
   Modules call this once after creating their panel; it wires the
   header, toggle button and handle, and returns a teardown() so the
   listeners are removed on mode switch. */
export function initBottomSheet({ panel, handle, toggle, header }) {
  if (!panel) return null;

  const isMobile = () => window.matchMedia("(max-width: 600px)").matches;

  const applyTransform = (animate = true) => {
    if (!isMobile()) { panel.style.transform = ""; return; }
    panel.style.transition = animate ? "" : "none";
    const collapsedH = (handle?.offsetHeight || 0) + (header?.offsetHeight || 0);
    panel.style.transform = panel.classList.contains("collapsed")
      ? `translateY(calc(100% - ${collapsedH}px))`
      : "translateY(0px)";
    if (!animate) requestAnimationFrame(() => { panel.style.transition = ""; });
  };

  const sync = () => {
    if (!header.dataset.userToggled) {
      panel.classList.toggle("collapsed", isMobile());
      if (toggle) toggle.setAttribute("aria-expanded", String(!isMobile()));
      applyTransform(false);
    }
  };

  const setOpen = (open, animate = true) => {
    header.dataset.userToggled = "1";
    panel.classList.toggle("collapsed", !open);
    applyTransform(animate);
    if (toggle) {
      toggle.title = open ? "Minimalkan panel" : "Buka panel";
      toggle.setAttribute("aria-expanded", String(open));
    }
  };

  const toggleOpen = () => setOpen(panel.classList.contains("collapsed"));

  // Drag state (shared by pointer + touch events)
  let dragging = null;
  let lastDragEnd = 0; // timestamp to suppress the click that follows a drag

  const collapsedOffset = () => {
    const collapsedH = (handle?.offsetHeight || 0) + (header?.offsetHeight || 0);
    return Math.round((panel.offsetHeight - collapsedH) / panel.offsetHeight * 100);
  };

  const onDragStart = (startY) => {
    if (!isMobile()) return;
    dragging = { startY, wasCollapsed: panel.classList.contains("collapsed") };
    panel.style.transition = "none";
    document.body.style.touchAction = "none";
    if (handle) handle.classList.add("dragging");
  };
  const onDragMove = (clientY) => {
    if (!dragging) return;
    const dy = clientY - dragging.startY;
    // Base position in px: 0 when open, offset below when collapsed.
    const base = dragging.wasCollapsed ? panel.offsetHeight * collapsedOffset() / 100 : 0;
    const next = Math.max(0, Math.min(panel.offsetHeight, base + dy));
    panel.style.transform = `translateY(${next}px)`;
  };
  const onDragEnd = () => {
    if (!dragging) return;
    const { wasCollapsed } = dragging;
    dragging = null;
    lastDragEnd = Date.now();
    document.body.style.touchAction = "";
    if (handle) handle.classList.remove("dragging");
    // Snap: open if dragged more than half the collapsed offset upward.
    const threshold = Math.round(panel.offsetHeight * collapsedOffset() / 100 / 2);
    const currentY = parseFloat(panel.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] || "0");
    const shouldOpen = wasCollapsed ? currentY < threshold : true;
    const shouldCollapse = !wasCollapsed ? currentY > threshold : false;
    setOpen(shouldOpen && !shouldCollapse, true);
  };

  const onPointerDown = (e) => {
    // On touch screens both pointer and touch events fire for one
    // gesture; let the touch handler own touch drags to avoid double
    // state. Pointer (mouse) drags still work unchanged.
    if (e.pointerType === "touch") return;
    if (e.target.closest("button")) return;
    onDragStart(e.clientY);
    const move = (ev) => onDragMove(ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onDragEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTouchStart = (e) => {
    if (e.target.closest("button")) return;
    if (e.touches.length !== 1) return;
    onDragStart(e.touches[0].clientY);
    const move = (ev) => {
      if (!dragging) return;
      ev.preventDefault();
      onDragMove(ev.touches[0].clientY);
    };
    const up = () => {
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      document.removeEventListener("touchcancel", up);
      onDragEnd();
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
    document.addEventListener("touchcancel", up);
  };

  const onHeaderClick = (e) => {
    if (e.target.closest("button")) return;
    // A click fires right after a drag gesture — don't toggle then.
    if (Date.now() - lastDragEnd < 400) return;
    toggleOpen();
  };

  // Wire up
  if (header) {
    header.addEventListener("click", onHeaderClick);
    header.addEventListener("pointerdown", onPointerDown);
    header.addEventListener("touchstart", onTouchStart, { passive: false });
  }
  if (handle) {
    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("touchstart", onTouchStart, { passive: false });
  }
  if (toggle) toggle.addEventListener("click", (e) => { e.stopPropagation(); toggleOpen(); });
  const onResize = () => sync();
  window.addEventListener("resize", onResize);
  sync();

  return function teardown() {
    if (header) {
      header.removeEventListener("click", onHeaderClick);
      header.removeEventListener("pointerdown", onPointerDown);
      header.removeEventListener("touchstart", onTouchStart);
    }
    if (handle) {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("touchstart", onTouchStart);
    }
    window.removeEventListener("resize", onResize);
  };
}
