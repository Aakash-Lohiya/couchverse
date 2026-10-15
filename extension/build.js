/**
 * Bundles the extension into extension/dist with esbuild. The companion
 * script pulls in socket.io-client and the shared sync engine, so it needs
 * bundling; the rest are copied verbatim.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(here, 'src', 'companion.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  outfile: path.join(out, 'companion.js'),
  minify: false,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});

// The bridge content script must run on the CouchVerse site itself. Local
// origins are always included; SITE_ORIGIN (e.g. https://couchverse.onrender.com)
// adds the production domain so the live site can talk to the extension.
const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const bridge = manifest.content_scripts.find((c) => c.js.includes('bridge.js'));
const siteOrigin = process.env.SITE_ORIGIN;
if (siteOrigin) {
  try {
    const u = new URL(siteOrigin);
    const pattern = `${u.protocol}//${u.host}/*`;
    if (!bridge.matches.includes(pattern)) bridge.matches.push(pattern);
    console.log(`bridge enabled for ${pattern}`);
  } catch {
    console.warn(`SITE_ORIGIN "${siteOrigin}" is not a valid URL; skipped`);
  }
}
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const f of ['bridge.js', 'background.js', 'page-netflix.js']) copyFileSync(path.join(here, 'src', f), path.join(out, f));
console.log('extension built -> extension/dist (load it unpacked in chrome://extensions)');
