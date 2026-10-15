import { useEffect, useState } from 'react';
import { fmtTime, getToken, SERVER_URL } from '../../lib/api.js';
import { platformById } from '@shared/constants.js';
import { External, Play, Pause, Tv, Check, Refresh, Back10, Fwd10 } from '../Icons.jsx';
import GetExtension from '../GetExtension.jsx';
import { useExtension } from '../../lib/useExtension.js';

/**
 * Stage for OTT rooms. The actual video plays inside the OTT site through the
 * CouchVerse browser extension; this page is the lobby / second screen that
 * hands the room to the extension and mirrors the shared timeline.
 */
export default function Companion({ room, media, playback, pos, host, isHost, actions, command, canControl, entered }) {
  const plat = platformById(room.platform);
  const { ext } = useExtension(); // null unknown, false missing, {version}
  const [title, setTitle] = useState(media?.title || '');
  const [sent, setSent] = useState(false);

  const payload = () => ({
    type: 'CV_SET_ROOM',
    token: getToken(),
    serverUrl: SERVER_URL || window.location.origin,
    roomId: room.id,
    roomCode: room.code,
    platform: room.platform,
    roomName: room.name,
  });

  useEffect(() => {
    const onMsg = (e) => {
      if (e.source === window && e.data?.type === 'CV_ROOM_ACK') setSent(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (ext && entered) window.postMessage(payload(), window.location.origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext, entered, room.id]);

  useEffect(() => setTitle(media?.title || ''), [media?.title]);

  const steps = [
    { done: !!ext, text: 'Install the CouchVerse extension', hint: ext ? `Version ${ext.version} detected.` : 'Use "Get the extension" above; it takes four quick steps.' },
    { done: !!ext && sent, text: 'Keep this tab open', hint: 'It tells the extension which room you are in.' },
    { done: false, text: `Open the title on ${plat?.name}`, hint: 'The overlay appears over the player with chat, reactions and people.' },
  ];

  return (
    <div className="companion-stage">
      <div className="card companion-card">
        <div className="eyebrow">Companion mode</div>
        <div className="plat" style={{ color: plat?.color }}>
          {plat?.name}
        </div>
        <p className="muted" style={{ marginTop: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {media ? (
            <>
              {playback?.playing ? <Play size={14} /> : <Pause size={14} />} <b style={{ color: 'var(--text)' }}>{media.title}</b> · {fmtTime(pos)}
            </>
          ) : (
            'Host has not announced a title yet'
          )}
        </p>

        <div className="row wrap" style={{ justifyContent: 'center', gap: 10, margin: '18px 0' }}>
          <a className={`btn btn-lg ${ext ? 'btn-primary' : ''}`} href={plat?.url} target="_blank" rel="noreferrer">
            <External size={16} /> Open {plat?.name}
          </a>
          {ext === false ? (
            <GetExtension size="btn-lg" />
          ) : (
            <span className="ext-status">
              <i className={`dot ${ext ? 'ok' : ''}`} />
              {ext ? `Extension v${ext.version}${sent ? ' · room linked' : ''}` : 'Looking for extension…'}
            </span>
          )}
        </div>

        <div className="steps">
          {steps.map((s, i) => (
            <div key={i} className={`step ${s.done ? 'done' : ''}`}>
              <span className="num">{s.done ? <Check size={14} /> : i + 1}</span>
              <div>
                <div className="t">{s.text}</div>
                <div className="hint">{s.hint}</div>
              </div>
            </div>
          ))}
          <div className="step">
            <span className="num">
              <Tv size={14} />
            </span>
            <div>
              <div className="t">{isHost ? 'You are host' : `${host?.displayName || 'The host'} drives playback`}</div>
              <div className="hint">{isHost ? 'Your play / pause / seek on the OTT player drives everyone.' : 'Your player follows within half a second.'}</div>
            </div>
          </div>
        </div>

        {isHost && (
          <form
            className="row"
            style={{ marginTop: 18 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) actions.setMedia({ kind: 'ott', platform: room.platform, title: title.trim(), url: null, duration: media?.duration || null }, false);
            }}
          >
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Title everyone should open on ${plat?.name}`} />
            <button className="btn">Announce</button>
          </form>
        )}

        <div className="row" style={{ justifyContent: 'center', marginTop: 16, gap: 8 }}>
          {ext && (
            <button className="btn btn-sm btn-ghost" onClick={() => window.postMessage(payload(), window.location.origin)}>
              <Refresh size={13} /> Re-send room to extension
            </button>
          )}
          {canControl && (
            <>
              <button className="btn btn-sm" onClick={() => command(playback?.playing ? 'pause' : 'play')}>
                {playback?.playing ? <Pause size={13} /> : <Play size={13} />} {playback?.playing ? 'Pause all' : 'Play all'}
              </button>
              <button className="btn btn-sm" onClick={() => command('seek', { position: Math.max(0, pos - 10) })} aria-label="Back 10 seconds">
                <Back10 size={15} />
              </button>
              <button className="btn btn-sm" onClick={() => command('seek', { position: pos + 10 })} aria-label="Forward 10 seconds">
                <Fwd10 size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
