# CouchVerse architecture

## Components

| piece | tech | role |
| --- | --- | --- |
| `server/` | Node 24, Express, Socket.IO, `node:sqlite` | auth (Google ID token / dev), profiles, friends, notifications, catalog search, room manager, media relay |
| `shared/sync-engine.js` | plain ES module, no DOM | server clock, drift controller, latency stats, virtual player (tests / load test) |
| `client/` | React 18 + Vite | all pages; native player (HTML5 / HLS / YouTube adapters) |
| `extension/` | Chrome MV3, esbuild | companion mode: overlay + sync on OTT players |

Users and social data live in SQLite. Rooms live in memory for latency, with their durable core (identity, media, queue, timeline, settings, polls) written back to SQLite on change (debounced 500 ms) and reloaded on boot.

## Playback timeline

The server is the only writer of the room timeline:

```
state = { version, playing, position (s), anchor (server ms), rate, mediaId }
expected(now) = playing ? position + (now − anchor)/1000 · rate : position
```

A control (`play | pause | seek | rate`) from the host is stamped with the server clock (`anchor = Date.now()`), `version` is bumped, and the new state is broadcast to every member including the sender. Because the anchor is a server timestamp, the state is self-describing: a peer that receives it 5 ms or 500 ms later computes the same `expected` position.

### Clock sync

Each peer runs `ServerClock`: `time:ping` with `t0`, server replies with `t1`, peer receives at `t2`:

```
rtt    = t2 − t0
offset = t1 − (t0 + rtt/2)
```

The sample with the lowest RTT out of the last 8 is kept (least asymmetric queueing error). A burst of 4 on connect, then every 5 s. On loopback the offset error is ~1 ms; on a Wi-Fi LAN typically 2-10 ms.

### Drift detection & correction (`SyncController.tick`, every 250 ms)

```
drift = player.currentTime − expected(serverNow)

playing:
  |drift| > 0.9 s   → hard seek to expected + 0.15 s lead   (cooldown 1.2 s)
  |drift| > 0.12 s  → playbackRate = rate ∓ 0.06 (soft nudge, inaudible)
  |drift| < 0.04 s  → restore rate                        (dead-band)
paused:
  |drift| > 0.25 s  → seek to position
```

Players that only support discrete rates (YouTube) declare `canNudge = false` and hard-seek above 0.36 s instead. A state that arrives from the server is applied immediately (seek if off by more than the soft threshold, then play/pause), so the loop only has to absorb slow drift (clock skew, decoder rate error, stalls).

### Echo suppression

The host's player raises `play/pause/seeked/ratechange` both for user actions and for the controller's own programmatic actions. After every programmatic action the controller ignores player events for 700 ms (`suppressUntil`). Host UI buttons never touch the player directly; they call `controller.command()` which sends a control and lets the echoed server state move the local player, so host and viewers share one code path.

### Concurrency

- Only the host (or everyone, if the host enables it) may send controls; checked server-side per message.
- Each control carries `baseVersion`. A play/pause based on a version older than `current − 1` is dropped if the room already matches its intent (the toggle lost a race); seeks and rate changes are explicit intent and always apply, bumping the version.
- Host transfer is a server-side atomic switch; the old host's late controls are rejected as `not-host`.
- The load test fires 10 seeks in a burst from a freshly promoted host while the previous host also seeks; all clients must end on one version with < 0.5 s spread.

### Late join, reconnect, host loss

- `room:join` returns a snapshot: timeline (with `serverNow`), members, last 200 chat messages, reactions, queue, polls, settings. The client applies the timeline as soon as its player has metadata; with a 4-sample clock burst this takes ~30-40 ms on loopback.
- Socket.IO reconnects (300 ms → 3 s backoff, 5 s ping interval / 8 s timeout). On `connect` the client re-emits `room:join`; the member record is kept for 30 s so presence and stats survive a blip, and a second tab for the same user supersedes the first.
- If the host is disconnected for 12 s, the longest-present connected member becomes host (`room:host` with `by: 'auto'`). Leaving explicitly transfers immediately.
- Empty rooms are kept 10 minutes, then deleted.

### Buffering

Players report `waiting`/`playing`. The viewer list shows who is buffering. With **Hold for buffering** on, the server pauses the room while anyone is buffering and resumes from the held position when everyone is ready.

## Socket protocol (summary)

client → server: `time:ping`, `room:join`, `room:leave`, `playback:control`, `playback:setMedia`, `playback:report`, `member:buffering`, `queue:add|remove|move|vote|play`, `chat:send`, `reaction:send`, `host:transfer`, `room:settings`, `poll:create|vote|close`, `typing`

server → client: `room:members`, `room:host`, `room:system`, `room:settings`, `room:closed`, `room:superseded`, `room:hold`, `room:stats` (1 Hz aggregate), `playback:state`, `media:change`, `queue:update`, `chat:message`, `reaction`, `poll:update`, `member:buffering`, `typing`, `notification`, `friends:changed`

## Companion mode

1. The website's room page posts `CV_SET_ROOM {token, serverUrl, roomId}` to `window`; the extension's bridge content script (matched to the CouchVerse origin) stores it in `chrome.storage.local`.
2. On an OTT site the companion content script reads the stored room, connects to the same Socket.IO server with the same token, joins the room and polls for a `<video>` (re-attaching when the site swaps the element between episodes).
3. The same `SyncController` drives that `<video>`. The host's native OTT controls become controls for the room; viewers' players follow.
4. The overlay is a Shadow-DOM host that is re-parented into `document.fullscreenElement` so it stays visible in fullscreen. Keyboard events are stopped inside it so OTT shortcuts don't fire while chatting.
5. Netflix ignores `currentTime` writes, so a page-world script (`page-netflix.js`) exposes `seek/play/pause` through Netflix's own player API via `postMessage`. Netflix also resets `playbackRate`, so the Netflix adapter declares `canNudge = false`.

## Security notes

- Sessions are JWTs (30 d). Google credentials are verified with `google-auth-library` against `GOOGLE_CLIENT_ID`.
- The media relay requires a valid token and only forwards `http(s)` URLs; it streams with Range pass-through and never buffers whole files.
- Avatars are size-limited data URLs or https URLs; usernames are `[a-z0-9_]{3,20}` and unique.
- Private rooms are unlisted; their 6-char code (from a 32-symbol alphabet, ~1e9 combinations) can be reinforced with a host passcode.
