const KEYS = ['left', 'right', 'jump', 'action', 'dash', 'down'];
const copyInput = (input) => Object.fromEntries(KEYS.map((key) => [key, input?.[key] === true]));
const sameInput = (a, b) => a && b && KEYS.every((key) => a[key] === b[key]);

// Fresh snapshots can still be carrying old acknowledgements. Watch commands
// actually handed to the transport, independently of snapshot arrival rate.
export class InputAckWatchdog {
  constructor({ onStall, now = () => performance.now(), maxAgeMs = 2000, capacity = 128 }) {
    this.onStall = onStall;
    this.now = now;
    this.maxAgeMs = maxAgeMs;
    this.capacity = Math.max(2, Math.min(256, Math.floor(capacity) || 128));
    this.reset();
  }

  reset() {
    this.pending = [];
    this.lastSeq = 0;
    this.stalled = false;
  }

  record(seq, { active = true, reset = false } = {}) {
    if (!active || reset) {
      this.reset();
      return;
    }
    if (this.stalled || !Number.isSafeInteger(seq) || seq <= this.lastSeq) return;
    this.lastSeq = seq;
    this.pending.push({ seq, at: this.now() });
    // Preserve the oldest outstanding command when trimming: a flood of newer
    // transitions must not hide how long its acknowledgement has been missing.
    if (this.pending.length > this.capacity)
      this.pending.splice(1, this.pending.length - this.capacity);
  }

  acknowledge(ack, { active = true } = {}) {
    if (!active) {
      this.reset();
      return false;
    }
    if (this.stalled) return true;
    if (Number.isSafeInteger(ack) && ack >= 0)
      this.pending = this.pending.filter((command) => command.seq > ack);
    if (this.pending.length && this.now() - this.pending[0].at >= this.maxAgeMs) {
      this.stalled = true;
      this.pending = [];
      this.onStall();
      return true;
    }
    return false;
  }
}

// A short FIFO preserves press/release edges while a socket briefly drains.
// It never becomes a recording of old movement to play after a bad connection.
export class NetworkInput {
  constructor({
    send,
    isOpen,
    bufferedAmount,
    onStall,
    now = () => performance.now(),
    keepaliveMs = 250,
    maxBufferedBytes = 4096,
    maxPendingMs = 250,
    maxPending = 24,
  }) {
    Object.assign(this, {
      send,
      isOpen,
      bufferedAmount,
      onStall,
      now,
      keepaliveMs,
      maxBufferedBytes,
      maxPendingMs,
      maxPending,
    });
    this.reset();
  }

  reset() {
    this.pending = [];
    this.desired = null;
    this.lastSentAt = -Infinity;
    this.blockedSince = null;
    this.stalled = false;
  }

  update(input, { reset = false, active = true } = {}) {
    if (this.stalled || !this.isOpen()) return;
    const next = copyInput(input);
    if (reset) {
      for (const key of KEYS) next[key] = false;
      this.pending = [];
    }
    if (reset || !sameInput(next, this.desired)) {
      this.desired = next;
      this.pending.push({ input: next, reset, at: this.now() });
    }
    this.tick(active);
  }

  stall() {
    this.pending = [];
    this.desired = null;
    this.stalled = true;
    this.onStall();
  }

  tick(active = false) {
    if (this.stalled) return;
    if (!this.isOpen()) {
      this.pending = [];
      return;
    }
    const now = this.now();
    if (
      this.pending.length > this.maxPending ||
      (this.pending.length && now - this.pending[0].at >= this.maxPendingMs)
    ) {
      this.stall();
      return;
    }
    if (this.bufferedAmount() > this.maxBufferedBytes) {
      this.blockedSince ??= now;
      if (now - this.blockedSince >= this.maxPendingMs) this.stall();
      return;
    }
    this.blockedSince = null;
    while (this.pending.length) {
      if (this.bufferedAmount() > this.maxBufferedBytes) return;
      const command = this.pending[0];
      if (!this.send({ ...command.input, ...(command.reset ? { reset: true } : {}) })) return;
      this.pending.shift();
      this.lastSentAt = now;
    }
    if (active && this.desired && now - this.lastSentAt >= this.keepaliveMs) {
      if (this.send({ ...this.desired })) this.lastSentAt = now;
    }
  }
}
