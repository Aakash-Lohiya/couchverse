# CouchVerse

Real-time watch party. Everyone in a room sees the same frame at the same time, whether the video plays in CouchVerse's own player or inside Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, Apple TV+ or YouTube through the companion extension.

```
┌──────────────┐   socket.io    ┌──────────────────┐   socket.io   ┌──────────────────────┐
│ React client │ ◄────────────► │ Node + Socket.IO │ ◄───────────► │ Chrome extension     │
│ native player│                │ server (SQLite)  │               │ overlay on OTT player│
└──────────────┘                └──────────────────┘               └──────────────────────┘
```

## Features

**Accounts & social**
- Google Sign-In (ID token verified server-side) with a local dev login fallback when no client id is configured.
- Unique `@username` (changeable exactly once, with a warning), visible name (changeable any time), profile picture (uploaded, resized client-side; initials fallback).
- Add friends by username, notification bell with accept / decline, notifications for accepted and declined requests, friend list with unfriend.

**Rooms**
- Public or private rooms, native player or OTT companion mode. Private rooms are joined by 6-character code or invite link, optionally with an extra passcode.
- Public room browser: what is screening, live progress bar, upcoming queue, member avatars, filters by native / any OTT / specific platform, search by title, `@username` of anyone in a room, or `host:name`.
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
- **Companion mode** with a real Chrome extension: overlay with emojis, chat, people and host transfer directly on top of the OTT player, including in fullscreen; Netflix seeks go through its player API.
- **Movie discovery**: top-10 per genre with the Indian streaming platform for each title, fuzzy search ("intersteller" finds Interstellar), filters by platform / type / rating / sort. "Watch together" spins up a companion room for that platform.

## Running it

Requirements: Node.js 22.12+ (24 recommended; the server uses the built-in `node:sqlite`).

```bash
npm install
npm --prefix client install
npm run fetch-samples      # 4 MB CC-licensed clip served locally, so a demo needs no internet in the browser
npm run dev                # API + sockets on http://localhost:4000
npm run dev:client         # Vite dev server on http://localhost:5173 (proxies /api, /socket.io, /media)
```

Open http://localhost:5173. Without `GOOGLE_CLIENT_ID` the dev login is enabled: any email creates its own account, so open a second browser profile (or http://127.0.0.1:5173, a different origin) to be a second user.

Production: `npm run build` then `npm start` serves the built client from the API server on port 4000.

### Environment

| variable | default | purpose |
| --- | --- | --- |
| `PORT` | `4000` | API/socket port |
| `GOOGLE_CLIENT_ID` | – | enables Google Sign-In (create a Web client in Google Cloud Console, add `http://localhost:5173` as authorized origin) |
| `ALLOW_DEV_LOGIN` | `true` when no Google id | `false` to disable the email dev login |
| `JWT_SECRET` | dev value | sign session tokens; set in production |
| `DB_PATH` | `data/couchverse.sqlite` | SQLite file |
| `EXTENSION_STORE_URL` | – | Chrome Web Store URL; when set, the site offers "Add to Chrome" instead of the zip download |
| `VITE_SERVER_URL` (client) | same origin | API/socket origin when the client is hosted elsewhere |
| `API_PORT` (client dev, in `client/.env.local`) | `4000` | where the Vite dev proxy forwards `/api`, `/media`, `/socket.io`; set it to match `PORT` when 4000 is taken |

### Companion extension (OTT mode)

```bash
npm run build:ext          # bundles to extension/dist
```

Users get it from the site itself: the companion lobby and the profile page show a **Get the extension** button.
- If `EXTENSION_STORE_URL` is set (a Chrome Web Store listing), the button is "Add to Chrome" and links there: two clicks, automatic updates.
- Otherwise the server packages `extension/dist` on the fly at `/api/extension.zip` and the button opens a four-step guide (unzip, `chrome://extensions`, Developer mode, Load unpacked). Chrome does not allow silent installs from websites, so this is the minimum outside the store.
- Once installed, the lobby and profile page detect it and show "Extension installed".

Manual install for development: Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`. Then:
1. Create or join an **OTT companion** room on the CouchVerse site. The lobby page detects the extension and hands it the room.
2. Open the title on the OTT site. The CouchVerse overlay appears over the player; the host's play / pause / seek drives everyone, viewers follow within half a second.

The bridge content script is matched to `localhost:5173` / `localhost:4000`; add your production origin to `extension/manifest.json` when deploying.

## Deploying

The server serves the built client, so one Node service is enough. It needs WebSockets and, ideally, a persistent disk for SQLite.

**Render (simplest).** Push to GitHub, then in Render choose *New → Blueprint* and pick the repo: `render.yaml` defines the service, build and start commands, a generated `JWT_SECRET`, and the health check. After the first deploy, set `SITE_ORIGIN` to your Render URL and redeploy so the packaged extension's bridge runs on your domain. The free plan sleeps when idle and resets SQLite on each deploy; a paid plan with a disk (`DB_PATH=/var/data/couchverse.sqlite`) keeps accounts and friends.

**Fly.io / Docker.** `fly launch --copy-config && fly deploy` uses `fly.toml` and the `Dockerfile`, with a volume mounted at `/app/data` for SQLite. Any Docker host works: `docker build --build-arg SITE_ORIGIN=https://your.domain -t couchverse . && docker run -p 4000:4000 -v couchverse-data:/app/data -e JWT_SECRET=... couchverse`.

**After going live**
- Google Sign-In: create a Web OAuth client in Google Cloud Console, add your site origin to *Authorized JavaScript origins*, set `GOOGLE_CLIENT_ID`, and set `ALLOW_DEV_LOGIN=false`.
- Extension: the site serves `extension/dist` as a zip; with `SITE_ORIGIN` set at build time the bridge content script is allowed on your domain. Publishing to the Chrome Web Store and setting `EXTENSION_STORE_URL` turns the button into "Add to Chrome".

## Tests, load test and measurements

```bash
npm test                   # sync engine unit tests (node:test)
npm run loadtest           # 12 users + 2 late joiners, 40 controls, stalls, reconnect, host transfer, burst
```

The load test drives the real `SyncController` with virtual players and writes `docs/latency-results.json`. See **[docs/LATENCY.md](docs/LATENCY.md)** for the numbers, test conditions and failure handling, and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the protocol.

## Project layout

```
server/        Express + Socket.IO API, room manager, SQLite (node:sqlite), catalog + fuzzy search
shared/        sync-engine.js (clock, controller, virtual player), constants
client/        React + Vite app (pages: Login, Setup, Home, Profile, PublicRooms, Room)
extension/     MV3 Chrome extension (bridge, companion overlay, Netflix page hook)
scripts/       loadtest.js, fetch-samples.js
tests/         unit tests
docs/          ARCHITECTURE.md, LATENCY.md, latency-results.json
```
