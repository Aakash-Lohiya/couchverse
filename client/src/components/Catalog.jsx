import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { platformByName } from '@shared/constants.js';
import { Search, Sparkles, X, Play, ChevronRight } from './Icons.jsx';

const genreHue = {
  Action: ['#ef4444', '#7c2d12'], Drama: ['#8b5cf6', '#312e81'], Comedy: ['#f59e0b', '#78350f'], Thriller: ['#0ea5e9', '#0c4a6e'],
  'Sci-Fi': ['#22d3ee', '#164e63'], Romance: ['#f472b6', '#831843'], Horror: ['#64748b', '#0f172a'], Crime: ['#a3e635', '#365314'],
  Animation: ['#fb923c', '#7c2d12'], Documentary: ['#34d399', '#064e3b'], Fantasy: ['#c084fc', '#4c1d95'],
};
const posterStyle = (item) => {
  const [a, b] = genreHue[item.genres[0]] || ['#8b5cf6', '#1e1b4b'];
  const seed = [...item.id].reduce((x, c) => x + c.charCodeAt(0), 0) % 360;
  return { background: `linear-gradient(${135 + (seed % 90)}deg, ${a} 0%, ${b} 100%)` };
};

export function MovieCard({ item, rank, onWatch, compact = false }) {
  const plat = platformByName(item.platform);
  return (
    <div className="movie">
      <div className="poster" style={posterStyle(item)} data-letter={item.title[0]}>
        {rank && <span className="rank">#{rank}</span>}
        <span className="rating">★ {item.rating.toFixed(1)}</span>
        <span className="ptitle">{item.title}</span>
      </div>
      <div className="meta">
        <span>
          {item.year} · {item.type === 'series' ? 'Series' : 'Movie'} · {item.language}
        </span>
        {!compact && <span className="syn">{item.synopsis}</span>}
        <span className="platform">
          <i style={{ background: plat?.color || '#999', color: plat?.color || '#999' }} /> {item.platform}
        </span>
      </div>
      <div className="act">
        <button className="btn btn-sm btn-primary grow" onClick={() => onWatch?.(item)}>
          <Play size={14} /> Watch together
        </button>
      </div>
    </div>
  );
}

function SkeletonBoards() {
  return (
    <div className="accordion">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skeleton" style={{ height: 58 }} />
      ))}
    </div>
  );
}

export default function Catalog({ onWatch }) {
  const [meta, setMeta] = useState(null);
  const [boards, setBoards] = useState(null);
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [platform, setPlatform] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('relevance');
  const [minRating, setMinRating] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (g) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  useEffect(() => {
    api.get('/api/catalog/meta').then(setMeta).catch(() => {});
    api.get('/api/catalog/boards').then((r) => setBoards(r.boards)).catch(() => setBoards([]));
  }, []);

  const filtering = useMemo(() => !!(q.trim() || genre || platform || type || minRating || sort !== 'relevance'), [q, genre, platform, type, minRating, sort]);
  const clear = () => {
    setQ('');
    setGenre('');
    setPlatform('');
    setType('');
    setSort('relevance');
    setMinRating('');
  };

  useEffect(() => {
    if (!filtering) return setResults(null);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q, genre, platform, type, sort, minRating });
      api.get(`/api/catalog/search?${params}`).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, genre, platform, type, sort, minRating, filtering]);

  return (
    <section className="reveal reveal-d2">
      <div className="section-title">
        <h2>
          <Sparkles size={20} /> Discover
        </h2>
        {!filtering && boards?.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open.size === boards.length ? new Set() : new Set(boards.map((b) => b.genre)))}>
            {open.size === boards.length ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      <div className="filter-box">
        <div className="filter-row">
          <div className="input-icon">
            <Search size={16} />
            <input className="input" placeholder="Search titles — typos welcome, 'intersteller' works" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
            <option value="">All platforms</option>
            {meta?.platforms.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">Movies & series</option>
            <option value="movie">Movies</option>
            <option value="series">Series</option>
          </select>
          <select className="input" value={minRating} onChange={(e) => setMinRating(e.target.value)} aria-label="Minimum rating">
            <option value="">Any rating</option>
            <option value="7">7.0+</option>
            <option value="8">8.0+</option>
            <option value="8.5">8.5+</option>
            <option value="9">9.0+</option>
          </select>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="relevance">Relevance</option>
            <option value="rating">Top rated</option>
            <option value="year">Newest</option>
            <option value="title">A → Z</option>
          </select>
          <button className="btn btn-sm" onClick={clear} disabled={!filtering} title="Clear filters">
            <X size={14} /> Clear
          </button>
        </div>
        <div className="filter-group">
          <span className="filter-label">Genre</span>
          <div className="chips">
            <button className={`chip ${!genre ? 'active' : ''}`} onClick={() => setGenre('')}>
              All
            </button>
            {meta?.genres.map((g) => (
              <button key={g} className={`chip ${genre === g ? 'active' : ''}`} onClick={() => setGenre(genre === g ? '' : g)}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-foot">
          <span>Streaming availability shown for India · indicative, licences move.</span>
          {results && (
            <span>
              {results.length} result{results.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {results ? (
        <>
          <div className="grid-movies">
            {results.map((item) => (
              <MovieCard key={item.id} item={item} onWatch={onWatch} />
            ))}
          </div>
          {!results.length && (
            <div className="card empty">
              <Search size={30} />
              <div>Nothing matched.</div>
              <div className="hint">Try fewer filters or a looser spelling.</div>
            </div>
          )}
        </>
      ) : boards === null ? (
        <SkeletonBoards />
      ) : (
        <div className="accordion">
          {boards.map((b) => {
            const isOpen = open.has(b.genre);
            const platforms = [...new Set(b.items.map((i) => i.platform))];
            return (
              <div className={`board ${isOpen ? 'open' : ''}`} key={b.genre}>
                <button className="board-head" onClick={() => toggle(b.genre)} aria-expanded={isOpen}>
                  <span className="chev">
                    <ChevronRight size={14} />
                  </span>
                  <span className="board-name">{b.genre}</span>
                  <span className="badge accent">Top {b.items.length}</span>
                  <span className="board-sub">
                    {b.items
                      .slice(0, isOpen ? 2 : 3)
                      .map((i) => i.title)
                      .join(', ')}
                    {b.items.length > (isOpen ? 2 : 3) ? '…' : ''}
                  </span>
                  <span className="board-plats">
                    {platforms.slice(0, 4).map((p) => (
                      <i key={p} title={p} style={{ background: platformByName(p)?.color || '#999' }} />
                    ))}
                  </span>
                </button>
                {isOpen && (
                  <div className="board-body">
                    <div className="grid-movies">
                      {b.items.map((item, i) => (
                        <MovieCard key={item.id} item={item} rank={i + 1} onWatch={onWatch} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
