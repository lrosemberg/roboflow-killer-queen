import test from 'node:test';
import assert from 'node:assert/strict';
import { canContactStrike, bumpOpponents } from '../shared/combat.js';
import { movePlayer } from '../shared/world.js';

const makePlayer = (id, team, extra = {}) => ({
  id,
  team,
  role: 'warrior',
  alive: true,
  x: 100,
  y: 600,
  vx: 0,
  vy: 0,
  grounded: false,
  facing: 1,
  invulnerableUntil: 0,
  ...extra,
});
const map = {
  width: 1440,
  height: 820,
  platforms: [{ x: 0, y: 740, w: 1440, h: 80, kind: 'ground' }],
};

test('contact kills require height and facing; equal-height clashes have no iteration winner', () => {
  const a = makePlayer('a', 0),
    b = makePlayer('b', 1, { x: 120, facing: -1 });
  assert.equal(canContactStrike(a, b, 1000), false);
  assert.equal(canContactStrike(b, a, 1000), false);
  a.y -= 10;
  assert.equal(canContactStrike(a, b, 1000), true);
  assert.equal(canContactStrike(b, a, 1000), false, 'A lower facing attacker cannot kill');
  a.facing = -1;
  assert.equal(canContactStrike(a, b, 1000), false, 'An exposed back cannot strike');
  a.role = 'queen';
  a.dive = true;
  assert.equal(canContactStrike(a, b, 1000), true, 'A Queen dive hits below regardless of facing');
  a.role = 'warrior';
  assert.equal(canContactStrike(a, b, 1000), false, 'Only Queens have a dive attack');
  a.role = 'worker';
  a.facing = 1;
  assert.equal(canContactStrike(a, b, 1000), false);
});

test('enemy-only bumps are bounded, decay through shared physics, and are not multiplied by a crowd', () => {
  const a = makePlayer('a', 0),
    b = makePlayer('b', 1, { x: 110 });
  assert.equal(bumpOpponents(a, { ...b, team: 0 }, 1000), false);
  assert.equal(bumpOpponents(a, b, 1000), true);
  assert.equal(a.bumpVx, -180);
  assert.equal(b.bumpVx, 180);
  for (let i = 0; i < 59; i++)
    assert.equal(bumpOpponents(a, makePlayer(`enemy${i}`, 1), 1000), false);
  for (let frame = 0; frame < 40; frame++)
    movePlayer(a, {}, map, 1 / 60, 1000 + (frame * 1000) / 60);
  assert.equal(a.bumpVx, 0);
  assert.equal(a.vx, 0);
  assert.ok(a.x > 80, 'Bounce displacement remains small');
});

test('a worker can escape a dense enemy overlap even against the arena wall', () => {
  const a = makePlayer('a', 0, { role: 'worker', x: 0, y: 704, grounded: true });
  const crowd = Array.from({ length: 60 }, (_, i) =>
    makePlayer(`enemy${i}`, 1, { role: 'worker', x: 5, y: 704, grounded: true }),
  );
  for (let frame = 0; frame < 90; frame++) {
    const now = 1000 + (frame * 1000) / 60;
    for (const b of crowd) bumpOpponents(a, b, now);
    movePlayer(a, { right: true }, map, 1 / 60, now);
    assert.ok(a.vx > 0, 'Bounded bounce never overpowers active movement');
  }
  assert.ok(a.x > 300);
  assert.equal(a.alive, true);
});
