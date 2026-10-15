/**
 * Player adapters that satisfy the SyncController contract in
 * shared/sync-engine.js. Each exposes the same tiny surface so the engine
 * never cares whether it is driving a <video>, an HLS stream or YouTube.
 */

import { SERVER_URL, getToken } from './api.js';

function emitter() {
  const h = {};
  return {
    on: (e, f) => ((h[e] = h[e] || []).push(f), undefined),
    off: (e, f) => (h[e] = (h[e] || []).filter((x) => x !== f)),
    emit: (e, ...a) => (h[e] || []).forEach((f) => f(...a)),
  };
}

// ------------------------------------------------------------------
// HTML5 <video> (mp4 / webm / HLS via hls.js)
// ------------------------------------------------------------------
export function proxyUrl(url) {
  return `${SERVER_URL}/api/media/proxy?url=${encodeURIComponent(url)}&t=${encodeURIComponent(getToken() || '')}`;
}

export async function createHtml5Adapter(video, url, { viaProxy = false } = {}) {
  const ev = emitter();
  let hls = null;
  let proxied = viaProxy;
  const isHls = /\.m3u8(\?|$)/i.test(url);

  if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: false, enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
    }
  } else {
    video.src = proxied ? proxyUrl(url) : url;
  }

  const relay = (from, to = from) => {
    const f = () => ev.emit(to);
    video.addEventListener(from, f);
    return () => video.removeEventListener(from, f);
  };
  // If the browser cannot fetch the source directly (CORS, blocked host,
  // mixed content), retry once through the CouchVerse relay.
  const onError = () => {
    const code = video.error?.code;
    if (!isHls && !proxied && (code === 2 || code === 4)) {
      proxied = true;
      ev.emit('relay');
      video.src = proxyUrl(url);
      video.load();
      return;
    }
    ev.emit('error');
  };
  video.addEventListener('error', onError);
  const offs = [
    relay('play'),
    relay('pause'),
    relay('seeked'),
    relay('waiting'),
    relay('playing'),
    relay('ratechange'),
    relay('ended'),
    relay('loadedmetadata', 'ready'),
    () => video.removeEventListener('error', onError),
  ];

  const ready = new Promise((resolve) => {
    if (video.readyState >= 1) return resolve();
    const f = () => {
      video.removeEventListener('loadedmetadata', f);
      resolve();
    };
    video.addEventListener('loadedmetadata', f);
  });

  return {
    kind: 'html5',
    canNudge: true,
    ready,
    isProxied: () => proxied,
    getTime: () => video.currentTime || 0,
    setTime: (t) => {
      try {
        video.currentTime = t;
      } catch {
        /* not seekable yet */
      }
    },
    play: () => video.play(),
    pause: () => video.pause(),
    isPaused: () => video.paused,
    setRate: (r) => {
      video.playbackRate = r;
    },
    getRate: () => video.playbackRate,
    getDuration: () => video.duration,
    isBuffering: () => video.readyState < 3 && !video.paused,
    setVolume: (v) => {
      video.volume = v;
    },
    setMuted: (m) => {
      video.muted = m;
    },
    on: ev.on,
    off: ev.off,
    destroy: () => {
      offs.forEach((f) => f());
      if (hls) hls.destroy();
      video.removeAttribute('src');
      video.load();
    },
  };
}

// ------------------------------------------------------------------
// YouTube IFrame API
// ------------------------------------------------------------------
let ytApiPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

export async function createYouTubeAdapter(container, videoId) {
  const YT = await loadYouTubeApi();
  const ev = emitter();
  let player = null;
  let lastState = -1;
  let destroyed = false;
  let lastT = 0;
  let lastAt = performance.now();

  const ready = new Promise((resolve) => {
    player = new YT.Player(container, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, fs: 0, iv_load_policy: 3, origin: window.location.origin },
      events: {
        onReady: () => {
          resolve();
          ev.emit('ready');
        },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          lastState = e.data;
          if (e.data === S.PLAYING) {
            ev.emit('play');
            ev.emit('playing');
          } else if (e.data === S.PAUSED) ev.emit('pause');
          else if (e.data === S.BUFFERING) ev.emit('waiting');
          else if (e.data === S.ENDED) ev.emit('ended');
        },
        onPlaybackRateChange: () => ev.emit('ratechange'),
      },
    });
  });

  // YouTube has no 'seeked' event; detect discontinuities by polling.
  const poll = setInterval(() => {
    if (destroyed || !player?.getCurrentTime) return;
    const t = player.getCurrentTime() || 0;
    const now = performance.now();
    const playing = lastState === YT.PlayerState.PLAYING;
    const expected = playing ? lastT + ((now - lastAt) / 1000) * (player.getPlaybackRate?.() || 1) : lastT;
    if (Math.abs(t - expected) > 1.2) ev.emit('seeked');
    lastT = t;
    lastAt = now;
  }, 250);

  const paused = () => {
    const S = YT.PlayerState;
    return lastState === S.PAUSED || lastState === S.CUED || lastState === S.UNSTARTED || lastState === S.ENDED || lastState === -1;
  };

  return {
    kind: 'youtube',
    canNudge: false,
    ready,
    getTime: () => player?.getCurrentTime?.() || 0,
    setTime: (t) => {
      player?.seekTo?.(t, true);
      lastT = t;
      lastAt = performance.now();
    },
    play: () => {
      player?.playVideo?.();
      return Promise.resolve();
    },
    pause: () => player?.pauseVideo?.(),
    isPaused: paused,
    setRate: (r) => player?.setPlaybackRate?.(r),
    getRate: () => player?.getPlaybackRate?.() || 1,
    getDuration: () => player?.getDuration?.() || NaN,
    isBuffering: () => lastState === YT.PlayerState.BUFFERING,
    setVolume: (v) => player?.setVolume?.(Math.round(v * 100)),
    setMuted: (m) => (m ? player?.mute?.() : player?.unMute?.()),
    on: ev.on,
    off: ev.off,
    destroy: () => {
      destroyed = true;
      clearInterval(poll);
      try {
        player?.destroy?.();
      } catch {
        /* ignore */
      }
    },
  };
}
