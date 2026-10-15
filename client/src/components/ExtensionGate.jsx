import GetExtension from './GetExtension.jsx';
import { Tv, Refresh, ArrowLeft } from './Icons.jsx';

/**
 * Shown wherever companion mode is about to start without the extension.
 * `compact` renders an inline panel (inside the create-room dialog);
 * otherwise a full card with a back action.
 */
export default function ExtensionGate({ onRecheck, onBack, compact = false, platformName }) {
  const body = (
    <>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="gate-icon">
          <Tv size={22} />
        </span>
        <div className="grow">
          <div style={{ fontWeight: 700, fontSize: compact ? 15 : 18, fontFamily: 'var(--font-display)' }}>Companion mode needs the CouchVerse extension</div>
          <div className="hint" style={{ marginTop: 4 }}>
            It runs on {platformName || 'the OTT site'} and keeps everyone's player in sync while drawing chat, reactions and the people list over the video. We couldn't find it in this browser.
          </div>
        </div>
      </div>
      <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
        <GetExtension />
        <button type="button" className="btn" onClick={onRecheck} title="Reload this page and check again">
          <Refresh size={14} /> I've installed it, check again
        </button>
        {onBack && (
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            <ArrowLeft size={14} /> Back
          </button>
        )}
      </div>
    </>
  );
  if (compact) return <div className="gate full">{body}</div>;
  return <div className="card gate-card">{body}</div>;
}
