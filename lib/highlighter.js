const Highlighter = (() => {
  const HIGHLIGHT_COLORS = [
    { id: "rose", hex: "#d68989", top: "#f8e3e3", bottom: "#e3b3b3" },
    { id: "amber", hex: "#e3b869", top: "#faf0d6", bottom: "#e8cb8f" },
    { id: "sky", hex: "#8db8d8", top: "#e6f2fa", bottom: "#b8d4e8" },
    { id: "sage", hex: "#9cbf8a", top: "#ecf5e4", bottom: "#c3dcae" },
    { id: "lavender", hex: "#b9a0d4", top: "#f2e9f8", bottom: "#d4bfe8" },
  ];

  function highlightColorEntry(h) {
    return HIGHLIGHT_COLORS.find((c) => c.id === h.color) || HIGHLIGHT_COLORS[0];
  }

  function highlightColorHex(h) {
    return highlightColorEntry(h).hex;
  }

  const NOTE_STYLES = [
    { id: "tape", label: "Tape" },
    { id: "zigzag", label: "Zigzag" },
    { id: "plain", label: "Plain" },
  ];

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => (node[k] = v));
    return node;
  }

  function getTextOffsets(container, range) {
    let start = -1;
    let end = -1;
    let pos = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (start === -1 && node === range.startContainer) start = pos + range.startOffset;
      if (node === range.endContainer) end = pos + range.endOffset;
      pos += len;
    }
    if (start === -1) start = 0;
    if (end === -1) end = pos;
    return { start, end };
  }

  function getRangeFromOffsets(container, start, end) {
    const range = document.createRange();
    let pos = 0;
    let startSet = false;
    let endSet = false;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (!startSet && pos + len >= start) {
        range.setStart(node, Math.max(0, start - pos));
        startSet = true;
      }
      if (!endSet && pos + len >= end) {
        range.setEnd(node, Math.max(0, end - pos));
        endSet = true;
        break;
      }
      pos += len;
    }
    if (!startSet || !endSet) return null;
    return range;
  }

  function wrapRangeWithMarks(range, highlightId) {
    const root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach((node) => {
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      if (node === range.startContainer) nodeRange.setStart(node, range.startOffset);
      if (node === range.endContainer) nodeRange.setEnd(node, range.endOffset);
      if (nodeRange.collapsed) return;
      const mark = document.createElement("mark");
      mark.className = "sn-highlight-mark";
      mark.dataset.highlightId = highlightId;
      try {
        nodeRange.surroundContents(mark);
      } catch (e) {
        /* skip a node that can't be cleanly wrapped */
      }
    });
  }

  function create(options) {
    const {
      container,
      selectionToolbarEl,
      highlightBtn,
      stickyNoteEl,
      stickyQuoteEl,
      stickyTextarea,
      stickyCloseBtn,
      stickyRemoveBtn,
      highlightListEl,
      highlightEmptyHintEl,
      getRecord,
      onChange,
    } = options;

    let stickyOpenId = null;
    let noteDebounce = null;

    function persist() {
      return Promise.resolve(onChange());
    }

    function applyMarkColor(h) {
      const hex = highlightColorHex(h);
      container.querySelectorAll(`mark[data-highlight-id="${h.id}"]`).forEach((m) => {
        m.style.setProperty("--hl-color", hexToRgba(hex, 0.55));
        m.style.setProperty("--hl-color-active", hexToRgba(hex, 0.9));
      });
    }

    function applyStickyBackground(h) {
      const entry = highlightColorEntry(h);
      stickyNoteEl.style.setProperty("--sticky-top", entry.top);
      stickyNoteEl.style.setProperty("--sticky-bottom", entry.bottom);
    }

    function reapplyHighlights() {
      getRecord().highlights.forEach((h) => {
        if (container.querySelector(`mark[data-highlight-id="${h.id}"]`)) return;
        const range = getRangeFromOffsets(container, h.startOffset, h.endOffset);
        if (!range || range.toString() !== h.text) return;
        wrapRangeWithMarks(range, h.id);
        applyMarkColor(h);
      });
    }

    function updateActiveHighlightClasses() {
      container.querySelectorAll("mark.sn-highlight-mark").forEach((m) => {
        m.classList.toggle("sn-highlight-active", m.dataset.highlightId === stickyOpenId);
      });
      if (highlightListEl) {
        highlightListEl.querySelectorAll(".dv-highlight-item").forEach((item) => {
          item.classList.toggle("sn-highlight-active", item.dataset.highlightId === stickyOpenId);
        });
      }
    }

    function updateColorRowActive(h) {
      colorRow.querySelectorAll(".sn-hl-color-swatch").forEach((sw) => {
        sw.classList.toggle("sn-color-active", (h.color || HIGHLIGHT_COLORS[0].id) === sw.dataset.colorId);
      });
    }

    const colorSection = el("div", "sn-hl-color-section");
    colorSection.appendChild(el("div", "sn-hl-color-label", { textContent: "Colour:" }));
    const colorRow = el("div", "sn-hl-color-row");
    colorSection.appendChild(colorRow);
    HIGHLIGHT_COLORS.forEach((c) => {
      const swatch = el("button", "sn-hl-color-swatch", { title: c.id });
      swatch.dataset.colorId = c.id;
      swatch.style.setProperty("--swatch-color", c.hex);
      swatch.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!stickyOpenId) return;
        const h = getRecord().highlights.find((x) => x.id === stickyOpenId);
        if (!h) return;
        h.color = c.id;
        applyMarkColor(h);
        applyStickyBackground(h);
        updateColorRowActive(h);
        persist();
      });
      colorRow.appendChild(swatch);
    });
    stickyNoteEl.insertBefore(colorSection, stickyTextarea);

    function currentNoteStyleId() {
      if (stickyNoteEl.classList.contains("sn-style-zigzag")) return "zigzag";
      if (stickyNoteEl.classList.contains("sn-style-plain")) return "plain";
      return "tape";
    }

    function updateStyleOptionsActive() {
      const current = currentNoteStyleId();
      styleOptions.querySelectorAll(".sn-style-btn").forEach((b) => b.classList.toggle("sn-style-active", b.dataset.styleId === current));
    }

    const styleSection = el("div", "sn-style-section");
    styleSection.appendChild(el("div", "sn-style-section-label", { textContent: "Style:" }));
    const styleOptions = el("div", "sn-style-options");
    NOTE_STYLES.forEach((s) => {
      const btn = el("button", "sn-style-btn", { title: s.label });
      btn.dataset.styleId = s.id;
      btn.appendChild(el("span", `sn-style-preview sn-style-preview-${s.id}`));
      btn.appendChild(el("span", "", { textContent: s.label }));
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        stickyNoteEl.classList.remove("sn-style-zigzag", "sn-style-plain");
        if (s.id !== "tape") stickyNoteEl.classList.add(`sn-style-${s.id}`);
        updateStyleOptionsActive();
        StudyNotesStorage.setNoteStyle(s.id);
      });
      styleOptions.appendChild(btn);
    });
    styleSection.appendChild(styleOptions);
    stickyNoteEl.insertBefore(styleSection, stickyTextarea);
    updateStyleOptionsActive();

    const stickyHeadEl = stickyNoteEl.querySelector(".sn-hlnote-head, .dv-sticky-head");
    if (stickyHeadEl) {
      stickyHeadEl.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) return;
        const rect = stickyNoteEl.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const onMove = (moveEvent) => {
          const left = Math.min(Math.max(8, moveEvent.clientX - dx), window.innerWidth - 60);
          const top = Math.min(Math.max(8, moveEvent.clientY - dy), window.innerHeight - 40);
          stickyNoteEl.style.left = `${left}px`;
          stickyNoteEl.style.top = `${top}px`;
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("mouseup", onUp, true);
        };
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("mouseup", onUp, true);
        e.preventDefault();
      });
    }

    function positionStickyNote(highlightId) {
      const markEl = container.querySelector(`mark[data-highlight-id="${highlightId}"]`);
      const rect = markEl ? markEl.getBoundingClientRect() : selectionToolbarEl.getBoundingClientRect();
      let left = rect.right + 16;
      if (left + 280 > window.innerWidth) left = Math.max(8, rect.left - 280 - 16);
      let top = rect.top;
      if (top + 220 > window.innerHeight) top = Math.max(8, window.innerHeight - 228);
      stickyNoteEl.style.left = `${left}px`;
      stickyNoteEl.style.top = `${top}px`;
    }

    function openStickyNote(highlightId, { focus } = {}) {
      const h = getRecord().highlights.find((x) => x.id === highlightId);
      if (!h) return;
      stickyOpenId = highlightId;
      stickyQuoteEl.textContent = h.text;
      stickyTextarea.value = h.note || "";
      stickyNoteEl.style.display = "block";
      applyStickyBackground(h);
      positionStickyNote(highlightId);
      stickyNoteEl.classList.remove("sn-sticky-pop");
      void stickyNoteEl.offsetWidth;
      stickyNoteEl.classList.add("sn-sticky-pop");
      updateActiveHighlightClasses();
      updateColorRowActive(h);
      updateStyleOptionsActive();
      if (focus) stickyTextarea.focus();
    }

    function closeStickyNote() {
      stickyNoteEl.style.display = "none";
      stickyOpenId = null;
      updateActiveHighlightClasses();
    }

    function renderHighlightList() {
      if (!highlightListEl) return;
      highlightListEl.innerHTML = "";
      const sorted = [...getRecord().highlights].sort((a, b) => a.startOffset - b.startOffset);
      if (highlightEmptyHintEl) highlightEmptyHintEl.style.display = sorted.length ? "none" : "block";
      sorted.forEach((h) => {
        const item = el("div", "dv-highlight-item");
        item.dataset.highlightId = h.id;
        item.appendChild(el("div", "dv-highlight-item-text", { textContent: h.text }));
        if (h.note && h.note.trim()) {
          item.appendChild(el("div", "dv-highlight-item-note", { textContent: h.note }));
        }
        item.addEventListener("click", () => {
          const markEl = container.querySelector(`mark[data-highlight-id="${h.id}"]`);
          if (markEl) markEl.scrollIntoView({ block: "center", behavior: "smooth" });
          openStickyNote(h.id);
        });
        highlightListEl.appendChild(item);
      });
    }

    function removeHighlight(id) {
      const record = getRecord();
      record.highlights = record.highlights.filter((h) => h.id !== id);
      container.querySelectorAll(`mark[data-highlight-id="${id}"]`).forEach((mark) => {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });
      persist();
      renderHighlightList();
      closeStickyNote();
    }

    function hideSelectionToolbar() {
      selectionToolbarEl.style.display = "none";
    }

    function createHighlightFromSelection(forcedColorId) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;
      const { start, end } = getTextOffsets(container, range);
      const text = range.toString();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const record = getRecord();
      const color = forcedColorId || HIGHLIGHT_COLORS[record.highlights.length % HIGHLIGHT_COLORS.length].id;
      const h = { id, startOffset: start, endOffset: end, text, note: "", color, createdAt: Date.now() };
      record.highlights.push(h);
      wrapRangeWithMarks(range, id);
      applyMarkColor(h);
      sel.removeAllRanges();
      hideSelectionToolbar();
      persist();
      renderHighlightList();
      openStickyNote(id, { focus: true });
    }

    container.addEventListener("click", (e) => {
      const mark = e.target.closest("mark.sn-highlight-mark");
      if (mark) openStickyNote(mark.dataset.highlightId);
    });

    document.addEventListener("mouseup", (e) => {
      if (stickyNoteEl.contains(e.target)) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          hideSelectionToolbar();
          return;
        }
        const range = sel.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) {
          hideSelectionToolbar();
          return;
        }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          hideSelectionToolbar();
          return;
        }
        selectionToolbarEl.style.left = `${Math.max(8, rect.left)}px`;
        selectionToolbarEl.style.top = `${Math.max(8, rect.top - 40)}px`;
        selectionToolbarEl.style.display = "block";
      }, 10);
    });

    document.addEventListener("mousedown", (e) => {
      if (!selectionToolbarEl.contains(e.target)) hideSelectionToolbar();
    });

    // Shield the sticky note from any global keyboard/mouse handlers the host page
    // may have registered (some sites intercept keys for their own shortcuts) —
    // stopping propagation here still lets the browser's normal typing/selection
    // behavior happen, it only keeps the event from bubbling past this element.
    ["keydown", "keypress", "keyup", "mousedown", "mouseup", "click"].forEach((type) => {
      stickyNoteEl.addEventListener(type, (e) => e.stopPropagation());
    });

    highlightBtn.addEventListener("click", () => createHighlightFromSelection());

    const toolbarColorRow = el("div", "sn-select-color-row");
    HIGHLIGHT_COLORS.forEach((c) => {
      const dot = el("button", "sn-select-color-dot", { title: `Highlight in ${c.id}` });
      dot.style.setProperty("--swatch-color", c.hex);
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        createHighlightFromSelection(c.id);
      });
      toolbarColorRow.appendChild(dot);
    });
    selectionToolbarEl.appendChild(toolbarColorRow);
    stickyCloseBtn.addEventListener("click", closeStickyNote);
    stickyRemoveBtn.addEventListener("click", () => stickyOpenId && removeHighlight(stickyOpenId));
    stickyTextarea.addEventListener("input", () => {
      if (!stickyOpenId) return;
      const h = getRecord().highlights.find((x) => x.id === stickyOpenId);
      if (!h) return;
      h.note = stickyTextarea.value;
      clearTimeout(noteDebounce);
      noteDebounce = setTimeout(() => {
        persist();
        renderHighlightList();
      }, 500);
    });

    return { reapplyHighlights, renderHighlightList, openStickyNote, closeStickyNote };
  }

  return { create, getTextOffsets, getRangeFromOffsets, wrapRangeWithMarks };
})();
