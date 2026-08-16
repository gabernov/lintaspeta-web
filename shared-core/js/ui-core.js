let toastTimer = null;

export function toast(msg, ms = 3000) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

export const Loading = {
  show(text) {
    const el = document.getElementById("loading");
    const status = document.getElementById("load-status");
    if (el) el.classList.remove("hidden");
    if (status && text) status.textContent = text;
  },
  hide() {
    const el = document.getElementById("loading");
    if (el) el.classList.add("hidden");
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
