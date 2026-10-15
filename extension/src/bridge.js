// Runs on the CouchVerse website. The site cannot talk to the extension
// directly, so it posts window messages; we answer and stash the active
// room (token + server + room id) in chrome.storage for the OTT tabs.
(() => {
  const version = chrome.runtime.getManifest().version;
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'CV_PING') {
      window.postMessage({ type: 'CV_PONG', version }, window.location.origin);
    } else if (d.type === 'CV_SET_ROOM' && d.token && d.roomId && d.serverUrl) {
      chrome.storage.local.set(
        {
          cvRoom: {
            token: d.token,
            serverUrl: d.serverUrl,
            roomId: d.roomId,
            roomCode: d.roomCode,
            roomName: d.roomName,
            platform: d.platform,
            setAt: Date.now(),
          },
        },
        () => window.postMessage({ type: 'CV_ROOM_ACK' }, window.location.origin),
      );
    } else if (d.type === 'CV_CLEAR_ROOM') {
      chrome.storage.local.remove('cvRoom');
    }
  });
  // Let the page know we're here even before it asks.
  window.postMessage({ type: 'CV_PONG', version }, window.location.origin);
})();
