import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, readFileAsDataUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import { Logo } from '../components/Logo.jsx';
import { Camera, ChevronRight, Spinner, Check } from '../components/Icons.jsx';

export default function SetupProfile() {
  const { user, needsProfile, applySession, toast } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [avatar, setAvatar] = useState(user?.avatar || null);
  const [avail, setAvail] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!username) return setAvail(null);
    const t = setTimeout(async () => {
      try {
        setAvail(await api.get(`/api/username-available?u=${encodeURIComponent(username)}`));
      } catch {
        setAvail(null);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [username]);

  if (!needsProfile) return <Navigate to={loc.state?.from || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const s = await api.post('/api/profile/setup', { username, displayName, avatar });
      applySession(s);
      toast(`Welcome, ${s.user.displayName}!`);
      nav(loc.state?.from && loc.state.from !== '/setup' ? loc.state.from : '/', { replace: true });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const preview = { displayName: displayName || user.displayName, username, avatar };

  return (
    <div className="auth-wrap">
      <div className="blob a" />
      <div className="blob b" />
      <form className="card auth-card" onSubmit={submit}>
        <Logo size={32} />
        <p className="tag">One more step: how should people see you?</p>
        <div className="avatar-edit" style={{ marginBottom: 18 }}>
          <Avatar user={preview} size={76} showTooltip={false} />
          <div style={{ display: 'grid', gap: 6 }}>
            <label className="btn btn-sm">
              <Camera size={15} /> Upload photo
              <input type="file" accept="image/*" onChange={async (e) => e.target.files[0] && setAvatar(await readFileAsDataUrl(e.target.files[0]))} />
            </label>
            {avatar && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAvatar(null)}>
                Remove photo
              </button>
            )}
            <div className="hint">No photo? We'll show your initials.</div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            Visible name
            <input className="input" required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How friends see you" />
          </label>
          <label className="field">
            Username (unique)
            <div className="row">
              <span className="muted">@</span>
              <input className="input" required value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))} placeholder="your_handle" autoCapitalize="off" />
            </div>
            {username && avail && (
              <span className={avail.available ? 'hint' : 'error'} style={avail.available ? { color: 'var(--ok)', display: 'inline-flex', alignItems: 'center', gap: 4 } : undefined}>
                {avail.available ? <Check size={13} /> : null}
                {avail.available ? `@${username} is available` : avail.reason || `@${username} is taken`}
              </span>
            )}
            <span className="hint warn">You can change your username only once, ever. Pick carefully.</span>
          </label>
        </div>
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 20 }} disabled={busy || !username || (avail && !avail.available)}>
          {busy ? <Spinner /> : null}
          {busy ? 'Saving…' : 'Enter CouchVerse'}
          {!busy && <ChevronRight size={16} />}
        </button>
      </form>
    </div>
  );
}
