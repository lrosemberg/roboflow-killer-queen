import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, movePlayer, PLAYER_H, PLAYER_W } from '../shared/world.js';
import { createNavigator } from '../shared/navigation.js';

function walkTo(player, target, map, navigator, limit = 4200) {
  const visited = new Set(); let jumps = 0;
  for (let frame = 0; frame < limit; frame++) {
    const input = navigator.steer(player, target);
    if (player.grounded) { visited.add(navigator.currentFor(player)); if (input.jump) jumps++; }
    const previous = { x: player.x, y: player.y, alive: player.alive };
    movePlayer(player, input, map, 1 / 60, frame * 1000 / 60);
    assert.ok(Math.abs(player.x - previous.x) < 7, 'Navigation cannot teleport horizontally');
    assert.ok(Math.abs(player.y - previous.y) < 16, 'Navigation cannot teleport vertically');
    if (Math.abs(player.x - target.x) < 20 && Math.abs(player.y - target.y) < 3 && player.grounded) return { frames: frame + 1, visited, jumps };
  }
  assert.fail(`Worker could not reach (${target.x},${target.y}); stopped at (${player.x},${player.y})`);
}

test('Classic is a mirrored compact arena with separated supplies, machines and elevated doorways', () => {
  const map = createMap();
  assert.deepEqual([map.width, map.height], [1440, 820]);
  for (const platform of map.platforms) assert.ok(map.platforms.some(other => other.y === platform.y && other.x === map.width - platform.x - platform.w && other.w === platform.w));
  for (const pile of map.berryPiles) {
    assert.ok(pile.x > 400 && pile.x < 1040);
    for (const gate of map.gates) if (Math.abs(pile.y + 22 - gate.y - gate.h) < 5) assert.ok(Math.abs(pile.x - gate.x - gate.w / 2) >= 100);
  }
  for (const base of map.bases) { assert.equal(base.y + base.h, 200); assert.equal(base.door.w, 56); assert.equal(base.door.x + 28, base.x + base.w / 2); }
  assert.deepEqual([map.gatorTrack.x1, map.gatorTrack.x2], [110, 1330]);
});

for (const mode of ['normal', 'xxl']) test(`${mode} workers can deliver from every stockpile to either elevated HQ using only physics inputs`, () => {
  const map = createMap(mode), navigator = createNavigator(map);
  for (const speedBoost of [false, true]) for (const pile of map.berryPiles) for (const base of map.bases) {
    const player = { x: pile.x - PLAYER_W / 2, y: pile.y - 14, alive: true, role: 'worker', grounded: true, vx: 0, vy: 0, jumpHeld: false, speedBoost };
    player.y = map.platforms[navigator.currentFor(player)].y - PLAYER_H;
    const target = { x: base.x + base.w / 2 - PLAYER_W / 2, y: base.y + base.h - PLAYER_H };
    const route = walkTo(player, target, map, navigator);
    assert.ok(route.jumps >= 1, 'A worker must climb toward the elevated HQ');
    assert.ok(route.visited.size >= 2, 'Delivery uses multiple actual platforms');
  }
});

test('Classic collection loops take seven to eleven seconds of ordinary traversal, without timers or extra speed', () => {
  const map = createMap(), navigator = createNavigator(map);
  for (const base of map.bases) for (const pile of map.berryPiles) {
    const home = { x: base.x + base.w / 2 - PLAYER_W / 2, y: base.y + base.h - PLAYER_H };
    const player = { ...home, alive: true, role: 'worker', grounded: true, vx: 0, vy: 0, jumpHeld: false };
    const pickup = { x: pile.x - PLAYER_W / 2, y: pile.y - 14 };
    pickup.y = map.platforms[navigator.goalFor(pickup)].y - PLAYER_H;
    const outgoing = walkTo(player, pickup, map, navigator);
    player.carrying = true;
    const returning = walkTo(player, home, map, navigator);
    assert.ok(returning.jumps >= 1);
    const roundTripSeconds = (outgoing.frames + returning.frames) / 60;
    assert.ok(roundTripSeconds >= 7, `HQ ${base.team}, pile ${pile.id}: ${roundTripSeconds}s route is too short`);
    assert.ok(roundTripSeconds < 11, `HQ ${base.team}, pile ${pile.id}: ${roundTripSeconds}s route is too long`);
  }
});

test('all Classic AI1 stations remain reachable by ordinary and speed-upgraded workers from either HQ', () => {
  const map = createMap(), navigator = createNavigator(map);
  for (const speedBoost of [false, true]) for (const base of map.bases) for (const gate of map.gates) {
    const player = { x: base.x + base.w / 2 - PLAYER_W / 2, y: base.y + base.h - PLAYER_H, alive: true, role: 'worker', grounded: true, vx: 0, vy: 0, jumpHeld: false, speedBoost };
    const target = { x: gate.x + gate.w / 2 - PLAYER_W / 2, y: gate.y + gate.h - PLAYER_H };
    const route = walkTo(player, target, map, navigator);
    assert.ok(route.frames > 0);
    assert.equal(player.y + PLAYER_H, gate.y + gate.h);
  }
});

test('XXL supplies stay distributed across districts and outside immediate HQ collection loops', () => {
  const map = createMap('xxl');
  assert.equal(map.berryPiles.length, 12);
  const xs = map.berryPiles.map(pile => pile.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 6500, 'The large crew must retain many widely separated collection areas');
  assert.equal(new Set(xs).size, 12);
  for (const base of map.bases) for (const pile of map.berryPiles) {
    assert.ok(Math.abs(pile.x - base.x - base.w / 2) > 2000, 'Supply runs should leave the HQ district');
  }
});
