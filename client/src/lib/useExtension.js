import { useCallback, useEffect, useState } from 'react';

/**
 * Detects the CouchVerse companion extension through its bridge content
 * script (CV_PING → CV_PONG over window.postMessage).
 * Returns { ext, recheck }: ext is null while checking, false when absent,
 * or { version } when present.
 *
 * Chrome does not inject content scripts into tabs that were already open
 * when an extension is installed, so `recheck` reloads the page.
 */
export function useExtension({ pollMs = 5000, timeoutMs = 1200 } = {}) {
  const [ext, setExt] = useState(null);

  useEffect(() => {
    let settled = false;
    const onMsg = (e) => {
      if (e.source !== window || e.data?.type !== 'CV_PONG') return;
      settled = true;
      setExt((cur) => (cur && cur.version === e.data.version ? cur : { version: e.data.version }));
    };
    window.addEventListener('message', onMsg);
    const ping = () => window.postMessage({ type: 'CV_PING' }, window.location.origin);
    ping();
    const t = setTimeout(() => !settled && setExt(false), timeoutMs);
    const iv = setInterval(ping, pollMs);
    return () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [pollMs, timeoutMs]);

  const recheck = useCallback(() => window.location.reload(), []);
  return { ext, recheck };
}
