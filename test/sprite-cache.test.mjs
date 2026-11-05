import test from 'node:test';
import assert from 'node:assert/strict';

// Importing the real sprite module only creates its atlas; injected drawing
// keeps the cache tests independent of DOM, Canvas rasterization and image IO.
globalThis.Image = class {
  complete = false;
  naturalWidth = 0;
};
const { RaccoonSpriteCache } = await import('../public/sprite-cache.js');

const player = (extra = {}) => ({
  id: 'one',
  name: 'Lenny',
  x: 10,
  y: 20,
  facing: 1,
  team: 0,
  role: 'worker',
  grounded: true,
  vx: 270,
  carrying: false,
  ...extra,
});
function fixture(options = {}) {
  let ready = true;
  const draws = [],
    canvases = [],
    paints = [];
  const ctx = {
    save() {
      paints.push(['save']);
    },
    translate(...args) {
      paints.push(['translate', ...args]);
    },
    scale(...args) {
      paints.push(['scale', ...args]);
    },
    drawImage(...args) {
      paints.push(['image', ...args]);
    },
    restore() {
      paints.push(['restore']);
    },
  };
  const cache = new RaccoonSpriteCache({
    createCanvas(width, height) {
      const context = {};
      const canvas = { width, height, getContext: () => context };
      canvases.push(canvas);
      return canvas;
    },
    drawSprite(...args) {
      draws.push(args);
    },
    isSourceReady: () => ready,
    ...options,
  });
  return {
    cache,
    draws,
    canvases,
    paints,
    ctx,
    setReady(value) {
      ready = value;
    },
  };
}

test('sprite frames reuse different identities, positions and facings, mirroring at the player anchor', () => {
  const f = fixture();
  const first = player();
  f.cache.draw(f.ctx, first, 0, { now: 10, mapId: 'brazil' });
  f.cache.draw(
    f.ctx,
    player({ id: 'different-long-id', name: 'Other', x: 100, y: 200, facing: -1 }),
    0,
    { now: 20, mapId: 'brazil', scale: 3.5 },
  );
  assert.equal(f.draws.length, 1);
  assert.equal(f.cache.stats().hits, 1);
  assert.equal(f.cache.stats().entries, 1);
  assert.deepEqual(f.paints.slice(6, 8), [
    ['translate', 114, 236],
    ['scale', -2, 2],
  ]);
  assert.equal(f.draws[0][1].facing, 1);
  assert.equal(f.draws[0][3].mapId, 'brazil');
  assert.deepEqual(first, player(), 'Caller state remains unchanged');
});

test('animation retains sixteen reusable phases and separates role, team, carrying, motion and speed', () => {
  const f = fixture();
  for (let i = 0; i < 16; i++) f.cache.draw(f.ctx, player(), (i + 0.1) / 28, { now: 10 });
  assert.equal(f.cache.stats().entries, 16);
  f.cache.draw(f.ctx, player(), 16.1 / 28, { now: 10 });
  assert.equal(f.cache.stats().hits, 1);
  for (const state of [
    { role: 'queen' },
    { team: 1 },
    { carrying: true },
    { grounded: false },
    { vx: 0 },
    { speedBoost: true },
  ])
    f.cache.draw(f.ctx, player(state), 0, { now: 10 });
  assert.equal(f.cache.stats().entries, 22);
  assert.equal(f.draws.length, 22);
  assert.ok(f.canvases.every((c) => c.width === 128 && c.height === 96));
});

test('LRU capacity is hard bounded, recently used frames survive and evicted backing stores are released', () => {
  const f = fixture({ capacity: 2 });
  f.cache.draw(f.ctx, player(), 0, { now: 10 });
  f.cache.draw(f.ctx, player({ team: 1 }), 0, { now: 10 });
  f.cache.draw(f.ctx, player(), 0, { now: 10 });
  f.cache.draw(f.ctx, player({ role: 'queen' }), 0, { now: 10 });
  assert.equal(f.canvases[1].width, 0);
  assert.equal(f.canvases[0].width, 128);
  assert.equal(f.cache.stats().evictions, 1);
  assert.equal(f.cache.stats().entries, 2);
  assert.equal(f.cache.stats().estimatedBytes, 2 * 128 * 96 * 4);
  assert.equal(fixture({ capacity: 5000 }).cache.stats().capacity, 256);
  f.cache.clear();
  assert.equal(f.cache.stats().entries, 0);
  assert.ok(f.canvases.every((c) => c.width === 0 && c.height === 0));
});

test('map and atlas readiness transitions invalidate frames and never cache fallback faces', () => {
  const f = fixture();
  f.setReady(false);
  f.cache.draw(f.ctx, player(), 0, { now: 10, mapId: 'miami' });
  assert.equal(f.canvases.length, 0);
  assert.equal(f.draws[0][0], f.ctx);
  f.setReady(true);
  f.cache.draw(f.ctx, player(), 0, { now: 10, mapId: 'miami' });
  f.cache.draw(f.ctx, player(), 0, { now: 10, mapId: 'new-york' });
  assert.equal(f.canvases[0].width, 0);
  assert.equal(f.cache.stats().entries, 1);
  f.setReady(false);
  f.cache.draw(f.ctx, player(), 0, { now: 10, mapId: 'new-york' });
  assert.equal(f.cache.stats().entries, 0);
  f.setReady(true);
  f.cache.draw(f.ctx, player(), 0, { now: 10, mapId: 'new-york' });
  assert.equal(f.canvases.length, 3);
});

test('attack bursts and disabled comparisons use the exact original draw without allocating frames', () => {
  const f = fixture();
  const attacking = player({ attackUntil: 150 });
  const options = { now: 100, mapId: 'san-francisco' };
  f.cache.draw(f.ctx, attacking, 9.5, options);
  assert.deepEqual(f.draws[0], [f.ctx, attacking, 9.5, options]);
  f.cache.enabled = false;
  f.cache.draw(f.ctx, player(), 10, options);
  assert.equal(f.canvases.length, 0);
  assert.equal(f.paints.length, 0);
  assert.equal(f.cache.stats().bypasses, 2);
});
