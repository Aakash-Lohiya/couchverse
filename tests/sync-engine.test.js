import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedPosition, ServerClock, SyncController, VirtualPlayer, LatencyStats, SYNC } from '../shared/sync-engine.js';

// A controllable clock so tests are deterministic and fast.
function fakeTime() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test('expectedPosition advances only while playing and honours rate', () => {
  const anchor = 10_000;
  assert.equal(expectedPosition({ playing: false, position: 42, anchor, rate: 1 }, anchor + 5000), 42);
  assert.equal(expectedPosition({ playing: true, position: 42, anchor, rate: 1 }, anchor + 5000), 47);
  assert.equal(expectedPosition({ playing: true, position: 42, anchor, rate: 2 }, anchor + 5000), 52);
  assert.equal(expectedPosition({ playing: true, position: 42, anchor, rate: 1 }, anchor - 5000), 42, 'never goes backwards before the anchor');
});

test('ServerClock keeps the lowest-RTT sample as its offset', async () => {
  const ft = fakeTime();
  const serverOffset = 2500; // server is 2.5s ahead
  let rtt = 200;
  const clock = new ServerClock(async (t0) => {
    ft.advance(rtt / 2);
    const serverTime = ft.now() + serverOffset;
    ft.advance(rtt / 2);
    return serverTime;
  }, ft.now);
  await clock.sync();
  assert.equal(Math.round(clock.offset), serverOffset);
  rtt = 10;
  await clock.sync();
  assert.equal(clock.rtt, 10);
  rtt = 400;
  await clock.sync();
  assert.equal(Math.round(clock.offset), serverOffset, 'noisy sample does not displace the best one');
});

function harness({ rateError = 0 } = {}) {
  const ft = fakeTime();
  const clock = new ServerClock(async () => ft.now(), ft.now);
  clock.offset = 0;
  clock.synced = true;
  const player = new VirtualPlayer({ rateError, now: ft.now });
  const corrections = [];
  const sent = [];
  let host = false;
  const ctrl = new SyncController({
    player,
    clock,
    now: ft.now,
    isHost: () => host,
    sendControl: (c) => sent.push(c),
    onCorrection: (e) => corrections.push(e),
    setInterval: () => 0,
    clearInterval: () => {},
  });
  ctrl.markReady();
  const run = (ms, step = SYNC.TICK_MS) => {
    for (let t = 0; t < ms; t += step) {
      ft.advance(step);
      ctrl.tick();
    }
  };
  return { ft, clock, player, ctrl, corrections, sent, run, setHost: (v) => (host = v) };
}

test('late joiner lands on the room timeline and plays', () => {
  const h = harness();
  const state = { version: 3, playing: true, position: 100, anchor: h.ft.now() - 10_000, rate: 1, mediaId: 'm' };
  h.ctrl.applyState(state);
  assert.equal(h.player.isPaused(), false);
  assert.ok(Math.abs(h.player.getTime() - 110) < 0.3, `expected ~110s, got ${h.player.getTime()}`);
});

test('drift above the hard threshold is corrected by a seek', () => {
  const h = harness();
  h.ctrl.applyState({ version: 1, playing: true, position: 0, anchor: h.ft.now(), rate: 1, mediaId: 'm' });
  h.run(2000);
  assert.equal(h.corrections.filter((c) => c.type === 'seek').length, 1, 'only the initial landing seek so far');
  h.player.stall(3000); // simulate a 3s buffering stall: the player freezes while the room moves on
  h.run(SYNC.SEEK_COOLDOWN_MS + 1000);
  const seeks = h.corrections.filter((c) => c.type === 'seek' && c.reason === 'hard-drift');
  assert.ok(seeks.length >= 1, 'hard seek issued once drift crossed the threshold');
  h.run(1000);
  assert.ok(Math.abs(h.ctrl.lastDrift) < 0.5, `drift after correction must be < 500ms, got ${h.ctrl.lastDrift}`);
  assert.ok(h.ctrl.driftStats.percentile(95) < 1500, 'the stall was never allowed to run away');
});

test('small drift is corrected by rate nudging and converges within 500ms', () => {
  const h = harness({ rateError: 0.02 }); // player runs 2% fast
  h.ctrl.applyState({ version: 1, playing: true, position: 0, anchor: h.ft.now(), rate: 1, mediaId: 'm' });
  h.run(30_000);
  assert.ok(h.corrections.some((c) => c.type === 'nudge'), 'nudge issued');
  assert.ok(!h.corrections.some((c) => c.type === 'seek' && c.reason === 'hard-drift'), 'no hard seek needed for 2% rate error');
  assert.ok(Math.abs(h.ctrl.lastDrift) < 0.5, `steady drift ${h.ctrl.lastDrift}`);
});

test('pause state is enforced and position pinned', () => {
  const h = harness();
  h.ctrl.applyState({ version: 1, playing: true, position: 0, anchor: h.ft.now(), rate: 1, mediaId: 'm' });
  h.run(1000);
  h.ctrl.applyState({ version: 2, playing: false, position: 1, anchor: h.ft.now(), rate: 1, mediaId: 'm' });
  assert.equal(h.player.isPaused(), true);
  h.run(5000);
  assert.ok(Math.abs(h.player.getTime() - 1) < 0.05);
});

test('only the host turns local player events into controls, and echoes are suppressed', () => {
  const h = harness();
  h.ctrl.applyState({ version: 1, playing: false, position: 0, anchor: h.ft.now(), rate: 1, mediaId: 'm' });
  h.ft.advance(SYNC.ECHO_SUPPRESS_MS + 10);
  h.player.play();
  assert.equal(h.sent.length, 0, 'viewer never sends controls');
  h.setHost(true);
  h.player.pause();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].action, 'pause');
  // A programmatic apply must not echo back as a new control.
  h.ctrl.applyState({ version: 2, playing: true, position: 0, anchor: h.ft.now(), rate: 1, mediaId: 'm' });
  assert.equal(h.sent.length, 1, 'applyState did not generate a control');
  assert.ok(h.ctrl.command('seek', { position: 30 }));
  assert.equal(h.sent[1].action, 'seek');
  assert.equal(h.sent[1].position, 30);
});

test('propagation latency is measured from originTs', () => {
  const h = harness();
  h.clock.offset = 0;
  h.ctrl.applyState({ version: 1, playing: true, position: 0, anchor: h.ft.now(), rate: 1, mediaId: 'm', originTs: h.ft.now() - 120 });
  assert.equal(h.ctrl.propagation.values[0], 120);
});

test('LatencyStats percentiles', () => {
  const s = new LatencyStats();
  for (let i = 1; i <= 100; i++) s.push(i);
  assert.equal(s.percentile(50), 50);
  assert.equal(s.percentile(95), 95);
  assert.equal(s.summary().max, 100);
});
