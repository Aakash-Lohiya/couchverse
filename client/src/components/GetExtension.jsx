import { useState } from 'react';
import Modal from './Modal.jsx';
import { useAuth } from '../lib/auth.jsx';
import { SERVER_URL } from '../lib/api.js';
import { External, Check, Copy, Tv, ChevronRight } from './Icons.jsx';

/**
 * Store-aware "get the extension" button.
 *  - Chrome Web Store URL configured → "Add to Chrome" (two clicks in Chrome).
 *  - Otherwise → download the packaged extension and show the load-unpacked guide.
 *  - `installed` (detected by the companion lobby) → a quiet "Installed" badge.
 */
export default function GetExtension({ installed = false, size = '', className = '' }) {
  const { config, toast } = useAuth();
  const [guide, setGuide] = useState(false);
  const storeUrl = config?.extensionStoreUrl;
  const canDownload = config?.extensionDownload !== false;
  const zipUrl = `${SERVER_URL}/api/extension.zip`;

  if (installed) {
    return (
      <span className={`badge ok ${className}`} style={{ padding: '7px 12px', fontSize: 13 }}>
        <Check size={14} /> Extension installed
      </span>
    );
  }

  if (storeUrl) {
    return (
      <a className={`btn btn-primary ${size} ${className}`} href={storeUrl} target="_blank" rel="noreferrer">
        <Tv size={16} /> Add to Chrome <External size={14} />
      </a>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText('chrome://extensions');
      toast('Copied chrome://extensions. Paste it in the address bar.');
    } catch {
      toast('Type chrome://extensions in the address bar', 'error');
    }
  };

  const steps = [
    { t: 'Download and unzip', h: 'You get a folder called couchverse-extension. Keep it somewhere permanent; Chrome loads it from there.' },
    { t: 'Open chrome://extensions', h: 'Chrome blocks links to that page, so paste it into the address bar.', action: copy },
    { t: 'Turn on Developer mode', h: 'The switch is in the top-right corner of that page.' },
    { t: 'Click "Load unpacked" and pick the folder', h: 'Choose the unzipped couchverse-extension folder. The CouchVerse icon appears in the toolbar.' },
  ];

  return (
    <>
      <button className={`btn btn-primary ${size} ${className}`} onClick={() => setGuide(true)} disabled={!canDownload} title={canDownload ? '' : 'Extension is not built on this server'}>
        <Tv size={16} /> Get the extension
      </button>
      {guide && (
        <Modal onClose={() => setGuide(false)}>
          <h2>Install the CouchVerse extension</h2>
          <p className="muted" style={{ marginTop: -6 }}>
            Chrome only installs extensions from its Web Store automatically, so this one takes four quick steps. It stays installed afterwards.
          </p>
          <a className="btn btn-primary btn-lg" href={zipUrl} download="couchverse-extension.zip" style={{ width: '100%', marginBottom: 14 }}>
            Download couchverse-extension.zip <ChevronRight size={16} />
          </a>
          <div className="steps">
            {steps.map((s, i) => (
              <div key={i} className="step">
                <span className="num">{i + 1}</span>
                <div className="grow">
                  <div className="t">{s.t}</div>
                  <div className="hint">{s.h}</div>
                </div>
                {s.action && (
                  <button className="btn btn-sm" onClick={s.action} title="Copy chrome://extensions">
                    <Copy size={13} /> Copy
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 12 }}>
            Works in Chrome, Edge and other Chromium browsers (Edge: <span className="mono">edge://extensions</span>). After installing, open or refresh your room: the lobby will say "Extension installed".
          </div>
          <div className="actions">
            <button className="btn" onClick={() => setGuide(false)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
