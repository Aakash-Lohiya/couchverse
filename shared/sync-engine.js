/**
 * CouchVerse shared sync engine.
 *
 * Runs in three places with zero DOM dependencies:
 *   - the React client (native player rooms)
 *   - the Chrome extension content script (companion mode on OTT players)
 *   - the Node load-test harness (virtual players)
 *
 * Concepts
 * --------
 * Server time is the single source of truth. Every playback state carries an
 * `anchor` (server ms) and `position` (media seconds at that anchor). Any peer
 * can compute the position the room *should* be at right now:
 *
 *     expected = position + (serverNow - anchor) / 1000 * rate   (if playing)
 *
 * Each peer keeps a clock offset to the server (NTP-style, best-of-N), then a
 * SyncController compares its local player against `expected` a few times a
 * second and corrects: small drift -> nudge playbackRate; big drift -> seek.
 */

export const SYNC = {
  TICK_MS: 250,            // controller loop interval
  SOFT_DRIFT_S: 0.12,      // above this we nudge the playback rate
  HARD_DRIFT_S: 0.9,       // above this we hard-seek
  DEADBAND_S: 0.04,        // below this we stop nudging and restore rate 1
  NUDGE_RATE: 0.06,        // +/- rate applied while soft correcting
  PAUSED_DRIFT_S: 0.25,    // when paused, re-seek if we are off by this much
  SEEK_LEAD_S: 0.15,       // seek a touch ahead to compensate seek latency
  SEEK_COOLDOWN_MS: 1200,  // minimum time between hard seeks
  ECHO_SUPPRESS_MS: 700,   // ignore player events this long after we act on it
};

export const SERVER_CLOCK_SAMPLES = 8;

/** Position the room should be at for a given server timestamp. */
export function expectedPosition(state, serverNow) {
  if (!state) return 0;
  if (!state.playing) return state.position;
  const elapsed = Math.max(0, serverNow - state.anchor) / 1000;
  return state.position + elapsed * (state.rate || 1);
}

/**
 * NTP-ish clock: ask the server for its time, keep the sample with the lowest
 * RTT out of the last N. `request` must return a promise of the server time
 * (ms) and is given t0 so a transport can echo it back.
 */
export class ServerClock {
  constructor(request, now = () => Date.now()) {
    this.request = request;
    this.now = now;
    this.samples = [];
    this.offset = 0;   // serverTime - localTime
    this.rtt = 0;
    this.synced = false;
  }

  async sync() {
    const t0 = this.now();
    let t1;
    try {
      t1 = await this.request(t0);
    } catch {
      return false;
    }
    const t2 = this.now();
    const rtt = t2 - t0;
    const offset = t1 - (t0 + rtt / 2);
    this.samples.push({ rtt, offset });
    if (this.samples.length > SERVER_CLOCK_SAMPLES) this.samples.shift();
    // Lowest-RTT sample has the least asymmetric queueing error.
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.rtt = rtt;
    this.synced = true;
    return true;
  }

  /** Run an initial burst, then keep re-syncing on an interval. */
  start(intervalMs = 5000, burst = 4) {
    this.stop();
    let p = Promise.resolve();
    for (let i = 0; i < burst; i++) p = p.then(() => this.sync());
    this.timer = setInterval(() => this.sync(), intervalMs);
    return p;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  serverNow() {
    return this.now() + this.offset;
  }
}

/** Running percentile stats over a bounded window. */
export class LatencyStats {
  constructor(limit = 500) {
    this.limit = limit;
    this.values = [];
  }
  push(v) {
    if (!Number.isFinite(v)) return;
    this.values.push(v);
    if (this.values.length > this.limit) this.values.shift();
  }
  percentile(p) {
    if (!this.values.length) return null;
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  }
  summary() {
    return {
      count: this.values.length,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.values.length ? Math.max(...this.values) : null,
      mean: this.values.length ? this.values.reduce((a, b) => a + b, 0) / this.values.length : null,
    };
  }
  reset() {
    this.values = [];
  }
}

/**
 * Player adapter contract (duck-typed):
 *   getTime(): number            seconds
 *   setTime(seconds)
 *   play(): Promise|void
 *   pause()
 *   isPaused(): boolean
 *   setRate(rate)
 *   getDuration(): number|NaN
 *   on(event, handler)           events: 'play' | 'pause' | 'seeked' | 'waiting' | 'playing' | 'ratechange'
 *   off(event, handler)
 */

export class SyncController {
  /**
   * @param {object} opts
   * @param {object} opts.player        adapter (see contract above)
   * @param {ServerClock} opts.clock
   * @param {(ctl: object) => void} [opts.sendControl]  host -> server
   * @param {(evt: object) => void} [opts.onCorrection]
   * @param {(info: object) => void} [opts.onStats]
   * @param {() => boolean} [opts.isHost]
   */
  constructor(opts) {
    this.player = opts.player;
    this.clock = opts.clock;
    this.sendControl = opts.sendControl || (() => {});
    this.onCorrection = opts.onCorrection || (() => {});
    this.onStats = opts.onStats || (() => {});
    this.isHost = opts.isHost || (() => false);
    this.now = opts.now || (() => Date.now());
    // Wrapped so browsers don't see the controller as `this` (illegal invocation).
    this.setTimer = opts.setInterval || ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = opts.clearInterval || ((id) => clearInterval(id));

    this.state = null;             // last authoritative state
    this.suppressUntil = 0;        // ignore player events before this local ms
    this.lastSeekAt = 0;
    this.nudging = false;
    this.ready = false;            // player has media & can seek
    this.lastDrift = 0;
    this.propagation = new LatencyStats();
    this.driftStats = new LatencyStats();
    this.corrections = 0;
    this.hardSeeks = 0;
    this.pendingPlayGesture = false;

    this._bind();
  }

  _bind() {
    const p = this.player;
    this._onPlay = () => this._hostEvent('play');
    this._onPause = () => this._hostEvent('pause');
    this._onSeeked = () => this._hostEvent('seek');
    this._onRate = () => this._hostEvent('rate');
    p.on('play', this._onPlay);
    p.on('pause', this._onPause);
    p.on('seeked', this._onSeeked);
    p.on('ratechange', this._onRate);
  }

  destroy() {
    this.stop();
    const p = this.player;
    p.off('play', this._onPlay);
    p.off('pause', this._onPause);
    p.off('seeked', this._onSeeked);
    p.off('ratechange', this._onRate);
  }

  start() {
    this.stop();
    this.timer = this.setTimer(() => this.tick(), SYNC.TICK_MS);
  }

  stop() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  markReady() {
    this.ready = true;
    if (this.state) this.applyState(this.state, { force: true });
  }

  /** Called when the player raises an event. Only the host turns these into controls. */
  _hostEvent(action) {
    if (!this.isHost()) return;
    if (this.now() < this.suppressUntil) return; // echo of our own programmatic action
    const position = this.player.getTime();
    const rate = this.player.getRate ? this.player.getRate() : 1;
    if (action === 'rate' && this.state && Math.abs(rate - (this.state.rate || 1)) < 0.001) return;
    this.sendControl({
      action,
      position,
      rate,
      baseVersion: this.state ? this.state.version : 0,
      originTs: this.clock.serverNow(),
    });
  }

  /**
   * Explicit host command from the UI (button, seek bar, keyboard). Goes
   * straight to the server; the echoed state is what actually moves the
   * local player, so host and viewers share one code path.
   */
  command(action, { position, rate } = {}) {
    if (!this.isHost()) return false;
    const pos = Number.isFinite(position) ? position : this.player.getTime();
    this.sendControl({
      action,
      position: pos,
      rate: Number.isFinite(rate) ? rate : this.player.getRate ? this.player.getRate() : 1,
      baseVersion: this.state ? this.state.version : 0,
      originTs: this.clock.serverNow(),
    });
    return true;
  }

  /**
   * Apply an authoritative state from the server. Returns propagation (ms)
   * from origin to local apply when the state carries `originTs`.
   */
  applyState(state, { force = false } = {}) {
    const prev = this.state;
    this.state = state;
    const serverNow = this.clock.serverNow();
    let propagation = null;
    if (state.originTs && !state.replay) {
      propagation = serverNow - state.originTs;
      if (propagation >= 0 && propagation < 10000) this.propagation.push(propagation);
    }
    if (!this.ready) return propagation;

    const expected = expectedPosition(state, serverNow);
    const localPos = this.player.getTime();
    const drift = localPos - expected;
    const mediaChanged = !prev || prev.mediaId !== state.mediaId;

    this._suppress();
    if (Math.abs(drift) > SYNC.SOFT_DRIFT_S || force || mediaChanged || !state.playing) {
      // When paused, land exactly; when playing lead slightly to absorb seek latency.
      const target = state.playing ? expected + SYNC.SEEK_LEAD_S : expected;
      this._seek(target, 'state');
    }
    const rate = state.rate || 1;
    if (this.player.getRate && Math.abs(this.player.getRate() - rate) > 0.001) this.player.setRate(rate);
    this.nudging = false;

    if (state.playing && this.player.isPaused()) {
      const r = this.player.play();
      if (r && typeof r.catch === 'function') {
        r.catch(() => {
          // Autoplay policy blocked us; the UI should show a "tap to join" prompt.
          this.pendingPlayGesture = true;
          this.onCorrection({ type: 'autoplay-blocked' });
        });
      }
    } else if (!state.playing && !this.player.isPaused()) {
      this.player.pause();
    }
    return propagation;
  }

  _suppress(ms = SYNC.ECHO_SUPPRESS_MS) {
    this.suppressUntil = this.now() + ms;
  }

  _seek(target, reason) {
    const duration = this.player.getDuration();
    let t = Math.max(0, target);
    if (Number.isFinite(duration) && duration > 0) t = Math.min(t, duration - 0.05);
    this._suppress();
    this.player.setTime(t);
    this.lastSeekAt = this.now();
    this.hardSeeks++;
    this.corrections++;
    this.onCorrection({ type: 'seek', reason, target: t });
  }

  /** Drift detection + correction loop. */
  tick() {
    const state = this.state;
    if (!state || !this.ready) return;
    if (this.pendingPlayGesture) return;
    const serverNow = this.clock.serverNow();
    const expected = expectedPosition(state, serverNow);
    const local = this.player.getTime();
    const drift = local - expected;
    this.lastDrift = drift;
    this.driftStats.push(Math.abs(drift) * 1000);

    const paused = this.player.isPaused();

    if (!state.playing) {
      if (!paused) {
        this._suppress();
        this.player.pause();
      }
      if (Math.abs(drift) > SYNC.PAUSED_DRIFT_S) this._seek(expected, 'paused-drift');
      this._emitStats(drift, expected);
      return;
    }

    // Playing. The host is the reference only in the sense that it issues
    // controls; it still corrects against server time like everyone else so
    // that two hosts handing off never diverge.
    if (paused && !this.pendingPlayGesture) {
      // Could be buffering (waiting) or a blocked play(). Try to resume.
      const r = this.player.play();
      if (r && typeof r.catch === 'function') {
        r.catch(() => {
          this.pendingPlayGesture = true;
          this.onCorrection({ type: 'autoplay-blocked' });
        });
      }
    }

    const abs = Math.abs(drift);
    // Players that only accept discrete rates (YouTube) cannot be nudged, so
    // they seek at a lower threshold instead.
    const canNudge = this.player.canNudge !== false;
    const hardThreshold = canNudge ? SYNC.HARD_DRIFT_S : SYNC.SOFT_DRIFT_S * 3;
    if (abs > hardThreshold) {
      if (this.now() - this.lastSeekAt > SYNC.SEEK_COOLDOWN_MS) {
        this._seek(expected + SYNC.SEEK_LEAD_S, 'hard-drift');
        if (this.nudging) {
          this.player.setRate(state.rate || 1);
          this.nudging = false;
        }
      }
    } else if (abs > SYNC.SOFT_DRIFT_S && canNudge) {
      const base = state.rate || 1;
      const rate = drift > 0 ? base - SYNC.NUDGE_RATE : base + SYNC.NUDGE_RATE;
      if (!this.nudging || Math.abs((this.player.getRate ? this.player.getRate() : rate) - rate) > 0.001) {
        this._suppress();
        this.player.setRate(rate);
        this.nudging = true;
        this.corrections++;
        this.onCorrection({ type: 'nudge', rate, drift });
      }
    } else if (abs < SYNC.DEADBAND_S && this.nudging) {
      this._suppress();
      this.player.setRate(state.rate || 1);
      this.nudging = false;
      this.onCorrection({ type: 'nudge-end', drift });
    }
    this._emitStats(drift, expected);
  }

  _emitStats(drift, expected) {
    this.onStats({
      drift,
      expected,
      local: this.player.getTime(),
      offset: this.clock.offset,
      rtt: this.clock.rtt,
      propagation: this.propagation.summary(),
      driftStats: this.driftStats.summary(),
      corrections: this.corrections,
      hardSeeks: this.hardSeeks,
      nudging: this.nudging,
    });
  }

  /** User tapped to allow playback after an autoplay block. */
  resumeAfterGesture() {
    this.pendingPlayGesture = false;
    if (this.state) this.applyState(this.state, { force: true });
  }

  /** Manual "resync me" button. */
  resync() {
    if (this.state) this.applyState(this.state, { force: true });
  }
}

/**
 * A virtual player used by the load tester and unit tests. It advances with a
 * configurable rate error and random stalls so the controller has something
 * to correct.
 */
export class VirtualPlayer {
  constructor({ rateError = 0, stallChance = 0, now = () => Date.now() } = {}) {
    this.rateError = rateError;
    this.stallChance = stallChance;
    this.now = now;
    this.paused = true;
    this.rate = 1;
    this.base = 0;
    this.baseAt = now();
    this.handlers = {};
    this.duration = 3600;
    this.stalledUntil = 0;
  }
  _emit(e) {
    (this.handlers[e] || []).forEach((h) => h());
  }
  on(e, h) {
    (this.handlers[e] = this.handlers[e] || []).push(h);
  }
  off(e, h) {
    this.handlers[e] = (this.handlers[e] || []).filter((x) => x !== h);
  }
  getTime() {
    if (this.paused) return this.base;
    const t = this.now();
    if (t < this.stalledUntil) return this.base;
    const effective = this.rate * (1 + this.rateError);
    return this.base + ((t - this.baseAt) / 1000) * effective;
  }
  _rebase() {
    // Rate/play/pause changes must not cancel an in-progress stall; only an
    // explicit seek (setTime) clears it, like a real player.
    this.base = this.getTime();
    const t = this.now();
    this.baseAt = t < this.stalledUntil ? this.stalledUntil : t;
  }
  setTime(s) {
    this.base = s;
    this.baseAt = this.now();
    this.stalledUntil = 0;
    this._emit('seeked');
  }
  play() {
    if (!this.paused) return Promise.resolve();
    this._rebase();
    this.paused = false;
    this._emit('play');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this._rebase();
    this.paused = true;
    this._emit('pause');
  }
  isPaused() {
    return this.paused;
  }
  setRate(r) {
    this._rebase();
    this.rate = r;
    this._emit('ratechange');
  }
  getRate() {
    return this.rate;
  }
  getDuration() {
    return this.duration;
  }
  /** Simulate a network stall of `ms`. */
  stall(ms) {
    this._rebase();
    this.stalledUntil = this.now() + ms;
    this.baseAt = this.stalledUntil;
  }
}
