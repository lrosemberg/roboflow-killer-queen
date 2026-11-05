import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_CATALOG,
  PLAYABLE_MAPS,
  NEXT_MAP,
  DEFAULT_MAP_ID,
  isMapId,
  normalizeMapId,
} from '../shared/maps.js';
import { createMap, movePlayer, PLAYER_W, PLAYER_H } from '../shared/world.js';
import { createNavigator } from '../shared/navigation.js';

function travel(player, target, map, navigator) {
  for (let frame = 0; frame < 4200; frame++) {
    const before = { x: player.x, y: player.y };
    movePlayer(player, navigator.steer(player, target), map, 1 / 60, (frame * 1000) / 60);
    assert.ok(
      Math.abs(player.x - before.x) < 7,
      'Navigation must use ordinary horizontal movement',
    );
    assert.ok(Math.abs(player.y - before.y) < 16, 'Navigation must use ordinary vertical movement');
    if (Math.abs(player.x - target.x) < 20 && Math.abs(player.y - target.y) < 3 && player.grounded)
      return (frame + 1) / 60;
  }
  assert.fail(
    `${map.mapId}/${map.mode} worker stalled at ${player.x},${player.y} toward ${target.x},${target.y}`,
  );
}
const worker = (position, speedBoost = false) => ({
  ...position,
  alive: true,
  role: 'worker',
  grounded: true,
  vx: 0,
  vy: 0,
  jumpHeld: false,
  speedBoost,
});
const home = (base) => ({ x: base.x + base.w / 2 - PLAYER_W / 2, y: base.y + base.h - PLAYER_H });

test('the catalog exposes five playable maps and a future map that cannot become a server map', () => {
  assert.equal(MAP_CATALOG.length, 6);
  assert.equal(PLAYABLE_MAPS.length, 5);
  assert.equal(NEXT_MAP.id, 'next-onsite');
  assert.equal(NEXT_MAP.status, 'coming-soon');
  assert.equal(isMapId(NEXT_MAP.id), false);
  assert.equal(isMapId('__proto__'), false);
  assert.equal(normalizeMapId(NEXT_MAP.id), DEFAULT_MAP_ID);
  assert.equal(createMap().mapId, 'miami');
  for (const definition of PLAYABLE_MAPS) {
    assert.equal(isMapId(definition.id), true);
    assert.match(definition.preview, /^\/assets\/maps\/[a-z-]+\.svg$/);
    assert.ok(definition.ride.name && definition.queen.style);
  }
});

test('every city and size uses the full twelve-chip minimum, then scales larger crews proportionally', () => {
  for (const definition of PLAYABLE_MAPS)
    for (const mode of ['normal', 'xxl']) {
      for (const [participants, target, stock] of [
        [1, 12, 60],
        [4, 12, 60],
        [10, 12, 60],
        [11, 14, 66],
        [20, 24, 120],
        [120, 144, 720],
      ]) {
        const map = createMap(mode, participants, definition.id);
        assert.equal(
          map.economyPlayerCount,
          participants,
          'Minimum goals must not inflate the reported roster',
        );
        assert.equal(map.scoreTarget, target);
        assert.equal(map.resourceCount, stock);
        assert.equal(map.berrySpawns.length, stock);
      }
    }
});

for (const mode of ['normal', 'xxl'])
  test(`${mode}: every city has a distinct deterministic layout and the same proportional economy`, () => {
    const shapes = new Set();
    for (const definition of PLAYABLE_MAPS) {
      const map = createMap(mode, 10, definition.id);
      assert.deepEqual(map, createMap(mode, 10, definition.id));
      assert.equal(map.mapId, definition.id);
      assert.equal(map.name, definition.name);
      assert.equal(map.scoreTarget, 12);
      assert.equal(map.berrySpawns.length, 60);
      assert.equal(map.berryPiles.length, mode === 'normal' ? 6 : 12);
      assert.equal(map.width, mode === 'normal' ? 1440 : 12000);
      assert.equal(map.height, mode === 'normal' ? 820 : 2000);
      assert.equal(map.bases[0].x, map.width - map.bases[1].x - map.bases[1].w);
      for (const platform of map.platforms) {
        assert.ok(platform.x >= 0 && platform.x + platform.w <= map.width);
        assert.ok(platform.y > 0 && platform.y + platform.h <= map.height);
        if (mode === 'normal' || definition.id !== 'miami')
          assert.ok(
            map.platforms.some(
              (other) =>
                other.x === map.width - platform.x - platform.w &&
                other.y === platform.y &&
                other.w === platform.w,
            ),
            'Gameplay ledges mirror across the arena',
          );
      }
      for (const gate of map.gates)
        assert.ok(
          map.platforms.some(
            (platform) =>
              platform.y === gate.y + gate.h &&
              gate.x >= platform.x &&
              gate.x + gate.w <= platform.x + platform.w,
          ),
          'Every machine must stand on a real reachable ledge',
        );
      shapes.add(JSON.stringify(map.platforms));
    }
    assert.equal(shapes.size, 5, 'City choices change layout as well as scenery');
  });

for (const definition of PLAYABLE_MAPS)
  for (const mode of ['normal', 'xxl'])
    test(`${definition.name} ${mode}: every supply reaches either HQ with normal or upgraded worker physics`, () => {
      const map = createMap(mode, undefined, definition.id),
        navigator = createNavigator(map);
      for (const speedBoost of [false, true])
        for (const pile of map.berryPiles)
          for (const base of map.bases) {
            const position = { x: pile.x - PLAYER_W / 2, y: pile.y - 14 };
            position.y = map.platforms[navigator.goalFor(position)].y - PLAYER_H;
            travel(worker(position, speedBoost), home(base), map, navigator);
          }
      for (const base of map.bases)
        for (const gate of map.gates) {
          travel(
            worker(home(base)),
            { x: gate.x + gate.w / 2 - PLAYER_W / 2, y: gate.y + gate.h - PLAYER_H },
            map,
            navigator,
          );
        }
    });

test('every Classic city preserves contested seven-to-eleven-second collection routes and mirrored travel times', () => {
  for (const definition of PLAYABLE_MAPS) {
    const map = createMap('normal', 10, definition.id),
      navigator = createNavigator(map);
    const times = [[], []];
    for (const base of map.bases)
      for (const pile of map.berryPiles) {
        const player = worker(home(base)),
          target = { x: pile.x - PLAYER_W / 2, y: pile.y - 14 };
        target.y = map.platforms[navigator.goalFor(target)].y - PLAYER_H;
        const duration =
          travel(player, target, map, navigator) + travel(player, home(base), map, navigator);
        assert.ok(
          duration >= 7 && duration < 11,
          `${definition.id} pile ${pile.id}: ${duration}s collection loop`,
        );
        times[base.team].push(duration);
      }
    times.forEach((team) => team.sort((a, b) => a - b));
    for (let i = 0; i < times[0].length; i++)
      assert.ok(
        Math.abs(times[0][i] - times[1][i]) < 0.05,
        `${definition.id} routes should be symmetric`,
      );
  }
});
