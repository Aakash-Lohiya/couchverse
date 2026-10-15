/**
 * Downloads a small CC-licensed sample clip into server/media so a demo
 * works without outbound internet from the browser. Run: npm run fetch-samples
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'server', 'media');
mkdirSync(dir, { recursive: true });

const SAMPLES = [
  { file: 'sintel_trailer-480p.mp4', url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4', note: 'Sintel trailer, (c) Blender Foundation, CC BY 3.0' },
];

for (const s of SAMPLES) {
  const dest = path.join(dir, s.file);
  if (existsSync(dest) && statSync(dest).size > 100_000) {
    console.log(`✓ ${s.file} already present (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  console.log(`↓ ${s.url}`);
  const res = await fetch(s.url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`  failed: ${res.status}`);
    continue;
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`✓ saved ${s.file} (${(statSync(dest).size / 1e6).toFixed(1)} MB) - ${s.note}`);
}
