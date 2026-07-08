(function () {
  const adapter = window.SNAdapter;
  if (!adapter) return;

  const BOOKMARK_CURSOR =
    "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"28\" viewBox=\"0 0 10 28\"><rect x=\"1\" y=\"1\" width=\"8\" height=\"26\" rx=\"2\" fill=\"%23ffd93d\" stroke=\"%23201c3a\" stroke-width=\"2\"/></svg>') 5 27, pointer";

  const BOOKMARK_COLORS = [
    { id: "rose", hex: "#d68989" },
    { id: "amber", hex: "#e3b869" },
    { id: "sky", hex: "#8db8d8" },
    { id: "sage", hex: "#9cbf8a" },
    { id: "lavender", hex: "#b9a0d4" },
  ];

  function bookmarkColorHex(bm) {
    const found = BOOKMARK_COLORS.find((c) => c.id === bm.color);
    return (found || BOOKMARK_COLORS[0]).hex;
  }

  const PANEL_COLORS = [
    { id: "parchment", swatch: "#e8d3a3", top: "#f6ead0", bottom: "#dfc492" },
    { id: "rose", swatch: "#d68989", top: "#f8e3e3", bottom: "#e3b3b3" },
    { id: "amber", swatch: "#e3b869", top: "#faf0d6", bottom: "#e8cb8f" },
    { id: "sky", swatch: "#8db8d8", top: "#e6f2fa", bottom: "#b8d4e8" },
    { id: "sage", swatch: "#9cbf8a", top: "#ecf5e4", bottom: "#c3dcae" },
    { id: "lavender", swatch: "#b9a0d4", top: "#f2e9f8", bottom: "#d4bfe8" },
  ];

  const NOTE_STYLE_OPTIONS = [
    { id: "tape", label: "Tape" },
    { id: "zigzag", label: "Zigzag" },
    { id: "plain", label: "Plain" },
  ];

  function panelColorEntry(record) {
    return PANEL_COLORS.find((c) => c.id === record.noteColor) || PANEL_COLORS[0];
  }

  function applyPanelColor() {
    if (!panelEl) return;
    const entry = panelColorEntry(record);
    panelEl.style.setProperty("--panel-top", entry.top);
    panelEl.style.setProperty("--panel-bottom", entry.bottom);
  }

  function updateNoteColorActive() {
    if (!panelEl) return;
    const current = record.noteColor || PANEL_COLORS[0].id;
    panelEl.querySelectorAll(".sn-panel-body > .sn-color-section .sn-color-swatch").forEach((sw) => {
      sw.classList.toggle("sn-color-active", sw.dataset.colorId === current);
    });
  }

  function syncNoteColorToBookmark(colorId) {
    record.noteColor = colorId;
    applyPanelColor();
    updateNoteColorActive();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  let root = null;
  let pinEl = null;
  let menuEl = null;
  let panelEl = null;
  let toastEl = null;
  let bookmarkOverlay = null;
  let panelOpen = false;
  let menuOpenState = false;
  let panelUserMoved = false;
  let panelDragState = null;
  let pinPosition = null;
  let pinDragState = null;
  let pinDidDrag = false;
  let currentKey = null;
  let record = null;
  let videoEl = null;
  let notesDebounce = null;
  let markerRefreshTimer = null;
  let positionFrame = null;
  let readyPollTimer = null;
  let retryTimers = [];
  let markerEls = [];
  let hlRoot = null;
  let highlighter = null;
  let openColorPickerId = null;
  let noteStyle = "tape";

  function applyNoteStyleClass(el) {
    el.classList.remove("sn-style-zigzag", "sn-style-plain");
    if (noteStyle === "zigzag") el.classList.add("sn-style-zigzag");
    else if (noteStyle === "plain") el.classList.add("sn-style-plain");
  }

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => (node[k] = v));
    return node;
  }

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = el("div", "sn-root");
    document.documentElement.appendChild(root);
    return root;
  }

  function onDocClickCloseMenu(e) {
    if (menuEl && !menuEl.contains(e.target) && e.target !== pinEl) closeMenu();
  }

  function onBookmarkModeKeydown(e) {
    if (e.key === "Escape") exitBookmarkMode();
  }

  function onWindowMouseDownDuringBookmarkMode(e) {
    if (!bookmarkOverlay || !videoEl) return;
    const r = bookmarkOverlay.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    e.preventDefault();
    e.stopPropagation();
    if (inside) {
      const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const seconds = pct * videoEl.duration;
      exitBookmarkMode();
      addBookmarkAt(seconds);
    } else {
      exitBookmarkMode();
    }
  }

  function teardown() {
    exitBookmarkMode();
    closeMenu();
    onPanelDragEnd();
    document.removeEventListener("mousemove", onPinDragMove);
    document.removeEventListener("mouseup", onPinDragEnd);
    pinDragState = null;
    pinDidDrag = false;
    retryTimers.forEach(clearTimeout);
    retryTimers = [];
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    pinEl = null;
    menuEl = null;
    panelEl = null;
    toastEl = null;
    panelOpen = false;
    panelUserMoved = false;
    markerEls = [];
    clearInterval(markerRefreshTimer);
    if (readyPollTimer) clearInterval(readyPollTimer);
    window.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition, true);
  }

  function schedulePosition() {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      positionUI();
    });
  }

  function getAnchorRect() {
    const container = adapter.getPlayerContainer();
    if (container) {
      const r = container.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
    if (videoEl) {
      const r = videoEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
    const bottom = window.innerHeight - 20;
    return { left: 20, top: bottom - 140, right: window.innerWidth - 20, bottom, width: window.innerWidth - 40, height: 140 };
  }

  function computePinPosition() {
    const pinSize = 42;
    if (pinPosition) {
      let left;
      let top;
      if (pinPosition.corner === "top-left") {
        left = pinPosition.offsetX;
        top = pinPosition.offsetY;
      } else if (pinPosition.corner === "top-right") {
        left = window.innerWidth - pinPosition.offsetX - pinSize;
        top = pinPosition.offsetY;
      } else if (pinPosition.corner === "bottom-left") {
        left = pinPosition.offsetX;
        top = window.innerHeight - pinPosition.offsetY - pinSize;
      } else {
        left = window.innerWidth - pinPosition.offsetX - pinSize;
        top = window.innerHeight - pinPosition.offsetY - pinSize;
      }
      return { left: Math.max(8, left), top: Math.max(8, top) };
    }
    const rect = getAnchorRect();
    return { left: Math.max(8, rect.right - 54), top: Math.max(8, rect.bottom - 62) };
  }

  function positionUI() {
    if (!pinEl) return;
    const { left: pinLeft, top: pinTop } = computePinPosition();
    pinEl.style.left = `${pinLeft}px`;
    pinEl.style.top = `${pinTop}px`;

    if (menuEl) {
      menuEl.style.left = `${Math.max(8, pinLeft - 96)}px`;
      menuEl.style.top = `${Math.max(8, pinTop - 100)}px`;
    }

    if (panelEl && !panelUserMoved) {
      const panelWidth = panelEl.offsetWidth || 280;
      let panelLeft = pinLeft - panelWidth - 10;
      if (panelLeft < 8) panelLeft = Math.min(pinLeft + 54 + 10, window.innerWidth - panelWidth - 8);
      let panelTop = pinTop - 340;
      if (panelTop < 8) panelTop = Math.min(pinTop + 54, window.innerHeight - 400);
      panelEl.style.left = `${Math.max(8, panelLeft)}px`;
      panelEl.style.top = `${Math.max(8, panelTop)}px`;
    }

    renderMarkers();
  }

  function onPinMouseDown(e) {
    const rect = pinEl.getBoundingClientRect();
    pinDragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, startX: e.clientX, startY: e.clientY };
    pinDidDrag = false;
    document.addEventListener("mousemove", onPinDragMove);
    document.addEventListener("mouseup", onPinDragEnd);
  }

  function onPinDragMove(e) {
    if (!pinDragState) return;
    const moved = Math.abs(e.clientX - pinDragState.startX) + Math.abs(e.clientY - pinDragState.startY);
    if (moved > 4) pinDidDrag = true;
    if (!pinDidDrag) return;
    closeMenu();
    const left = Math.min(Math.max(8, e.clientX - pinDragState.dx), window.innerWidth - 50);
    const top = Math.min(Math.max(8, e.clientY - pinDragState.dy), window.innerHeight - 50);
    pinEl.style.left = `${left}px`;
    pinEl.style.top = `${top}px`;
  }

  async function onPinDragEnd() {
    document.removeEventListener("mousemove", onPinDragMove);
    document.removeEventListener("mouseup", onPinDragEnd);
    pinDragState = null;
    if (!pinDidDrag) return;
    const rect = pinEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const vertical = centerY < window.innerHeight / 2 ? "top" : "bottom";
    const horizontal = centerX < window.innerWidth / 2 ? "left" : "right";
    const corner = `${vertical}-${horizontal}`;
    pinPosition = {
      corner,
      offsetX: horizontal === "left" ? rect.left : window.innerWidth - rect.right,
      offsetY: vertical === "top" ? rect.top : window.innerHeight - rect.bottom,
    };
    await StudyNotesStorage.setPinPosition(pinPosition);
    positionUI();
  }

  function onPanelHeadMouseDown(e) {
    if (e.target.closest(".sn-panel-close")) return;
    const rect = panelEl.getBoundingClientRect();
    panelDragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    panelUserMoved = true;
    document.addEventListener("mousemove", onPanelDragMove);
    document.addEventListener("mouseup", onPanelDragEnd);
    e.preventDefault();
  }

  function onPanelDragMove(e) {
    if (!panelDragState) return;
    const left = Math.min(Math.max(8, e.clientX - panelDragState.dx), window.innerWidth - 60);
    const top = Math.min(Math.max(8, e.clientY - panelDragState.dy), window.innerHeight - 40);
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
  }

  function onPanelDragEnd() {
    panelDragState = null;
    document.removeEventListener("mousemove", onPanelDragMove);
    document.removeEventListener("mouseup", onPanelDragEnd);
  }

  function showToast(message) {
    if (!toastEl || !pinEl) return;
    toastEl.textContent = message;
    const pinRect = pinEl.getBoundingClientRect();
    toastEl.style.left = `${Math.max(8, pinRect.left - 150)}px`;
    toastEl.style.top = `${pinRect.top}px`;
    toastEl.classList.add("sn-show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("sn-show"), 1800);
  }

  function hasContent() {
    return !!(record && (record.notes.trim() || record.bookmarks.length || (record.highlights && record.highlights.length)));
  }

  function updatePinState() {
    const active = hasContent();
    pinEl.classList.toggle("sn-has-notes", active);
    const highlightCount = record && record.highlights ? record.highlights.length : 0;
    chrome.runtime.sendMessage({
      type: "sn-badge",
      count: record ? record.bookmarks.length + highlightCount + (record.notes.trim() ? 1 : 0) : 0,
    });
  }

  async function persist() {
    record.authorName = await StudyNotesStorage.getUserName();
    await StudyNotesStorage.setRecord(currentKey, record);
    updatePinState();
  }

  function clearMarkerEls() {
    markerEls.forEach((m) => m.remove());
    markerEls = [];
  }

  function renderMarkers() {
    clearMarkerEls();
    if (!adapter.supportsMarkers || !videoEl || !isFinite(videoEl.duration) || videoEl.duration <= 0 || !root) return;

    const rect = getAnchorRect();
    const barHeight = 28;
    const barCenterY = rect.bottom - barHeight / 2;

    record.bookmarks.forEach((bm) => {
      const pct = Math.min(1, Math.max(0, bm.timestampSeconds / videoEl.duration));
      const hasEnd = bm.endTimestampSeconds && bm.endTimestampSeconds > bm.timestampSeconds;
      const colorHex = bookmarkColorHex(bm);

      if (hasEnd) {
        const endPct = Math.min(1, Math.max(0, bm.endTimestampSeconds / videoEl.duration));
        const range = el("div", "sn-marker-range");
        range.style.left = `${rect.left + pct * rect.width}px`;
        range.style.top = `${barCenterY}px`;
        range.style.width = `${(endPct - pct) * rect.width}px`;
        range.style.setProperty("--marker-range-color", hexToRgba(colorHex, 0.35));
        range.style.setProperty("--marker-range-outline", hexToRgba(colorHex, 0.6));
        range.title = bm.label || StudyNotesExporter.bookmarkTimeLabel(bm);
        range.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          videoEl.currentTime = bm.timestampSeconds;
          openPanel({ focusBookmarkId: bm.id });
        });
        root.appendChild(range);
        markerEls.push(range);
      }

      const marker = el("div", "sn-marker");
      marker.style.left = `${rect.left + pct * rect.width}px`;
      marker.style.top = `${barCenterY}px`;
      marker.style.setProperty("--marker-color", colorHex);
      marker.style.setProperty("--marker-glow", hexToRgba(colorHex, 0.7));
      marker.title = bm.label || StudyNotesExporter.bookmarkTimeLabel(bm);
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        videoEl.currentTime = bm.timestampSeconds;
        openPanel({ focusBookmarkId: bm.id });
      });
      root.appendChild(marker);
      markerEls.push(marker);
    });
  }

  function highlightBookmarkItem(id) {
    const itemEl = panelEl.querySelector(`[data-bookmark-id="${id}"]`);
    if (!itemEl) return;
    itemEl.scrollIntoView({ block: "nearest" });
    itemEl.classList.add("sn-highlight");
    setTimeout(() => itemEl.classList.remove("sn-highlight"), 1500);
    const input = itemEl.querySelector(".sn-bookmark-label-input");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function renderBookmarkList() {
    const list = panelEl.querySelector(".sn-bookmark-list");
    const empty = panelEl.querySelector(".sn-empty-hint");
    if (!list || !empty) return;
    list.innerHTML = "";
    const sorted = [...record.bookmarks].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    empty.style.display = sorted.length === 0 ? "block" : "none";

    sorted.forEach((bm) => {
      const item = el("div", "sn-bookmark-item");
      item.dataset.bookmarkId = bm.id;

      const row = el("div", "sn-bookmark-row");

      const colorDot = el("button", "sn-bookmark-color-dot", { title: "Bookmark colour" });
      colorDot.style.setProperty("--bm-color", bookmarkColorHex(bm));
      colorDot.addEventListener("click", (e) => {
        e.stopPropagation();
        openColorPickerId = openColorPickerId === bm.id ? null : bm.id;
        renderBookmarkList();
      });
      row.appendChild(colorDot);

      const timeBtn = el("button", "sn-bookmark-time");
      timeBtn.style.setProperty("--bm-color", bookmarkColorHex(bm));
      timeBtn.textContent = StudyNotesExporter.bookmarkTimeLabel(bm);
      timeBtn.addEventListener("click", () => {
        videoEl.currentTime = bm.timestampSeconds;
        if (videoEl.paused) videoEl.play().catch(() => {});
      });
      row.appendChild(timeBtn);

      const meta = el("div", "sn-bookmark-meta");
      const labelInput = el("input", "sn-bookmark-label-input", {
        type: "text",
        placeholder: "What happens here…",
        value: bm.label || "",
      });
      labelInput.addEventListener("click", (e) => e.stopPropagation());
      labelInput.addEventListener("input", () => {
        bm.label = labelInput.value;
        clearTimeout(labelInput._t);
        labelInput._t = setTimeout(async () => {
          await persist();
          renderMarkers();
        }, 500);
      });
      meta.appendChild(labelInput);

      const endInput = el("input", "sn-bookmark-end-input", {
        type: "text",
        placeholder: "end time, e.g. 5:45 (optional)",
        value: bm.endTimestampSeconds ? StudyNotesExporter.formatTimestamp(bm.endTimestampSeconds) : "",
      });
      endInput.addEventListener("click", (e) => e.stopPropagation());
      endInput.addEventListener("input", () => {
        clearTimeout(endInput._t);
        endInput._t = setTimeout(async () => {
          const seconds = StudyNotesExporter.parseTimestamp(endInput.value);
          bm.endTimestampSeconds = seconds && seconds > bm.timestampSeconds ? seconds : null;
          await persist();
          timeBtn.textContent = StudyNotesExporter.bookmarkTimeLabel(bm);
          renderMarkers();
        }, 500);
      });
      meta.appendChild(endInput);

      const removeBtn = el("button", "sn-bookmark-remove", { textContent: "✕" });
      removeBtn.addEventListener("click", async () => {
        record.bookmarks = record.bookmarks.filter((b) => b.id !== bm.id);
        await persist();
        renderBookmarkList();
        renderMarkers();
      });

      row.appendChild(meta);
      row.appendChild(removeBtn);
      item.appendChild(row);

      if (openColorPickerId === bm.id) {
        const pickerSection = el("div", "sn-color-section");
        pickerSection.appendChild(el("div", "sn-color-section-label", { textContent: "Colour:" }));
        const pickerRow = el("div", "sn-color-picker-row");
        BOOKMARK_COLORS.forEach((c) => {
          const swatch = el("button", "sn-color-swatch", { title: c.id });
          swatch.style.setProperty("--swatch-color", c.hex);
          if ((bm.color || BOOKMARK_COLORS[0].id) === c.id) swatch.classList.add("sn-color-active");
          swatch.addEventListener("click", async (e) => {
            e.stopPropagation();
            bm.color = c.id;
            openColorPickerId = null;
            syncNoteColorToBookmark(c.id);
            await persist();
            renderBookmarkList();
            renderMarkers();
          });
          pickerRow.appendChild(swatch);
        });
        pickerSection.appendChild(pickerRow);
        item.appendChild(pickerSection);
      }

      list.appendChild(item);
    });
  }

  async function addBookmarkAt(seconds) {
    const bookmark = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestampSeconds: seconds,
      endTimestampSeconds: null,
      label: "",
      note: "",
      color: BOOKMARK_COLORS[(record.bookmarks.length) % BOOKMARK_COLORS.length].id,
      createdAt: Date.now(),
    };
    record.bookmarks.push(bookmark);
    syncNoteColorToBookmark(bookmark.color);
    openColorPickerId = bookmark.id;
    await persist();
    renderMarkers();
    showToast(`Bookmarked at ${StudyNotesExporter.formatTimestamp(seconds)}`);
    openPanel({ focusBookmarkId: bookmark.id });
    return bookmark;
  }

  function enterBookmarkMode() {
    videoEl = adapter.getVideoElement() || videoEl;
    if (!videoEl) {
      showToast("No video found on this page yet");
      return;
    }

    const canPlaceOnTimeline = adapter.supportsMarkers && isFinite(videoEl.duration) && videoEl.duration > 0;
    if (!canPlaceOnTimeline) {
      addBookmarkAt(videoEl.currentTime);
      return;
    }

    const playerRect = getAnchorRect();
    const barHeight = 28;
    bookmarkOverlay = el("div", "sn-bookmark-overlay");
    bookmarkOverlay.style.left = `${playerRect.left}px`;
    bookmarkOverlay.style.top = `${playerRect.bottom - barHeight}px`;
    bookmarkOverlay.style.width = `${playerRect.width}px`;
    bookmarkOverlay.style.height = `${barHeight}px`;
    bookmarkOverlay.style.cursor = BOOKMARK_CURSOR;
    bookmarkOverlay.title = "Click a point on the timeline to drop a bookmark there";
    root.appendChild(bookmarkOverlay);
    document.addEventListener("keydown", onBookmarkModeKeydown);
    window.addEventListener("mousedown", onWindowMouseDownDuringBookmarkMode, true);
  }

  function exitBookmarkMode() {
    if (bookmarkOverlay && bookmarkOverlay.parentNode) bookmarkOverlay.parentNode.removeChild(bookmarkOverlay);
    bookmarkOverlay = null;
    document.removeEventListener("keydown", onBookmarkModeKeydown);
    window.removeEventListener("mousedown", onWindowMouseDownDuringBookmarkMode, true);
  }

  function openPanel({ focusBookmarkId, focusNotes } = {}) {
    panelOpen = true;
    panelEl.style.display = "flex";
    renderBookmarkList();
    positionUI();
    if (focusBookmarkId) {
      highlightBookmarkItem(focusBookmarkId);
    } else if (focusNotes) {
      panelEl.querySelector(".sn-notes-area").focus();
    }
  }

  function closePanel() {
    panelOpen = false;
    panelEl.style.display = "none";
  }

  function openMenu() {
    menuOpenState = true;
    menuEl.style.display = "flex";
    positionUI();
    setTimeout(() => document.addEventListener("click", onDocClickCloseMenu, true), 0);
  }

  function closeMenu() {
    menuOpenState = false;
    if (menuEl) menuEl.style.display = "none";
    document.removeEventListener("click", onDocClickCloseMenu, true);
  }

  function toggleMenu() {
    if (menuOpenState) closeMenu();
    else openMenu();
  }

  function buildPin() {
    pinEl = el("button", "sn-pin", { textContent: "📌", title: "Study Notes — drag to move" });
    pinEl.addEventListener("mousedown", onPinMouseDown);
    pinEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pinDidDrag) {
        pinDidDrag = false;
        return;
      }
      toggleMenu();
    });
    root.appendChild(pinEl);
  }

  function buildMenu() {
    menuEl = el("div", "sn-menu");
    menuEl.style.display = "none";

    const noteItem = el("button", "sn-menu-item", { innerHTML: "📝 <span>Add note</span>" });
    noteItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      openPanel({ focusNotes: true });
    });
    menuEl.appendChild(noteItem);

    const bookmarkItem = el("button", "sn-menu-item", { innerHTML: "🔖 <span>Add bookmark</span>" });
    bookmarkItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      enterBookmarkMode();
    });
    menuEl.appendChild(bookmarkItem);

    const highlightItem = el("button", "sn-menu-item", { innerHTML: "🖍️ <span>Highlight text</span>" });
    highlightItem.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      showToast("Select any text on the page, then click 🖍️ Highlight");
    });
    menuEl.appendChild(highlightItem);

    root.appendChild(menuEl);
  }

  function buildPanel() {
    panelEl = el("div", "sn-panel");
    panelEl.style.display = "none";

    const head = el("div", "sn-panel-head");
    head.appendChild(el("div", "sn-panel-title", { textContent: record.title }));
    const closeBtn = el("button", "sn-panel-close", { textContent: "✕" });
    closeBtn.addEventListener("click", closePanel);
    head.appendChild(closeBtn);
    head.addEventListener("mousedown", onPanelHeadMouseDown);

    const body = el("div", "sn-panel-body");
    const textarea = el("textarea", "sn-notes-area", {
      placeholder: "Jot down what matters while it's fresh…",
      value: record.notes,
    });
    textarea.addEventListener("input", () => {
      record.notes = textarea.value;
      clearTimeout(notesDebounce);
      notesDebounce = setTimeout(persist, 500);
    });

    const exportRow = el("div", "sn-export-row");
    const exportBtn = el("button", "sn-export-btn", { textContent: "Export notes" });
    exportBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "sn-export",
        filename: StudyNotesExporter.filenameFor(record, "md"),
        content: StudyNotesExporter.buildMarkdown(record),
        mime: "text/markdown",
      });
      showToast("Exported to Downloads");
    });
    exportRow.appendChild(exportBtn);

    const colorSection = el("div", "sn-color-section");
    colorSection.appendChild(el("div", "sn-color-section-label", { textContent: "Note colour:" }));
    const colorRow = el("div", "sn-color-picker-row");
    PANEL_COLORS.forEach((c) => {
      const swatch = el("button", "sn-color-swatch", { title: c.id });
      swatch.dataset.colorId = c.id;
      swatch.style.setProperty("--swatch-color", c.swatch);
      if ((record.noteColor || PANEL_COLORS[0].id) === c.id) swatch.classList.add("sn-color-active");
      swatch.addEventListener("click", async (e) => {
        e.stopPropagation();
        record.noteColor = c.id;
        applyPanelColor();
        colorRow.querySelectorAll(".sn-color-swatch").forEach((sw) => sw.classList.toggle("sn-color-active", sw.dataset.colorId === c.id));
        await persist();
      });
      colorRow.appendChild(swatch);
    });
    colorSection.appendChild(colorRow);

    const styleSection = el("div", "sn-style-section");
    styleSection.appendChild(el("div", "sn-style-section-label", { textContent: "Style:" }));
    const styleOptions = el("div", "sn-style-options");
    NOTE_STYLE_OPTIONS.forEach((s) => {
      const btn = el("button", "sn-style-btn", { title: s.label });
      btn.dataset.styleId = s.id;
      btn.appendChild(el("span", `sn-style-preview sn-style-preview-${s.id}`));
      btn.appendChild(el("span", "", { textContent: s.label }));
      if (noteStyle === s.id) btn.classList.add("sn-style-active");
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        noteStyle = s.id;
        applyNoteStyleClass(panelEl);
        styleOptions.querySelectorAll(".sn-style-btn").forEach((b) => b.classList.toggle("sn-style-active", b.dataset.styleId === s.id));
        await StudyNotesStorage.setNoteStyle(s.id);
      });
      styleOptions.appendChild(btn);
    });
    styleSection.appendChild(styleOptions);

    body.appendChild(textarea);
    body.appendChild(colorSection);
    body.appendChild(styleSection);
    body.appendChild(el("div", "sn-bookmarks-label", { textContent: "Bookmarks" }));
    body.appendChild(el("div", "sn-bookmark-list"));
    body.appendChild(el("div", "sn-empty-hint", { textContent: "No bookmarks yet — pick 🔖 Add bookmark from the pin." }));
    body.appendChild(exportRow);

    panelEl.appendChild(head);
    panelEl.appendChild(body);
    root.appendChild(panelEl);
    applyPanelColor();
    applyNoteStyleClass(panelEl);
  }

  function buildHighlightUI() {
    hlRoot = el("div", "sn-hl-root");
    document.documentElement.appendChild(hlRoot);

    const selectionToolbarEl = el("div", "sn-select-toolbar");
    selectionToolbarEl.style.display = "none";
    const highlightSelectBtn = el("button", "sn-select-highlight-btn", { textContent: "🖍️ Highlight" });
    selectionToolbarEl.appendChild(highlightSelectBtn);

    const stickyNoteEl = el("div", "sn-hlnote");
    stickyNoteEl.style.display = "none";
    const stickyHead = el("div", "sn-hlnote-head");
    stickyHead.appendChild(el("span", "", { textContent: "Note" }));
    const stickyCloseBtn = el("button", "sn-hlnote-close", { textContent: "✕" });
    stickyHead.appendChild(stickyCloseBtn);
    const stickyQuoteEl = el("div", "sn-hlnote-quote");
    const stickyTextarea = el("textarea", "sn-hlnote-textarea", { placeholder: "What matters about this…" });
    const stickyRemoveBtn = el("button", "sn-hlnote-remove", { textContent: "Remove highlight" });
    stickyNoteEl.appendChild(stickyHead);
    stickyNoteEl.appendChild(stickyQuoteEl);
    stickyNoteEl.appendChild(stickyTextarea);
    stickyNoteEl.appendChild(stickyRemoveBtn);

    hlRoot.appendChild(selectionToolbarEl);
    hlRoot.appendChild(stickyNoteEl);

    highlighter = Highlighter.create({
      container: document.body,
      selectionToolbarEl,
      highlightBtn: highlightSelectBtn,
      stickyNoteEl,
      stickyQuoteEl,
      stickyTextarea,
      stickyCloseBtn,
      stickyRemoveBtn,
      highlightListEl: null,
      highlightEmptyHintEl: null,
      getRecord: () => record,
      onChange: () => persist(),
    });
    applyNoteStyleClass(stickyNoteEl);
  }

  async function initForCurrentVideo(skipVideoWait) {
    if (!adapter.isSupported()) return;
    videoEl = adapter.getVideoElement();
    if (!videoEl && !skipVideoWait) {
      const maxAttempts = adapter.videoOptional ? 6 : Infinity;
      let attempts = 0;
      readyPollTimer = setInterval(() => {
        videoEl = adapter.getVideoElement();
        attempts += 1;
        if (videoEl || attempts >= maxAttempts) {
          clearInterval(readyPollTimer);
          readyPollTimer = null;
          initForCurrentVideo(true);
        }
      }, 500);
      return;
    }

    pinPosition = await StudyNotesStorage.getPinPosition();

    currentKey = StudyNotesStorage.keyFor(adapter.site, adapter.getVideoId());
    const existing = await StudyNotesStorage.getRecord(currentKey);
    record =
      existing ||
      StudyNotesStorage.emptyRecord({
        site: adapter.site,
        videoId: adapter.getVideoId(),
        url: adapter.getUrl(),
        title: adapter.getTitle(),
      });
    record.title = adapter.getTitle();
    record.url = adapter.getUrl();
    if (!record.highlights) record.highlights = [];
    if (!record.noteColor) record.noteColor = "parchment";

    ensureRoot();
    toastEl = el("div", "sn-toast");
    root.appendChild(toastEl);
    buildPin();
    buildMenu();
    buildPanel();
    updatePinState();
    positionUI();
    highlighter.reapplyHighlights();
    retryTimers = [300, 1000, 2500].map((ms) => setTimeout(positionUI, ms));
    if (videoEl) videoEl.addEventListener("loadedmetadata", positionUI, { once: true });

    window.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("resize", schedulePosition, true);
    markerRefreshTimer = setInterval(positionUI, 4000);
  }

  function reinit() {
    teardown();
    setTimeout(initForCurrentVideo, 400);
  }

  (async () => {
    noteStyle = await StudyNotesStorage.getNoteStyle();
    buildHighlightUI();
    initForCurrentVideo();
    if (adapter.onNavigate) adapter.onNavigate(reinit);
  })();
})();
