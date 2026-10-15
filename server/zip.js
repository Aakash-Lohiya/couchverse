/**
 * Minimal ZIP writer (deflate, no dependencies). Enough to package a folder
 * of extension files for download.
 */
import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** @param {{name: string, data: Buffer}[]} files */
export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = dosDateTime();
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(f.data);
    const deflated = deflateRawSync(f.data, { level: 9 });
    const useDeflate = deflated.length < f.data.length;
    const body = useDeflate ? deflated : f.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Zip every file under `dir`, placed inside a top-level folder `rootName`. */
export function zipDirectory(dir, rootName) {
  const files = [];
  const walk = (d, rel) => {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      const r = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, r);
      else files.push({ name: `${rootName}/${r}`, data: readFileSync(full) });
    }
  };
  walk(dir, '');
  return buildZip(files);
}
