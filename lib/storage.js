const StudyNotesStorage = (() => {
  const INDEX_KEY = "noteIndex";
  const USER_NAME_KEY = "snUserName";
  const PIN_POSITION_KEY = "snPinPosition";
  const NOTE_STYLE_KEY = "snNoteStyle";

  function keyFor(site, videoId) {
    return `note:${site}:${videoId}`;
  }

  async function getIndex() {
    const data = await chrome.storage.local.get(INDEX_KEY);
    return data[INDEX_KEY] || [];
  }

  async function getRecord(key) {
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
  }

  async function setRecord(key, record) {
    record.updatedAt = Date.now();
    await chrome.storage.local.set({ [key]: record });
    const index = await getIndex();
    if (!index.includes(key)) {
      index.push(key);
      await chrome.storage.local.set({ [INDEX_KEY]: index });
    }
  }

  async function deleteRecord(key) {
    await chrome.storage.local.remove(key);
    const index = await getIndex();
    const next = index.filter((k) => k !== key);
    await chrome.storage.local.set({ [INDEX_KEY]: next });
  }

  async function getAllRecords() {
    const index = await getIndex();
    if (index.length === 0) return [];
    const data = await chrome.storage.local.get(index);
    return index
      .map((key) => (data[key] ? { key, ...data[key] } : null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function emptyRecord({ site, videoId, url, title }) {
    return {
      site,
      videoId,
      url,
      title,
      notes: "",
      noteColor: "parchment",
      bookmarks: [],
      highlights: [],
      updatedAt: Date.now(),
    };
  }

  function emptyDocRecord({ docId, filename }) {
    return {
      site: "doc",
      docId,
      filename,
      title: filename,
      highlights: [],
      updatedAt: Date.now(),
    };
  }

  function emptyPdfRecord({ pdfId, filename }) {
    return {
      site: "pdf",
      pdfId,
      filename,
      title: filename,
      highlights: [],
      updatedAt: Date.now(),
    };
  }

  function fileBlobKey(id) {
    return `fileblob:${id}`;
  }

  async function getFileBlob(id) {
    const key = fileBlobKey(id);
    const data = await chrome.storage.local.get(key);
    return data[key] ? data[key].base64 : null;
  }

  async function setFileBlob(id, base64) {
    await chrome.storage.local.set({ [fileBlobKey(id)]: { base64 } });
  }

  async function deleteFileBlob(id) {
    await chrome.storage.local.remove(fileBlobKey(id));
  }

  async function getUserName() {
    const data = await chrome.storage.local.get(USER_NAME_KEY);
    return data[USER_NAME_KEY] || "";
  }

  async function setUserName(name) {
    await chrome.storage.local.set({ [USER_NAME_KEY]: (name || "").trim() });
  }

  async function getPinPosition() {
    const data = await chrome.storage.local.get(PIN_POSITION_KEY);
    return data[PIN_POSITION_KEY] || null;
  }

  async function setPinPosition(position) {
    await chrome.storage.local.set({ [PIN_POSITION_KEY]: position });
  }

  async function clearPinPosition() {
    await chrome.storage.local.remove(PIN_POSITION_KEY);
  }

  async function getNoteStyle() {
    const data = await chrome.storage.local.get(NOTE_STYLE_KEY);
    return data[NOTE_STYLE_KEY] || "tape";
  }

  async function setNoteStyle(style) {
    await chrome.storage.local.set({ [NOTE_STYLE_KEY]: style });
  }

  return {
    keyFor,
    getIndex,
    getRecord,
    setRecord,
    deleteRecord,
    getAllRecords,
    emptyRecord,
    emptyDocRecord,
    emptyPdfRecord,
    getFileBlob,
    setFileBlob,
    deleteFileBlob,
    getUserName,
    setUserName,
    getPinPosition,
    setPinPosition,
    clearPinPosition,
    getNoteStyle,
    setNoteStyle,
  };
})();
