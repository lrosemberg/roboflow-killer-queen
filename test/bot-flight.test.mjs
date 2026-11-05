import test from 'node:test';
import assert from 'node:assert/strict';
import { pulseBotFlight } from '../shared/bot-flight.js';
import { movePlayer, PLAYER_H } from '../shared/world.js';

const map = {
  width: 1440,
  height: 1600,
  platforms: [{ x: 0, y: 1520, w: 1440, h: 80, kind: 'ground' }],
};

for (const role of ['queen', 'warrior'])
  test(`${role} bots generate separated presses and gain altitude through ordinary movement`, () => {
    const p = { role, alive: true, x: 200, y: 1520 - PLAYER_H, grounded: true, vx: 0, vy: 0 };
    const desire = { jump: true, right: true };
    const flaps = [];
    let previousJump = false;
    for (let tick = 0; tick < 120; tick++) {
      const now = 1000 + (tick * 1000) / 60;
      const input = pulseBotFlight(p, desire, now);
      assert.equal(Boolean(input.jump && previousJump), false, 'Every press has a release');
      const before = p.nextFlap;
      movePlayer(p, input, map, 1 / 60, now);
      if (p.nextFlap !== before) flaps.push(now);
      previousJump = input.jump;
    }
    assert.ok(flaps.length >= 8);
    for (let i = 1; i < flaps.length; i++)
      assert.ok(flaps[i] - flaps[i - 1] >= (role === 'queen' ? 190 : 220));
    assert.ok(p.y < 1520 - PLAYER_H - 400);
    assert.equal(p.x, 740, 'Normal speed and collision code still determine movement');
    assert.deepEqual(desire, { jump: true, right: true }, 'Cached strategy input stays immutable');
    for (let tick = 120; tick < 155; tick++)
      movePlayer(p, pulseBotFlight(p, {}, 1000 + tick * 17), map, 1 / 60, 1000 + tick * 17);
    assert.ok(p.vy > 0, 'Stopping the flight desire allows gravity to take over');
  });

test('flight pulse keeps worker navigation intact and respects Queen dive', () => {
  const input = { jump: true, down: true, action: true };
  assert.equal(pulseBotFlight({ role: 'worker' }, input, 1000), input);
  assert.equal(pulseBotFlight({ role: 'queen' }, input, 1000).jump, false);
  assert.equal(pulseBotFlight({ role: 'warrior' }, input, 1000).jump, true);
});
