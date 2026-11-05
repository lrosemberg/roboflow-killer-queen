import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { PLAYABLE_MAPS } from '../shared/maps.js';
import { decodeSnapshot } from '../shared/protocol.js';

// Two private clients exercise the actual HTTP/WebSocket route. No game state
// is patched and no public room is created. Run locally or on an authorized host.
const base = new URL(process.argv[2] || 'http://localhost:8787');
assert.ok(['http:', 'https:'].includes(base.protocol), 'Use an HTTP(S) game URL');
const output = process.argv[3] || 'scripts/map-smoke-result.json';
const socketUrl = new URL('/ws?protocol=compact-v1', base);
socketUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
const peers = [];
const report = {
  testedAt: new Date().toISOString(),
  url: base.origin,
  success: false,
  maps: [],
  checks: [],
  note: 'Two synthetic clients on one machine; not a physical-device or capacity test.',
};

async function connect() {
  const socket = new WebSocket(socketUrl, { handshakeTimeout: 10000, origin: base.origin });
  const peer = { socket, queue: [], pending: [] };
  peers.push(peer);
  peer.wait = (type, predicate = () => true) => {
    const queued = peer.queue.findIndex((message) => message.type === type && predicate(message));
    if (queued >= 0) return Promise.resolve(peer.queue.splice(queued, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve, reject };
      waiter.timer = setTimeout(() => {
        peer.pending = peer.pending.filter((item) => item !== waiter);
        reject(new Error(`Timed out waiting for ${type}`));
      }, 10000);
      peer.pending.push(waiter);
    });
  };
  peer.send = (message) => socket.send(JSON.stringify(message));
  socket.on('message', (bytes) => {
    const message = decodeSnapshot(JSON.parse(bytes));
    const index = peer.pending.findIndex(
      (waiter) => waiter.type === message.type && waiter.predicate(message),
    );
    if (index >= 0) {
      const [waiter] = peer.pending.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else if (message.type !== 'state') {
      peer.queue.push(message);
      if (peer.queue.length > 30) peer.queue.shift();
    }
  });
  const fail = (error) => {
    for (const waiter of peer.pending.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('Connection closed')));
  peer.id = (await peer.wait('welcome')).id;
  return peer;
}

try {
  const health = await fetch(new URL('/api/health', base), {
    signal: AbortSignal.timeout(10000),
  }).then((response) => response.json());
  assert.equal(health.ok, true);
  report.version = health.version;
  for (const destination of PLAYABLE_MAPS) {
    const response = await fetch(new URL(destination.preview, base), {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, `${destination.name} preview missing`);
    assert.match(await response.text(), /<svg/);
  }
  report.checks.push('All five destination previews served');
  const [host, guest] = await Promise.all([connect(), connect()]);
  for (const mode of ['normal', 'xxl']) {
    host.send({
      type: 'create',
      name: 'Map QA Host',
      roomName: 'Private map smoke',
      mapId: 'miami',
      mode,
      role: 'worker',
      private: true,
      botCount: 0,
    });
    const joined = await host.wait('joined');
    assert.equal(joined.map.mapId, 'miami');
    assert.equal(joined.map.mode, mode);
    guest.send({ type: 'join', code: joined.code, name: 'Map QA Guest', role: 'worker' });
    const arrived = await guest.wait('joined');
    assert.equal(arrived.map.mapId, 'miami');
    const ids = arrived.players.map((player) => player.id).sort();
    let revision = arrived.mapRevision ?? arrived.room.mapRevision ?? 0;
    guest.send({ type: 'map', mapId: 'singapore' });
    await guest.wait('error');
    host.send({ type: 'map', mapId: 'next-onsite' });
    await host.wait('error');
    for (const destination of [...PLAYABLE_MAPS.slice(1), PLAYABLE_MAPS[0]]) {
      host.send({ type: 'map', mapId: destination.id });
      const [changed, observed] = await Promise.all([
        host.wait('map-changed'),
        guest.wait('map-changed'),
      ]);
      assert.equal(changed.map.mapId, destination.id);
      assert.equal(observed.map.mapId, destination.id);
      assert.equal(changed.map.mode, mode);
      assert.ok(changed.mapRevision > revision, 'Map revision must advance');
      revision = changed.mapRevision;
      assert.deepEqual(changed.map, observed.map, 'Both peers must receive identical geometry');
      assert.deepEqual(
        changed.players.map((player) => player.id).sort(),
        ids,
        'Changing maps must preserve participants',
      );
      assert.equal(changed.map.scoreTarget, 12);
      assert.equal(changed.map.resourceCount, 60);
      const snapshot = await guest.wait(
        'state',
        (state) => state.mapId === destination.id && state.mapRevision === revision,
      );
      assert.equal(snapshot.status, 'waiting');
      report.maps.push({
        mapId: destination.id,
        mode,
        width: changed.map.width,
        height: changed.map.height,
        revision,
        platforms: changed.map.platforms.length,
        piles: changed.map.berryPiles.length,
        synchronized: true,
      });
    }
    host.send({ type: 'role', role: 'queen' });
    guest.send({ type: 'role', role: 'queen' });
    await host.wait(
      'state',
      (state) => state.lobbyPlayers?.filter((player) => player.role === 'queen').length === 2,
    );
    host.send({ type: 'start' });
    const running = await host.wait(
      'state',
      (state) => state.status === 'playing' && state.time >= state.startsAt,
    );
    host.send({ type: 'map', mapId: 'brazil' });
    await host.wait('error');
    const beforeX = running.players.find((player) => player.id === host.id).x;
    host.send({ type: 'input', seq: mode === 'normal' ? 1 : 3, right: true });
    await host.wait(
      'state',
      (state) => state.players.find((player) => player.id === host.id)?.x > beforeX + 20,
    );
    host.send({ type: 'input', seq: mode === 'normal' ? 2 : 4 });
    report.checks.push(
      `${mode}: host-only map changes, coming-soon rejected, both peers synchronized, active round locked, movement works`,
    );
    host.send({ type: 'leave' });
    guest.send({ type: 'leave' });
    await Promise.all([host.wait('left'), guest.wait('left')]);
  }
  report.success = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  for (const peer of peers) peer.socket.close();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
