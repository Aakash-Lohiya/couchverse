// Injected into the Netflix page world. Netflix's <video> ignores
// currentTime writes, so seeks go through the player's own API.
(() => {
  const api = () => {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const id = vp.getAllPlayerSessionIds().find((s) => s.startsWith('watch-')) || vp.getAllPlayerSessionIds()[0];
      return vp.getVideoPlayerBySessionId(id);
    } catch {
      return null;
    }
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'CV_NF') return;
    const p = api();
    if (!p) return;
    const { cmd, seconds } = e.data;
    if (cmd === 'seek') p.seek(Math.max(0, seconds * 1000));
    else if (cmd === 'play') p.play();
    else if (cmd === 'pause') p.pause();
  });
})();
