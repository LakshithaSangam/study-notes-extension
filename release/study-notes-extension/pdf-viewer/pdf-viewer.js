import * as pdfjsLib from "../lib/pdf.mjs";

(function () {
  const emptyStateEl = document.getElementById("emptyState");
  const docViewEl = document.getElementById("docView");
  const docContentEl = document.getElementById("docContent");
  const loadingHintEl = document.getElementById("loadingHint");
  const pdfFilenameEl = document.getElementById("pdfFilename");
  const importBtn = document.getElementById("importBtn");
  const exportBtn = document.getElementById("exportBtn");
  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const chooseFileBtn = document.getElementById("chooseFileBtn");
  const recentListEl = document.getElementById("recentList");
  const recentEmptyHintEl = document.getElementById("recentEmptyHint");
  const highlightListEl = document.getElementById("highlightList");
  const highlightEmptyHintEl = document.getElementById("highlightEmptyHint");
  const selectionToolbarEl = document.getElementById("selectionToolbar");
  const highlightBtn = document.getElementById("highlightBtn");
  const stickyNoteEl = document.getElementById("stickyNote");
  const stickyQuoteEl = document.getElementById("stickyQuote");
  const stickyTextarea = document.getElementById("stickyTextarea");
  const stickyCloseBtn = document.getElementById("stickyCloseBtn");
  const stickyRemoveBtn = document.getElementById("stickyRemoveBtn");

  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.mjs");

  let currentRecord = null;
  let currentKey = null;

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => (node[k] = v));
    return node;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function hashArrayBuffer(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hex.slice(0, 16);
  }

  async function persistDoc() {
    currentRecord.authorName = await StudyNotesStorage.getUserName();
    await StudyNotesStorage.setRecord(currentKey, currentRecord);
  }

  const highlighter = Highlighter.create({
    container: docContentEl,
    selectionToolbarEl,
    highlightBtn,
    stickyNoteEl,
    stickyQuoteEl,
    stickyTextarea,
    stickyCloseBtn,
    stickyRemoveBtn,
    highlightListEl,
    highlightEmptyHintEl,
    getRecord: () => currentRecord,
    onChange: persistDoc,
  });

  StudyNotesStorage.getNoteStyle().then((style) => {
    if (style === "zigzag") stickyNoteEl.classList.add("sn-style-zigzag");
    else if (style === "plain") stickyNoteEl.classList.add("sn-style-plain");
  });

  function showDocView() {
    emptyStateEl.hidden = true;
    docViewEl.hidden = false;
    exportBtn.hidden = false;
  }

  function showEmptyState() {
    emptyStateEl.hidden = false;
    docViewEl.hidden = true;
    exportBtn.hidden = true;
    pdfFilenameEl.textContent = "";
    renderRecentList();
  }

  async function renderRecentList() {
    const all = await StudyNotesStorage.getAllRecords();
    const pdfs = all.filter((r) => r.site === "pdf");
    recentListEl.innerHTML = "";
    recentEmptyHintEl.style.display = pdfs.length ? "none" : "block";
    pdfs.forEach((r) => {
      const item = el("div", "dv-recent-item");
      item.appendChild(el("div", "dv-recent-item-title", { textContent: r.title || r.filename }));
      item.appendChild(
        el("div", "dv-recent-item-meta", {
          textContent: `${r.highlights.length} highlight${r.highlights.length === 1 ? "" : "s"}`,
        })
      );
      item.addEventListener("click", () => openPdfById(r.pdfId));
      recentListEl.appendChild(item);
    });
  }

  async function renderPage(pdf, pageNum, targetWidth) {
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;

    const pageWrap = el("div", "dv-pdf-page");
    pageWrap.style.width = `${Math.floor(viewport.width)}px`;
    pageWrap.style.height = `${Math.floor(viewport.height)}px`;

    const canvas = el("canvas");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext("2d");
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

    pageWrap.appendChild(canvas);
    docContentEl.appendChild(pageWrap);

    await page.render({ canvasContext: ctx, viewport, transform }).promise;

    const textLayerDiv = el("div", "textLayer");
    textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
    textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
    pageWrap.appendChild(textLayerDiv);

    const textContentSource = page.streamTextContent();
    const textLayer = new pdfjsLib.TextLayer({ textContentSource, container: textLayerDiv, viewport });
    await textLayer.render();
  }

  async function loadAndDisplay(buffer) {
    docContentEl.innerHTML = "";
    loadingHintEl.hidden = false;
    pdfFilenameEl.textContent = currentRecord.filename;
    showDocView();

    const targetWidth = Math.min(760, docContentEl.parentElement.clientWidth || 760);
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      await renderPage(pdf, pageNum, targetWidth);
    }

    loadingHintEl.hidden = true;
    highlighter.reapplyHighlights();
    highlighter.renderHighlightList();
    history.replaceState(null, "", `?pdfId=${currentRecord.pdfId}`);
  }

  async function importFile(file) {
    if (!file || !/\.pdf$/i.test(file.name)) {
      window.alert("Please choose a .pdf file.");
      return;
    }
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (e) {
      window.alert("Could not read that file.");
      return;
    }
    const pdfId = await hashArrayBuffer(buffer);
    const key = StudyNotesStorage.keyFor("pdf", pdfId);
    let record = await StudyNotesStorage.getRecord(key);
    if (!record) {
      record = StudyNotesStorage.emptyPdfRecord({ pdfId, filename: file.name });
      await StudyNotesStorage.setFileBlob(pdfId, arrayBufferToBase64(buffer));
    }
    currentRecord = record;
    currentKey = key;
    await persistDoc();
    try {
      await loadAndDisplay(buffer);
    } catch (e) {
      window.alert("Could not render that PDF: " + e.message);
    }
  }

  async function openPdfById(pdfId) {
    const key = StudyNotesStorage.keyFor("pdf", pdfId);
    const record = await StudyNotesStorage.getRecord(key);
    if (!record) return;
    const base64 = await StudyNotesStorage.getFileBlob(pdfId);
    if (!base64) {
      window.alert("The original file content for this PDF is missing — try re-importing it.");
      return;
    }
    currentRecord = record;
    currentKey = key;
    await loadAndDisplay(base64ToArrayBuffer(base64));
  }

  importBtn.addEventListener("click", () => fileInput.click());
  chooseFileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) importFile(fileInput.files[0]);
    fileInput.value = "";
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dv-dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dv-dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dv-dragover");
    const file = e.dataTransfer.files[0];
    if (file) importFile(file);
  });

  exportBtn.addEventListener("click", () => {
    if (!currentRecord) return;
    chrome.runtime.sendMessage({
      type: "sn-export",
      filename: StudyNotesExporter.filenameFor(currentRecord, "md"),
      content: StudyNotesExporter.buildMarkdownForDoc(currentRecord),
      mime: "text/markdown",
    });
  });

  (async function init() {
    const params = new URLSearchParams(location.search);
    const pdfId = params.get("pdfId");
    if (pdfId) {
      await openPdfById(pdfId);
    } else {
      showEmptyState();
    }
  })();
})();
