import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import Catalog from '../components/Catalog.jsx';
import CreateRoomModal from '../components/CreateRoomModal.jsx';
import Modal from '../components/Modal.jsx';
import Avatar from '../components/Avatar.jsx';
import { Film, Key, Play, Pause, Users, ChevronRight, Globe } from '../components/Icons.jsx';
import { api, fmtTime } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { platformById, platformByName } from '@shared/constants.js';

function JoinPrivateModal({ onClose }) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [passcode, setPasscode] = useState('');
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setInfo(null);
    setErr('');
    if (code.length < 6) return;
    api.get(`/api/rooms/code/${code}`).then((r) => setInfo(r.room)).catch((e) => setErr(e.message));
  }, [code]);

  const go = (e) => {
    e.preventDefault();
    if (!info) return;
    nav(`/r/${info.code}`, { state: { passcode } });
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={go} style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Join with a code</h2>
        <label className="field">
          Room code
          <input className="input mono" style={{ letterSpacing: '0.25em', textTransform: 'uppercase', fontSize: 22, textAlign: 'center' }} autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABC123" />
        </label>
        {info && (
          <div className="live-room">
            <div className="grow">
              <div className="title">{info.name}</div>
              <div className="sub">
                {info.type === 'ott' ? `${platformById(info.platform)?.name} companion` : 'Native player'} · {info.memberCount} watching
                {info.media ? ` · ${info.media.title}` : ''}
              </div>
            </div>
          </div>
        )}
        {info?.hasPasscode && (
          <label className="field">
            Passcode
            <input className="input" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Ask the host" />
          </label>
        )}
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!info}>
            Join room <ChevronRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LiveNow() {
  const [rooms, setRooms] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get('/api/rooms/public')
        .then((r) => {
          if (!alive) return;
          setRooms(r.rooms.slice(0, 6));
          setFetchedAt(Date.now());
        })
        .catch(() => alive && setRooms([]));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <div className="card live-card reveal reveal-d1">
      <div className="live-head">
        <h3>
          <span className="live-pulse" /> Live now
        </h3>
        <Link to="/rooms" className="btn btn-sm btn-ghost">
          Browse all <ChevronRight size={14} />
        </Link>
      </div>
      <div className="live-rooms">
        {rooms === null && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}
        {rooms?.length === 0 && (
          <div className="empty" style={{ flex: 1 }}>
            <Globe size={30} />
            <div>No public rooms right now.</div>
            <div className="hint">Start one and it shows up here for everyone.</div>
          </div>
        )}
        {rooms?.map((r) => {
          const pos = r.playing ? r.position + (Date.now() - fetchedAt) / 1000 : r.position;
          const pct = r.duration ? Math.min(100, (pos / r.duration) * 100) : null;
          return (
            <Link key={r.id} to={`/r/${r.code}`} className="live-room">
              <Avatar user={r.host} size={36} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="title">{r.name}</div>
                  <span className={`badge ${r.type === 'ott' ? 'cyan' : 'accent'}`}>{r.type === 'ott' ? platformById(r.platform)?.name : 'Native'}</span>
                </div>
                <div className="sub">
                  {r.media ? (
                    <>
                      {r.playing ? <Play size={11} /> : <Pause size={11} />} {r.media.title}
                      {r.duration ? ` · ${fmtTime(pos)} / ${fmtTime(r.duration)}` : ''}
                    </>
                  ) : (
                    'Nothing playing yet'
                  )}
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Users size={12} /> {r.memberCount}
                  </span>
                </div>
                {pct !== null && (
                  <div className="mini-progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [modal, setModal] = useState(null); // 'create' | 'join' | {preset}

  const watchTogether = (item) => {
    const plat = platformByName(item.platform);
    setModal({ preset: { type: 'ott', platform: plat?.id || 'netflix', title: item.title, duration: item.runtime ? item.runtime * 60 : null } });
  };

  return (
    <>
      <Header />
      <main className="page">
        <div className="hero">
          <div className="card hero-card reveal">
            <div className="eyebrow">Watch together</div>
            <h1>
              Hey {user.displayName.split(' ')[0]}, <span className="accent-text">movie night?</span>
            </h1>
            <p className="lead">Start a room, drop a link or pick an OTT title, and everyone watches in lock-step. Chat, react and vote without ever asking "where are you at?"</p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => setModal('create')}>
                <Film size={18} /> Create a room
              </button>
              <button className="btn" onClick={() => setModal('join')}>
                <Key size={18} /> Join with a code
              </button>
            </div>
            <div className="hero-stats">
              <div className="hero-stat">
                <b>≤ 250 ms</b>
                <span>control propagation</span>
              </div>
              <div className="hero-stat">
                <b>≤ 500 ms</b>
                <span>drift after correction</span>
              </div>
              <div className="hero-stat">
                <b>8 platforms</b>
                <span>companion mode</span>
              </div>
            </div>
          </div>
          <LiveNow />
        </div>

        <Catalog onWatch={watchTogether} />
      </main>

      {modal === 'create' && <CreateRoomModal onClose={() => setModal(null)} />}
      {modal === 'join' && <JoinPrivateModal onClose={() => setModal(null)} />}
      {modal?.preset && <CreateRoomModal preset={modal.preset} onClose={() => setModal(null)} />}
    </>
  );
}
