import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import Avatar from '../components/Avatar.jsx';
import { api, readFileAsDataUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { CHAT_POPUP_MODES } from '@shared/constants.js';
import { Camera, LogOut, Users, Check, X, Tv } from '../components/Icons.jsx';
import GetExtension from '../components/GetExtension.jsx';

/** Detects the extension through the bridge content script and shows the right action. */
function ExtensionStatusRow() {
  const [ext, setExt] = useState(null);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source === window && e.data?.type === 'CV_PONG') setExt({ version: e.data.version });
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'CV_PING' }, window.location.origin);
    const t = setTimeout(() => setExt((x) => (x === null ? false : x)), 1200);
    return () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(t);
    };
  }, []);
  return (
    <div className="row wrap">
      <GetExtension installed={!!ext} />
      {ext && <span className="hint">Version {ext.version} is active in this browser.</span>}
      {ext === null && <span className="hint">Checking…</span>}
    </div>
  );
}

export default function Profile() {
  const { user, usernameChanged, applySession, toast, logout, settings, setSettings } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [avail, setAvail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [confirmRename, setConfirmRename] = useState(false);

  const loadFriends = () => api.get('/api/friends').then((r) => { setFriends(r.friends); setIncoming(r.incoming); }).catch(() => {});
  useEffect(() => {
    loadFriends();
    window.addEventListener('cv:friends-changed', loadFriends);
    window.addEventListener('cv:notification', loadFriends);
    return () => {
      window.removeEventListener('cv:friends-changed', loadFriends);
      window.removeEventListener('cv:notification', loadFriends);
    };
  }, []);

  useEffect(() => {
    if (!username || username === user.username) return setAvail(null);
    const t = setTimeout(() => api.get(`/api/username-available?u=${encodeURIComponent(username)}`).then(setAvail).catch(() => setAvail(null)), 250);
    return () => clearTimeout(t);
  }, [username, user.username]);

  const save = async (patch, okText) => {
    setBusy(true);
    try {
      const s = await api.patch('/api/profile', patch);
      applySession(s);
      toast(okText);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = async (file) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    save({ avatar: dataUrl }, 'Profile picture updated');
  };

  const unfriend = async (f) => {
    if (!confirm(`Remove ${f.displayName} (@${f.username}) from your friends?`)) return;
    await api.del(`/api/friends/${f.id}`);
    toast(`Removed ${f.displayName}`);
    loadFriends();
  };

  const respond = async (r, accept) => {
    await api.post('/api/friends/respond', { requestId: r.id, accept });
    toast(accept ? `You and ${r.from.displayName} are now friends` : 'Declined');
    loadFriends();
  };

  const saveSetting = async (patch) => {
    try {
      setSettings(await api.patch('/api/settings', patch));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <Header />
      <main className="page">
        <div className="eyebrow">Account</div>
        <h1>Your profile</h1>
        <p className="page-sub">How you appear in rooms, your overlay preferences, and your crew.</p>
        <div className="profile-grid">
          <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
            <div className="card">
              <h3>Identity</h3>
              <div className="avatar-edit" style={{ marginBottom: 16 }}>
                <Avatar user={user} size={84} showTooltip={false} />
                <div style={{ display: 'grid', gap: 6 }}>
                  <label className="btn btn-sm">
                    <Camera size={15} /> {user.avatar ? 'Change photo' : 'Add photo'}
                    <input type="file" accept="image/*" onChange={(e) => changeAvatar(e.target.files[0])} />
                  </label>
                  {user.avatar && (
                    <button className="btn btn-sm btn-ghost" onClick={() => save({ avatar: null }, 'Photo removed')}>
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 14 }}>
                <label className="field">
                  Visible name <span className="hint">(change as often as you like)</span>
                  <div className="row">
                    <input className="input" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
                    <button className="btn" disabled={busy || !displayName.trim() || displayName === user.displayName} onClick={() => save({ displayName }, 'Visible name updated')}>
                      Save
                    </button>
                  </div>
                </label>
                <label className="field">
                  Username
                  <div className="row">
                    <span className="muted">@</span>
                    <input className="input" value={username} disabled={usernameChanged} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))} />
                    <button className="btn" disabled={usernameChanged || busy || username === user.username || (avail && !avail.available)} onClick={() => setConfirmRename(true)}>
                      Change
                    </button>
                  </div>
                  {avail && username !== user.username && (
                    <span className={avail.available ? 'hint' : 'error'} style={avail.available ? { color: 'var(--ok)' } : undefined}>
                      {avail.available ? `@${username} is available` : avail.reason || `@${username} is taken`}
                    </span>
                  )}
                  <span className="hint warn">
                    {usernameChanged ? '⚠ You have already used your one username change.' : '⚠ You can change your username only once in your lifetime.'}
                  </span>
                </label>
              </div>
            </div>

            <div className="card">
              <h3>Room overlay preferences</h3>
              <div className="hint" style={{ marginBottom: 10 }}>Which pop-ups appear over the video when the chat panel is closed.</div>
              <label className="field" style={{ marginBottom: 12 }}>
                Chat pop-ups from
                <div className="seg">
                  {CHAT_POPUP_MODES.map((m) => (
                    <button key={m} className={settings.chatPopup === m ? 'active' : ''} onClick={() => saveSetting({ chatPopup: m })}>
                      {m === 'mentions' ? 'only @mentions' : m}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field" style={{ marginBottom: 12 }}>
                Emoji pop-ups from
                <div className="seg">
                  {CHAT_POPUP_MODES.filter((m) => m !== 'mentions').map((m) => (
                    <button key={m} className={settings.emojiPopup === m ? 'active' : ''} onClick={() => saveSetting({ emojiPopup: m })}>
                      {m}
                    </button>
                  ))}
                </div>
              </label>
              <div className="toggle">
                <span>Go fullscreen when entering a native room</span>
                <button className={`switch ${settings.autoFullscreen ? 'on' : ''}`} onClick={() => saveSetting({ autoFullscreen: !settings.autoFullscreen })} aria-label="toggle auto fullscreen" />
              </div>
            </div>

            <div className="card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tv size={18} /> Companion extension
              </h3>
              <div className="hint" style={{ marginBottom: 12 }}>Watch Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, Apple TV+ and YouTube in sync with your room. The overlay with chat, reactions and people appears right over the OTT player.</div>
              <ExtensionStatusRow />
            </div>

            <button className="btn btn-danger" onClick={logout}>
              <LogOut size={15} /> Sign out
            </button>
          </div>

          <div className="card" style={{ alignSelf: 'start' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={18} /> Friends <span className="badge">{friends.length}</span>
            </h3>
            {incoming.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="hint" style={{ marginBottom: 6 }}>Pending requests</div>
                {incoming.map((r) => (
                  <div className="friend" key={r.id}>
                    <Avatar user={r.from} size={36} />
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{r.from.displayName}</div>
                      <div className="hint">@{r.from.username}</div>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={() => respond(r, true)}>
                      <Check size={14} /> Accept
                    </button>
                    <button className="btn btn-sm" onClick={() => respond(r, false)}>
                      <X size={14} /> Decline
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!friends.length && !incoming.length && (
              <div className="empty">
                <Users size={30} />
                <div>No friends yet.</div>
                <div className="hint">Use the add-friend button in the header to add someone by username.</div>
              </div>
            )}
            {friends.map((f) => (
              <div className="friend" key={f.id}>
                <Avatar user={f} size={36} />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{f.displayName}</div>
                  <div className="hint">@{f.username}</div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => unfriend(f)}>
                  Unfriend
                </button>
              </div>
            ))}
          </div>
        </div>
      </main>

      {confirmRename && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirmRename(false)}>
          <div className="modal">
            <h2>Change username to @{username}?</h2>
            <p className="warn">This is your one and only username change. After this, @{username} is permanent.</p>
            <div className="actions">
              <button className="btn" onClick={() => setConfirmRename(false)}>
                Keep @{user.username}
              </button>
              <button className="btn btn-primary" onClick={() => { setConfirmRename(false); save({ username }, `You are now @${username}`); }}>
                Yes, change it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
