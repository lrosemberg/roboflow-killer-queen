import test from 'node:test';
import assert from 'node:assert/strict';
import { queuePlayerInput, consumePlayerInput, resetPlayerInput } from '../shared/input-buffer.js';
import { movePlayer, PLAYER_H } from '../shared/world.js';

// Input-buffer behavior is independent of arena ledges. Use open space above
// a real collision floor so jumps and released flight can finish naturally.
const map = { width: 1440, height: 820, platforms: [{ x: 0, y: 740, w: 1440, h: 80, kind: 'ground' }] };
const makePlayer = (role = 'worker') => ({ role, alive: true, x: 30, y: 740 - PLAYER_H, vx: 0, vy: 0, grounded: true, jumpHeld: false });
const frame = (p, tick = 0) => movePlayer(p, consumePlayerInput(p), map, 1 / 60, 1000 + tick * 1000 / 60);

test('a complete jump tap between frames launches once and never repeats after landing', () => {
  const p = makePlayer(); resetPlayerInput(p);
  queuePlayerInput(p, { jump: true }); queuePlayerInput(p, {});
  frame(p);
  assert.ok(p.vy < -700); assert.equal(p.grounded, false);
  assert.equal(p.input.jump, false, 'Latest held state still reflects the release');
  for (let tick = 1; tick < 100; tick++) frame(p, tick);
  assert.equal(p.grounded, true); assert.equal(p.y, 740 - PLAYER_H); assert.equal(p.vy, 0);
  assert.equal(consumePlayerInput(p).jump, false);
});

test('release and repress between frames is a fresh jump even after holding through landing', () => {
  const p = makePlayer(); resetPlayerInput(p); queuePlayerInput(p, { jump: true });
  for (let tick = 0; tick < 100; tick++) frame(p, tick);
  assert.equal(p.grounded, true); assert.equal(p.jumpHeld, true);
  queuePlayerInput(p, {}); queuePlayerInput(p, { jump: true }); queuePlayerInput(p, {});
  frame(p, 100); assert.ok(p.vy < -700);
});

test('midair taps are consumed immediately and do not create a double jump or landing jump', () => {
  const p = makePlayer(); resetPlayerInput(p);
  queuePlayerInput(p, { jump: true }); frame(p);
  queuePlayerInput(p, {}); queuePlayerInput(p, { jump: true }); queuePlayerInput(p, {});
  const vy = p.vy; frame(p, 1); assert.ok(p.vy > vy);
  for (let tick = 2; tick < 100; tick++) frame(p, tick);
  assert.equal(p.grounded, true); assert.equal(p.y, 740 - PLAYER_H);
});

test('short action taps are observed once while movement stays at its latest state', () => {
  const p = {}; resetPlayerInput(p);
  queuePlayerInput(p, { action: true, left: true });
  queuePlayerInput(p, { right: true });
  assert.deepEqual(consumePlayerInput(p), { left: false, right: true, jump: false, action: true, dash: false, down: false });
  assert.equal(consumePlayerInput(p).action, false);
  queuePlayerInput(p, { action: true });
  for (let tick = 0; tick < 3; tick++) assert.equal(consumePlayerInput(p).action, true, 'Holding action retains existing behavior');
});

test('lifecycle resets discard pending taps and held inputs, and allow a fresh finger press', () => {
  const p = makePlayer(); resetPlayerInput(p);
  queuePlayerInput(p, { jump: true, action: true, right: true }); queuePlayerInput(p, {});
  resetPlayerInput(p); frame(p);
  assert.equal(p.grounded, true); assert.equal(p.vx, 0); assert.equal(consumePlayerInput(p).action, false);
  queuePlayerInput(p, { jump: true }); frame(p, 1); assert.ok(p.vy < -700);
});

test('Queen flight still flaps while held, then stops flapping after release', () => {
  const p = makePlayer('queen'); resetPlayerInput(p); queuePlayerInput(p, { jump: true });
  for (let tick = 0; tick < 24; tick++) frame(p, tick);
  assert.ok(p.vy < 0); assert.ok(p.y < 740 - PLAYER_H - 100);
  queuePlayerInput(p, {}); const nextFlap = p.nextFlap;
  for (let tick = 24; tick < 50; tick++) frame(p, tick);
  assert.equal(p.nextFlap, nextFlap); assert.ok(p.vy > 0);
});
