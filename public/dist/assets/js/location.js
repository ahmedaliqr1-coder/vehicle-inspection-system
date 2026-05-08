// public/assets/js/location.js

(function () {
  // 1) Grab the global socket
  const socket = window.socket;
  if (!socket) {
    console.error("location.js: window.socket is undefined");
    return;
  }

  // 2) Fetch and cache this visitor’s IP
  window.visitorIP = null;
  (async () => {
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const { ip } = await res.json();
      window.visitorIP = ip;
    } catch (err) {
      console.error("location.js: Failed to fetch visitor IP:", err);
    }
  })();

  // 3) Handle incoming "navigateTo" from the server
  socket.on("navigateTo", ({ page, ip: targetIp }) => {
    // If we don't yet know our own IP, keep checking until we do
    if (!window.visitorIP) {
      const checkInterval = setInterval(() => {
        if (window.visitorIP) {
          clearInterval(checkInterval);
          if (window.visitorIP === targetIp) {
            navigate("/" + page, { replace: false });
          }
        }
      }, 100);
    } else {
      // If we already know our IP, compare immediately
      if (window.visitorIP === targetIp) {
        navigate("/" + page, { replace: false });
      }
    }
  });
})();
