import test from 'node:test';
import assert from 'node:assert/strict';
import { InputPrediction } from '../public/prediction.js';
import { PLAYER_H, SPEED } from '../shared/world.js';

const map = { width: 5000, height: 1000, platforms: [{ x: 0, y: 900, w: 5000, h: 100, kind: 'ground' }] };
const worker = () => ({ id: 'test', role: 'worker', alive: true, x: 1000, y: 900 - PLAYER_H, vx: 0, vy: 0, grounded: true, facing: 1, jumpHeld: false, jumps: 0, ack: 0 });
const options = (receivedAt, ack = 0, extra = {}) => ({ ack, map, receivedAt, serverTime: 10000 + receivedAt, active: true, resetKey: 'room:round1', ...extra });
const begin = (prediction, player = worker()) => prediction.reconcile(player, options(0));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .001, `${actual} should be ${expected}`);

test('authoritative acknowledgements remove input and cannot apply it a second time', () => {
  const prediction = new InputPrediction();
  const player = worker(); begin(prediction, player);
  prediction.record({ seq: 1, input: { right: true }, time: 10 });
  const first = prediction.reconcile(player, options(60));
  near(first.x, player.x + SPEED * .05);
  const accepted = { ...player, x: first.x, ack: 1 };
  const second = prediction.reconcile(accepted, options(100, 1));
  near(second.x, accepted.x);
  assert.equal(prediction.lastReplayMs, 0);
  assert.equal(prediction.commands.length, 0);
});

test('rapid opposite directions replay their individual durations, not only the newest direction', () => {
  const prediction = new InputPrediction();
  const player = worker(); begin(prediction, player);
  const mutable = { left: true };
  prediction.record({ seq: 1, input: mutable, time: 10 });
  mutable.left = false; mutable.right = true;
  prediction.record({ seq: 2, input: mutable, time: 70 });
  const predicted = prediction.reconcile(player, options(100));
  near(predicted.x, player.x - SPEED * .06 + SPEED * .03);
  assert.equal(predicted.facing, 1);
});

test('a lifecycle reset cancels unacknowledged jumps immediately and preserves fresh input in the same round', () => {
  const prediction = new InputPrediction(); const player = worker(); begin(prediction, player);
  const context = prediction.context;
  prediction.record({ seq: 1, input: { jump: true, right: true }, time: 10 });
  // Like the server, reset overrides any stale booleans in the packet.
  prediction.record({ seq: 2, input: { reset: true, jump: true, right: true }, time: 20 });
  assert.equal(prediction.context, context);
  assert.equal(prediction.commands.length, 1);
  const cancelled = prediction.reconcile(player, options(80, 0));
  assert.equal(cancelled.grounded, true); assert.equal(cancelled.jumps, 0);
  near(cancelled.x, player.x); near(cancelled.y, player.y);
  prediction.record({ seq: 3, input: { jump: true }, time: 90 });
  const fresh = prediction.reconcile(player, options(110, 0));
  assert.equal(fresh.grounded, false); assert.equal(fresh.jumps, 1); assert.ok(fresh.vy < 0);
  near(fresh.x, player.x);
  // A duplicate/outdated reset cannot erase newer accepted commands.
  prediction.record({ seq: 2, input: { reset: true }, time: 120 });
  assert.equal(prediction.commands.at(-1).seq, 3);
});

test('acknowledged jump edge is not triggered again by a held pending input', () => {
  const prediction = new InputPrediction();
  const player = { ...worker(), grounded: false, y: 780, vy: -200, jumpHeld: true, jumps: 1 };
  begin(prediction, player);
  prediction.record({ seq: 1, input: { jump: true }, time: 10 });
  prediction.record({ seq: 2, input: { jump: true }, time: 40 });
  const predicted = prediction.reconcile(player, options(80, 1));
  assert.equal(predicted.jumps, 1);
  assert.ok(predicted.vy > player.vy, 'gravity continues; a held jump does not create another jump');
});

test('a fresh jump transition and queen dive use shared movement rules', () => {
  const prediction = new InputPrediction(); begin(prediction);
  prediction.record({ seq: 1, input: { jump: true }, time: 10 });
  const jumping = prediction.reconcile(worker(), options(40));
  assert.equal(jumping.grounded, false);
  assert.equal(jumping.jumps, 1);
  assert.ok(jumping.vy < 0);

  const queen = { ...worker(), role: 'queen', grounded: false, y: 300 };
  prediction.reset(); begin(prediction, queen);
  prediction.record({ seq: 1, input: { down: true }, time: 10 });
  const diving = prediction.reconcile(queen, options(50));
  assert.equal(diving.dive, true);
  assert.ok(diving.y > queen.y);
});

test('delayed packets have bounded replay and expired history cannot cause runaway movement', () => {
  const prediction = new InputPrediction(); const player = worker(); begin(prediction, player);
  prediction.record({ seq: 1, input: { right: true }, time: 10 });
  const delayed = prediction.reconcile(player, options(1000));
  near(delayed.x, player.x + SPEED * .25);
  near(prediction.lastReplayMs, 250);
  const expired = prediction.reconcile(player, options(2500));
  near(expired.x, player.x);
  assert.equal(prediction.commands.length, 0);
});

test('trimming a delayed interval cannot resurrect an old jump press', () => {
  const prediction = new InputPrediction(); const player = worker(); begin(prediction, player);
  prediction.record({ seq: 1, input: { jump: true }, time: 10 });
  const trimmed = prediction.reconcile(player, options(1000));
  assert.equal(trimmed.grounded, true);
  assert.equal(trimmed.jumps, 0);
  prediction.record({ seq: 2, input: { jump: false }, time: 1010 });
  prediction.record({ seq: 3, input: { jump: true }, time: 1040 });
  const freshPress = prediction.reconcile(player, options(1100));
  assert.equal(freshPress.grounded, false);
  assert.equal(freshPress.jumps, 1);
});

test('death, respawn, role changes, rides, and new rounds discard the previous movement history', () => {
  const cases = [
    [{ alive: false }, {}], [{ invulnerableUntil: 12000 }, {}],
    [{ role: 'warrior' }, {}], [{ speedBoost: true }, {}],
    [{}, { riding: true }], [{}, { active: false }],
    [{}, { resetKey: 'room:round2' }],
  ];
  for (const [patch, extra] of cases) {
    const prediction = new InputPrediction(); const player = worker(); begin(prediction, player);
    prediction.record({ seq: 1, input: { right: true }, time: 10 });
    const authoritative = { ...player, ...patch };
    const predicted = prediction.reconcile(authoritative, options(100, 0, extra));
    assert.deepEqual(predicted, authoritative);
    assert.equal(prediction.commands.length, 0);
  }
});

test('replay uses collisions and never mutates the server snapshot', () => {
  const prediction = new InputPrediction(); const player = { ...worker(), x: map.width - 30 }; begin(prediction, player);
  const original = { ...player };
  prediction.record({ seq: 1, input: { right: true }, time: 10 });
  const predicted = prediction.reconcile(player, options(100));
  assert.ok(predicted.x < map.width);
  assert.deepEqual(player, original);
});

test('AI1 channel entry, active channel and cancellation discard stale movement, then accept fresh input', () => {
  const prediction = new InputPrediction(); const player = worker(); begin(prediction, player);
  prediction.record({ seq: 1, input: { right: true }, time: 10 });
  const installing = { ...player, upgradeUntil: 11000, upgradeGateId: 2, upgradeKind: 'warrior' };
  assert.deepEqual(prediction.reconcile(installing, options(100)), installing);
  assert.equal(prediction.commands.length, 0);

  prediction.record({ seq: 2, input: { left: true }, time: 110 });
  assert.deepEqual(prediction.reconcile(installing, options(200)), installing);
  assert.equal(prediction.lastReplayMs, 0);
  assert.equal(prediction.commands.length, 0);

  // Cancellation keeps the same role, so the upgrade context itself must reset.
  prediction.record({ seq: 3, input: { jump: true }, time: 210 });
  const cancelled = { ...player, upgradeUntil: 0, upgradeGateId: null, upgradeKind: null };
  assert.deepEqual(prediction.reconcile(cancelled, options(300)), cancelled);
  assert.equal(prediction.commands.length, 0);
  prediction.record({ seq: 4, input: { right: true }, time: 320 });
  near(prediction.reconcile(cancelled, options(400)).x, player.x + SPEED * .08);
});
