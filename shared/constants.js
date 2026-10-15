export const OTT_PLATFORMS = [
  { id: 'netflix', name: 'Netflix', color: '#E50914', host: 'www.netflix.com', url: 'https://www.netflix.com' },
  { id: 'prime', name: 'Prime Video', color: '#00A8E1', host: 'www.primevideo.com', url: 'https://www.primevideo.com' },
  { id: 'jiohotstar', name: 'JioHotstar', color: '#1F80E0', host: 'www.hotstar.com', url: 'https://www.hotstar.com' },
  { id: 'zee5', name: 'ZEE5', color: '#8230C6', host: 'www.zee5.com', url: 'https://www.zee5.com' },
  { id: 'sonyliv', name: 'SonyLIV', color: '#F4A300', host: 'www.sonyliv.com', url: 'https://www.sonyliv.com' },
  { id: 'appletv', name: 'Apple TV+', color: '#A2AAAD', host: 'tv.apple.com', url: 'https://tv.apple.com' },
  { id: 'youtube', name: 'YouTube', color: '#FF0000', host: 'www.youtube.com', url: 'https://www.youtube.com' },
  { id: 'mxplayer', name: 'MX Player', color: '#2D7FF9', host: 'www.mxplayer.in', url: 'https://www.mxplayer.in' },
  { id: 'lionsgate', name: 'Lionsgate Play', color: '#E8731A', host: 'www.lionsgateplay.com', url: 'https://www.lionsgateplay.com' },
];

export const platformByName = (name) => OTT_PLATFORMS.find((p) => p.name === name) || null;
export const platformById = (id) => OTT_PLATFORMS.find((p) => p.id === id) || null;

export const QUICK_EMOJIS = ['😂', '🔥', '😱', '❤️', '👏'];

export const EMOJI_GRID = [
  '😂', '🤣', '😅', '😭', '😍', '🥰', '😘', '🤩', '😎', '🤔', '🙄', '😏',
  '😱', '😨', '🤯', '😡', '🤬', '😴', '🥱', '🤮', '🤢', '😬', '🫣', '🫢',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '🔥', '✨', '💯', '🎉',
  '👏', '🙌', '👍', '👎', '👀', '🫡', '🙏', '💪', '🤝', '👋', '🤙', '✌️',
  '🍿', '🎬', '📺', '🎥', '🍕', '🍺', '☕', '🧸', '🚀', '💀', '👻', '🤡',
];

export const CHAT_POPUP_MODES = ['everyone', 'friends', 'mentions', 'none'];

// Public-domain / CC sample media. The first entry is served by the
// CouchVerse server itself once `npm run fetch-samples` has run, so a demo
// works even with no outbound internet in the browser.
export const SAMPLE_MEDIA = [
  {
    title: 'Sintel trailer (local)',
    url: '/media/sintel_trailer-480p.mp4',
    kind: 'url',
    duration: 52,
    local: true,
  },
  {
    title: 'Big Buck Bunny',
    url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
    kind: 'url',
    duration: 596,
  },
  {
    title: 'Elephants Dream',
    url: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
    kind: 'url',
    duration: 654,
  },
  {
    title: 'Sintel trailer',
    url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
    kind: 'url',
    duration: 52,
  },
  {
    title: 'HLS test stream (Mux)',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    kind: 'url',
    duration: 634,
  },
];
