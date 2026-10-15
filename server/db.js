import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'couchverse.sqlite');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT,
    username TEXT UNIQUE,
    display_name TEXT,
    avatar TEXT,
    username_changed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_popup TEXT NOT NULL DEFAULT 'everyone',
    emoji_popup TEXT NOT NULL DEFAULT 'everyone',
    auto_fullscreen INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS friendships (
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_a, user_b)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fr_to ON friend_requests(to_user, status);
  CREATE INDEX IF NOT EXISTS idx_fr_from ON friend_requests(from_user, status);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// ---------- helpers ----------
const q = (sql) => db.prepare(sql);

export const Users = {
  byId: (id) => q('SELECT * FROM users WHERE id = ?').get(id),
  byGoogleSub: (sub) => q('SELECT * FROM users WHERE google_sub = ?').get(sub),
  byUsername: (u) => q('SELECT * FROM users WHERE lower(username) = lower(?)').get(u),
  byEmail: (e) => q('SELECT * FROM users WHERE lower(email) = lower(?)').get(e),
  create({ id, googleSub, email, displayName, avatar }) {
    q(
      'INSERT INTO users (id, google_sub, email, username, display_name, avatar, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
    ).run(id, googleSub, email, displayName, avatar || null, Date.now());
    q('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
    return Users.byId(id);
  },
  setUsername(id, username, markChanged) {
    if (markChanged) q('UPDATE users SET username = ?, username_changed = 1 WHERE id = ?').run(username, id);
    else q('UPDATE users SET username = ? WHERE id = ?').run(username, id);
  },
  setDisplayName: (id, name) => q('UPDATE users SET display_name = ? WHERE id = ?').run(name, id),
  setAvatar: (id, avatar) => q('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, id),
  search: (prefix, limit = 10) =>
    q('SELECT id, username, display_name, avatar FROM users WHERE username LIKE ? LIMIT ?').all(`${prefix}%`, limit),
};

export const Settings = {
  get(userId) {
    q('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(userId);
    const row = q('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
    return { chatPopup: row.chat_popup, emojiPopup: row.emoji_popup, autoFullscreen: !!row.auto_fullscreen };
  },
  update(userId, { chatPopup, emojiPopup, autoFullscreen }) {
    const cur = Settings.get(userId);
    q('UPDATE user_settings SET chat_popup = ?, emoji_popup = ?, auto_fullscreen = ? WHERE user_id = ?').run(
      chatPopup ?? cur.chatPopup,
      emojiPopup ?? cur.emojiPopup,
      autoFullscreen === undefined ? (cur.autoFullscreen ? 1 : 0) : autoFullscreen ? 1 : 0,
      userId,
    );
    return Settings.get(userId);
  },
};

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export const Friends = {
  are(a, b) {
    const [x, y] = pair(a, b);
    return !!q('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?').get(x, y);
  },
  add(a, b) {
    const [x, y] = pair(a, b);
    q('INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)').run(x, y, Date.now());
  },
  remove(a, b) {
    const [x, y] = pair(a, b);
    q('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(x, y);
  },
  list(userId) {
    return q(
      `SELECT u.id, u.username, u.display_name, u.avatar, f.created_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?
       ORDER BY u.display_name COLLATE NOCASE`,
    ).all(userId, userId, userId);
  },
  idSet(userId) {
    return new Set(
      q('SELECT user_a, user_b FROM friendships WHERE user_a = ? OR user_b = ?')
        .all(userId, userId)
        .map((r) => (r.user_a === userId ? r.user_b : r.user_a)),
    );
  },
};

export const FriendRequests = {
  pendingBetween(a, b) {
    return q(
      `SELECT * FROM friend_requests WHERE status = 'pending' AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))`,
    ).get(a, b, b, a);
  },
  create(id, from, to) {
    q('INSERT INTO friend_requests (id, from_user, to_user, created_at) VALUES (?, ?, ?, ?)').run(id, from, to, Date.now());
    return FriendRequests.byId(id);
  },
  byId: (id) => q('SELECT * FROM friend_requests WHERE id = ?').get(id),
  resolve(id, status) {
    q('UPDATE friend_requests SET status = ?, resolved_at = ? WHERE id = ?').run(status, Date.now(), id);
  },
  incoming(userId) {
    return q(
      `SELECT r.*, u.username, u.display_name, u.avatar FROM friend_requests r JOIN users u ON u.id = r.from_user
       WHERE r.to_user = ? AND r.status = 'pending' ORDER BY r.created_at DESC`,
    ).all(userId);
  },
};

export const Notifications = {
  add(id, userId, type, payload) {
    q('INSERT INTO notifications (id, user_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      userId,
      type,
      JSON.stringify(payload),
      Date.now(),
    );
    return { id, userId, type, payload, read: false, createdAt: Date.now() };
  },
  list(userId, limit = 50) {
    return q('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit)
      .map((n) => ({ id: n.id, type: n.type, payload: JSON.parse(n.payload), read: !!n.read, createdAt: n.created_at }));
  },
  markRead(userId) {
    q('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
  },
  unreadCount(userId) {
    return q('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(userId).c;
  },
};

export const RoomStore = {
  save(id, data) {
    q('INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(
      id,
      JSON.stringify(data),
      Date.now(),
    );
  },
  remove(id) {
    q('DELETE FROM rooms WHERE id = ?').run(id);
  },
  all() {
    return q('SELECT data FROM rooms').all().map((r) => JSON.parse(r.data));
  },
};

/** Shape a user row for API responses (never leaks google_sub). */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar || null,
  };
}
