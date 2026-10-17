# CouchVerse

**Live: https://couchverse.onrender.com**

Real-time watch party. Everyone in a room sees the same frame at the same time, whether the video plays in CouchVerse's own player or inside Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, Apple TV+ or YouTube through the companion extension.

```
┌──────────────┐   socket.io    ┌──────────────────┐   socket.io   ┌──────────────────────┐
│ React client │ ◄────────────► │ Node + Socket.IO │ ◄───────────► │ Chrome extension     │
│ native player│                │ server (SQLite)  │               │ overlay on OTT player│
└──────────────┘                └──────────────────┘               └──────────────────────┘
```

## Using the live site

1. Open https://couchverse.onrender.com and sign in with Google. Pick a visible name and a unique `@username` (the username can be changed only once, ever).
2. **Create a room**: public or private, native player (any mp4 / HLS / YouTube link, or the built-in sample) or OTT companion (pick the platform and the title).
3. Share the 6-letter room code or the invite link. Friends join from **Join with a code**, from the **Live now** panel, or from **Browse all** public rooms.
4. In the room: the host's play, pause and seek drive everyone; viewers follow within half a second. Use the icons at the top for chat, people (with host transfer and per-person sync stats), the shared queue, polls and settings. Quick emojis and the emoji grid float over everyone's video.
5. For OTT rooms, click **Get the extension** in the room lobby (or on your profile page). The site serves the packaged extension and walks you through the four-step install; after that, open the title on the OTT site and the CouchVerse overlay appears over the player.

Hosting note: the site runs on Render's free tier, so the first visit after 15 idle minutes takes about 30 seconds to wake. Accounts, friends and preferences are stored in a hosted database and persist across deploys.

## Features

**Accounts & social**
- Google Sign-In (ID token verified server-side). An email-based dev login can be enabled for local testing.
- Unique `@username` (changeable exactly once, with a warning), visible name (changeable any time), profile picture (uploaded, resized client-side; initials fallback).
- Add friends by username, notification bell with accept / decline, notifications for accepted and declined requests, friend list with unfriend.

**Rooms**
- Public or private rooms, native player or OTT companion mode. Private rooms are joined by 6-character code or invite link, optionally with an extra passcode.
- Public room browser: what is screening, live progress bar, upcoming queue, member avatars, filters by native / any OTT / specific platform, search by title, `@username` of anyone in a room, or `host:name`.
- Host controls: leave and hand over, or end the room for everyone. When a host leaves, the next person who joined becomes host, and the original host gets the role back on return.
- Rooms survive a server restart (core state persisted to SQLite); members simply rejoin.

**Native player room**
- Auto-fullscreen on entry (user setting), host-only controls (play, pause, seek, speed), optional "everyone can control".
- Supports mp4/webm, HLS (hls.js) and YouTube (IFrame API). Sources the browser cannot fetch directly are relayed through the server with Range support.
- Five quick emojis plus a 60-emoji grid; reactions float up on everyone's screen with the sender's name.
- Chat panel (avatar, visible name, hover for `@username`, `@mentions`, typing indicator). When closed, messages appear as translucent pop-ups.
- Viewer list with host crown, connection and buffering state, per-viewer ping / drift / p95 control latency, and one-click host transfer.
- Per-user settings: chat pop-ups from everyone / friends / only @mentions / none; emoji pop-ups from everyone / friends / none.
- Shared playlist with up-votes, reorder, play-now, auto-advance when a video ends.
- Group polls with countdown and live results, "vote what's next" (winner jumps to the front of the queue) and "snack break" (room pauses if yes wins).

**Companion mode (OTT)**
- Chrome extension that overlays emojis, chat, the people list, host transfer and sync stats directly on the OTT player, including in fullscreen. The host's native OTT controls drive the room.
- The site checks for the extension before creating or joining an OTT room and offers the download with a guided install if it is missing. Netflix seeks go through its player API.

**Sync engine** (shared between web client, extension and load tester)
- Server-authoritative timeline: `{position, anchor(server ms), playing, rate, version}`. Any peer computes `expected = position + (serverNow − anchor) · rate`.
- NTP-style clock sync (best-of-8 samples) so every peer agrees on "now" to within a few ms on a LAN.
- Drift loop every 250 ms: >120 ms drift → playback-rate nudge (±6%); >900 ms → hard seek with a 150 ms lead; paused → position pinned. YouTube cannot nudge, so it seeks above 360 ms.
- Late joins get a full snapshot and land directly on the timeline; reconnects rejoin automatically; a host who drops is replaced by the longest-present member after 12 s.
- Concurrency: every control carries the version it was based on; stale play/pause toggles are dropped, seeks (explicit intent) win, host identity is checked server-side.
- Autoplay-policy aware: if the browser blocks `play()`, a "tap to join playback" overlay appears and the engine resumes on gesture.

**Creative extras**
- **Spoiler shield**: a chat message written further ahead than where you are is blurred with "ahead of you by 1:23" until you catch up (or click).
- **Reaction heat-map** on the seek bar: where the room laughed, screamed or cried, with the top emoji per segment.
- **Hold for buffering**: if anyone stalls, the room pauses for all and resumes together.
- **Movie discovery**: top-10 per genre with the Indian streaming platform for each title, fuzzy search ("intersteller" finds Interstellar), filters by platform / type / rating / sort. "Watch together" spins up a companion room for that platform.

## Measurements

The load test drives the real `SyncController` with virtual players: 12 users plus 2 late joiners, 52 host controls, injected stalls, a forced reconnect, a host transfer and a 10-seek burst.

| metric | p95 | target |
| --- | ---: | --- |
| control propagation (host → viewer applied) | 4 ms | ≤ 250 ms |
| steady-state drift | 135 ms | ≤ 500 ms |
| stall recovery | 459 ms | – |
| late join → in sync | 33 ms | – |

Full numbers, test conditions and failure handling: **[docs/LATENCY.md](docs/LATENCY.md)**. Protocol and design: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## For developers

### Running locally

Requirements: Node.js 22.12+ (24 recommended; the server uses the built-in `node:sqlite`).

```bash
npm install
npm --prefix client install
npm run fetch-samples      # 4 MB CC-licensed clip served locally, so a demo needs no internet in the browser
npm run dev                # API + sockets on http://localhost:4000
npm run dev:client         # Vite dev server on http://localhost:5173 (proxies /api, /socket.io, /media)
```

Open http://localhost:5173. Without `GOOGLE_CLIENT_ID` the dev login is enabled: any email creates its own account, so open a second browser profile (or http://127.0.0.1:5173, a different origin) to be a second user. If port 4000 is busy, start the API with another `PORT` and put the same number in `client/.env.local` as `API_PORT`.

Production build: `npm run build` then `npm start` serves the built client from the API server.

### Environment

| variable | default | purpose |
| --- | --- | --- |
| `PORT` | `4000` | API/socket port |
| `GOOGLE_CLIENT_ID` | – | enables Google Sign-In (Web OAuth client; add the site origin under *Authorized JavaScript origins*) |
| `ALLOW_DEV_LOGIN` | `true` when no Google id | `false` to disable the email dev login |
| `JWT_SECRET` | dev value | signs session tokens; set in production |
| `SITE_ORIGIN` | – | public site URL, baked into the extension at build time so its bridge runs on your domain |
| `EXTENSION_STORE_URL` | – | Chrome Web Store URL; when set, the site offers "Add to Chrome" instead of the zip download |
| `DB_PATH` | `data/couchverse.sqlite` | local SQLite file (ignored when Turso is configured) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | – | hosted libSQL database (free at turso.tech) so accounts, friends and preferences survive deploys on hosts without a disk |
| `VITE_SERVER_URL` (client) | same origin | API/socket origin when the client is hosted elsewhere |
| `API_PORT` (client dev, in `client/.env.local`) | `4000` | where the Vite dev proxy forwards `/api`, `/media`, `/socket.io` |

See [.env.example](.env.example).

### Companion extension

```bash
npm run build:ext          # bundles to extension/dist (set SITE_ORIGIN to include your live domain)
```

The site serves `extension/dist` as a zip at `/api/extension.zip` and shows the guided install. Publishing to the Chrome Web Store and setting `EXTENSION_STORE_URL` turns the button into "Add to Chrome". For development, load `extension/dist` unpacked from `chrome://extensions`.

### Deploying

The server serves the built client, so one Node service is enough. Step-by-step instructions for GitHub + Render, Google Sign-In and the extension are in **[docs/DEPLOY.md](docs/DEPLOY.md)**. `render.yaml` (Render Blueprint), `Dockerfile` and `fly.toml` are included; every push to `main` runs the CI workflow (Linux build, unit tests, server smoke test) and Render redeploys automatically.

### Tests and load test

```bash
npm test                   # sync engine unit tests (node:test)
npm run loadtest           # against a local server; add --server https://… to measure a deployment
```

### Project layout

```
server/        Express + Socket.IO API, room manager, SQLite (node:sqlite), catalog + fuzzy search, media relay, extension packaging
shared/        sync-engine.js (clock, controller, virtual player), constants
client/        React + Vite app (pages: Login, Setup, Home, Profile, PublicRooms, Room)
extension/     MV3 Chrome extension (bridge, companion overlay, Netflix page hook)
scripts/       loadtest.js, fetch-samples.js
tests/         unit tests
docs/          ARCHITECTURE.md, LATENCY.md, DEPLOY.md, latency-results.json
```
