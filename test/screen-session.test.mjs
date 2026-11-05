import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenAwake, toggleGameFullscreen } from '../public/screen-session.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const sentinel = () =>
  Object.assign(new EventTarget(), {
    released: false,
    async release() {
      this.released = true;
      this.dispatchEvent(new Event('release'));
    },
  });

test('fullscreen is optional, handles denial and supports prefixed browser APIs without orientation locks', async () => {
  assert.equal(await toggleGameFullscreen({}, {}), 'unsupported');
  assert.equal(
    await toggleGameFullscreen(
      {
        requestFullscreen() {
          throw new Error('denied');
        },
      },
      {},
    ),
    'denied',
  );
  const element = {
    entered: false,
    webkitRequestFullscreen() {
      this.entered = true;
    },
  };
  assert.equal(await toggleGameFullscreen(element, {}), 'entered');
  assert.equal(element.entered, true);
  const doc = {
    webkitFullscreenElement: element,
    webkitExitFullscreen() {
      this.webkitFullscreenElement = null;
    },
  };
  assert.equal(await toggleGameFullscreen(element, doc), 'exited');
  assert.equal(doc.webkitFullscreenElement, null);
});

test('wake lock is acquired once for active play, released on exit and reacquired on return', async () => {
  const locks = [];
  const manager = new ScreenAwake({
    async request(type) {
      assert.equal(type, 'screen');
      const lock = sentinel();
      locks.push(lock);
      return lock;
    },
  });
  manager.setActive(true);
  manager.setActive(true);
  await flush();
  assert.equal(locks.length, 1);
  manager.setActive(false);
  await flush();
  assert.equal(locks[0].released, true);
  manager.setActive(true);
  await flush();
  assert.equal(locks.length, 2);
  manager.setActive(false);
  await flush();
  assert.equal(locks[1].released, true);
});

test('a pending wake request that resolves after the player leaves is immediately released', async () => {
  let resolveRequest;
  const manager = new ScreenAwake({
    request() {
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  });
  manager.setActive(true);
  await flush();
  manager.setActive(false);
  const lock = sentinel();
  resolveRequest(lock);
  await flush();
  assert.equal(lock.released, true);
  assert.equal(manager.lock, null);
});

test('unsupported or denied wake requests never interrupt play or loop on snapshots', async () => {
  const unsupported = new ScreenAwake(undefined);
  unsupported.setActive(true);
  await flush();
  assert.equal(unsupported.lock, null);
  let attempts = 0;
  const denied = new ScreenAwake({
    async request() {
      attempts++;
      throw new Error('low battery');
    },
  });
  denied.setActive(true);
  await flush();
  for (let i = 0; i < 30; i++) denied.setActive(true);
  await flush();
  assert.equal(attempts, 1);
  assert.equal(denied.lock, null);
});
