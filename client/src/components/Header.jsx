import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';
import { Logo } from './Logo.jsx';
import { Bell, UserPlus, Check, X } from './Icons.jsx';

const ago = (ts) => {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

function Notifications() {
  const { unread, setUnread, toast } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);

  const load = async () => {
    try {
      const r = await api.get('/api/notifications');
      setItems(r.notifications);
      setUnread(r.unread);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const h = () => open && load();
    window.addEventListener('cv:notification', h);
    return () => window.removeEventListener('cv:notification', h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    load().then(() => api.post('/api/notifications/read').then(() => setUnread(0)).catch(() => {}));
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const respond = async (n, accept) => {
    try {
      await api.post('/api/friends/respond', { requestId: n.payload.requestId, accept });
      toast(accept ? `You and ${n.payload.user.displayName} are now friends` : 'Request declined');
      window.dispatchEvent(new CustomEvent('cv:friends-changed'));
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const text = (n) => {
    const who = <b>{n.payload?.user?.displayName}</b>;
    switch (n.type) {
      case 'friend_request':
        return <>{who} (@{n.payload.user.username}) sent you a friend request</>;
      case 'friend_accepted':
        return <>{who} accepted your friend request</>;
      case 'friend_declined':
        return <>{who} declined your friend request</>;
      case 'friend_you_accepted':
        return <>You accepted {who}'s request</>;
      case 'friend_you_declined':
        return <>You declined {who}'s request</>;
      default:
        return n.type;
    }
  };

  return (
    <div className="anchor" ref={ref}>
      <button className={`btn btn-icon ${open ? 'active btn-primary' : ''}`} title="Notifications" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell />
        {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <h4>Notifications</h4>
          {!items.length && (
            <div className="empty">
              <Bell size={26} />
              Nothing yet. Add friends to get started.
            </div>
          )}
          {items.map((n) => (
            <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
              <Avatar user={n.payload?.user} size={36} />
              <div className="body">
                <div>{text(n)}</div>
                <div className="time">{ago(n.createdAt)} ago</div>
                {n.type === 'friend_request' && n.status === 'pending' && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => respond(n, true)}>
                      <Check size={14} /> Accept
                    </button>
                    <button className="btn btn-sm" onClick={() => respond(n, false)}>
                      <X size={14} /> Decline
                    </button>
                  </div>
                )}
                {n.type === 'friend_request' && n.status && n.status !== 'pending' && <div className="hint">{n.status}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddFriend() {
  const { toast } = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api.post('/api/friends/request', { username });
      toast(r.accepted ? `You and ${r.friend.displayName} are now friends` : `Friend request sent to @${username.replace(/^@/, '')}`);
      setOpen(false);
      setUsername('');
      window.dispatchEvent(new CustomEvent('cv:friends-changed'));
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn btn-icon" title="Add friend" onClick={() => setOpen(true)} aria-label="Add friend">
        <UserPlus />
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <h2>Add a friend</h2>
            <label className="field">
              Their username
              <div className="row">
                <span className="muted">@</span>
                <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))} placeholder="username" />
              </div>
            </label>
            {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !username}>
                <UserPlus size={16} /> Send request
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Header() {
  const { user } = useAuth();
  return (
    <header className="header">
      <Link to="/" aria-label="CouchVerse home">
        <Logo />
      </Link>
      <div className="spacer" />
      <Notifications />
      <AddFriend />
      <Link to="/profile" title={`@${user.username}`} aria-label="Profile" style={{ display: 'inline-flex' }}>
        <Avatar user={user} size={40} ring />
      </Link>
    </header>
  );
}
