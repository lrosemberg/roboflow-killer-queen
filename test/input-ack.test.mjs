import assert from 'node:assert/strict';
import test from 'node:test';
import { InputAckWatchdog } from '../public/network-input.js';

function fixture(capacity = 128) {
  let time = 0,
    stalls = 0;
  const guard = new InputAckWatchdog({
    now: () => time,
    onStall: () => stalls++,
    capacity,
  });
  return {
    guard,
    set time(value) {
      time = value;
    },
    get stalls() {
      return stalls;
    },
  };
}

test('healthy 250ms input keepalive and regular authoritative ACKs never reconnect', () => {
  const f = fixture();
  let seq = 0;
  for (let time = 0; time <= 10000; time += 50) {
    f.time = time;
    if (time % 250 === 0) f.guard.record(++seq);
    const ack = time % 250 === 0 ? seq - 1 : seq;
    assert.equal(f.guard.acknowledge(ack), false);
    assert.ok(f.guard.pending.length <= 1);
  }
  assert.equal(f.stalls, 0);
});

test('regular snapshots with stale ACKs cannot hide an outstanding two-second command', () => {
  const f = fixture();
  let seq = 0;
  for (let time = 0; time < 2000; time += 50) {
    f.time = time;
    if (time % 250 === 0) f.guard.record(++seq);
    assert.equal(f.guard.acknowledge(0), false);
  }
  f.time = 2000;
  f.guard.record(++seq);
  assert.equal(f.guard.acknowledge(0), true);
  assert.equal(f.stalls, 1, 'New sends must not restart the age of the oldest input');
  assert.equal(f.guard.pending.length, 0);
  f.guard.acknowledge(0);
  assert.equal(f.stalls, 1, 'Recovery fires once per transport');
});

test('an ACK that catches up at the threshold drains commands before considering recovery', () => {
  const f = fixture();
  f.guard.record(5);
  f.time = 1800;
  f.guard.record(6);
  f.time = 2100;
  assert.equal(f.guard.acknowledge(5), false);
  assert.deepEqual(
    f.guard.pending.map((command) => command.seq),
    [6],
  );
  f.time = 2500;
  assert.equal(f.guard.acknowledge(6), false);
  assert.equal(f.stalls, 0);
});

test('inactive play, explicit input reset and replacement sessions discard old tracking', () => {
  for (const reset of [
    (guard) => guard.acknowledge(0, { active: false }),
    (guard) => guard.record(11, { active: false }),
    (guard) => guard.record(11, { reset: true }),
    (guard) => guard.reset(),
  ]) {
    const f = fixture();
    f.guard.record(10);
    f.time = 4000;
    reset(f.guard);
    assert.equal(f.guard.acknowledge(0), false);
    assert.equal(f.guard.pending.length, 0);
    f.guard.record(1);
    assert.equal(f.guard.pending[0].at, 4000);
    assert.equal(f.stalls, 0);
  }
});

test('bounded command history retains its oldest deadline despite a flood of later inputs', () => {
  const f = fixture(8);
  for (let seq = 1; seq <= 1000; seq++) {
    f.time = seq;
    f.guard.record(seq);
    assert.ok(f.guard.pending.length <= 8);
  }
  assert.equal(f.guard.pending[0].seq, 1);
  assert.equal(f.guard.pending[0].at, 1);
  f.time = 2001;
  assert.equal(f.guard.acknowledge(0), true);
  assert.equal(f.stalls, 1);
});
