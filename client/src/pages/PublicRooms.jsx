import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import Avatar from '../components/Avatar.jsx';
import { Search, Users, Play, Pause, Globe, ChevronRight, Tv, Film } from '../components/Icons.jsx';
import { api, fmtTime } from '../lib/api.js';
import { OTT_PLATFORMS, platformById } from '@shared/constants.js';

function RoomCard({ r, fetchedAt }) {
  // Progress advances locally between refreshes so the bar moves smoothly.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pos = r.playing ? r.position + (Date.now() - fetchedAt) / 1000 : r.position;
  const pct = r.duration ? Math.min(100, (pos / r.duration) * 100) : null;
  const plat = platformById(r.platform);
  return (
    <div className="card hover room-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="name">{r.name}</div>
        <span className={`badge ${r.type === 'ott' ? 'cyan' : 'accent'}`}>
          {r.type === 'ott' ? <Tv size={12} /> : <Film size={12} />} {r.type === 'ott' ? plat?.name || 'OTT' : 'Native'}
        </span>
      </div>
      <div className="row">
        <Avatar user={r.host} size={28} />
        <span className="hint">
          Host <b style={{ color: 'var(--text)' }}>{r.host?.displayName || '—'}</b> {r.host && <span>@{r.host.username}</span>}
        </span>
        <div className="grow" />
        <div className="stack">
          {r.members.slice(0, 5).map((m) => (
            <Avatar key={m.id} user={m} size={24} />
          ))}
        </div>
        <span className="badge">
          <Users size={12} /> {r.memberCount}
        </span>
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          {r.media ? (
            <>
              {r.playing ? <Play size={13} /> : <Pause size={13} />} {r.media.title}
            </>
          ) : (
            'Waiting for the host to pick something'
          )}
        </div>
        {r.media && (
          <>
            <div className="hint" style={{ margin: '4px 0 6px' }}>
              {fmtTime(pos)}
              {r.duration ? ` / ${fmtTime(r.duration)} · ${Math.round(pct)}% done` : ' elapsed'}
            </div>
            {pct !== null && (
              <div className="progress">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
          </>
        )}
      </div>
      {r.queue.length > 0 && (
        <div className="queue-preview">
          <b style={{ color: 'var(--text)' }}>Up next ({r.queueLength})</b>
          {r.queue.map((q, i) => (
            <span key={q.id}>
              {i + 1}. {q.title}
            </span>
          ))}
        </div>
      )}
      <Link to={`/r/${r.code}`} className="btn btn-primary" style={{ justifyContent: 'center' }}>
        Join room <ChevronRight size={16} />
      </Link>
    </div>
  );
}

export default function PublicRooms() {
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('');
  const [rooms, setRooms] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get(`/api/rooms/public?q=${encodeURIComponent(q)}&platform=${encodeURIComponent(platform)}`)
        .then((r) => {
          if (!alive) return;
          setRooms(r.rooms);
          setFetchedAt(Date.now());
        })
        .catch(() => alive && setRooms([]));
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 150);
    const iv = setInterval(load, 4000);
    return () => {
      alive = false;
      clearTimeout(timer.current);
      clearInterval(iv);
    };
  }, [q, platform]);

  return (
    <>
      <Header />
      <main className="page">
        <div className="eyebrow">Live rooms</div>
        <h1>Public rooms</h1>
        <p className="page-sub">
          Search by title or room name, <span className="kbd">@username</span> for someone in a room, or <span className="kbd">host:name</span> for the creator.
        </p>

        <div className="filter-box">
          <div className="input-icon">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rooms, titles, @people, host:…" />
          </div>
          <div className="filter-group">
            <span className="filter-label">Player</span>
            <div className="chips">
              <button className={`chip ${!platform ? 'active' : ''}`} onClick={() => setPlatform('')}>
                All
              </button>
              <button className={`chip ${platform === 'native' ? 'active' : ''}`} onClick={() => setPlatform('native')}>
                Native player
              </button>
              <button className={`chip ${platform === 'ott' ? 'active' : ''}`} onClick={() => setPlatform('ott')}>
                Any OTT
              </button>
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">Platform</span>
            <div className="chips">
              {OTT_PLATFORMS.map((p) => (
                <button key={p.id} className={`chip ${platform === p.id ? 'active' : ''}`} onClick={() => setPlatform(platform === p.id ? '' : p.id)} style={platform === p.id ? { borderColor: p.color } : undefined}>
                  <i style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: p.color, marginRight: 7, verticalAlign: 'middle' }} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {rooms === null && (
          <div className="rooms-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 220 }} />
            ))}
          </div>
        )}
        {rooms?.length === 0 && (
          <div className="card empty">
            <Globe size={32} />
            <div>No public rooms match.</div>
            <div className="hint">Start one from the home page and it will appear here.</div>
          </div>
        )}
        <div className="rooms-grid">
          {rooms?.map((r) => (
            <RoomCard key={r.id} r={r} fetchedAt={fetchedAt} />
          ))}
        </div>
      </main>
    </>
  );
}
