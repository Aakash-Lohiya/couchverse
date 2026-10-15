import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../Avatar.jsx';
import { api, fmtTime, parseMediaUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { CHAT_POPUP_MODES, SAMPLE_MEDIA } from '@shared/constants.js';
import { Chat, Users, Queue, Poll, Sliders, X, Crown, Refresh, Copy, ThumbsUp, Play, Send, Shield, Popcorn, LogOut, Plus, ChevronDown } from '../Icons.jsx';

const TABS = [
  ['chat', Chat, 'Chat'],
  ['people', Users, 'People'],
  ['queue', Queue, 'Queue'],
  ['polls', Poll, 'Polls'],
  ['settings', Sliders, 'Settings'],
];

export default function SidePanel(props) {
  const { tab, onTab, onClose } = props;
  return (
    <aside className={`side-panel ${tab ? '' : 'hidden'}`} aria-hidden={!tab}>
      <div className="side-tabs">
        {TABS.map(([id, Icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => onTab(id)} title={label}>
            <Icon size={17} />
            {label}
          </button>
        ))}
        <button onClick={onClose} title="Close panel" className="close" aria-label="Close panel">
          <X size={16} />
        </button>
      </div>
      {tab === 'chat' && <ChatTab {...props} />}
      {tab === 'people' && <PeopleTab {...props} />}
      {tab === 'queue' && <QueueTab {...props} />}
      {tab === 'polls' && <PollsTab {...props} />}
      {tab === 'settings' && <SettingsTab {...props} />}
    </aside>
  );
}

// ------------------------------------------------------------------
function renderText(text, meName) {
  return text.split(/(@[a-z0-9_]{3,20})/gi).map((part, i) =>
    /^@[a-z0-9_]{3,20}$/i.test(part) ? (
      <span key={i} className="mention" style={part.slice(1).toLowerCase() === meName ? { background: 'rgba(139,92,246,0.3)', borderRadius: 4, padding: '0 2px' } : undefined}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function ChatTab({ r, me, currentPos }) {
  const [text, setText] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [revealed, setRevealed] = useState(() => new Set());
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [r.chat.length]);

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    r.actions.chat(text.trim(), { mediaPos: currentPos(), spoiler });
    setText('');
    setSpoiler(false);
    r.actions.typing(false);
  };

  const onType = (v) => {
    setText(v);
    r.actions.typing(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => r.actions.typing(false), 1500);
  };

  const myPos = currentPos();
  const typingNames = r.members.filter((m) => m.id !== me.id && r.typing[m.id] && Date.now() - r.typing[m.id] < 2500).map((m) => m.displayName);

  return (
    <>
      <div className="side-body" ref={listRef}>
        {r.chat.map((m) => {
          if (m.kind === 'system' || !m.user) {
            return (
              <div key={m.id} className="sys">
                {m.text}
              </div>
            );
          }
          const sameMedia = !m.mediaId || !r.media || m.mediaId === r.media.id;
          const ahead = r.settings.spoilerShield && sameMedia && m.mediaPos != null && m.user.id !== me.id && m.mediaPos > myPos + 4;
          const hidden = (m.spoiler || ahead) && !revealed.has(m.id);
          return (
            <div key={m.id} className={`msg ${hidden ? 'spoiler' : ''}`} onClick={() => hidden && setRevealed((s) => new Set([...s, m.id]))}>
              <Avatar user={m.user} size={30} />
              <div className="bubble">
                <div className="who">
                  <b>{m.user.displayName}</b>
                  <span>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {m.mediaPos != null && <span>@ {fmtTime(m.mediaPos)}</span>}
                  {hidden && <span className="spoiler-tag">{m.spoiler ? 'spoiler · click to reveal' : `ahead of you by ${fmtTime(m.mediaPos - myPos)} · click to reveal`}</span>}
                </div>
                <div className="text">{renderText(m.text, me.username)}</div>
              </div>
            </div>
          );
        })}
        {!r.chat.length && (
          <div className="empty">
            <Chat size={28} />
            <div>Say hi!</div>
            <div className="hint">Mention people with @username.</div>
          </div>
        )}
      </div>
      {typingNames.length > 0 && <div className="typing">{typingNames.join(', ')} typing…</div>}
      <form className="side-foot" onSubmit={send}>
        <div className="row">
          <input className="input" value={text} onChange={(e) => onType(e.target.value)} placeholder="Message… (@name to mention)" maxLength={1000} />
          <button className="btn btn-primary btn-icon" disabled={!text.trim()} aria-label="Send" title="Send">
            <Send size={16} />
          </button>
        </div>
        <label className="row hint" style={{ marginTop: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /> Mark as spoiler
          {r.settings.spoilerShield && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Shield size={12} /> shield on
            </span>
          )}
        </label>
      </form>
    </>
  );
}

// ------------------------------------------------------------------
function PeopleTab({ r, me, isHost, stats, onResync }) {
  const { toast } = useAuth();
  const sorted = useMemo(
    () => [...r.members].sort((a, b) => (b.id === r.hostId) - (a.id === r.hostId) || b.connected - a.connected || a.joinedAt - b.joinedAt),
    [r.members, r.hostId],
  );
  const live = (id) => r.roomStats?.members.find((m) => m.id === id)?.stats;
  const cls = (ms, warn, bad) => (ms == null ? '' : Math.abs(ms) < warn ? 'ok' : Math.abs(ms) < bad ? 'warn' : 'bad');
  const invite = `${window.location.origin}/r/${r.room.code}`;

  return (
    <div className="side-body">
      <div className="side-card">
        <div className="title">
          Your sync
          <button className="btn btn-sm btn-ghost" onClick={onResync}>
            <Refresh size={13} /> Resync
          </button>
        </div>
        {stats ? (
          <div className="stat-grid">
            <div className={`stat ${cls(stats.drift * 1000, 250, 500)}`}>
              drift <b>{Math.round(stats.drift * 1000)} ms</b>
            </div>
            <div className={`stat ${cls(stats.rtt, 80, 200)}`}>
              ping (RTT) <b>{Math.round(stats.rtt)} ms</b>
            </div>
            <div className={`stat ${cls(stats.propagation.p95, 250, 500)}`}>
              control latency p95 <b>{stats.propagation.p95 == null ? '—' : `${Math.round(stats.propagation.p95)} ms`}</b>
            </div>
            <div className="stat">
              control latency p50 <b>{stats.propagation.p50 == null ? '—' : `${Math.round(stats.propagation.p50)} ms`}</b>
            </div>
            <div className="stat">
              clock offset <b>{Math.round(stats.offset)} ms</b>
            </div>
            <div className="stat">
              corrections <b>{stats.corrections} ({stats.hardSeeks} seeks)</b>
            </div>
          </div>
        ) : (
          <div className="hint">{r.room.type === 'ott' ? 'Playback stats come from the extension on the OTT tab.' : 'Stats appear once media is playing.'}</div>
        )}
      </div>

      <div className="hint" style={{ margin: '6px 2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Users size={13} /> {r.members.filter((m) => m.connected).length} watching · host {r.members.find((m) => m.id === r.hostId)?.displayName}
      </div>
      {sorted.map((m) => {
        const st = live(m.id) || m.stats;
        return (
          <div key={m.id} className={`member ${m.connected ? '' : 'offline'}`}>
            <Avatar user={m} size={36} ring={m.id === r.hostId} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="nm">
                {m.displayName}
                {m.id === r.hostId && <Crown size={14} title="Host" />}
                {m.id === me.id && <span className="badge">you</span>}
                {r.friends.has(m.id) && <span className="badge accent">friend</span>}
                {m.buffering && <span className="badge warn">buffering</span>}
                {!m.connected && <span className="badge danger">reconnecting</span>}
              </div>
              <div className="st">
                @{m.username}
                {st && st.ping != null && ` · ping ${Math.round(st.ping)}ms`}
                {st && st.drift != null && ` · drift ${Math.round(st.drift * 1000)}ms`}
                {st && st.propagationP95 != null && ` · p95 ${Math.round(st.propagationP95)}ms`}
              </div>
            </div>
            {isHost && m.id !== me.id && m.connected && (
              <button
                className="btn btn-sm"
                onClick={async () => {
                  if (!confirm(`Make ${m.displayName} the host? You will lose playback control.`)) return;
                  const res = await r.actions.transferHost(m.id);
                  if (res?.ok) toast(`${m.displayName} is now host`);
                }}
              >
                <Crown size={13} /> Make host
              </button>
            )}
          </div>
        );
      })}

      <div className="side-card" style={{ marginTop: 6 }}>
        <div className="title">Invite</div>
        <div className="row">
          <span className="room-code" style={{ fontSize: 18 }}>
            {r.room.code}
          </span>
          <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(invite); toast('Invite link copied'); }}>
            <Copy size={14} /> Copy link
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8, wordBreak: 'break-all' }}>{invite}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function QueueTab({ r, me, isHost }) {
  const { toast } = useAuth();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const isOtt = r.room.type === 'ott';
  const canControl = isHost || r.settings.allowGuestControl;

  const add = async (e) => {
    e.preventDefault();
    let item;
    if (isOtt) {
      if (!title.trim()) return;
      item = { title: title.trim(), kind: 'ott', platform: r.room.platform };
    } else {
      const parsed = parseMediaUrl(url);
      if (!parsed) return toast('Enter a valid video or YouTube URL', 'error');
      const sample = SAMPLE_MEDIA.find((s) => s.url === parsed.url);
      item = { ...parsed, title: title || sample?.title || parsed.url.split('/').pop(), duration: sample?.duration || null };
    }
    await r.actions.queueAdd(item);
    setUrl('');
    setTitle('');
  };

  const voteNext = async () => {
    const options = r.queue.slice(0, 6).map((q) => q.title);
    if (options.length < 2) return toast('Need at least 2 items in the queue to vote', 'error');
    await r.actions.pollCreate({ question: 'What should we watch next?', options, kind: 'next', durationSec: 45 });
    toast('Poll started: the winner jumps to the front of the queue');
  };

  return (
    <>
      <div className="side-body">
        {r.media && (
          <div className="qitem" style={{ borderLeft: '3px solid var(--accent)' }}>
            {r.playback?.playing ? <Play size={14} /> : <span className="muted">⏸</span>}
            <span className="t">{r.media.title}</span>
            <span className="badge accent">now</span>
          </div>
        )}
        {!r.queue.length && (
          <div className="empty">
            <Queue size={28} />
            <div>Queue is empty.</div>
            <div className="hint">Anyone can add something below.</div>
          </div>
        )}
        {r.queue.map((q, i) => {
          const voted = q.votes.includes(me.id);
          return (
            <div key={q.id} className="qitem">
              <span className="muted" style={{ width: 18, textAlign: 'right', fontSize: 12 }}>
                {i + 1}
              </span>
              <div className="t" title={q.url || q.title}>
                {q.title}
                <div className="hint">{q.kind === 'youtube' ? 'YouTube' : q.kind === 'ott' ? 'OTT' : 'Video'}{q.duration ? ` · ${fmtTime(q.duration)}` : ''}</div>
              </div>
              <button className={`btn btn-sm ${voted ? 'btn-primary' : ''}`} onClick={() => r.actions.queueVote(q.id)} title="Vote this up">
                <ThumbsUp size={13} /> {q.votes.length}
              </button>
              {canControl && (
                <>
                  <button className="btn btn-sm" onClick={() => r.actions.queueMove(q.id, i - 1)} disabled={i === 0} title="Move up" aria-label="Move up">
                    <ChevronDown size={13} style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => r.actions.queuePlay(q.id)} title="Play now" aria-label="Play now">
                    <Play size={13} />
                  </button>
                </>
              )}
              {(canControl || q.addedBy === me.id) && (
                <button className="btn btn-sm btn-ghost" onClick={() => r.actions.queueRemove(q.id)} title="Remove" aria-label="Remove">
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
        {r.queue.length >= 2 && (
          <button className="btn btn-sm" onClick={voteNext}>
            <Poll size={14} /> Vote on what's next
          </button>
        )}
      </div>
      <form className="side-foot" onSubmit={add} style={{ display: 'grid', gap: 6 }}>
        {!isOtt && <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Video / YouTube URL" />}
        <div className="row">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isOtt ? 'Title to watch next' : 'Title (optional)'} />
          <button className="btn btn-sm btn-primary">
            <Plus size={14} /> Add
          </button>
        </div>
        {!isOtt && (
          <div className="chips">
            {SAMPLE_MEDIA.slice(0, 3).map((s) => (
              <button type="button" key={s.url} className="chip" onClick={() => { setUrl(s.url); setTitle(s.title); }}>
                {s.title}
              </button>
            ))}
          </div>
        )}
      </form>
    </>
  );
}

// ------------------------------------------------------------------
function PollsTab({ r, me, isHost }) {
  const { toast } = useAuth();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [duration, setDuration] = useState(60);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const create = async (e) => {
    e.preventDefault();
    const opts = options.split('\n').map((s) => s.trim()).filter(Boolean);
    const res = await r.actions.pollCreate({ question, options: opts, durationSec: Number(duration) });
    if (res?.error) return toast('Need a question and at least 2 options', 'error');
    setQuestion('');
    setOptions('');
  };
  const snackBreak = () => r.actions.pollCreate({ question: 'Snack break? Pause for everyone', options: ['Yes, pause!', 'Keep going'], kind: 'pause', durationSec: 30 });

  const polls = [...r.polls].sort((a, b) => a.closed - b.closed || b.createdAt - a.createdAt);
  return (
    <>
      <div className="side-body">
        <button className="btn btn-sm" onClick={snackBreak}>
          <Popcorn size={14} /> Call a snack break vote
        </button>
        {!polls.length && (
          <div className="empty">
            <Poll size={28} />
            <div>No polls yet.</div>
            <div className="hint">Ask the room anything.</div>
          </div>
        )}
        {polls.map((p) => {
          const total = Object.keys(p.votes).length;
          const counts = p.options.map((_, i) => Object.values(p.votes).filter((v) => v === i).length);
          const left = Math.max(0, Math.round((p.endsAt - Date.now()) / 1000));
          return (
            <div key={p.id} className="poll">
              <div className="q">
                {p.question}
                <div className="hint" style={{ fontWeight: 400 }}>
                  by {p.createdBy.displayName} · {total} vote{total === 1 ? '' : 's'} · {p.closed ? 'closed' : `${left}s left`}
                  {p.kind === 'next' && ' · winner goes next'}
                </div>
              </div>
              {p.options.map((o, i) => {
                const pct = total ? (counts[i] / total) * 100 : 0;
                const mine = p.votes[me.id] === i;
                const win = p.closed && p.result?.winners.includes(i);
                return (
                  <button key={i} className={`opt ${mine ? 'mine' : ''} ${win ? 'win' : ''}`} disabled={p.closed} onClick={() => r.actions.pollVote(p.id, i)}>
                    <div className="bar" style={{ width: `${pct}%` }} />
                    <span>
                      <span>
                        {win && '🏆 '}
                        {o}
                      </span>
                      <span className="muted">
                        {counts[i]} · {Math.round(pct)}%
                      </span>
                    </span>
                  </button>
                );
              })}
              {!p.closed && (isHost || p.createdBy.id === me.id) && (
                <button className="btn btn-sm btn-ghost" onClick={() => r.actions.pollClose(p.id)}>
                  Close now
                </button>
              )}
            </div>
          );
        })}
      </div>
      <form className="side-foot" onSubmit={create} style={{ display: 'grid', gap: 6 }}>
        <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask the room…" maxLength={200} />
        <textarea className="input" rows={3} value={options} onChange={(e) => setOptions(e.target.value)} placeholder={'One option per line\nOption A\nOption B'} />
        <div className="row">
          <select className="input" style={{ width: 120 }} value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value={30}>30s</option>
            <option value={60}>1 min</option>
            <option value={120}>2 min</option>
            <option value={300}>5 min</option>
          </select>
          <button className="btn btn-sm btn-primary grow" disabled={!question.trim()}>
            <Poll size={14} /> Start poll
          </button>
        </div>
      </form>
    </>
  );
}

// ------------------------------------------------------------------
function SettingsTab({ r, isHost, onLeave }) {
  const { settings, setSettings, toast } = useAuth();
  const save = async (patch) => {
    try {
      setSettings(await api.patch('/api/settings', patch));
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const Toggle = ({ label, hint, on, onChange, disabled }) => (
    <div className="toggle">
      <div>
        <div>{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <button className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} aria-label={label} />
    </div>
  );
  return (
    <div className="side-body">
      <div className="side-card">
        <div className="title">Pop-ups over the video (just for you)</div>
        <label className="field">
          Chat pop-ups from
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {CHAT_POPUP_MODES.map((m) => (
              <button key={m} className={settings.chatPopup === m ? 'active' : ''} onClick={() => save({ chatPopup: m })}>
                {m === 'mentions' ? '@mentions' : m}
              </button>
            ))}
          </div>
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          Emoji pop-ups from
          <div className="seg">
            {CHAT_POPUP_MODES.filter((m) => m !== 'mentions').map((m) => (
              <button key={m} className={settings.emojiPopup === m ? 'active' : ''} onClick={() => save({ emojiPopup: m })}>
                {m}
              </button>
            ))}
          </div>
        </label>
        <Toggle label="Auto fullscreen on entering native rooms" on={settings.autoFullscreen} onChange={(v) => save({ autoFullscreen: v })} />
      </div>

      <div className="side-card">
        <div className="title">Room settings {isHost ? '· you are host' : '· host only'}</div>
        <Toggle label="Hold for buffering" hint="If anyone is buffering, pause everyone and resume together." on={!!r.settings.holdForBuffering} disabled={!isHost} onChange={(v) => r.actions.updateSettings({ holdForBuffering: v })} />
        <Toggle label="Everyone can control playback" hint="Off = only the host plays, pauses and seeks." on={!!r.settings.allowGuestControl} disabled={!isHost} onChange={(v) => r.actions.updateSettings({ allowGuestControl: v })} />
        <Toggle label="Spoiler shield" hint="Blur chat written further ahead than where you are." on={!!r.settings.spoilerShield} disabled={!isHost} onChange={(v) => r.actions.updateSettings({ spoilerShield: v })} />
      </div>

      <div className="side-card">
        <div className="title">Keyboard</div>
        <div className="hint" style={{ lineHeight: 2 }}>
          <span className="kbd">space</span> play/pause (host) · <span className="kbd">←</span> <span className="kbd">→</span> seek 10s (host) · <span className="kbd">c</span> chat · <span className="kbd">p</span> people · <span className="kbd">q</span> queue · <span className="kbd">e</span> emojis · <span className="kbd">f</span> fullscreen · <span className="kbd">m</span> mute
        </div>
      </div>

      <button className="btn btn-danger" onClick={onLeave}>
        <LogOut size={15} /> Leave room
      </button>
    </div>
  );
}
