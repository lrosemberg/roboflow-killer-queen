import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMap,
  economyForPlayers,
  movePlayer,
  PLAYER_H,
  SCORE_TARGETS,
} from '../shared/world.js';

const player = (overrides = {}) => ({
  alive: true,
  role: 'worker',
  x: 100,
  y: 704,
  vx: 0,
  vy: 0,
  grounded: true,
  facing: 1,
  ...overrides,
});
test('maps use finite grouped stockpiles, neutral wing/speed gates and scaled objectives', () => {
  for (const mode of ['normal', 'xxl']) {
    const m = createMap(mode);
    assert.equal(m.bases[0].x, m.width - m.bases[1].x - m.bases[1].w);
    assert.equal(m.berryPiles.length, mode === 'xxl' ? 12 : 6);
    assert.equal(m.berrySpawns.length, mode === 'xxl' ? 720 : 60);
    assert.equal(m.scoreTarget, SCORE_TARGETS[mode]);
    assert.equal(m.scoreTarget, mode === 'xxl' ? 144 : 12);
    assert.ok(m.bases.every((base) => base.y + base.h === m.height - 620));
    assert.equal(m.gates.filter((g) => g.kind === 'warrior').length, 3);
    assert.equal(m.gates.filter((g) => g.kind === 'speed').length, 2);
    assert.ok(m.gates.every((g) => g.team === null));
    for (const berry of m.berrySpawns)
      assert.ok(
        m.berryPiles.some((pile) => pile.id === berry.pileId && Math.abs(pile.x - berry.x) <= 14),
      );
    for (const p of m.platforms)
      assert.ok(p.x >= 0 && p.x + p.w <= m.width && p.y > 0 && p.y + p.h <= m.height);
  }
});
test('economic goals retain the twelve-chip minimum and scale above ten participants', () => {
  for (const [participants, target, stock] of [
    [0, 12, 60],
    [1, 12, 60],
    [3, 12, 60],
    [4, 12, 60],
    [6, 12, 60],
    [9, 12, 60],
    [10, 12, 60],
    [11, 14, 66],
    [20, 24, 120],
    [21, 26, 126],
    [120, 144, 720],
  ]) {
    const m = createMap('xxl', participants);
    assert.equal(m.scoreTarget, target);
    assert.equal(m.resourceCount, stock);
    assert.equal(m.berrySpawns.length, stock);
    assert.equal(m.economyPlayerCount, participants);
    const piles = m.berryPiles.map(
      (pile) => m.berrySpawns.filter((chip) => chip.pileId === pile.id).length,
    );
    assert.ok(
      Math.max(...piles) - Math.min(...piles) <= 1,
      'Stock stays evenly distributed across collection points',
    );
    assert.ok(
      stock >= 2 * target,
      'Finite supply can fill both vaults, with extra chips for upgrades',
    );
    assert.equal(
      createMap('normal', participants).scoreTarget,
      target,
      'Geometry does not dictate the objective',
    );
  }
  assert.deepEqual(economyForPlayers(0), {
    economyPlayerCount: 0,
    scoreTarget: 12,
    resourceCount: 60,
  });
});
test('workers have a single jump that can reach 180px platforms; tapping midair does not grant another', () => {
  const p = player();
  const m = createMap();
  movePlayer(p, { jump: true }, m, 1 / 60, 1000);
  assert.ok(p.vy < -700);
  assert.equal(p.jumps, 1);
  movePlayer(p, {}, m, 1 / 60, 1017);
  const before = p.vy;
  movePlayer(p, { jump: true }, m, 1 / 60, 1034);
  assert.ok(p.vy > before);
  assert.equal(p.jumps, 1);
  let minY = p.y;
  for (let i = 0; i < 35; i++) {
    movePlayer(p, {}, m, 1 / 60, 1051 + i * 17);
    minY = Math.min(minY, p.y);
  }
  assert.ok(704 - minY > 180);
});
test('one-way platforms catch downward movement and down drops through them', () => {
  const map = createMap();
  const ledge = map.platforms[1];
  const p = player({ x: ledge.x + 15, y: ledge.y - PLAYER_H - 2, vy: 250, grounded: false });
  movePlayer(p, {}, map, 1 / 60, 1000);
  assert.equal(p.y + PLAYER_H, ledge.y);
  assert.equal(p.grounded, true);
  movePlayer(p, { down: true }, map, 1 / 60, 1017);
  assert.ok(p.y + PLAYER_H > ledge.y);
});
test('Queen flight and dive differ from earned speed; workers have no universal dash', () => {
  const map = createMap();
  const p = player({ role: 'queen' });
  for (let i = 0; i < 60; i++)
    movePlayer(p, { jump: true, left: true }, map, 1 / 60, 1000 + i * 17);
  assert.ok(p.y < 1000);
  assert.equal(p.x, 0);
  movePlayer(p, { down: true, right: true }, map, 1 / 60, 3000);
  assert.equal(p.vy, 1150);
  assert.equal(p.dive, true);
  assert.equal(p.vx, 270);
  const worker = player();
  movePlayer(worker, { dash: true, right: true }, map, 1 / 60, 3000);
  assert.equal(worker.vx, 270);
  worker.speedBoost = true;
  movePlayer(worker, { right: true }, map, 1 / 60, 3017);
  assert.equal(worker.vx, 364.5);
});
