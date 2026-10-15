/**
 * CouchVerse companion: runs on OTT sites, finds the <video>, keeps it in
 * sync with the room and draws the CouchVerse overlay (dock with emojis,
 * chat, people, stats) over the player. Bundled by extension/build.js.
 */
import { io } from 'socket.io-client';
import { ServerClock, SyncController } from '../../shared/sync-engine.js';
import { QUICK_EMOJIS, EMOJI_GRID } from '../../shared/constants.js';

const IS_NETFLIX = /netflix\.com$/.test(location.hostname);

let session = null; // active companion session

// ------------------------------------------------------------------
// activation: wait for a room in storage and a video on the page
// ------------------------------------------------------------------
chrome.storage.local.get('cvRoom').then(({ cvRoom }) => cvRoom && activate(cvRoom));
chrome.storage.onChanged.addListener((c) => {
  if (!c.cvRoom) return;
  if (session) session.destroy();
  session = null;
  if (c.cvRoom.newValue) activate(c.cvRoom.newValue);
});

function findVideo() {
  const vids = [...document.querySelectorAll('video')];
  return vids.find((v) => v.readyState > 0 || v.duration > 0 || v.src || v.currentSrc) || vids[0] || null;
}

/**
 * Only drive top-level OTT pages. A YouTube <iframe> embedded in CouchVerse's
 * own native player (or any other site) must not get a second overlay.
 */
function shouldRunHere(cfg) {
  if (window === window.top) return true;
  if (/youtube\.com$/.test(location.hostname)) return false; // embeds
  try {
    const ref = new URL(document.referrer);
    const server = new URL(cfg.serverUrl);
    if (ref.origin === server.origin) return false;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(ref.hostname)) return false;
  } catch {
    /* no referrer: allow (player iframes on OTT sites) */
  }
  return true;
}

function activate(cfg) {
  if (session) return;
  if (!shouldRunHere(cfg)) return;
  if (IS_NETFLIX) {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('page-netflix.js');
    (document.head || document.documentElement).appendChild(s);
  }
  session = new Companion(cfg);
}

// ------------------------------------------------------------------
// video adapter (same contract as the web player adapters)
// ------------------------------------------------------------------
function videoAdapter(video) {
  const h = {};
  const on = (e, f) => (h[e] = h[e] || []).push(f);
  const off = (e, f) => (h[e] = (h[e] || []).filter((x) => x !== f));
  const emit = (e) => (h[e] || []).forEach((f) => f());
  const relays = ['play', 'pause', 'seeked', 'waiting', 'playing', 'ratechange', 'ended'].map((ev) => {
    const f = () => emit(ev);
    video.addEventListener(ev, f);
    return () => video.removeEventListener(ev, f);
  });
  return {
    canNudge: !IS_NETFLIX, // Netflix resets playbackRate; use seeks instead
    getTime: () => video.currentTime || 0,
    setTime: (t) => {
      if (IS_NETFLIX) window.postMessage({ type: 'CV_NF', cmd: 'seek', seconds: t }, '*');
      else video.currentTime = t;
    },
    play: () => (IS_NETFLIX ? (window.postMessage({ type: 'CV_NF', cmd: 'play' }, '*'), Promise.resolve()) : video.play()),
    pause: () => (IS_NETFLIX ? window.postMessage({ type: 'CV_NF', cmd: 'pause' }, '*') : video.pause()),
    isPaused: () => video.paused,
    setRate: (r) => {
      video.playbackRate = r;
    },
    getRate: () => video.playbackRate,
    getDuration: () => video.duration,
    on,
    off,
    destroy: () => relays.forEach((f) => f()),
  };
}

// ------------------------------------------------------------------
// icons (inline SVG strings)
// ------------------------------------------------------------------
const I = {
  chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  people: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>',
  smile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01" stroke-width="2.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 18h18l1.5-10-5.5 4L12 5l-5 7-5.5-4z"/></svg>',
  min: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  logo: '<svg viewBox="0 0 64 64"><defs><linearGradient id="cvg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="16" fill="url(#cvg)" stroke="none"/><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 30v-7a5 5 0 0 1 5-5h18a5 5 0 0 1 5 5v7"/><path d="M12 30a4 4 0 0 1 4 4v3h32v-3a4 4 0 0 1 8 0v8a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z"/><path d="M14 46v4M50 46v4"/></g><path d="M29.5 24.5v9l7.5-4.5z" fill="#fff" stroke="none"/></svg>',
};

// ------------------------------------------------------------------
// the session
// ------------------------------------------------------------------
class Companion {
  constructor(cfg) {
    this.cfg = cfg;
    this.me = null;
    this.hostId = null;
    this.members = [];
    this.friends = new Set();
    this.prefs = { chatPopup: 'everyone', emojiPopup: 'everyone' };
    this.chat = [];
    this.unread = 0;
    this.chatOpen = false;
    this.video = null;
    this.adapter = null;
    this.ctrl = null;
    this.stats = null;
    this.destroyed = false;
    this.minimized = false;
    this.connected = false;

    this.clock = new ServerClock((t0) => new Promise((res, rej) => (this.socket?.connected ? this.socket.emit('time:ping', t0, (t1) => res(t1)) : rej(new Error('offline')))));
    this.socket = io(cfg.serverUrl, { auth: { token: cfg.token }, transports: ['websocket'], reconnectionDelay: 300 });
    this.socket.on('connect', () => {
      this.connected = true;
      this.join();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.renderStatus();
      this.toastMsg('Connection lost, reconnecting…', 'bad');
    });
    this.socket.on('playback:state', (st) => this.ctrl?.applyState(st));
    this.socket.on('room:members', ({ members, hostId }) => {
      this.members = members;
      this.hostId = hostId;
      this.renderPeople();
      this.renderStatus();
    });
    this.socket.on('room:host', ({ hostId }) => {
      this.hostId = hostId;
      this.renderStatus();
      this.renderPeople();
      const name = this.members.find((m) => m.id === hostId)?.displayName || 'Someone';
      this.toastMsg(hostId === this.me?.id ? 'You are the host now' : `${name} is now host`, 'ok');
    });
    this.socket.on('room:system', (m) => {
      this.system(m.text);
      if (m.kind !== 'join' && m.kind !== 'rejoin') this.toastMsg(m.text);
    });
    this.socket.on('chat:message', (m) => this.onChat(m));
    this.socket.on('reaction', (r) => this.onReaction(r));
    this.socket.on('room:closed', ({ reason }) => {
      this.toastMsg(reason === 'ended' ? 'The host ended the room' : 'Room closed', 'bad');
      setTimeout(() => this.destroy(), 1500);
    });
    this.socket.on('room:superseded', () => this.toastMsg('Room opened in another tab', 'bad'));
    this.socket.on('room:stats', (s) => (this.roomStats = s));
    this.socket.on('room:hold', ({ held }) => this.toastMsg(held ? 'Holding for someone buffering…' : 'Everyone is ready, resuming', held ? 'warn' : 'ok'));

    fetch(`${cfg.serverUrl}/api/settings`, { headers: { authorization: `Bearer ${cfg.token}` } })
      .then((r) => r.json())
      .then((p) => (this.prefs = p))
      .catch(() => {});

    this.mountUI();
    this.clock.start(5000, 4);
    this.videoPoll = setInterval(() => this.attachVideo(), 1000);
    this.statsTimer = setInterval(() => {
      if (this.stats) this.socket.emit('playback:report', this.stats);
      this.renderStatus();
    }, 1000);
    this.onFs = () => this.relocate();
    document.addEventListener('fullscreenchange', this.onFs);
  }

  join() {
    this.socket.emit('room:join', { roomId: this.cfg.roomId }, (res) => {
      if (res?.error) return this.toastMsg(res.error, 'bad');
      const s = res.snapshot;
      this.me = s.me;
      this.hostId = s.room.hostId;
      this.members = s.members;
      this.friends = new Set(s.friends || []);
      this.chat = s.chat;
      this.roomName = s.room.name;
      this.ctrl?.applyState({ ...s.state, replay: true });
      this.renderChat();
      this.renderPeople();
      this.renderStatus();
      this.toastMsg(`Joined ${s.room.name}`, 'ok');
    });
  }

  attachVideo() {
    if (this.destroyed) return;
    const v = findVideo();
    if (v === this.video && v && v.isConnected) return;
    this.detachVideo();
    if (!v) {
      this.renderStatus();
      return;
    }
    this.video = v;
    this.adapter = videoAdapter(v);
    this.ctrl = new SyncController({
      player: this.adapter,
      clock: this.clock,
      isHost: () => this.hostId && this.me && this.hostId === this.me.id,
      sendControl: (c) => this.socket.emit('playback:control', c),
      onStats: (s) => (this.stats = s),
      onCorrection: (e) => e.type === 'autoplay-blocked' && this.toastMsg('Click the player once to join playback', 'warn'),
    });
    this.adapter.on('waiting', () => this.socket.emit('member:buffering', { buffering: true }));
    this.adapter.on('playing', () => this.socket.emit('member:buffering', { buffering: false }));
    const ready = () => {
      this.ctrl.markReady();
      this.ctrl.start();
    };
    if (v.readyState >= 1) ready();
    else v.addEventListener('loadedmetadata', ready, { once: true });
    // Re-request state so a freshly attached player lands on the timeline.
    this.socket.emit('room:join', { roomId: this.cfg.roomId }, (res) => res?.snapshot && this.ctrl?.applyState({ ...res.snapshot.state, replay: true }));
    this.relocate();
    this.toastMsg('Player linked to the room', 'ok');
  }

  detachVideo() {
    this.ctrl?.destroy();
    this.adapter?.destroy();
    this.ctrl = null;
    this.adapter = null;
    this.video = null;
    this.stats = null;
  }

  currentPos() {
    return this.adapter ? this.adapter.getTime() : 0;
  }

  // ---------- events ----------
  onChat(m) {
    this.chat.push(m);
    if (this.chat.length > 300) this.chat.shift();
    this.renderChat();
    if (m.user.id === this.me?.id || this.chatOpen) return;
    this.unread++;
    this.renderStatus();
    const mode = this.prefs.chatPopup;
    const ok = mode === 'everyone' || (mode === 'friends' && this.friends.has(m.user.id)) || (mode === 'mentions' && (m.mentions || []).includes(this.me?.username));
    if (ok) this.popup(m);
  }

  onReaction(r) {
    const mine = r.user.id === this.me?.id;
    const mode = this.prefs.emojiPopup;
    if (!mine && (mode === 'none' || (mode === 'friends' && !this.friends.has(r.user.id)))) return;
    const el = document.createElement('div');
    el.className = 'floater';
    el.style.left = `${8 + Math.random() * 84}%`;
    el.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
    el.innerHTML = `<span class="e">${r.emoji}</span><span class="n">${esc(r.user.displayName)}</span>`;
    this.$('.floaters').appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }

  system(text) {
    this.chat.push({ id: `s${Date.now()}${Math.random()}`, kind: 'system', text, at: Date.now() });
    this.renderChat();
  }

  popup(m) {
    const el = document.createElement('div');
    el.className = 'chat-popup';
    el.innerHTML = `${avatar(m.user, 22)}<span><b>${esc(m.user.displayName)}</b> ${m.spoiler ? '<i>(spoiler hidden)</i>' : esc(m.text)}</span>`;
    this.$('.chat-popups').appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  toastMsg(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.$('.toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  // ---------- UI ----------
  mountUI() {
    this.host = document.createElement('div');
    this.host.id = 'couchverse-overlay';
    this.host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const root = this.host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="floaters"></div>
      <div class="chat-popups"></div>
      <div class="toasts"></div>
      <div class="hud">
        <span class="mark">${I.logo}</span>
        <span class="room"><b class="rn">${esc(this.cfg.roomName || this.cfg.roomCode)}</b><span class="rs">connecting…</span></span>
        <span class="stack"></span>
        <span class="drift"></span>
        <button data-min="1" class="ic" title="Hide CouchVerse (click the pill to bring it back)">${I.min}</button>
      </div>
      <button class="pill hidden" data-restore="1">${I.logo}<span>CouchVerse</span><i class="badge"></i></button>
      <div class="dock">
        ${QUICK_EMOJIS.map((e) => `<button data-e="${e}" title="React ${e}">${e}</button>`).join('')}
        <button data-grid="1" class="ic" title="More emojis">${I.smile}</button>
        <span class="sep"></span>
        <button data-chat="1" class="ic" title="Chat">${I.chat}<i class="badge"></i></button>
        <button data-people="1" class="ic" title="People">${I.people}</button>
        <button data-resync="1" class="ic" title="Resync to the room">${I.refresh}</button>
      </div>
      <div class="emoji-grid hidden">${EMOJI_GRID.map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>
      <div class="panel chat hidden">
        <div class="hd">${I.chat}<span>Chat</span><button data-close="chat" class="ic">${I.x}</button></div>
        <div class="list"></div>
        <form class="ft"><input placeholder="Message… (@name to mention)" maxlength="1000"/><button class="ic send" title="Send">${I.send}</button></form>
      </div>
      <div class="panel people hidden">
        <div class="hd">${I.people}<span>People</span><button data-close="people" class="ic">${I.x}</button></div>
        <div class="list"></div>
      </div>`;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.e) {
        this.socket.emit('reaction:send', { emoji: b.dataset.e, mediaPos: this.currentPos() });
        this.$('.emoji-grid').classList.add('hidden');
      } else if (b.dataset.grid) this.$('.emoji-grid').classList.toggle('hidden');
      else if (b.dataset.chat || b.dataset.close === 'chat') this.togglePanel('chat');
      else if (b.dataset.people || b.dataset.close === 'people') this.togglePanel('people');
      else if (b.dataset.resync) {
        this.ctrl?.resync();
        this.toastMsg('Resynced to the room', 'ok');
      } else if (b.dataset.host) this.socket.emit('host:transfer', { userId: b.dataset.host });
      else if (b.dataset.min) this.setMinimized(true);
      else if (b.dataset.restore) this.setMinimized(false);
    });
    root.querySelector('form.ft').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      if (!input.value.trim()) return;
      this.socket.emit('chat:send', { text: input.value.trim(), mediaPos: this.currentPos() });
      input.value = '';
    });
    // Keep OTT keyboard shortcuts from firing while typing in our chat.
    root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root = root;
    this.relocate();
  }

  setMinimized(v) {
    this.minimized = v;
    for (const sel of ['.hud', '.dock']) this.$(sel).classList.toggle('hidden', v);
    this.$('.pill').classList.toggle('hidden', !v);
    if (v) {
      this.$('.panel.chat').classList.add('hidden');
      this.$('.panel.people').classList.add('hidden');
      this.$('.emoji-grid').classList.add('hidden');
      this.chatOpen = false;
    }
  }

  /** Move the overlay into the fullscreen element so it stays visible. */
  relocate() {
    const target = document.fullscreenElement || document.body || document.documentElement;
    if (this.host.parentElement !== target) target.appendChild(this.host);
  }

  $(sel) {
    return this.root.querySelector(sel);
  }

  togglePanel(name) {
    const other = name === 'chat' ? 'people' : 'chat';
    this.$(`.panel.${other}`).classList.add('hidden');
    const open = this.$(`.panel.${name}`).classList.toggle('hidden') === false;
    if (name === 'chat') {
      this.chatOpen = open;
      if (open) {
        this.unread = 0;
        this.renderStatus();
        this.$('.panel.chat input').focus();
      }
    }
  }

  renderStatus() {
    const isHost = this.hostId && this.me && this.hostId === this.me.id;
    const host = this.members.find((m) => m.id === this.hostId);
    const live = this.members.filter((m) => m.connected);
    this.$('.hud .rn').textContent = this.roomName || this.cfg.roomCode;
    const rs = this.$('.hud .rs');
    rs.textContent = !this.connected ? 'reconnecting…' : !this.video ? 'waiting for a video on this page' : isHost ? 'you are host · your player drives everyone' : `following ${host?.displayName || 'the host'}`;
    rs.className = `rs ${!this.connected ? 'bad' : isHost ? 'ok' : ''}`;
    this.$('.hud .stack').innerHTML = live.slice(0, 5).map((m) => avatar(m, 22, m.id === this.hostId)).join('') + (live.length > 5 ? `<span class="more">+${live.length - 5}</span>` : '');
    const d = this.$('.hud .drift');
    if (this.stats) {
      d.textContent = `${Math.round(this.stats.drift * 1000)} ms · ${Math.round(this.stats.rtt)} ms`;
      d.title = 'drift vs room · ping';
      d.className = `drift ${Math.abs(this.stats.drift) < 0.25 ? 'ok' : Math.abs(this.stats.drift) < 0.5 ? 'warn' : 'bad'}`;
    } else {
      d.textContent = '';
    }
    for (const b of this.root.querySelectorAll('.badge')) b.textContent = this.unread ? String(this.unread) : '';
  }

  renderChat() {
    const list = this.$('.panel.chat .list');
    const myPos = this.currentPos();
    list.innerHTML = this.chat
      .slice(-150)
      .map((m) => {
        if (m.kind === 'system' || !m.user) return `<div class="sys">${esc(m.text)}</div>`;
        const ahead = m.mediaPos != null && m.user.id !== this.me?.id && m.mediaPos > myPos + 4;
        const hidden = m.spoiler || ahead;
        return `<div class="msg ${hidden ? 'spoiler' : ''}">${avatar(m.user, 26)}<div class="b"><div class="who"><b>${esc(m.user.displayName)}</b><span>@${esc(m.user.username)}</span>${hidden ? '<i>spoiler · hover to reveal</i>' : ''}</div><div class="text">${esc(m.text)}</div></div></div>`;
      })
      .join('');
    list.scrollTop = list.scrollHeight;
  }

  renderPeople() {
    const isHost = this.hostId && this.me && this.hostId === this.me.id;
    const live = (id) => this.roomStats?.members.find((m) => m.id === id)?.stats;
    const sorted = [...this.members].sort((a, b) => (b.id === this.hostId) - (a.id === this.hostId) || b.connected - a.connected);
    this.$('.panel.people .list').innerHTML = sorted
      .map((m) => {
        const st = live(m.id) || m.stats;
        return `<div class="member ${m.connected ? '' : 'off'}">${avatar(m, 30, m.id === this.hostId)}<div class="grow"><div class="nm">${esc(m.displayName)} ${m.id === this.hostId ? `<span class="crown" title="Host">${I.crown}</span>` : ''} ${m.id === this.me?.id ? '<span class="tag">you</span>' : ''} ${m.buffering ? '<span class="tag warn">buffering</span>' : ''} ${!m.connected ? '<span class="tag bad">away</span>' : ''}</div><div class="st">@${esc(m.username)}${st?.ping != null ? ` · ${Math.round(st.ping)} ms ping` : ''}${st?.drift != null ? ` · ${Math.round(st.drift * 1000)} ms drift` : ''}</div></div>${isHost && m.id !== this.me.id && m.connected ? `<button data-host="${m.id}" class="mini">${I.crown} Make host</button>` : ''}</div>`;
      })
      .join('');
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.videoPoll);
    clearInterval(this.statsTimer);
    document.removeEventListener('fullscreenchange', this.onFs);
    this.detachVideo();
    this.clock.stop();
    this.socket.disconnect();
    this.host.remove();
    if (session === this) session = null;
  }
}

// ------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hueFor = (s = '') => ['#8b5cf6', '#06b6d4', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#84cc16'][[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 8];
const avatar = (u, size, ring = false) =>
  u.avatar
    ? `<img class="av ${ring ? 'ring' : ''}" src="${esc(u.avatar)}" style="width:${size}px;height:${size}px" title="@${esc(u.username)}">`
    : `<span class="av ${ring ? 'ring' : ''}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${hueFor(u.username || u.displayName)}" title="@${esc(u.username)}">${esc((u.displayName || '?').slice(0, 2).toUpperCase())}</span>`;

const CSS = `
  :host, * { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .hidden { display: none !important; }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
  button { cursor: pointer; border: none; background: transparent; color: #fff; font: inherit; }
  .ic { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; position: relative; transition: background .15s, transform .15s; }
  .ic:hover { background: rgba(255,255,255,.12); transform: scale(1.08); }

  /* floating reactions */
  .floaters { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .floater { position: absolute; bottom: 90px; display: flex; flex-direction: column; align-items: center; animation: up 3.2s ease-out forwards; }
  .floater .e { font-size: 40px; filter: drop-shadow(0 4px 10px rgba(0,0,0,.6)); }
  .floater .n { font-size: 11px; color: #fff; background: rgba(0,0,0,.5); padding: 2px 6px; border-radius: 6px; }
  @keyframes up { 0% { transform: translateY(0) scale(.6); opacity: 0 } 10% { opacity: 1; transform: translateY(-30px) scale(1.1) } 100% { transform: translateY(-55vh) translateX(var(--dx,0)) scale(1); opacity: 0 } }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }

  /* heads-up bar */
  .hud { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; align-items: center; padding: 6px 10px 6px 8px; border-radius: 999px; background: rgba(10,10,18,.78); color: #f3f3f8; border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 40px -16px rgba(0,0,0,.8); backdrop-filter: blur(14px); pointer-events: auto; animation: pop .25s ease; max-width: min(92vw, 720px); }
  .hud .mark svg { width: 28px; height: 28px; }
  .hud .room { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
  .hud .rn { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
  .hud .rs { font-size: 11px; color: #9a9ab0; white-space: nowrap; }
  .hud .rs.ok { color: #a7f3d0 } .hud .rs.bad { color: #fda4af }
  .hud .stack { display: flex; align-items: center; }
  .hud .stack .av { margin-left: -6px; box-shadow: 0 0 0 2px #0d0d16; } .hud .stack .av:first-child { margin-left: 0 }
  .hud .more { font-size: 11px; color: #9a9ab0; margin-left: 6px; }
  .drift { font-family: ui-monospace, Menlo, monospace; font-size: 11px; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,.06); }
  .drift:empty { display: none; }
  .drift.ok { color: #a7f3d0 } .drift.warn { color: #fde68a } .drift.bad { color: #fda4af }
  .pill { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border-radius: 999px; background: rgba(10,10,18,.78); border: 1px solid rgba(255,255,255,.12); color: #fff; font-size: 12px; font-weight: 700; pointer-events: auto; backdrop-filter: blur(14px); }
  .pill svg { width: 22px; height: 22px; }
  .badge { position: absolute; top: -2px; right: -2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #fb4e6b; color: #fff; font-size: 10px; font-style: normal; font-weight: 700; display: grid; place-items: center; }
  .badge:empty { display: none; }

  /* dock */
  .dock { position: absolute; right: 16px; bottom: 96px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 6px; border-radius: 999px; background: rgba(10,10,18,.6); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(12px); pointer-events: auto; animation: pop .25s ease; }
  .dock button { width: 40px; height: 40px; border-radius: 50%; font-size: 21px; display: grid; place-items: center; transition: transform .15s, background .15s; position: relative; }
  .dock button:hover { background: rgba(255,255,255,.12); transform: scale(1.2); }
  .dock .sep { width: 22px; height: 1px; background: rgba(255,255,255,.15); margin: 4px 0; }
  .emoji-grid { position: absolute; right: 72px; bottom: 96px; width: 300px; display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; background: rgba(14,14,22,.94); border: 1px solid rgba(255,255,255,.14); border-radius: 16px; padding: 8px; pointer-events: auto; animation: pop .2s ease; }
  .emoji-grid button { width: 34px; height: 34px; border-radius: 8px; font-size: 20px; }
  .emoji-grid button:hover { background: rgba(255,255,255,.12); transform: scale(1.2); }

  /* panels */
  .panel { position: absolute; right: 72px; bottom: 96px; width: 340px; max-height: min(62vh, 560px); display: flex; flex-direction: column; background: rgba(12,12,20,.92); color: #f3f3f8; border: 1px solid rgba(255,255,255,.12); border-radius: 18px; pointer-events: auto; backdrop-filter: blur(16px); font-size: 13px; box-shadow: 0 20px 60px -20px rgba(0,0,0,.8); animation: pop .22s ease; }
  .panel .hd { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid rgba(255,255,255,.08); font-weight: 700; font-size: 14px; }
  .panel .hd svg { color: #22d3ee; }
  .panel .hd span { flex: 1; }
  .panel .hd .ic { width: 30px; height: 30px; }
  .panel .list { flex: 1; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .panel .list::-webkit-scrollbar { width: 6px } .panel .list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 6px }
  .panel .ft { display: flex; gap: 6px; padding: 10px; border-top: 1px solid rgba(255,255,255,.08); }
  .panel .ft input { flex: 1; padding: 9px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: rgba(0,0,0,.3); color: #fff; outline: none; font-size: 13px; }
  .panel .ft input:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,.25); }
  .panel .ft .send { background: linear-gradient(135deg,#8b5cf6,#7c3aed); }
  .msg { display: flex; gap: 8px; align-items: flex-start; } .msg .b { min-width: 0; flex: 1 }
  .msg .who { font-size: 11px; color: #9a9ab0; display: flex; gap: 6px; align-items: baseline; } .msg .who b { color: #f3f3f8; font-size: 12px }
  .msg .who i { color: #fbbf24; font-style: normal; }
  .msg .text { line-height: 1.45; word-wrap: break-word; } .msg.spoiler .text { filter: blur(6px) } .msg.spoiler:hover .text { filter: none }
  .sys { font-size: 11px; color: #8d8da3; font-style: italic; text-align: center; padding: 2px; }
  .av { display: inline-grid; place-items: center; border-radius: 50%; background: #8b5cf6; color: #fff; font-weight: 700; flex: 0 0 auto; object-fit: cover; overflow: hidden; }
  .av.ring { box-shadow: 0 0 0 2px #0d0d16, 0 0 0 4px #8b5cf6 !important; }
  .member { display: flex; gap: 10px; align-items: center; padding: 8px; border-radius: 12px; background: rgba(255,255,255,.03); } .member.off { opacity: .5 } .member .grow { flex: 1; min-width: 0 }
  .member .nm { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; } .member .crown svg { width: 14px; height: 14px; color: #fbbf24; }
  .member .st { font-size: 11px; color: #8d8da3; font-family: ui-monospace, Menlo, monospace; margin-top: 2px; }
  .tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); font-weight: 600; }
  .tag.warn { color: #fde68a; border-color: rgba(251,191,36,.4) } .tag.bad { color: #fda4af; border-color: rgba(251,78,107,.4) }
  .mini { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 8px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); font-size: 12px; font-weight: 600; } .mini svg { width: 13px; height: 13px; color: #fbbf24 }
  .mini:hover { background: rgba(255,255,255,.14); }

  /* chat pop-ups and toasts */
  .chat-popups { position: absolute; left: 16px; bottom: 120px; display: flex; flex-direction: column; gap: 6px; max-width: 420px; pointer-events: none; }
  .chat-popup { display: flex; gap: 8px; align-items: center; background: rgba(10,10,16,.6); color: #fff; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 7px 11px; font-size: 13px; backdrop-filter: blur(8px); animation: pop .2s ease; }
  .toasts { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
  .toast { display: flex; align-items: center; gap: 8px; background: rgba(14,14,22,.92); color: #f3f3f8; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 7px 14px; font-size: 12px; font-weight: 600; animation: pop .22s ease; transition: opacity .4s, transform .4s; backdrop-filter: blur(10px); }
  .toast::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #8b5cf6; }
  .toast.ok::before { background: #34d399 } .toast.warn::before { background: #fbbf24 } .toast.bad::before { background: #fb4e6b }
  .toast.out { opacity: 0; transform: translateY(-6px); }
`;
