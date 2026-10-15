import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import { api, parseMediaUrl } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { OTT_PLATFORMS, SAMPLE_MEDIA } from '@shared/constants.js';
import { Globe, Lock, Play, Tv, Film, Check } from './Icons.jsx';
import { useExtension } from '../lib/useExtension.js';
import ExtensionGate from './ExtensionGate.jsx';

/**
 * Create a room. `preset` can prefill an OTT room from a catalog item:
 *   { type: 'ott', platform: 'netflix', title: 'Dark' }
 */
export default function CreateRoomModal({ onClose, preset }) {
  const nav = useNavigate();
  const { user, toast } = useAuth();
  const [name, setName] = useState(preset?.title ? `${preset.title} night` : `${user.displayName}'s room`);
  const [visibility, setVisibility] = useState('public');
  const [type, setType] = useState(preset?.type || 'native');
  const [platform, setPlatform] = useState(preset?.platform || 'netflix');
  const [passcode, setPasscode] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaTitle, setMediaTitle] = useState(preset?.title || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { ext, recheck } = useExtension();
  const needsExtension = type === 'ott' && ext === false;

  const submit = async (e) => {
    e.preventDefault();
    if (needsExtension) return;
    setErr('');
    setBusy(true);
    try {
      let media = null;
      if (type === 'native' && mediaUrl) {
        const parsed = parseMediaUrl(mediaUrl);
        if (!parsed) throw new Error('Enter a valid http(s) video URL or YouTube link');
        const sample = SAMPLE_MEDIA.find((s) => s.url === parsed.url);
        media = { ...parsed, title: mediaTitle || sample?.title || parsed.url.split('/').pop(), duration: sample?.duration || null };
      } else if (type === 'ott' && mediaTitle) {
        media = { kind: 'ott', platform, title: mediaTitle, url: null, duration: preset?.duration || null };
      }
      const r = await api.post('/api/rooms', { name, visibility, type, platform: type === 'ott' ? platform : null, passcode: visibility === 'private' ? passcode : null, media });
      toast(`Room ${r.room.code} created`);
      onClose?.();
      nav(`/r/${r.room.code}`, { state: { passcode } });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const platName = OTT_PLATFORMS.find((p) => p.id === platform)?.name;

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <h2 className="full" style={{ margin: 0 }}>
          Create a room
        </h2>
        <label className="field full">
          Room name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </label>
        <label className="field">
          Visibility
          <div className="seg">
            <button type="button" className={visibility === 'public' ? 'active' : ''} onClick={() => setVisibility('public')}>
              <Globe size={14} /> Public
            </button>
            <button type="button" className={visibility === 'private' ? 'active' : ''} onClick={() => setVisibility('private')}>
              <Lock size={14} /> Private
            </button>
          </div>
        </label>
        <label className="field">
          Player
          <div className="seg">
            <button type="button" className={type === 'native' ? 'active' : ''} onClick={() => setType('native')}>
              <Play size={13} /> Native
            </button>
            <button type="button" className={type === 'ott' ? 'active' : ''} onClick={() => setType('ott')}>
              <Tv size={14} /> OTT
            </button>
          </div>
        </label>
        {visibility === 'private' && (
          <label className="field full">
            Passcode (optional, on top of the secret room code)
            <input className="input" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="e.g. popcorn" maxLength={32} />
          </label>
        )}
        {type === 'ott' ? (
          <>
            <label className="field">
              Platform
              <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {OTT_PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Title (optional)
              <input className="input" value={mediaTitle} onChange={(e) => setMediaTitle(e.target.value)} placeholder="What are you watching?" />
            </label>
            {needsExtension ? (
              <ExtensionGate compact platformName={platName} onRecheck={recheck} />
            ) : (
              <div className="hint full" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {ext ? (
                  <>
                    <Check size={13} style={{ color: 'var(--ok)' }} /> Extension v{ext.version} detected. Everyone opens the title on {platName}; it keeps players in sync and overlays chat and reactions.
                  </>
                ) : (
                  'Checking for the CouchVerse extension…'
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <label className="field full">
              Video URL (optional, host can add later)
              <input className="input" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://… .mp4 / .m3u8 or a YouTube link" />
            </label>
            <div className="chips full">
              {SAMPLE_MEDIA.map((s) => (
                <button type="button" key={s.url} className={`chip ${mediaUrl === s.url ? 'active' : ''}`} onClick={() => { setMediaUrl(s.url); setMediaTitle(s.title); }}>
                  {s.title}
                </button>
              ))}
            </div>
            {mediaUrl && (
              <label className="field full">
                Title
                <input className="input" value={mediaTitle} onChange={(e) => setMediaTitle(e.target.value)} />
              </label>
            )}
          </>
        )}
        {err && <div className="error full">{err}</div>}
        <div className="actions full" style={{ marginTop: 6 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || needsExtension || (type === 'ott' && ext === null)} title={needsExtension ? 'Install the extension first' : ''}>
            <Film size={16} /> {busy ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
