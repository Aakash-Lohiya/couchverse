/**
 * Persistence layer on libSQL. One code path serves two backends:
 *   - a local SQLite file (default, `data/couchverse.sqlite`)
 *   - Turso / any libSQL server when TURSO_DATABASE_URL is set, so accounts,
 *     friends and preferences survive deploys on hosts without a disk.
 */
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');

const remoteUrl = (process.env.TURSO_DATABASE_URL || '').trim();
let url;
if (remoteUrl) {
  // Friendly diagnostics for the two mistakes that are easy to make in a dashboard.
  if (/^eyJ[A-Za-z0-9_-]+\./.test(remoteUrl)) {
    throw new Error('TURSO_DATABASE_URL contains a token (starts with "eyJ"). Put the libsql://...turso.io address in TURSO_DATABASE_URL and the token in TURSO_AUTH_TOKEN.');
  }
  if (!/^(libsql|https?|wss?):\/\//.test(remoteUrl)) {
    throw new Error(`TURSO_DATABASE_URL must start with libsql:// (got "${remoteUrl.slice(0, 24)}…"). Copy the database URL from the Turso dashboard.`);
  }
  if (!process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_AUTH_TOKEN is empty. Create a token in the Turso dashboard and set it alongside TURSO_DATABASE_URL.');
  }
  url = remoteUrl;
} else {
  mkdirSync(dataDir, { recursive: true });
  const file = process.env.DB_PATH || path.join(dataDir, 'couchverse.sqlite');
  url = `file:${file.replace(/\\/g, '/')}`;
}
export const DB_BACKEND = remoteUrl ? 'turso' : 'sqlite-file';

export const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

const SCHEMA = `
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
`;

/** Create tables; call once at boot. */
export async function initDb() {
  if (!remoteUrl) {
    try {
      await db.execute('PRAGMA journal_mode = WAL');
    } catch {
      /* not supported on some backends */
    }
  }
  // One statement per request: Turso's HTTP endpoint rejects some
  // multi-statement scripts, and this works identically on the local file.
  const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const sql of statements) {
    try {
      await db.execute(sql);
    } catch (e) {
      const detail = remoteUrl ? await describeRemoteError() : '';
      throw new Error(`Database setup failed on "${sql.slice(0, 60)}…": ${e.message}${detail}`);
    }
  }
}

/**
 * The libsql client hides the server's error body ("Server returned HTTP
 * status 400"). Ask the HTTP pipeline endpoint directly so the log shows the
 * real reason (bad token, wrong database, unsupported statement...).
 */
async function describeRemoteError() {
  try {
    const base = remoteUrl.replace(/^(libsql|wss?):\/\//, 'https://').replace(/\/+$/, '');
    const res = await fetch(`${base}/v2/pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TURSO_AUTH_TOKEN || ''}` },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'SELECT 1' } }, { type: 'close' }] }),
    });
    const text = (await res.text()).slice(0, 400);
    return `\n  Turso replied ${res.status} to a test query: ${text}\n  URL host: ${new URL(base).host}`;
  } catch (e) {
    return `\n  (could not reach Turso for diagnostics: ${e.message})`;
  }
}

// ---------- helpers ----------
const clean = (args) => args.map((a) => (a === undefined ? null : a));
const all = async (sql, ...args) => (await db.execute({ sql, args: clean(args) })).rows;
const get = async (sql, ...args) => (await all(sql, ...args))[0] || null;
const run = (sql, ...args) => db.execute({ sql, args: clean(args) });

export const Users = {
  byId: (id) => get('SELECT * FROM users WHERE id = ?', id),
  byGoogleSub: (sub) => get('SELECT * FROM users WHERE google_sub = ?', sub),
  byUsername: (u) => get('SELECT * FROM users WHERE lower(username) = lower(?)', u),
  byEmail: (e) => get('SELECT * FROM users WHERE lower(email) = lower(?)', e),
  async create({ id, googleSub, email, displayName, avatar }) {
    await run(
      'INSERT INTO users (id, google_sub, email, username, display_name, avatar, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
      id,
      googleSub,
      email,
      displayName,
      avatar || null,
      Date.now(),
    );
    await run('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)', id);
    return Users.byId(id);
  },
  setUsername(id, username, markChanged) {
    return markChanged
      ? run('UPDATE users SET username = ?, username_changed = 1 WHERE id = ?', username, id)
      : run('UPDATE users SET username = ? WHERE id = ?', username, id);
  },
  setDisplayName: (id, name) => run('UPDATE users SET display_name = ? WHERE id = ?', name, id),
  setAvatar: (id, avatar) => run('UPDATE users SET avatar = ? WHERE id = ?', avatar, id),
};

export const Settings = {
  async get(userId) {
    await run('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)', userId);
    const row = await get('SELECT * FROM user_settings WHERE user_id = ?', userId);
    return { chatPopup: row.chat_popup, emojiPopup: row.emoji_popup, autoFullscreen: !!row.auto_fullscreen };
  },
  async update(userId, { chatPopup, emojiPopup, autoFullscreen }) {
    const cur = await Settings.get(userId);
    await run(
      'UPDATE user_settings SET chat_popup = ?, emoji_popup = ?, auto_fullscreen = ? WHERE user_id = ?',
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
  async are(a, b) {
    const [x, y] = pair(a, b);
    return !!(await get('SELECT 1 AS one FROM friendships WHERE user_a = ? AND user_b = ?', x, y));
  },
  add(a, b) {
    const [x, y] = pair(a, b);
    return run('INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)', x, y, Date.now());
  },
  remove(a, b) {
    const [x, y] = pair(a, b);
    return run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', x, y);
  },
  list(userId) {
    return all(
      `SELECT u.id, u.username, u.display_name, u.avatar, f.created_at
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?
       ORDER BY u.display_name COLLATE NOCASE`,
      userId,
      userId,
      userId,
    );
  },
  async idSet(userId) {
    const rows = await all('SELECT user_a, user_b FROM friendships WHERE user_a = ? OR user_b = ?', userId, userId);
    return new Set(rows.map((r) => (r.user_a === userId ? r.user_b : r.user_a)));
  },
};

export const FriendRequests = {
  pendingBetween(a, b) {
    return get(
      `SELECT * FROM friend_requests WHERE status = 'pending' AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))`,
      a,
      b,
      b,
      a,
    );
  },
  async create(id, from, to) {
    await run('INSERT INTO friend_requests (id, from_user, to_user, created_at) VALUES (?, ?, ?, ?)', id, from, to, Date.now());
    return FriendRequests.byId(id);
  },
  byId: (id) => get('SELECT * FROM friend_requests WHERE id = ?', id),
  resolve: (id, status) => run('UPDATE friend_requests SET status = ?, resolved_at = ? WHERE id = ?', status, Date.now(), id),
  incoming(userId) {
    return all(
      `SELECT r.*, u.username, u.display_name, u.avatar FROM friend_requests r JOIN users u ON u.id = r.from_user
       WHERE r.to_user = ? AND r.status = 'pending' ORDER BY r.created_at DESC`,
      userId,
    );
  },
};

export const Notifications = {
  async add(id, userId, type, payload) {
    await run('INSERT INTO notifications (id, user_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)', id, userId, type, JSON.stringify(payload), Date.now());
    return { id, userId, type, payload, read: false, createdAt: Date.now() };
  },
  async list(userId, limit = 50) {
    const rows = await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit);
    return rows.map((n) => ({ id: n.id, type: n.type, payload: JSON.parse(n.payload), read: !!n.read, createdAt: Number(n.created_at) }));
  },
  markRead: (userId) => run('UPDATE notifications SET read = 1 WHERE user_id = ?', userId),
  async unreadCount(userId) {
    const row = await get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0', userId);
    return Number(row?.c || 0);
  },
};

export const RoomStore = {
  save: (id, data) =>
    run(
      'INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      id,
      JSON.stringify(data),
      Date.now(),
    ),
  remove: (id) => run('DELETE FROM rooms WHERE id = ?', id),
  async all() {
    return (await all('SELECT data FROM rooms')).map((r) => JSON.parse(r.data));
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
