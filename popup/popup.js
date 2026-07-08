(async function () {
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("emptyState");
  const searchEl = document.getElementById("searchInput");
  const exportAllBtn = document.getElementById("exportAllBtn");
  const openViewerBtn = document.getElementById("openViewerBtn");
  const openPdfViewerBtn = document.getElementById("openPdfViewerBtn");
  const nameDisplay = document.getElementById("nameDisplay");
  const nameInput = document.getElementById("nameInput");
  const nameSaveBtn = document.getElementById("nameSaveBtn");
  const nameEditBtn = document.getElementById("nameEditBtn");
  const styleButtons = document.querySelectorAll(".p-style-btn");

  let allRecords = [];

  function showNameDisplay(name) {
    nameDisplay.textContent = `Signed as ${name}`;
    nameDisplay.hidden = false;
    nameInput.hidden = true;
    nameSaveBtn.hidden = true;
    nameEditBtn.hidden = false;
  }

  function showNameInput() {
    nameDisplay.hidden = true;
    nameInput.hidden = false;
    nameSaveBtn.hidden = false;
    nameEditBtn.hidden = true;
    nameInput.focus();
  }

  async function setupNameField() {
    const name = await StudyNotesStorage.getUserName();
    if (name) showNameDisplay(name);
    else showNameInput();

    nameSaveBtn.addEventListener("click", async () => {
      const value = nameInput.value.trim();
      if (!value) return;
      await StudyNotesStorage.setUserName(value);
      showNameDisplay(value);
    });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") nameSaveBtn.click();
    });
    nameEditBtn.addEventListener("click", () => {
      nameInput.value = nameDisplay.textContent.replace(/^Signed as /, "");
      showNameInput();
    });
  }

  async function setupStyleField() {
    const current = await StudyNotesStorage.getNoteStyle();
    styleButtons.forEach((btn) => {
      btn.classList.toggle("p-style-active", btn.dataset.style === current);
      btn.addEventListener("click", async () => {
        await StudyNotesStorage.setNoteStyle(btn.dataset.style);
        styleButtons.forEach((b) => b.classList.toggle("p-style-active", b === btn));
      });
    });
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function render(filterText) {
    const filtered = filterText
      ? allRecords.filter((r) => r.title.toLowerCase().includes(filterText.toLowerCase()))
      : allRecords;

    listEl.innerHTML = "";
    emptyEl.hidden = allRecords.length > 0;
    if (allRecords.length === 0) return;

    filtered.forEach((record) => {
      const item = document.createElement("div");
      item.className = "p-item";

      const title = document.createElement("div");
      title.className = "p-item-title";
      title.textContent = record.title;

      const isDoc = record.site === "doc";
      const isPdf = record.site === "pdf";
      const isFile = isDoc || isPdf;
      const fileId = isDoc ? record.docId : record.pdfId;
      const viewerPage = isDoc ? "viewer/viewer.html?docId=" : "pdf-viewer/pdf-viewer.html?pdfId=";

      const meta = document.createElement("div");
      meta.className = "p-item-meta";
      const siteLabel = isDoc
        ? "📄 Word doc"
        : isPdf
        ? "📕 PDF"
        : record.site === "youtube"
        ? "▶️ YouTube"
        : "🌐 " + new URL(record.url).hostname;
      const countLabel = isFile
        ? `${record.highlights.length} highlight${record.highlights.length === 1 ? "" : "s"}`
        : `${record.bookmarks.length} bookmark${record.bookmarks.length === 1 ? "" : "s"}`;
      const metaParts = [siteLabel, countLabel, formatDate(record.updatedAt)];
      if (record.authorName) metaParts.push(record.authorName);
      metaParts.forEach((text, i) => {
        if (i > 0) meta.appendChild(document.createElement("span")).textContent = "·";
        meta.appendChild(document.createElement("span")).textContent = text;
      });

      const actions = document.createElement("div");
      actions.className = "p-item-actions";

      const openBtn = document.createElement("button");
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () =>
        chrome.tabs.create({
          url: isFile ? chrome.runtime.getURL(`${viewerPage}${fileId}`) : record.url,
        })
      );

      const exportBtn = document.createElement("button");
      exportBtn.textContent = "Export";
      exportBtn.addEventListener("click", () =>
        downloadText(
          StudyNotesExporter.filenameFor(record, "md"),
          isFile ? StudyNotesExporter.buildMarkdownForDoc(record) : StudyNotesExporter.buildMarkdown(record),
          "text/markdown"
        )
      );

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "p-delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        await StudyNotesStorage.deleteRecord(record.key);
        if (isFile) await StudyNotesStorage.deleteFileBlob(fileId);
        allRecords = allRecords.filter((r) => r.key !== record.key);
        render(searchEl.value);
      });

      actions.appendChild(openBtn);
      actions.appendChild(exportBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  }

  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }

  searchEl.addEventListener("input", () => render(searchEl.value));

  openViewerBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("viewer/viewer.html") });
  });

  openPdfViewerBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pdf-viewer/pdf-viewer.html") });
  });

  exportAllBtn.addEventListener("click", () => {
    if (allRecords.length === 0) return;
    downloadText("study-notes-all.md", StudyNotesExporter.buildMarkdownForAll(allRecords), "text/markdown");
  });

  allRecords = await StudyNotesStorage.getAllRecords();
  render("");
  setupNameField();
  setupStyleField();
})();
