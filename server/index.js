import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';

import { Users, Settings, Friends, FriendRequests, Notifications, publicUser } from './db.js';
import {
  requireAuth,
  verifyToken,
  verifyGoogleCredential,
  upsertIdentity,
  sessionPayload,
  USERNAME_RE,
  GOOGLE_CLIENT_ID,
  ALLOW_DEV_LOGIN,
} from './auth.js';
import { RoomManager } from './rooms.js';
import * as catalog from './catalog.js';
import { CHAT_POPUP_MODES, OTT_PLATFORMS } from '../shared/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const CLIENT_DIST = path.join(here, '..', 'client', 'dist');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
// Locally hosted sample media (see scripts/fetch-samples.js). express.static
// handles Range requests, which <video> needs for seeking.
app.use('/media', express.static(path.join(here, 'media'), { acceptRanges: true, maxAge: '1d' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  // Lower ping interval helps detect dead connections faster for host failover.
  pingInterval: 5000,
  pingTimeout: 8000,
  perMessageDeflate: false, // latency over bandwidth: small JSON frames
});

const rooms = new RoomManager(io);

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
function notify(userId, type, payload) {
  const n = Notifications.add(randomUUID(), userId, type, payload);
  io.to(`user:${userId}`).emit('notification', { ...n, unread: Notifications.unreadCount(userId) });
  return n;
}

function cleanAvatar(avatar) {
  if (avatar === null) return null;
  if (typeof avatar !== 'string') return undefined;
  if (avatar.length > 700_000) throw new Error('avatar too large (max ~500KB)');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(avatar) && !/^https?:\/\//.test(avatar)) {
    throw new Error('avatar must be an image data URL or https URL');
  }
  return avatar;
}

const wrap = (fn) => (req, res) =>
  (async () => fn(req, res))().catch((e) => {
    console.error(e);
    res.status(400).json({ error: e.message || 'bad request' });
  });

// ------------------------------------------------------------------
// config & auth
// ------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, now: Date.now(), rooms: rooms.rooms.size }));

const EXTENSION_STORE_URL = process.env.EXTENSION_STORE_URL || null;
const EXTENSION_DIST = path.join(here, '..', 'extension', 'dist');

app.get('/api/config', (_req, res) =>
  res.json({
    googleClientId: GOOGLE_CLIENT_ID || null,
    allowDevLogin: ALLOW_DEV_LOGIN,
    platforms: OTT_PLATFORMS,
    extensionStoreUrl: EXTENSION_STORE_URL,
    extensionDownload: existsSync(path.join(EXTENSION_DIST, 'manifest.json')),
  }),
);

// Packaged companion extension for "load unpacked" installs. Built lazily and
// cached until the dist folder changes.
let extZipCache = null;
app.get('/api/extension.zip', async (req, res) => {
  if (!existsSync(path.join(EXTENSION_DIST, 'manifest.json'))) {
    return res.status(404).json({ error: 'Extension is not built on this server. Run `npm run build:ext`.' });
  }
  const { statSync } = await import('node:fs');
  const stamp = statSync(path.join(EXTENSION_DIST, 'companion.js')).mtimeMs;
  if (!extZipCache || extZipCache.stamp !== stamp) {
    const { zipDirectory } = await import('./zip.js');
    extZipCache = { stamp, buf: zipDirectory(EXTENSION_DIST, 'couchverse-extension') };
  }
  res.setHeader('content-type', 'application/zip');
  res.setHeader('content-disposition', 'attachment; filename="couchverse-extension.zip"');
  res.setHeader('cache-control', 'no-cache');
  res.send(extZipCache.buf);
});

app.post(
  '/api/auth/google',
  wrap(async (req, res) => {
    const identity = await verifyGoogleCredential(req.body.credential);
    const { user } = upsertIdentity(identity);
    res.json(sessionPayload(user));
  }),
);

app.post(
  '/api/auth/dev',
  wrap((req, res) => {
    if (!ALLOW_DEV_LOGIN) return res.status(403).json({ error: 'dev login disabled' });
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new Error('email required');
    const name = String(req.body.name || email.split('@')[0]).trim().slice(0, 40);
    const { user } = upsertIdentity({ sub: `dev:${email}`, email, name, picture: null });
    res.json(sessionPayload(user));
  }),
);

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    ...sessionPayload(req.user),
    settings: Settings.get(req.user.id),
    unread: Notifications.unreadCount(req.user.id),
  });
});

app.get('/api/username-available', (req, res) => {
  const u = String(req.query.u || '').toLowerCase();
  if (!USERNAME_RE.test(u)) return res.json({ available: false, reason: '3-20 chars: a-z, 0-9, underscore' });
  res.json({ available: !Users.byUsername(u) });
});

app.post(
  '/api/profile/setup',
  requireAuth,
  wrap((req, res) => {
    if (req.user.username) throw new Error('profile already set up');
    const username = String(req.body.username || '').toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('username must be 3-20 chars: a-z, 0-9, underscore');
    if (Users.byUsername(username)) throw new Error('username is taken');
    const displayName = String(req.body.displayName || '').trim().slice(0, 40);
    if (!displayName) throw new Error('display name required');
    Users.setUsername(req.user.id, username, false);
    Users.setDisplayName(req.user.id, displayName);
    const avatar = cleanAvatar(req.body.avatar);
    if (avatar !== undefined) Users.setAvatar(req.user.id, avatar);
    res.json(sessionPayload(Users.byId(req.user.id)));
  }),
);

app.patch(
  '/api/profile',
  requireAuth,
  wrap((req, res) => {
    const { displayName, avatar, username } = req.body;
    if (displayName !== undefined) {
      const d = String(displayName).trim().slice(0, 40);
      if (!d) throw new Error('display name cannot be empty');
      Users.setDisplayName(req.user.id, d);
    }
    if (avatar !== undefined) {
      const a = cleanAvatar(avatar);
      if (a !== undefined) Users.setAvatar(req.user.id, a);
    }
    if (username !== undefined) {
      const u = String(username).toLowerCase();
      if (u !== req.user.username) {
        if (req.user.username_changed) throw new Error('username can only be changed once');
        if (!USERNAME_RE.test(u)) throw new Error('username must be 3-20 chars: a-z, 0-9, underscore');
        if (Users.byUsername(u)) throw new Error('username is taken');
        Users.setUsername(req.user.id, u, true);
      }
    }
    res.json(sessionPayload(Users.byId(req.user.id)));
  }),
);

app.get('/api/users/:username', requireAuth, (req, res) => {
  const u = Users.byUsername(req.params.username);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ user: publicUser(u), isFriend: Friends.are(req.user.id, u.id) });
});

// ------------------------------------------------------------------
// settings
// ------------------------------------------------------------------
app.get('/api/settings', requireAuth, (req, res) => res.json(Settings.get(req.user.id)));
app.patch(
  '/api/settings',
  requireAuth,
  wrap((req, res) => {
    const { chatPopup, emojiPopup, autoFullscreen } = req.body;
    if (chatPopup !== undefined && !CHAT_POPUP_MODES.includes(chatPopup)) throw new Error('bad chatPopup');
    if (emojiPopup !== undefined && !CHAT_POPUP_MODES.includes(emojiPopup)) throw new Error('bad emojiPopup');
    res.json(Settings.update(req.user.id, { chatPopup, emojiPopup, autoFullscreen }));
  }),
);

// ------------------------------------------------------------------
// friends & notifications
// ------------------------------------------------------------------
app.get('/api/friends', requireAuth, (req, res) => {
  res.json({
    friends: Friends.list(req.user.id).map((f) => ({ id: f.id, username: f.username, displayName: f.display_name, avatar: f.avatar, since: f.created_at })),
    incoming: FriendRequests.incoming(req.user.id).map((r) => ({
      id: r.id,
      from: { id: r.from_user, username: r.username, displayName: r.display_name, avatar: r.avatar },
      createdAt: r.created_at,
    })),
  });
});

app.post(
  '/api/friends/request',
  requireAuth,
  wrap((req, res) => {
    const target = Users.byUsername(String(req.body.username || '').replace(/^@/, ''));
    if (!target) throw new Error('no user with that username');
    if (target.id === req.user.id) throw new Error("you can't add yourself");
    if (Friends.are(req.user.id, target.id)) throw new Error('already friends');
    const pending = FriendRequests.pendingBetween(req.user.id, target.id);
    if (pending) {
      if (pending.from_user === target.id) {
        // They already asked us: accept instead.
        FriendRequests.resolve(pending.id, 'accepted');
        Friends.add(req.user.id, target.id);
        notify(target.id, 'friend_accepted', { user: publicUser(req.user) });
        return res.json({ ok: true, accepted: true, friend: publicUser(target) });
      }
      throw new Error('request already pending');
    }
    const r = FriendRequests.create(randomUUID(), req.user.id, target.id);
    notify(target.id, 'friend_request', { requestId: r.id, user: publicUser(req.user) });
    res.json({ ok: true, request: { id: r.id, to: publicUser(target) } });
  }),
);

app.post(
  '/api/friends/respond',
  requireAuth,
  wrap((req, res) => {
    const r = FriendRequests.byId(req.body.requestId);
    if (!r || r.to_user !== req.user.id || r.status !== 'pending') throw new Error('request not found');
    const accept = !!req.body.accept;
    FriendRequests.resolve(r.id, accept ? 'accepted' : 'declined');
    if (accept) Friends.add(r.from_user, r.to_user);
    notify(r.from_user, accept ? 'friend_accepted' : 'friend_declined', { user: publicUser(req.user) });
    // Clear the request notification on our side by marking a resolution record.
    notify(req.user.id, accept ? 'friend_you_accepted' : 'friend_you_declined', { user: publicUser(Users.byId(r.from_user)), requestId: r.id });
    res.json({ ok: true });
  }),
);

app.delete('/api/friends/:userId', requireAuth, (req, res) => {
  Friends.remove(req.user.id, req.params.userId);
  io.to(`user:${req.params.userId}`).emit('friends:changed');
  io.to(`user:${req.user.id}`).emit('friends:changed');
  res.json({ ok: true });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const list = Notifications.list(req.user.id);
  // Mark friend-request notifications as resolved if the request is no longer pending.
  const withStatus = list.map((n) => {
    if (n.type === 'friend_request') {
      const r = FriendRequests.byId(n.payload.requestId);
      return { ...n, status: r ? r.status : 'gone' };
    }
    return n;
  });
  res.json({ notifications: withStatus, unread: Notifications.unreadCount(req.user.id) });
});
app.post('/api/notifications/read', requireAuth, (req, res) => {
  Notifications.markRead(req.user.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// catalog
// ------------------------------------------------------------------
app.get('/api/catalog/meta', (_req, res) =>
  res.json({ ...catalog.catalogMeta, genres: catalog.GENRES, platforms: catalog.PLATFORMS, languages: catalog.LANGUAGES }),
);
app.get('/api/catalog/boards', (req, res) => res.json({ boards: catalog.genreBoards(Number(req.query.n) || 10) }));
app.get('/api/catalog/search', (req, res) => res.json({ results: catalog.search(req.query) }));
app.get('/api/catalog/:id', (req, res) => {
  const item = catalog.byId(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// ------------------------------------------------------------------
// rooms (REST side; realtime is over sockets)
// ------------------------------------------------------------------
app.post(
  '/api/rooms',
  requireAuth,
  wrap((req, res) => {
    if (!req.user.username) throw new Error('finish your profile first');
    const { name, visibility, type, platform, passcode, media } = req.body;
    const plat = type === 'ott' ? OTT_PLATFORMS.find((p) => p.id === platform) : null;
    if (type === 'ott' && !plat) throw new Error('choose an OTT platform');
    const room = rooms.create({
      name: String(name || `${req.user.display_name}'s room`).trim().slice(0, 60),
      visibility,
      type,
      platform: plat ? plat.id : null,
      passcode: passcode ? String(passcode).slice(0, 32) : null,
      creatorId: req.user.id,
      media: media && media.title ? { ...media, id: randomUUID() } : null,
    });
    if (room.media) room.state.mediaId = room.media.id;
    res.json({ room: room.summary() });
  }),
);

app.get('/api/rooms/public', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const platform = String(req.query.platform || '');
  let list = rooms.publicRooms();
  if (platform === 'native') list = list.filter((r) => r.type === 'native');
  else if (platform === 'ott') list = list.filter((r) => r.type === 'ott');
  else if (platform) list = list.filter((r) => r.platform === platform);
  if (q) {
    list = list.filter((r) => {
      if (q.startsWith('@')) {
        const u = q.slice(1);
        return r.members.some((m) => m.username?.toLowerCase().startsWith(u)) || r.host?.username?.toLowerCase().startsWith(u);
      }
      if (q.startsWith('host:')) {
        const h = q.slice(5).trim();
        return r.host && (r.host.username?.toLowerCase().includes(h) || r.host.displayName?.toLowerCase().includes(h));
      }
      const hay = [r.name, r.media?.title, r.host?.displayName, r.host?.username, ...r.queue.map((x) => x.title)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }
  list.sort((a, b) => b.memberCount - a.memberCount || b.createdAt - a.createdAt);
  res.json({ rooms: list, serverNow: Date.now() });
});

app.get('/api/rooms/code/:code', requireAuth, (req, res) => {
  const room = rooms.getByCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'no room with that code' });
  const s = room.summary();
  res.json({ room: { id: s.id, code: s.code, name: s.name, type: s.type, platform: s.platform, visibility: s.visibility, hasPasscode: s.hasPasscode, memberCount: s.memberCount, media: s.media } });
});

app.get('/api/rooms/:id', requireAuth, (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'room not found' });
  res.json({ room: room.summary() });
});

// ------------------------------------------------------------------
// media relay: streams a remote video through the server with Range
// support. Used automatically by the native player when the browser
// cannot fetch a source directly (CORS, mixed content, blocked host).
// ------------------------------------------------------------------
app.get('/api/media/proxy', async (req, res) => {
  const token = req.query.t;
  if (!token || !verifyToken(token)) return res.status(401).end();
  let url;
  try {
    url = new URL(String(req.query.url));
    if (!/^https?:$/.test(url.protocol)) throw new Error('bad protocol');
  } catch {
    return res.status(400).json({ error: 'bad url' });
  }
  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;
  headers['user-agent'] = 'CouchVerse/1.0';
  let upstream;
  try {
    upstream = await fetch(url, { headers, redirect: 'follow' });
  } catch (e) {
    return res.status(502).json({ error: `upstream failed: ${e.message}` });
  }
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
  if (!upstream.body) return res.end();
  const { Readable } = await import('node:stream');
  const stream = Readable.fromWeb(upstream.body);
  req.on('close', () => stream.destroy());
  stream.on('error', () => res.end());
  stream.pipe(res);
});

// ------------------------------------------------------------------
// static client (production)
// ------------------------------------------------------------------
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// ------------------------------------------------------------------
// sockets
// ------------------------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const userId = token && verifyToken(token);
  const user = userId && Users.byId(userId);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = publicUser(user);
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.data.userId;
  socket.join(`user:${uid}`);

  // Clock sync. Reply as fast as possible; callback carries server time.
  socket.on('time:ping', (t0, cb) => {
    if (typeof cb === 'function') cb(Date.now(), t0);
  });

  const currentRoom = () => {
    const rid = rooms.socketRoom.get(socket.id);
    return rid ? rooms.get(rid) : null;
  };

  socket.on('room:join', ({ roomId, code, passcode } = {}, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    const room = roomId ? rooms.get(roomId) : rooms.getByCode(code);
    if (!room) return reply({ error: 'room not found' });
    const fresh = Users.byId(uid);
    if (!fresh?.username) return reply({ error: 'finish your profile first' });
    const alreadyMember = room.members.has(uid);
    if (room.passcode && room.passcode !== passcode && !alreadyMember && uid !== room.creatorId) {
      return reply({ error: 'wrong passcode', needsPasscode: true });
    }
    // Leave any previous room first.
    if (currentRoom() && currentRoom().id !== room.id) rooms.leave(socket, { hard: true });
    socket.data.user = publicUser(fresh);
    const snapshot = rooms.join(socket, room, socket.data.user);
    snapshot.me = socket.data.user;
    snapshot.friends = [...Friends.idSet(uid)];
    reply({ ok: true, snapshot });
  });

  socket.on('room:leave', () => rooms.leave(socket, { hard: true }));

  socket.on('room:end', (_p, cb) => {
    const room = currentRoom();
    const ok = room ? rooms.end(room, uid) : false;
    if (typeof cb === 'function') cb({ ok });
  });

  socket.on('playback:control', (ctl = {}, cb) => {
    const room = currentRoom();
    if (!room) return;
    const r = rooms.control(room, uid, ctl);
    if (typeof cb === 'function') cb({ ...r, serverNow: Date.now() });
  });

  socket.on('playback:setMedia', ({ media, autoplay } = {}, cb) => {
    const room = currentRoom();
    if (!room) return;
    const r = rooms.setMedia(room, uid, media, { autoplay });
    if (typeof cb === 'function') cb(r);
  });

  socket.on('playback:report', (stats = {}) => {
    const room = currentRoom();
    if (room) rooms.report(room, uid, stats);
  });

  socket.on('member:buffering', ({ buffering } = {}) => {
    const room = currentRoom();
    if (room) rooms.setBuffering(room, uid, buffering);
  });

  socket.on('queue:add', (item = {}, cb) => {
    const room = currentRoom();
    if (!room || !item.title) return;
    const e = rooms.queueAdd(room, uid, {
      title: String(item.title).slice(0, 120),
      url: item.url ? String(item.url).slice(0, 2000) : null,
      kind: item.kind || (room.type === 'ott' ? 'ott' : 'url'),
      platform: item.platform || room.platform,
      duration: Number(item.duration) || null,
      poster: item.poster || null,
      catalogId: item.catalogId || null,
    });
    if (typeof cb === 'function') cb({ ok: true, item: e });
  });
  socket.on('queue:remove', ({ id } = {}) => {
    const room = currentRoom();
    if (room) rooms.queueRemove(room, uid, id);
  });
  socket.on('queue:move', ({ id, toIndex } = {}) => {
    const room = currentRoom();
    if (room) rooms.queueMove(room, uid, id, Number(toIndex) || 0);
  });
  socket.on('queue:vote', ({ id } = {}) => {
    const room = currentRoom();
    if (room) rooms.queueVote(room, uid, id);
  });
  socket.on('queue:play', ({ id } = {}, cb) => {
    const room = currentRoom();
    if (!room) return;
    const r = rooms.queuePlay(room, uid, id);
    if (typeof cb === 'function') cb(r);
  });

  socket.on('chat:send', (msg = {}) => {
    const room = currentRoom();
    if (!room || !msg.text || !String(msg.text).trim()) return;
    rooms.chat(room, socket.data.user, msg);
  });

  socket.on('reaction:send', (r = {}) => {
    const room = currentRoom();
    if (!room || !r.emoji) return;
    rooms.react(room, socket.data.user, r);
  });

  socket.on('host:transfer', ({ userId } = {}, cb) => {
    const room = currentRoom();
    if (!room || room.hostId !== uid) return;
    const ok = rooms.setHost(room, userId, 'transfer');
    if (typeof cb === 'function') cb({ ok });
  });

  socket.on('room:settings', (patch = {}) => {
    const room = currentRoom();
    if (room) rooms.updateSettings(room, uid, patch);
  });

  socket.on('poll:create', (p = {}, cb) => {
    const room = currentRoom();
    if (!room) return;
    const r = rooms.pollCreate(room, socket.data.user, p);
    if (typeof cb === 'function') cb(r);
  });
  socket.on('poll:vote', ({ pollId, option } = {}) => {
    const room = currentRoom();
    if (room) rooms.pollVote(room, uid, pollId, Number(option));
  });
  socket.on('poll:close', ({ pollId } = {}) => {
    const room = currentRoom();
    if (room) rooms.pollClose(room, uid, pollId);
  });

  socket.on('typing', ({ typing } = {}) => {
    const room = currentRoom();
    if (room) socket.to(room.id).emit('typing', { userId: uid, typing: !!typing });
  });

  socket.on('disconnect', () => {
    rooms.leave(socket, { hard: false });
  });
});

server.listen(PORT, () => {
  console.log(`CouchVerse server listening on http://localhost:${PORT}`);
  console.log(`  Google sign-in: ${GOOGLE_CLIENT_ID ? 'configured' : 'not configured'} | dev login: ${ALLOW_DEV_LOGIN ? 'enabled' : 'disabled'}`);
  console.log(`  Rooms restored from disk: ${rooms.rooms.size}`);
});
