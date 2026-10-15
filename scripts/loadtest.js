/**
 * CouchVerse load & latency harness.
 *
 * Spawns N socket.io clients in one room, each with a virtual player driven
 * by the real SyncController. The host fires play/pause/seek controls while
 * every viewer measures:
 *   - control propagation: host originTs (server clock) -> viewer apply
 *   - host round trip: control emit -> server ack
 *   - steady-state drift (outside correction windows)
 *   - recovery time after injected stalls, late joins and reconnects
 *   - concurrency: a burst of 10 controls must converge every client on the
 *     same final version
 *
 * Usage: node scripts/loadtest.js [--users 12] [--controls 40] [--interval 1200] [--server http://localhost:4000]
 */
import { io } from 'socket.io-client';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerClock, SyncController, VirtualPlayer, LatencyStats, expectedPosition } from '../shared/sync-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : [])).filter(Boolean));
const USERS = Number(args.users || 12);
const CONTROLS = Number(args.controls || 40);
const INTERVAL = Number(args.interval || 1200);
const SERVER = args.server || 'http://localhost:4000';
const LATE_JOINERS = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body, token) => {
  const r = await fetch(SERVER + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error || r.status}`);
  return j;
};

async function makeUser(i) {
  const s = await api('/api/auth/dev', { email: `loadtest_${i}@cv.local`, name: `Load ${i}` });
  if (s.needsProfile) await api('/api/profile/setup', { username: `loadtest_${i}`, displayName: `Load ${i}` }, s.token);
  return { token: s.token, id: s.user.id, name: `Load ${i}` };
}

class Client {
  constructor(user, roomCode, { rateError, stallChance } = {}) {
    this.user = user;
    this.roomCode = roomCode;
    this.socket = io(SERVER, { auth: { token: user.token }, transports: ['websocket'], reconnectionDelay: 200 });
    this.clock = new ServerClock((t0) => new Promise((res, rej) => (this.socket.connected ? this.socket.emit('time:ping', t0, (t1) => res(t1)) : rej(new Error('offline')))));
    this.player = new VirtualPlayer({ rateError: rateError ?? (Math.random() - 0.5) * 0.03, stallChance });
    this.ackRtt = new LatencyStats();
    this.corrections = [];
    this.hostId = null;
    this.joinedAt = 0;
    this.syncedAt = 0;
    this.ctrl = new SyncController({
      player: this.player,
      clock: this.clock,
      isHost: () => this.hostId === this.user.id,
      sendControl: (c) => {
        const t0 = Date.now();
        this.socket.emit('playback:control', c, () => this.ackRtt.push(Date.now() - t0));
      },
      onCorrection: (e) => this.corrections.push({ ...e, at: Date.now() }),
    });
    this.socket.on('playback:state', (st) => this.ctrl.applyState(st));
    this.socket.on('room:host', ({ hostId }) => (this.hostId = hostId));
    this.socket.on('room:members', ({ hostId }) => (this.hostId = hostId));
    this.socket.on('connect', () => this.join());
  }
  join() {
    return new Promise((resolve) => {
      this.socket.emit('room:join', { code: this.roomCode }, (res) => {
        if (res.error) return resolve(res);
        this.hostId = res.snapshot.room.hostId;
        this.joinedAt = Date.now();
        this.syncedAt = 0;
        this.ctrl.applyState({ ...res.snapshot.state, replay: true });
        resolve(res);
      });
    });
  }
  async start() {
    await new Promise((r) => (this.socket.connected ? r() : this.socket.once('connect', r)));
    await this.clock.start(3000, 4);
    this.ctrl.markReady();
    this.ctrl.start();
  }
  drift() {
    return this.ctrl.lastDrift;
  }
  stop() {
    this.ctrl.stop();
    this.clock.stop();
    this.socket.disconnect();
  }
}

async function main() {
  console.log(`CouchVerse load test: ${USERS} users, ${CONTROLS} controls every ${INTERVAL} ms against ${SERVER}`);
  const health = await api('/api/health');
  console.log(`server ok (rooms: ${health.rooms})`);

  const users = [];
  for (let i = 0; i < USERS + LATE_JOINERS; i++) users.push(await makeUser(i));
  const host = users[0];
  const { room } = await api('/api/rooms', { name: `Load test ${new Date().toISOString().slice(11, 19)}`, visibility: 'private', type: 'native', media: { kind: 'url', url: '/media/sintel_trailer-480p.mp4', title: 'Load test clip', duration: 3600 } }, host.token);
  console.log(`room ${room.code} created`);

  const clients = users.slice(0, USERS).map((u) => new Client(u, room.code));
  await Promise.all(clients.map((c) => c.start()));
  await Promise.all(clients.map((c) => c.join()));
  await sleep(500);
  const hostClient = clients[0];
  const viewers = () => clients.slice(1);
  console.log(`${clients.length} clients joined; host clock offset ${hostClient.clock.offset.toFixed(1)} ms, rtt ${hostClient.clock.rtt} ms`);

  // ---------- phase 1: controls + injected stalls ----------
  const steadyDrift = new LatencyStats(100000);
  const recoveries = [];
  let quietUntil = 0;
  const sampler = setInterval(() => {
    if (Date.now() < quietUntil) return;
    for (const c of viewers()) if (c.ctrl.state?.playing) steadyDrift.push(Math.abs(c.drift()) * 1000);
  }, 100);

  hostClient.ctrl.command('play', { position: 0 });
  await sleep(800);
  for (let i = 0; i < CONTROLS; i++) {
    const kind = i % 4;
    if (kind === 0) hostClient.ctrl.command('seek', { position: Math.random() * 3000 });
    else if (kind === 1) hostClient.ctrl.command('pause');
    else if (kind === 2) hostClient.ctrl.command('play');
    else hostClient.ctrl.command('seek', { position: hostClient.player.getTime() + 30 });
    quietUntil = Date.now() + 1000; // exclude the correction window from steady-state drift
    // every 3rd control, stall a random viewer for 300-900 ms and time the recovery
    if (i % 3 === 2) {
      const v = viewers()[Math.floor(Math.random() * viewers().length)];
      const ms = 300 + Math.random() * 600;
      setTimeout(() => {
        v.player.stall(ms);
        const t0 = Date.now();
        const poll = setInterval(() => {
          if (Math.abs(v.drift()) < 0.5 && Date.now() - t0 > ms) {
            recoveries.push(Date.now() - t0 - ms);
            clearInterval(poll);
          } else if (Date.now() - t0 > 10000) {
            recoveries.push(10000);
            clearInterval(poll);
          }
        }, 50);
      }, 300);
      quietUntil = Date.now() + 2200;
    }
    await sleep(INTERVAL);
  }
  hostClient.ctrl.command('play');
  await sleep(3000);

  // ---------- phase 2: late joiners ----------
  const late = users.slice(USERS).map((u) => new Client(u, room.code));
  const lateTimes = [];
  for (const c of late) {
    await c.start();
    const t0 = Date.now();
    await c.join();
    await new Promise((resolve) => {
      const p = setInterval(() => {
        if (c.ctrl.state && Math.abs(c.drift()) < 0.5) {
          lateTimes.push(Date.now() - t0);
          clearInterval(p);
          resolve();
        }
      }, 25);
    });
  }
  clients.push(...late);

  // ---------- phase 3: reconnection ----------
  const rc = viewers()[1];
  const t0r = Date.now();
  rc.socket.io.engine.close(); // simulate a dropped transport; socket.io reconnects
  const reconnectTime = await new Promise((resolve) => {
    const p = setInterval(() => {
      if (rc.socket.connected && rc.joinedAt > t0r && Math.abs(rc.drift()) < 0.5) {
        clearInterval(p);
        resolve(Date.now() - t0r);
      }
    }, 25);
  });

  // ---------- phase 4: host transfer + burst (concurrency) ----------
  const newHost = viewers()[0];
  await new Promise((resolve) => hostClient.socket.emit('host:transfer', { userId: newHost.user.id }, resolve));
  await sleep(300);
  for (let i = 0; i < 10; i++) newHost.ctrl.command('seek', { position: 100 + i * 10 });
  // the old host fires a stale control at the same moment; it must not win
  hostClient.ctrl.command('seek', { position: 5 });
  await sleep(1500);
  const versions = new Set(clients.map((c) => c.ctrl.state?.version));
  const positions = clients.map((c) => expectedPosition(c.ctrl.state, c.clock.serverNow()));
  const spread = Math.max(...positions) - Math.min(...positions);

  clearInterval(sampler);
  await sleep(200);

  // ---------- results ----------
  const prop = new LatencyStats(100000);
  for (const c of clients) for (const v of c.ctrl.propagation.values) prop.push(v);
  const perClient = clients.map((c) => ({ user: c.user.name, p50: c.ctrl.propagation.percentile(50), p95: c.ctrl.propagation.percentile(95), samples: c.ctrl.propagation.values.length, rtt: c.clock.rtt, hardSeeks: c.ctrl.hardSeeks }));
  const ackSummary = hostClient.ackRtt.summary();
  const recov = new LatencyStats();
  recoveries.forEach((r) => recov.push(r));
  const lateStats = new LatencyStats();
  lateTimes.forEach((t) => lateStats.push(t));

  const results = {
    when: new Date().toISOString(),
    server: SERVER,
    users: clients.length,
    controls: CONTROLS + 12,
    node: process.version,
    controlPropagationMs: prop.summary(),
    hostAckRttMs: ackSummary,
    steadyStateDriftMs: steadyDrift.summary(),
    stallRecoveryMs: recov.summary(),
    lateJoinToSyncMs: lateStats.summary(),
    reconnectToSyncMs: reconnectTime,
    concurrency: { distinctVersionsAfterBurst: versions.size, positionSpreadS: Number(spread.toFixed(3)), finalExpectedPosition: Number(positions[0].toFixed(2)) },
    perClient,
    pass: {
      propagationP95Under250: prop.percentile(95) != null && prop.percentile(95) <= 250,
      driftP95Under500: steadyDrift.percentile(95) != null && steadyDrift.percentile(95) <= 500,
      convergedAfterBurst: versions.size === 1 && spread < 0.5,
      tenPlusUsers: clients.length >= 10,
    },
  };

  const fmt = (s) => (s && s.count ? `p50 ${s.p50?.toFixed(0)} / p95 ${s.p95?.toFixed(0)} / p99 ${s.p99?.toFixed(0)} / max ${s.max?.toFixed(0)} ms (n=${s.count})` : '—');
  console.log('\n=== Results ===');
  console.log(`users in room:            ${results.users}`);
  console.log(`control propagation:      ${fmt(results.controlPropagationMs)}`);
  console.log(`host emit→server ack:     ${fmt(results.hostAckRttMs)}`);
  console.log(`steady-state drift:       ${fmt(results.steadyStateDriftMs)}`);
  console.log(`stall recovery:           ${fmt(results.stallRecoveryMs)}`);
  console.log(`late join → in sync:      ${fmt(results.lateJoinToSyncMs)}`);
  console.log(`reconnect → in sync:      ${reconnectTime} ms`);
  console.log(`burst convergence:        versions=${versions.size} spread=${spread.toFixed(3)} s`);
  console.log('pass:', results.pass);

  mkdirSync(path.join(here, '..', 'docs'), { recursive: true });
  writeFileSync(path.join(here, '..', 'docs', 'latency-results.json'), JSON.stringify(results, null, 2));
  console.log('\nwrote docs/latency-results.json');

  clients.forEach((c) => c.stop());
  process.exit(Object.values(results.pass).every(Boolean) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
