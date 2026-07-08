const StudyNotesExporter = (() => {
  function formatTimestamp(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  function parseTimestamp(text) {
    const parts = String(text || "").trim().split(":").map((p) => parseInt(p, 10));
    if (parts.some((p) => isNaN(p))) return null;
    let seconds = 0;
    for (const p of parts) seconds = seconds * 60 + p;
    return seconds;
  }

  function slugify(text) {
    return (text || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "untitled";
  }

  function bookmarkTimeLabel(bm) {
    return bm.endTimestampSeconds && bm.endTimestampSeconds > bm.timestampSeconds
      ? `${formatTimestamp(bm.timestampSeconds)}–${formatTimestamp(bm.endTimestampSeconds)}`
      : formatTimestamp(bm.timestampSeconds);
  }

  function highlightLines(record) {
    const lines = [];
    if (record.highlights && record.highlights.length) {
      lines.push("## Highlights", "");
      const sorted = [...record.highlights].sort((a, b) => a.startOffset - b.startOffset);
      for (const h of sorted) {
        lines.push(`> ${h.text.trim()}`);
        if (h.note && h.note.trim()) {
          lines.push("", h.note.trim());
        }
        lines.push("");
      }
    }
    return lines;
  }

  function creditLine() {
    return "\n---\n_an idea by Lucky (LS)_";
  }

  function buildMarkdownBody(record) {
    const lines = [`# ${record.title || "Untitled"}`, "", `Source: ${record.url}`];
    if (record.authorName) lines.push(`By: ${record.authorName}`);
    lines.push("");
    if (record.notes && record.notes.trim()) {
      lines.push("## Notes", "", record.notes.trim(), "");
    }
    if (record.bookmarks && record.bookmarks.length) {
      lines.push("## Bookmarks", "");
      const sorted = [...record.bookmarks].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
      for (const bm of sorted) {
        const label = bm.label ? ` — ${bm.label}` : "";
        lines.push(`- **${bookmarkTimeLabel(bm)}**${label}`);
        if (bm.note && bm.note.trim()) {
          lines.push(`  ${bm.note.trim()}`);
        }
      }
      lines.push("");
    }
    lines.push(...highlightLines(record));
    return lines.join("\n");
  }

  function buildMarkdownForDocBody(record) {
    const lines = [`# ${record.title || "Untitled"}`, ""];
    if (record.authorName) lines.push(`By: ${record.authorName}`, "");
    lines.push(...highlightLines(record));
    return lines.join("\n");
  }

  function buildMarkdown(record) {
    return buildMarkdownBody(record) + creditLine();
  }

  function buildMarkdownForDoc(record) {
    return buildMarkdownForDocBody(record) + creditLine();
  }

  function buildMarkdownForAll(records) {
    const body = records
      .map((r) => (r.site === "doc" || r.site === "pdf" ? buildMarkdownForDocBody(r) : buildMarkdownBody(r)))
      .join("\n---\n\n");
    return body + creditLine();
  }

  function buildJSON(records) {
    return JSON.stringify(records, null, 2);
  }

  function filenameFor(record, ext) {
    return `study-notes-${slugify(record.title)}.${ext}`;
  }

  return {
    formatTimestamp,
    parseTimestamp,
    bookmarkTimeLabel,
    slugify,
    buildMarkdown,
    buildMarkdownForDoc,
    buildMarkdownForAll,
    buildJSON,
    filenameFor,
  };
})();
