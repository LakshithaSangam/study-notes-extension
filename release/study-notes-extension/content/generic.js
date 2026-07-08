(function () {
  window.SNAdapter = {
    site: "generic",

    isSupported() {
      return true;
    },

    videoOptional: true,

    getVideoId() {
      return location.origin + location.pathname;
    },

    getVideoElement() {
      return document.querySelector("video");
    },

    getTitle() {
      return document.title || location.hostname;
    },

    getUrl() {
      return location.origin + location.pathname;
    },

    getPlayerContainer() {
      const video = document.querySelector("video");
      return video ? video.parentElement : null;
    },

    getProgressBarContainer() {
      return null;
    },

    supportsMarkers: true,

    onNavigate(callback) {
      let lastPath = location.origin + location.pathname;
      setInterval(() => {
        const path = location.origin + location.pathname;
        if (path !== lastPath) {
          lastPath = path;
          callback();
        }
      }, 1500);
    },
  };
})();
