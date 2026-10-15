import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from '../components/Logo.jsx';
import { ChevronRight, Spinner } from '../components/Icons.jsx';

function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function Login() {
  const { user, config, loading, applySession, toast } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const btnRef = useRef(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const next = loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/';

  useEffect(() => {
    if (!config?.googleClientId || !btnRef.current) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: async ({ credential }) => {
            try {
              setBusy(true);
              const s = await api.post('/api/auth/google', { credential });
              applySession(s);
              nav(s.needsProfile ? '/setup' : next, { replace: true, state: { from: next } });
            } catch (e) {
              setErr(e.message);
            } finally {
              setBusy(false);
            }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, { theme: 'filled_black', size: 'large', shape: 'pill', width: 320, text: 'continue_with' });
      })
      .catch(() => setErr('Could not load Google Sign-In'));
    return () => {
      cancelled = true;
    };
  }, [config?.googleClientId]);

  if (!loading && user) return <Navigate to={next} replace />;

  const devLogin = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const s = await api.post('/api/auth/dev', { email, name });
      applySession(s);
      toast(`Signed in as ${s.user.displayName}`);
      nav(s.needsProfile ? '/setup' : next, { replace: true, state: { from: next } });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="blob a" />
      <div className="blob b" />
      <div className="card auth-card">
        <Logo size={40} />
        <p className="tag">Watch anything, anywhere, together. In perfect sync.</p>

        {config?.googleClientId ? (
          <div className="gbtn" ref={btnRef} />
        ) : (
          <div className="hint" style={{ marginBottom: 12, textAlign: 'center' }}>
            Google Sign-In is not configured on this server. Set <span className="mono">GOOGLE_CLIENT_ID</span> to enable it.
          </div>
        )}

        {config?.allowDevLogin && (
          <>
            {config?.googleClientId && <div className="divider">or use a local dev account</div>}
            <form onSubmit={devLogin} style={{ display: 'grid', gap: 12 }}>
              <label className="field">
                Email
                <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
              <label className="field">
                Name (optional)
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </label>
              <button className="btn btn-primary btn-lg" disabled={busy}>
                {busy ? <Spinner /> : null}
                {busy ? 'Signing in…' : 'Continue with dev account'}
                {!busy && <ChevronRight size={16} />}
              </button>
              <div className="hint" style={{ textAlign: 'center' }}>Dev accounts are for local testing. Each email is its own account, so open another tab to be a second viewer.</div>
            </form>
          </>
        )}
        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    </div>
  );
}
