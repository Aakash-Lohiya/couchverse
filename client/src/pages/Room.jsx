import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useRoom } from '../lib/useRoom.js';
import { createHtml5Adapter, createYouTubeAdapter } from '../lib/players.js';
import { fmtTime, parseMediaUrl } from '../lib/api.js';
import { ServerClock, SyncController, expectedPosition } from '@shared/sync-engine.js';
import { QUICK_EMOJIS, EMOJI_GRID, SAMPLE_MEDIA, platformById } from '@shared/constants.js';
import Avatar from '../components/Avatar.jsx';
import Modal from '../components/Modal.jsx';
import SidePanel from '../components/room/SidePanel.jsx';
import Companion from '../components/room/Companion.jsx';
import ExtensionGate from '../components/ExtensionGate.jsx';
import { useExtension } from '../lib/useExtension.js';
import { ArrowLeft, Copy, Users, Queue, Poll, Chat, Sliders, Play, Pause, Back10, Fwd10, Volume, VolumeOff, Refresh, Plus, X, Maximize, Minimize, Crown, Popcorn, Tv, Lock, Smile } from '../components/Icons.jsx';

const IDLE_MS = 3000;

export default function Room() {
  const { code } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { user, settings: prefs, toast } = useAuth();
  const passcode = loc.state?.passcode || new URLSearchParams(loc.search).get('pass') || '';

  const handlersRef = useRef({});
  const r = useRoom({ code, passcode, handlersRef });
  const isHost = r.hostId === user.id;
  const isNative = r.room?.type === 'native';

  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const ytRef = useRef(null);
  const adapterRef = useRef(null);
  const ctrlRef = useRef(null);
  const clockRef = useRef(null);
  const statsRef = useRef(null);
  const playbackRef = useRef(null);
  const isHostRef = useRef(false);
  const queueRef = useRef([]);
  const prefsRef = useRef(prefs);
  const friendsRef = useRef(new Set());
  const panelRef = useRef(null);
  const idleTimer = useRef(null);

  const [entered, setEntered] = useState(false);
  const [panel, setPanel] = useState(null);
  const [idle, setIdle] = useState(false);
  const [emojiGrid, setEmojiGrid] = useState(false);
  const [floaters, setFloaters] = useState([]);
  const [popups, setPopups] = useState([]);
  const [stats, setStats] = useState(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [addMedia, setAddMedia] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFs, setIsFs] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [buffering, setBuffering] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const { ext, recheck: recheckExt } = useExtension();

  /** The host always gets a choice: hand over (or keep the room open) or end it. */
  const leave = () => {
    if (isHost) setLeaveModal(true);
    else nav('/');
  };
  const endRoom = async () => {
    await r.actions.endRoom().catch(() => {});
    nav('/');
  };

  isHostRef.current = isHost;
  playbackRef.current = r.playback;
  queueRef.current = r.queue;
  prefsRef.current = prefs;
  friendsRef.current = r.friends;
  panelRef.current = panel;

  // ---------- server clock ----------
  useEffect(() => {
    const clock = new ServerClock((t0) => r.actions.timePing(t0));
    clockRef.current = clock;
    clock.start(5000, 4);
    return () => clock.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---------- realtime handlers ----------
  const addFloater = useCallback((rx) => {
    const id = rx.id || Math.random().toString(36);
    const f = { id, emoji: rx.emoji, name: rx.user?.displayName, x: 8 + Math.random() * 84, dx: Math.round((Math.random() - 0.5) * 120) };
    setFloaters((fs) => [...fs.slice(-40), f]);
    setTimeout(() => setFloaters((fs) => fs.filter((x) => x.id !== id)), 3300);
  }, []);

  const addPopup = useCallback((m) => {
    setPopups((ps) => [...ps.slice(-4), m]);
    setTimeout(() => setPopups((ps) => ps.filter((x) => x.id !== m.id)), 6000);
  }, []);

  handlersRef.current = {
    onPlaybackState: (st) => {
      ctrlRef.current?.applyState(st);
    },
    onReaction: (rx) => {
      const mine = rx.user?.id === user.id;
      const mode = prefsRef.current.emojiPopup;
      if (!mine && (mode === 'none' || (mode === 'friends' && !friendsRef.current.has(rx.user?.id)))) return;
      addFloater(rx);
    },
    onChat: (m) => {
      if (m.user?.id === user.id || panelRef.current === 'chat') return;
      setUnreadChat((n) => n + 1);
      const mode = prefsRef.current.chatPopup;
      const ok =
        mode === 'everyone' ||
        (mode === 'friends' && friendsRef.current.has(m.user?.id)) ||
        (mode === 'mentions' && (m.mentions || []).includes(user.username));
      if (ok) addPopup(m);
    },
  };

  // ---------- player lifecycle ----------
  useEffect(() => {
    if (!entered || !isNative || !r.media) return;
    let cancelled = false;
    let statsTimer;
    (async () => {
      let adapter;
      try {
        adapter =
          r.media.kind === 'youtube'
            ? await createYouTubeAdapter(ytRef.current, r.media.videoId || parseMediaUrl(r.media.url)?.videoId)
            : await createHtml5Adapter(videoRef.current, r.media.url);
      } catch (e) {
        toast(`Could not load media: ${e.message}`, 'error');
        return;
      }
      if (cancelled) return adapter.destroy();
      adapterRef.current = adapter;
      adapter.setMuted?.(muted);
      adapter.setVolume?.(volume);

      const ctrl = new SyncController({
        player: adapter,
        clock: clockRef.current,
        isHost: () => isHostRef.current,
        sendControl: (c) => r.actions.control(c),
        onCorrection: (e) => {
          if (e.type === 'autoplay-blocked') setNeedsGesture(true);
        },
        onStats: (s) => {
          statsRef.current = s;
        },
      });
      ctrlRef.current = ctrl;
      if (playbackRef.current) ctrl.applyState({ ...playbackRef.current, replay: true });

      adapter.on('waiting', () => {
        setBuffering(true);
        r.actions.setBuffering(true);
      });
      adapter.on('playing', () => {
        setBuffering(false);
        r.actions.setBuffering(false);
      });
      const clearBuffering = () => {
        setBuffering(false);
        r.actions.setBuffering(false);
      };
      adapter.on('pause', clearBuffering);
      adapter.on('ended', () => {
        clearBuffering();
        if (isHostRef.current && queueRef.current.length) r.actions.queuePlay(queueRef.current[0].id);
      });
      adapter.on('error', () => toast('The player could not load this media, even via the relay', 'error'));
      adapter.on('relay', () => toast('Source blocked by the browser; relaying it through CouchVerse'));

      await adapter.ready;
      if (cancelled) return;
      setDuration(adapter.getDuration());
      ctrl.markReady();
      ctrl.start();

      statsTimer = setInterval(() => {
        if (statsRef.current) {
          setStats(statsRef.current);
          r.actions.report(statsRef.current);
        }
      }, 1000);
    })();
    return () => {
      cancelled = true;
      clearInterval(statsTimer);
      ctrlRef.current?.destroy();
      ctrlRef.current = null;
      adapterRef.current?.destroy();
      adapterRef.current = null;
      setStats(null);
      setNeedsGesture(false);
      setBuffering(false);
      r.actions.setBuffering(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, isNative, r.media?.id]);

  // Position ticker for the UI (works with or without a local player).
  useEffect(() => {
    const t = setInterval(() => {
      const a = adapterRef.current;
      if (a) {
        setPos(a.getTime());
        const d = a.getDuration();
        if (Number.isFinite(d) && d > 0) setDuration(d);
      } else if (playbackRef.current && clockRef.current) {
        setPos(expectedPosition(playbackRef.current, clockRef.current.serverNow()));
        setDuration(r.media?.duration || 0);
      }
    }, 250);
    return () => clearInterval(t);
  }, [r.media?.duration]);

  // ---------- idle hide ----------
  const poke = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (playbackRef.current?.playing && !panelRef.current) setIdle(true);
    }, IDLE_MS);
  }, []);
  useEffect(() => {
    poke();
    return () => clearTimeout(idleTimer.current);
  }, [poke, panel]);

  // ---------- fullscreen ----------
  useEffect(() => {
    const f = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  const enter = () => {
    setEntered(true);
    if (prefs.autoFullscreen && isNative) rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  // ---------- commands ----------
  const serverNow = () => clockRef.current?.serverNow() || Date.now();
  const command = useCallback(
    (action, extra = {}) => {
      if (!isHostRef.current && !r.settings.allowGuestControl) return;
      if (ctrlRef.current) return ctrlRef.current.command(action, extra);
      const pb = playbackRef.current;
      if (!pb) return;
      r.actions.control({
        action,
        position: extra.position ?? expectedPosition(pb, serverNow()),
        rate: extra.rate ?? pb.rate ?? 1,
        baseVersion: pb.version,
        originTs: serverNow(),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r.settings.allowGuestControl],
  );
  const canControl = isHost || r.settings.allowGuestControl;
  const togglePlay = () => command(playbackRef.current?.playing ? 'pause' : 'play', { position: currentPos() });
  const seekTo = (p) => command('seek', { position: Math.max(0, Math.min(duration || Infinity, p)) });
  const currentPos = () => (adapterRef.current ? adapterRef.current.getTime() : playbackRef.current ? expectedPosition(playbackRef.current, serverNow()) : 0);

  const sendReaction = (emoji) => {
    r.actions.react(emoji, currentPos());
    setEmojiGrid(false);
  };

  const openPanel = (p) => {
    setPanel((cur) => (cur === p ? null : p));
    if (p === 'chat') setUnreadChat(0);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          seekTo(currentPos() - 10);
          break;
        case 'ArrowRight':
          seekTo(currentPos() + 10);
          break;
        case 'c':
          openPanel('chat');
          break;
        case 'p':
          openPanel('people');
          break;
        case 'q':
          openPanel('queue');
          break;
        case 'f':
          toggleFs();
          break;
        case 'e':
          setEmojiGrid((g) => !g);
          break;
        case 'm':
          setMuted((m) => {
            adapterRef.current?.setMuted?.(!m);
            return !m;
          });
          break;
        case 'Escape':
          setEmojiGrid(false);
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.playback?.playing, duration, pos]);

  // ---------- heatmap ----------
  const heat = useMemo(() => {
    if (!duration || !r.media) return null;
    const buckets = new Array(60).fill(0);
    const top = new Array(60).fill(null);
    const counts = Array.from({ length: 60 }, () => ({}));
    for (const rx of r.reactions) {
      if (rx.mediaPos == null || (rx.mediaId && rx.mediaId !== r.media.id)) continue;
      const i = Math.min(59, Math.floor((rx.mediaPos / duration) * 60));
      buckets[i]++;
      counts[i][rx.emoji] = (counts[i][rx.emoji] || 0) + 1;
      top[i] = Object.entries(counts[i]).sort((a, b) => b[1] - a[1])[0][0];
    }
    const max = Math.max(1, ...buckets);
    return buckets.map((b, i) => ({ h: b / max, e: top[i], n: b }));
  }, [r.reactions, duration, r.media]);

  // ---------- render states ----------
  if (r.status === 'needsPasscode') {
    return (
      <div className="login-wrap">
        <form
          className="card login-card"
          onSubmit={(e) => {
            e.preventDefault();
            nav(`/r/${code}`, { replace: true, state: { passcode: passInput } });
          }}
        >
          <h2>This room needs a passcode</h2>
          <input className="input" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="Passcode from the host" />
          {r.error && passcode && <div className="error" style={{ marginTop: 8 }}>{r.error}</div>}
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={() => nav('/')}>
              Back
            </button>
            <button className="btn btn-primary">Join</button>
          </div>
        </form>
      </div>
    );
  }
  if (r.status === 'error' || r.status === 'closed' || r.status === 'superseded') {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h2>{r.status === 'closed' ? (r.error === 'ended' ? 'The host ended the room' : 'Room closed') : r.status === 'superseded' ? 'Opened elsewhere' : 'Could not join'}</h2>
          <p className="muted">
            {r.status === 'superseded'
              ? 'You joined this room from another tab or device, so this one was disconnected.'
              : r.status === 'closed'
                ? r.error === 'ended'
                  ? 'Thanks for watching. Start a new room any time.'
                  : 'This room was closed after being idle.'
                : r.error}
          </p>
          <button className="btn btn-primary" onClick={() => nav('/')}>
            Back home
          </button>
        </div>
      </div>
    );
  }
  if (r.status !== 'joined' || !r.room) {
    return <div className="login-wrap muted">Joining room {code}…</div>;
  }

  const host = r.members.find((m) => m.id === r.hostId);
  const plat = platformById(r.room.platform);
  const pct = duration ? Math.min(100, (pos / duration) * 100) : 0;

  return (
    <div ref={rootRef} className={`room ${idle ? 'idle' : ''} ${panel ? 'panel-open' : ''}`} onMouseMove={poke} onClick={poke}>
      {/* ---------- stage ---------- */}
      {isNative ? (
        <div className="stage" onDoubleClick={toggleFs}>
          {r.media ? (
            r.media.kind === 'youtube' ? (
              <div className="yt" key={r.media.id} style={{ position: 'relative' }}>
                <div ref={ytRef} style={{ width: '100%', height: '100%' }} />
                <div className="yt-shield" onClick={canControl ? togglePlay : undefined} />
              </div>
            ) : (
              <video key={r.media.id} ref={videoRef} playsInline preload="auto" onClick={canControl ? togglePlay : undefined} />
            )
          ) : (
            <div className="card" style={{ textAlign: 'center', maxWidth: 460 }}>
              <h2>Nothing playing yet</h2>
              <p className="muted">{isHost ? 'Add a video URL, a YouTube link or pick a sample to start the party.' : `Waiting for ${host?.displayName || 'the host'} to pick something.`}</p>
              {isHost && (
                <button className="btn btn-primary" onClick={() => setAddMedia(true)}>
                  <Plus size={16} /> Add media
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <Companion room={r.room} media={r.media} playback={r.playback} pos={pos} host={host} isHost={isHost} actions={r.actions} command={command} canControl={canControl} entered={entered} />
      )}

      {/* ---------- companion rooms need the extension before the lobby opens ---------- */}
      {!entered && !isNative && ext === false && (
        <div className="splash">
          <ExtensionGate platformName={plat?.name} onRecheck={recheckExt} onBack={() => nav('/')} />
        </div>
      )}

      {/* ---------- splash: gesture gate for autoplay + fullscreen ---------- */}
      {!entered && (isNative || ext) && (
        <div className="splash">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{r.room.name}</h2>
            <p className="muted">
              {isNative ? 'Native player' : `${plat?.name} companion`} · hosted by {host?.displayName || '…'} · {r.members.filter((m) => m.connected).length} here
            </p>
            {r.media && <p>{r.playback?.playing ? '▶ Now playing' : '⏸ Paused at'} <b>{r.media.title}</b> · {fmtTime(pos)}</p>}
            <button className="btn btn-primary btn-lg" onClick={enter} autoFocus>
              {isNative ? <Popcorn size={18} /> : <Tv size={18} />}
              {isNative ? 'Enter the room' : 'Open companion lobby'}
            </button>
            <div className="hint" style={{ marginTop: 10 }}>
              {isNative && prefs.autoFullscreen ? 'Opens fullscreen. ' : ''}Press <span className="kbd">c</span> for chat, <span className="kbd">e</span> for emojis, <span className="kbd">f</span> for fullscreen.
            </div>
          </div>
        </div>
      )}
      {entered && needsGesture && (
        <div className="splash" onClick={() => { setNeedsGesture(false); ctrlRef.current?.resumeAfterGesture(); }}>
          <div className="card">
            <h2>Tap to join playback</h2>
            <p className="muted">Your browser blocked autoplay. One tap and you'll jump to where everyone is.</p>
          </div>
        </div>
      )}

      {/* ---------- overlay ---------- */}
      <div className="overlay">
        <div className="topbar">
          <button className="btn btn-ghost btn-sm" onClick={leave} title="Leave room">
            <ArrowLeft size={16} /> Leave
          </button>
          <div className="room-title">
            <span className="name">{r.room.name}</span>
            <span className="room-code" title="Copy invite link" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/r/${r.room.code}${passcode ? `?pass=${encodeURIComponent(passcode)}` : ''}`); toast('Invite link copied'); }}>
              {r.room.code} <Copy size={12} />
            </span>
            {r.room.visibility === 'private' && (
              <span className="badge">
                <Lock size={11} /> private
              </span>
            )}
            {!isNative && <span className="badge cyan">{plat?.name}</span>}
          </div>
          {r.media && <span className="muted media-title" style={{ fontSize: 13 }}>· {r.media.title}</span>}
          <div className="grow" />
          {!r.connected && <span className="badge danger">reconnecting…</span>}
          {r.held && <span className="badge warn">⏳ holding for buffering</span>}
          {buffering && <span className="badge">buffering…</span>}
          {stats && (
            <span className={`badge ${Math.abs(stats.drift) < 0.25 ? 'ok' : Math.abs(stats.drift) < 0.5 ? 'warn' : 'danger'}`} title="Drift vs room timeline">
              drift {Math.round(stats.drift * 1000)}ms · ping {Math.round(stats.rtt)}ms
            </span>
          )}
          <div className="stack" style={{ marginLeft: 6 }}>
            {r.members.filter((m) => m.connected).slice(0, 6).map((m) => (
              <Avatar key={m.id} user={m} size={28} ring={m.id === r.hostId} />
            ))}
          </div>
          <button className={`btn btn-icon ${panel === 'people' ? 'active' : ''}`} onClick={() => openPanel('people')} title="People (p)" aria-label="People">
            <Users size={18} />
          </button>
          <button className={`btn btn-icon ${panel === 'queue' ? 'active' : ''}`} onClick={() => openPanel('queue')} title="Playlist (q)" aria-label="Playlist">
            <Queue size={18} />
          </button>
          <button className={`btn btn-icon ${panel === 'polls' ? 'active' : ''}`} onClick={() => openPanel('polls')} title="Polls" aria-label="Polls">
            <Poll size={18} />
          </button>
          <button className={`btn btn-icon ${panel === 'chat' ? 'active' : ''}`} onClick={() => openPanel('chat')} title="Chat (c)" aria-label="Chat">
            <Chat size={18} />
            {unreadChat > 0 && panel !== 'chat' && <span className="notif-dot">{unreadChat > 9 ? '9+' : unreadChat}</span>}
          </button>
          <button className={`btn btn-icon ${panel === 'settings' ? 'active' : ''}`} onClick={() => openPanel('settings')} title="Settings" aria-label="Settings">
            <Sliders size={18} />
          </button>
        </div>

        {/* floating reactions */}
        <div className="floaters">
          {floaters.map((f) => (
            <div key={f.id} className="floater" style={{ left: `${f.x}%`, '--dx': `${f.dx}px` }}>
              <span className="e">{f.emoji}</span>
              {f.name && <span className="n">{f.name}</span>}
            </div>
          ))}
        </div>

        {/* chat popups when panel closed */}
        {panel !== 'chat' && popups.length > 0 && (
          <div className="chat-popups">
            {popups.map((m) => (
              <div key={m.id} className="chat-popup">
                <Avatar user={m.user} size={24} />
                <span>
                  <b>{m.user.displayName}</b> {m.spoiler ? <i className="muted">(spoiler hidden)</i> : m.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* emoji bar */}
        {entered && (
          <div className="emoji-bar">
            {QUICK_EMOJIS.map((e) => (
              <button key={e} onClick={() => sendReaction(e)} title={`React ${e}`}>
                {e}
              </button>
            ))}
            <span className="sep" />
            <button onClick={() => setEmojiGrid((g) => !g)} title="More emojis (e)" aria-label="More emojis">
              {emojiGrid ? <X size={18} /> : <Smile size={20} />}
            </button>
          </div>
        )}
        {emojiGrid && (
          <div className="emoji-grid">
            {EMOJI_GRID.map((e) => (
              <button key={e} onClick={() => sendReaction(e)}>
                {e}
              </button>
            ))}
          </div>
        )}

        {/* bottom controls */}
        {entered && (isNative ? r.media : true) && (
          <div className="bottombar" style={{ right: panel ? 360 : 0 }}>
            <div
              className={`seekbar ${canControl ? '' : 'locked'}`}
              onClick={(e) => {
                if (!canControl || !duration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                seekTo(((e.clientX - rect.left) / rect.width) * duration);
              }}
              title={canControl ? 'Seek' : 'Only the host can seek'}
            >
              {heat && (
                <div className="heat">
                  {heat.map((h, i) => (
                    <i key={i} style={{ height: `${Math.max(0, h.h * 100)}%`, opacity: h.n ? 0.9 : 0 }} data-e={h.e || ''} className={h.h > 0.6 ? 'top' : ''} />
                  ))}
                </div>
              )}
              <div className="track">
                <div className="fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="knob" style={{ left: `${pct}%` }} />
            </div>
            <div className="controls">
              <button className="ctl big" onClick={togglePlay} disabled={!canControl || !r.media} title={canControl ? 'Play/Pause (space)' : 'Host controls playback'} aria-label="Play or pause">
                {r.playback?.playing ? <Pause /> : <Play style={{ marginLeft: 3 }} />}
              </button>
              <button className="ctl" onClick={() => seekTo(currentPos() - 10)} disabled={!canControl || !r.media} title="Back 10s (←)" aria-label="Back 10 seconds">
                <Back10 />
              </button>
              <button className="ctl" onClick={() => seekTo(currentPos() + 10)} disabled={!canControl || !r.media} title="Forward 10s (→)" aria-label="Forward 10 seconds">
                <Fwd10 />
              </button>
              <span className="time">
                {fmtTime(pos)} / {fmtTime(duration)}
              </span>
              {isNative && (
                <>
                  <button
                    className="ctl"
                    onClick={() => {
                      adapterRef.current?.setMuted?.(!muted);
                      setMuted(!muted);
                    }}
                    title="Mute (m)"
                    aria-label="Mute"
                  >
                    {muted || volume === 0 ? <VolumeOff /> : <Volume />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      setMuted(false);
                      adapterRef.current?.setVolume?.(v);
                      adapterRef.current?.setMuted?.(false);
                    }}
                    style={{ width: 90 }}
                    title="Volume (local)"
                  />
                </>
              )}
              {canControl && isNative && (
                <select className="input" style={{ width: 84, padding: '6px 8px' }} value={r.playback?.rate || 1} onChange={(e) => command('rate', { rate: Number(e.target.value), position: currentPos() })} title="Playback speed (everyone)">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((x) => (
                    <option key={x} value={x}>
                      {x}×
                    </option>
                  ))}
                </select>
              )}
              <div className="grow" />
              {!canControl && (
                <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Crown size={13} style={{ color: 'var(--warn)' }} /> {host?.displayName || 'Host'} controls playback
                </span>
              )}
              <button className="btn btn-sm" onClick={() => { ctrlRef.current?.resync(); toast('Resynced to the room'); }} title="Snap back to the room timeline">
                <Refresh size={14} /> Resync
              </button>
              {isHost && isNative && (
                <button className="btn btn-sm" onClick={() => setAddMedia(true)}>
                  <Plus size={14} /> Media
                </button>
              )}
              {isNative && (
                <button className="ctl" onClick={toggleFs} title="Fullscreen (f)" aria-label="Toggle fullscreen">
                  {isFs ? <Minimize /> : <Maximize />}
                </button>
              )}
            </div>
          </div>
        )}

        <SidePanel
          tab={panel}
          onTab={openPanel}
          onClose={() => setPanel(null)}
          r={r}
          me={user}
          isHost={isHost}
          stats={stats}
          currentPos={currentPos}
          onResync={() => ctrlRef.current?.resync()}
          onLeave={leave}
        />
      </div>

      {leaveModal && (
        <Modal onClose={() => setLeaveModal(false)}>
          <h2>You're the host</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {(() => {
              const n = r.members.filter((m) => m.connected && m.id !== user.id).length;
              return n === 0 ? 'Nobody else is in the room right now.' : `${n} other ${n === 1 ? 'person is' : 'people are'} still watching.`;
            })()}
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="btn btn-lg" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => nav('/')}>
              <ArrowLeft size={18} />
              <span>
                <b>Just leave</b>
                <div className="hint">
                  {r.members.filter((m) => m.connected && m.id !== user.id).length
                    ? 'The person who joined after you becomes host. If you come back, you get the role again.'
                    : 'The room stays open for 10 minutes so people can still join with the code.'}
                </div>
              </span>
            </button>
            <button className="btn btn-lg btn-danger" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={endRoom}>
              <X size={18} />
              <span>
                <b>End the room for everyone</b>
                <div className="hint" style={{ color: 'inherit', opacity: 0.8 }}>Playback stops and everyone is sent back home.</div>
              </span>
            </button>
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setLeaveModal(false)}>
              Stay
            </button>
          </div>
        </Modal>
      )}

      {addMedia && <AddMediaModal onClose={() => setAddMedia(false)} onSubmit={async (m, { queue }) => { if (queue) await r.actions.queueAdd(m); else await r.actions.setMedia(m, true); setAddMedia(false); }} />}
    </div>
  );
}

function AddMediaModal({ onClose, onSubmit }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const go = (queue) => {
    const parsed = parseMediaUrl(url);
    if (!parsed) return setErr('Enter an http(s) link to an mp4/webm/m3u8 file or a YouTube video');
    const sample = SAMPLE_MEDIA.find((s) => s.url === parsed.url);
    onSubmit({ ...parsed, title: title || sample?.title || (parsed.kind === 'youtube' ? `YouTube ${parsed.videoId}` : parsed.url.split('/').pop()), duration: sample?.duration || null }, { queue });
  };
  return (
    <Modal onClose={onClose}>
      <h2>Add media</h2>
      <div style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          Video URL or YouTube link
          <input className="input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </label>
        <div className="chips">
          {SAMPLE_MEDIA.map((s) => (
            <button key={s.url} className={`chip ${url === s.url ? 'active' : ''}`} onClick={() => { setUrl(s.url); setTitle(s.title); }}>
              {s.title}
            </button>
          ))}
        </div>
        <label className="field">
          Title
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shown to everyone" />
        </label>
        {err && <div className="error">{err}</div>}
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={() => go(true)}>
          Add to queue
        </button>
        <button className="btn btn-primary" onClick={() => go(false)}>
          Play now
        </button>
      </div>
    </Modal>
  );
}
