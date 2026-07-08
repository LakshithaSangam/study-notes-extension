chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;

  if (msg.type === "sn-badge" && sender.tab && sender.tab.id != null) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.count > 0 ? String(msg.count) : "" });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#ffd93d" });
    return;
  }

  if (msg.type === "sn-export") {
    const dataUrl = `data:${msg.mime};charset=utf-8,${encodeURIComponent(msg.content)}`;
    chrome.downloads.download({ url: dataUrl, filename: msg.filename, saveAs: false }, () => {
      if (chrome.runtime.lastError) {
        console.error("Study Notes export failed:", chrome.runtime.lastError.message);
      }
    });
  }
});
