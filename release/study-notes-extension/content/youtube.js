(function () {
  function getVideoId() {
    return new URLSearchParams(location.search).get("v");
  }

  window.SNAdapter = {
    site: "youtube",

    isSupported() {
      return location.pathname === "/watch" && !!getVideoId();
    },

    getVideoId,

    getVideoElement() {
      return document.querySelector("video.html5-main-video") || document.querySelector("#movie_player video");
    },

    getTitle() {
      const el =
        document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
        document.querySelector("#title h1") ||
        document.querySelector("#container h1.title");
      const text = el && el.textContent && el.textContent.trim();
      return text || document.title.replace(/ - YouTube$/, "");
    },

    getUrl() {
      return `https://www.youtube.com/watch?v=${getVideoId()}`;
    },

    getPlayerContainer() {
      return document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
    },

    getProgressBarContainer() {
      return document.querySelector(".ytp-progress-bar-container");
    },

    supportsMarkers: true,

    onNavigate(callback) {
      document.addEventListener("yt-navigate-finish", callback);
      let lastVideoId = getVideoId();
      setInterval(() => {
        const id = getVideoId();
        if (id && id !== lastVideoId) {
          lastVideoId = id;
          callback();
        }
      }, 1000);
    },
  };
})();
