/**
 * Room manager: authoritative playback state, membership, queue, chat,
 * reactions, polls, host transfer, stats aggregation.
 *
 * Rooms live in memory for speed; their durable core (identity, media, queue,
 * playback state) is persisted to SQLite so a server restart does not lose a
 * party in progress - clients simply rejoin on reconnect.
 */
import { randomUUID, randomInt } from 'node:crypto';
import { RoomStore } from './db.js';
import { expectedPosition } from '../shared/sync-engine.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAT_HISTORY = 200;
const REACTION_HISTORY = 500;
const MEMBER_GRACE_MS = 30_000;   // keep a disconnected member this long
const HOST_GRACE_MS = 12_000;     // auto-transfer host after this
const EMPTY_ROOM_TTL_MS = 10 * 60_000;

export function makeCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export class Room {
  constructor(init) {
    this.id = init.id || randomUUID();
    this.code = init.code || makeCode();
    this.name = init.name || 'Untitled room';
    this.visibility = init.visibility === 'private' ? 'private' : 'public';
    this.type = init.type === 'ott' ? 'ott' : 'native';
    this.platform = init.platform || null;
    this.passcode = init.passcode || null;
    this.creatorId = init.creatorId;
    this.hostId = init.hostId || init.creatorId;
    // How the current host got the role: 'creator' | 'transfer' (explicit
    // hand-off) | 'auto' (previous host left). An auto-promoted host gives the
    // role back when `previousHostId` returns.
    this.hostBy = init.hostBy || 'creator';
    this.previousHostId = init.previousHostId || null;
    this.createdAt = init.createdAt || Date.now();
    this.media = init.media || null;
    this.queue = init.queue || [];
    this.state = init.state || { version: 0, playing: false, position: 0, anchor: Date.now(), rate: 1, mediaId: null };
    this.settings = Object.assign({ holdForBuffering: false, allowGuestControl: false, spoilerShield: true }, init.settings);
    this.members = new Map(); // userId -> member
    this.chat = [];
    this.reactions = [];
    this.polls = init.polls || [];
    this.emptySince = Date.now();
    this.hostGoneSince = null;
    this.heldByBuffering = false;
  }

  toPersist() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      visibility: this.visibility,
      type: this.type,
      platform: this.platform,
      passcode: this.passcode,
      creatorId: this.creatorId,
      hostId: this.hostId,
      hostBy: this.hostBy,
      previousHostId: this.previousHostId,
      createdAt: this.createdAt,
      media: this.media,
      queue: this.queue,
      state: this.state,
      settings: this.settings,
      polls: this.polls,
    };
  }

  /** Public summary for the room browser. */
  summary(now = Date.now()) {
    const connected = [...this.members.values()].filter((m) => m.connected);
    const host = this.members.get(this.hostId);
    const position = expectedPosition(this.state, now);
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      visibility: this.visibility,
      type: this.type,
      platform: this.platform,
      hasPasscode: !!this.passcode,
      createdAt: this.createdAt,
      host: host ? host.user : null,
      hostId: this.hostId,
      memberCount: connected.length,
      members: connected.map((m) => m.user),
      media: this.media,
      playing: this.state.playing,
      position,
      duration: this.media?.duration || null,
      progress: this.media?.duration ? Math.min(1, position / this.media.duration) : null,
      queue: this.queue.slice(0, 5),
      queueLength: this.queue.length,
    };
  }

  /** Full snapshot sent to a (re)joining member. */
  snapshot() {
    return {
      room: this.summary(),
      state: { ...this.state, serverNow: Date.now() },
      settings: this.settings,
      members: this.memberList(),
      chat: this.chat.slice(-CHAT_HISTORY),
      reactions: this.reactions.slice(-REACTION_HISTORY),
      polls: this.polls,
      queue: this.queue,
      media: this.media,
      heldByBuffering: this.heldByBuffering,
    };
  }

  memberList() {
    return [...this.members.values()].map((m) => ({
      ...m.user,
      connected: m.connected,
      isHost: m.user.id === this.hostId,
      joinedAt: m.joinedAt,
      stats: m.stats,
      buffering: m.buffering,
    }));
  }
}

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.byCode = new Map();
    this.socketRoom = new Map(); // socket.id -> roomId
    this.saveTimers = new Map();
    setInterval(() => this._sweep(), 5000);
    setInterval(() => this._broadcastStats(), 1000);
  }

  /** Load rooms persisted by a previous process. Call once at boot. */
  async restore() {
    for (const data of await RoomStore.all()) this._register(new Room(data));
    return this.rooms.size;
  }

  _register(room) {
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room);
  }

  create(init) {
    let code = makeCode();
    while (this.byCode.has(code)) code = makeCode();
    const room = new Room({ ...init, code });
    this._register(room);
    this.persist(room);
    return room;
  }

  get(id) {
    return this.rooms.get(id);
  }

  getByCode(code) {
    return this.byCode.get(String(code || '').toUpperCase());
  }

  publicRooms() {
    return [...this.rooms.values()].filter((r) => r.visibility === 'public').map((r) => r.summary());
  }

  persist(room) {
    // Debounce: controls can arrive many times per second.
    if (this.saveTimers.has(room.id)) return;
    this.saveTimers.set(
      room.id,
      setTimeout(() => {
        this.saveTimers.delete(room.id);
        if (this.rooms.has(room.id)) RoomStore.save(room.id, room.toPersist()).catch((e) => console.error("room save failed", e.message));
      }, 500),
    );
  }

  /** Host ends the room for everyone. */
  end(room, userId) {
    if (room.hostId !== userId) return false;
    const host = room.members.get(userId);
    this.io.to(room.id).emit('room:system', { text: `${host?.user.displayName || 'Host'} ended the room`, at: Date.now(), kind: 'end' });
    this.destroy(room, 'ended');
    return true;
  }

  destroy(room, reason = 'closed') {
    this.io.to(room.id).emit('room:closed', { reason });
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    RoomStore.remove(room.id).catch(() => {});
  }

  // ---------- membership ----------
  join(socket, room, user) {
    const existing = room.members.get(user.id);
    const now = Date.now();
    if (existing) {
      // Reconnect / second tab: supersede the old socket.
      if (existing.socketId && existing.socketId !== socket.id) {
        const old = this.io.sockets.sockets.get(existing.socketId);
        if (old) {
          old.leave(room.id);
          this.socketRoom.delete(old.id);
          old.emit('room:superseded');
        }
      }
      existing.socketId = socket.id;
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.user = user;
    } else {
      room.members.set(user.id, {
        user,
        socketId: socket.id,
        connected: true,
        joinedAt: now,
        disconnectedAt: null,
        stats: null,
        buffering: false,
      });
    }
    if (user.id === room.hostId) room.hostGoneSince = null;
    socket.join(room.id);
    this.socketRoom.set(socket.id, room.id);
    room.emptySince = null;
    this._emitMembers(room);
    this.io.to(room.id).emit('room:system', { text: `${user.displayName} joined`, at: now, kind: existing ? 'rejoin' : 'join' });
    // The host who left (and was replaced automatically) gets the role back.
    if (room.hostBy === 'auto' && room.previousHostId === user.id && room.hostId !== user.id) {
      this.setHost(room, user.id, 'return');
    }
    return room.snapshot();
  }

  leave(socket, { hard = false } = {}) {
    const roomId = this.socketRoom.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    this.socketRoom.delete(socket.id);
    if (!room) return;
    const member = [...room.members.values()].find((m) => m.socketId === socket.id);
    if (!member) return;
    socket.leave(room.id);
    if (hard) {
      room.members.delete(member.user.id);
      this.io.to(room.id).emit('room:system', { text: `${member.user.displayName} left`, at: Date.now(), kind: 'leave' });
      if (member.user.id === room.hostId) this._autoTransferHost(room);
    } else {
      member.connected = false;
      member.disconnectedAt = Date.now();
      if (member.user.id === room.hostId) room.hostGoneSince = Date.now();
      this.io.to(room.id).emit('room:system', { text: `${member.user.displayName} disconnected`, at: Date.now(), kind: 'disconnect' });
    }
    this._emitMembers(room);
    if (![...room.members.values()].some((m) => m.connected)) room.emptySince = Date.now();
  }

  _emitMembers(room) {
    this.io.to(room.id).emit('room:members', { members: room.memberList(), hostId: room.hostId });
  }

  _autoTransferHost(room) {
    const candidates = [...room.members.values()].filter((m) => m.connected && m.user.id !== room.hostId);
    if (!candidates.length) return;
    candidates.sort((a, b) => a.joinedAt - b.joinedAt);
    this.setHost(room, candidates[0].user.id, 'auto');
  }

  setHost(room, userId, by = 'transfer') {
    if (!room.members.has(userId)) return false;
    const previous = room.hostId;
    room.hostId = userId;
    room.hostGoneSince = null;
    if (by === 'auto') {
      // Remember who to give it back to; keep the original if a chain of
      // auto-promotions happens (A leaves → B, B leaves → C: A still reclaims).
      if (room.hostBy !== 'auto') room.previousHostId = previous;
      room.hostBy = 'auto';
    } else if (by === 'return') {
      room.hostBy = 'creator';
      room.previousHostId = null;
    } else {
      room.hostBy = 'transfer';
      room.previousHostId = null;
    }
    const m = room.members.get(userId);
    this.io.to(room.id).emit('room:host', { hostId: userId, by });
    const text =
      by === 'auto'
        ? `${m.user.displayName} is now host (previous host left)`
        : by === 'return'
          ? `${m.user.displayName} is back and takes the host role again`
          : `${m.user.displayName} is now host`;
    this.io.to(room.id).emit('room:system', { text, at: Date.now(), kind: 'host' });
    this._emitMembers(room);
    this.persist(room);
    return true;
  }

  // ---------- playback ----------
  canControl(room, userId) {
    return userId === room.hostId || room.settings.allowGuestControl;
  }

  /**
   * Apply a control. Server stamps the anchor so every peer computes the
   * same timeline regardless of who sent it or how late it arrives.
   */
  control(room, userId, ctl) {
    if (!this.canControl(room, userId)) return { error: 'not-host' };
    const now = Date.now();
    const s = room.state;
    // Concurrency guard: a control based on an older version than the
    // current one lost a race (e.g. host transfer mid-seek). Seeks still win
    // because they are explicit user intent; play/pause toggles are dropped
    // if stale and the current state already matches the intent.
    const stale = Number.isFinite(ctl.baseVersion) && ctl.baseVersion < s.version - 1;
    if (stale && ctl.action !== 'seek' && ctl.action !== 'rate') {
      const wantsPlay = ctl.action === 'play';
      if (wantsPlay === s.playing) return { ignored: 'stale' };
    }
    const position = Number.isFinite(ctl.position) ? Math.max(0, ctl.position) : expectedPosition(s, now);
    const next = { ...s, version: s.version + 1, anchor: now, position };
    switch (ctl.action) {
      case 'play':
        next.playing = true;
        break;
      case 'pause':
        next.playing = false;
        break;
      case 'seek':
        // keep playing flag; position updated above
        break;
      case 'rate':
        next.rate = Math.min(2, Math.max(0.5, Number(ctl.rate) || 1));
        break;
      default:
        return { error: 'bad-action' };
    }
    room.state = next;
    room.heldByBuffering = false;
    this.io.to(room.id).emit('playback:state', {
      ...next,
      action: ctl.action,
      byUserId: userId,
      originTs: Number.isFinite(ctl.originTs) ? ctl.originTs : now,
      serverNow: now,
    });
    this.persist(room);
    return { ok: true, state: next };
  }

  setMedia(room, userId, media, { autoplay = false } = {}) {
    if (!this.canControl(room, userId)) return { error: 'not-host' };
    const now = Date.now();
    room.media = media ? { ...media, id: media.id || randomUUID(), addedBy: userId } : null;
    room.state = { version: room.state.version + 1, playing: !!(autoplay && media), position: 0, anchor: now, rate: 1, mediaId: room.media?.id || null };
    room.reactions = [];
    this.io.to(room.id).emit('media:change', { media: room.media, state: { ...room.state, serverNow: now } });
    this.io.to(room.id).emit('playback:state', { ...room.state, action: 'media', byUserId: userId, originTs: now, serverNow: now });
    this.io.to(room.id).emit('room:system', { text: media ? `Now playing: ${media.title}` : 'Media cleared', at: now, kind: 'media' });
    this.persist(room);
    return { ok: true };
  }

  // ---------- queue ----------
  queueAdd(room, userId, item) {
    const entry = { ...item, id: randomUUID(), addedBy: userId, addedAt: Date.now(), votes: [] };
    room.queue.push(entry);
    this._emitQueue(room);
    return entry;
  }
  queueRemove(room, userId, itemId) {
    const idx = room.queue.findIndex((q) => q.id === itemId);
    if (idx < 0) return false;
    const item = room.queue[idx];
    if (item.addedBy !== userId && !this.canControl(room, userId)) return false;
    room.queue.splice(idx, 1);
    this._emitQueue(room);
    return true;
  }
  queueMove(room, userId, itemId, toIndex) {
    if (!this.canControl(room, userId)) return false;
    const idx = room.queue.findIndex((q) => q.id === itemId);
    if (idx < 0) return false;
    const [item] = room.queue.splice(idx, 1);
    room.queue.splice(Math.max(0, Math.min(room.queue.length, toIndex)), 0, item);
    this._emitQueue(room);
    return true;
  }
  queueVote(room, userId, itemId) {
    const item = room.queue.find((q) => q.id === itemId);
    if (!item) return false;
    const i = item.votes.indexOf(userId);
    if (i >= 0) item.votes.splice(i, 1);
    else item.votes.push(userId);
    // Keep the queue sorted by votes (stable for ties).
    room.queue.sort((a, b) => b.votes.length - a.votes.length || a.addedAt - b.addedAt);
    this._emitQueue(room);
    return true;
  }
  queuePlay(room, userId, itemId) {
    if (!this.canControl(room, userId)) return { error: 'not-host' };
    const idx = itemId ? room.queue.findIndex((q) => q.id === itemId) : 0;
    if (idx < 0 || !room.queue.length) return { error: 'empty' };
    const [item] = room.queue.splice(idx, 1);
    this._emitQueue(room);
    return this.setMedia(room, userId, item, { autoplay: true });
  }
  _emitQueue(room) {
    this.io.to(room.id).emit('queue:update', { queue: room.queue });
    this.persist(room);
  }

  // ---------- chat & reactions ----------
  chat(room, user, { text, mediaPos, spoiler, replyTo }) {
    const msg = {
      id: randomUUID(),
      user,
      text: String(text).slice(0, 1000),
      at: Date.now(),
      mediaId: room.media?.id || null,
      mediaPos: Number.isFinite(mediaPos) ? mediaPos : null,
      spoiler: !!spoiler,
      replyTo: replyTo || null,
      mentions: [...String(text).matchAll(/@([a-z0-9_]{3,20})/gi)].map((m) => m[1].toLowerCase()),
    };
    room.chat.push(msg);
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    this.io.to(room.id).emit('chat:message', msg);
    return msg;
  }

  react(room, user, { emoji, mediaPos }) {
    const r = {
      id: randomUUID(),
      user,
      emoji: String(emoji).slice(0, 8),
      at: Date.now(),
      mediaId: room.media?.id || null,
      mediaPos: Number.isFinite(mediaPos) ? mediaPos : null,
    };
    room.reactions.push(r);
    if (room.reactions.length > REACTION_HISTORY) room.reactions.shift();
    this.io.to(room.id).emit('reaction', r);
    return r;
  }

  // ---------- polls ----------
  pollCreate(room, user, { question, options, kind = 'custom', durationSec = 60 }) {
    const opts = (options || []).map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 8);
    if (!question || opts.length < 2) return { error: 'bad-poll' };
    const poll = {
      id: randomUUID(),
      question: String(question).slice(0, 200),
      options: opts,
      kind, // 'custom' | 'next' (vote the next item) | 'pause' (snack break)
      votes: {}, // userId -> optionIndex
      createdBy: user,
      createdAt: Date.now(),
      endsAt: Date.now() + Math.min(600, Math.max(10, durationSec)) * 1000,
      closed: false,
      meta: {},
    };
    room.polls.push(poll);
    if (room.polls.length > 20) room.polls.shift();
    this.io.to(room.id).emit('poll:update', { poll });
    this.persist(room);
    setTimeout(() => this.pollClose(room, null, poll.id, true), poll.endsAt - Date.now() + 50);
    return { ok: true, poll };
  }

  pollVote(room, userId, pollId, optionIdx) {
    const poll = room.polls.find((p) => p.id === pollId);
    if (!poll || poll.closed) return false;
    if (optionIdx < 0 || optionIdx >= poll.options.length) return false;
    poll.votes[userId] = optionIdx;
    this.io.to(room.id).emit('poll:update', { poll });
    return true;
  }

  pollClose(room, userId, pollId, auto = false) {
    const poll = room.polls.find((p) => p.id === pollId);
    if (!poll || poll.closed) return false;
    if (!auto && userId !== room.hostId && poll.createdBy.id !== userId) return false;
    poll.closed = true;
    const counts = poll.options.map((_, i) => Object.values(poll.votes).filter((v) => v === i).length);
    const max = Math.max(...counts);
    const winners = counts.map((c, i) => (c === max && max > 0 ? i : -1)).filter((i) => i >= 0);
    poll.result = { counts, winners };
    // Creative hooks: a "next" poll auto-promotes the winner to the front of
    // the queue; a "pause" (snack break) poll pauses the room if yes wins.
    if (poll.kind === 'next' && winners.length === 1) {
      const target = room.queue.find((q) => q.title === poll.options[winners[0]]);
      if (target) {
        room.queue = [target, ...room.queue.filter((q) => q.id !== target.id)];
        this._emitQueue(room);
      }
    }
    if (poll.kind === 'pause' && winners.length === 1 && winners[0] === 0 && room.state.playing) {
      this.control(room, room.hostId, { action: 'pause', position: expectedPosition(room.state, Date.now()) });
      this.io.to(room.id).emit('room:system', { text: 'Snack break! The room voted to pause.', at: Date.now(), kind: 'poll' });
    }
    this.io.to(room.id).emit('poll:update', { poll });
    this.persist(room);
    return true;
  }

  // ---------- settings ----------
  updateSettings(room, userId, patch) {
    if (userId !== room.hostId) return false;
    for (const k of ['holdForBuffering', 'allowGuestControl', 'spoilerShield']) {
      if (typeof patch[k] === 'boolean') room.settings[k] = patch[k];
    }
    this.io.to(room.id).emit('room:settings', { settings: room.settings });
    this.persist(room);
    return true;
  }

  // ---------- stats & buffering ----------
  report(room, userId, stats) {
    const m = room.members.get(userId);
    if (!m) return;
    m.stats = {
      ping: stats.rtt ?? null,
      offset: stats.offset ?? null,
      drift: stats.drift ?? null,
      position: stats.local ?? null,
      propagationP95: stats.propagation?.p95 ?? null,
      propagationP50: stats.propagation?.p50 ?? null,
      corrections: stats.corrections ?? 0,
      at: Date.now(),
    };
  }

  setBuffering(room, userId, buffering) {
    const m = room.members.get(userId);
    if (!m) return;
    m.buffering = !!buffering;
    this.io.to(room.id).emit('member:buffering', { userId, buffering: m.buffering });
    if (room.settings.holdForBuffering) this._evaluateHold(room);
  }

  /**
   * "Hold for buffering": if anyone is buffering while the room plays, pause
   * for everyone; when everyone is ready again, resume where we held.
   */
  _evaluateHold(room) {
    const connected = [...room.members.values()].filter((m) => m.connected);
    const anyBuffering = connected.some((m) => m.buffering);
    if (anyBuffering && room.state.playing && !room.heldByBuffering) {
      this.control(room, room.hostId, { action: 'pause', position: expectedPosition(room.state, Date.now()) });
      room.heldByBuffering = true;
      this.io.to(room.id).emit('room:hold', { held: true });
    } else if (!anyBuffering && room.heldByBuffering) {
      room.heldByBuffering = false;
      this.control(room, room.hostId, { action: 'play', position: room.state.position });
      this.io.to(room.id).emit('room:hold', { held: false });
    }
  }

  _broadcastStats(now = Date.now()) {
    for (const room of this.rooms.values()) {
      const connected = [...room.members.values()].filter((m) => m.connected);
      if (!connected.length) continue;
      this.io.to(room.id).emit('room:stats', {
        serverNow: now,
        expected: expectedPosition(room.state, now),
        members: connected.map((m) => ({ id: m.user.id, stats: m.stats, buffering: m.buffering })),
      });
    }
  }

  _sweep() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      for (const [uid, m] of room.members) {
        if (!m.connected && m.disconnectedAt && now - m.disconnectedAt > MEMBER_GRACE_MS) {
          room.members.delete(uid);
          this._emitMembers(room);
        }
      }
      if (room.hostGoneSince && now - room.hostGoneSince > HOST_GRACE_MS) {
        room.hostGoneSince = null;
        this._autoTransferHost(room);
      }
      const anyConnected = [...room.members.values()].some((m) => m.connected);
      if (!anyConnected) {
        if (!room.emptySince) room.emptySince = now;
        if (now - room.emptySince > EMPTY_ROOM_TTL_MS) this.destroy(room, 'idle');
      }
    }
  }
}
