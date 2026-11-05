import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';
import { COMPACT_PROTOCOL, PLAYER_FIELDS, encodePlayer, decodeSnapshot } from '../shared/protocol.js';

async function client(port, protocol) {
  const query = protocol ? `?protocol=${encodeURIComponent(protocol)}` : '';
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
  const queue = [], pending = [];
  ws.on('message', bytes => {
    const packet = { message: JSON.parse(bytes), bytes: bytes.length };
    const index = pending.findIndex(entry => entry.matches(packet.message));
    if (index >= 0) {
      const [entry] = pending.splice(index, 1);
      clearTimeout(entry.timer); entry.resolve(packet);
    } else {
      queue.push(packet); if (queue.length > 150) queue.shift();
    }
  });
  const wait = (type, predicate = () => true) => {
    const matches = message => message.type === type && predicate(message);
    const index = queue.findIndex(packet => matches(packet.message));
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const entry = { matches, resolve, timer: setTimeout(() => {
        pending.splice(pending.indexOf(entry), 1); reject(new Error(`Waiting for ${type}`));
      }, 4000) };
      pending.push(entry);
    });
  };
  const { message: welcome } = await wait('welcome');
  return { id: welcome.id, ws, wait, send: message => ws.send(JSON.stringify(message)) };
}

async function roomWithBothProtocols(t, mode = 'normal') {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 1000 });
  const { port } = await game.listen(); t.after(() => game.close());
  const legacy = await client(port), compact = await client(port, COMPACT_PROTOCOL);
  legacy.send({ type: 'create', name: 'Q "hi" \\ 🦝', mode, botCount: mode === 'xxl' ? 119 : 9, private: true });
  const { message: joined } = await legacy.wait('joined');
  compact.send({ type: 'join', code: joined.code, name: 'Second Queen', role: 'worker' });
  const { message: compactJoined } = await compact.wait('joined');
  assert.ok(compactJoined.map.platforms.length > 0);
  assert.ok(compactJoined.players.every(player => !Array.isArray(player)));
  assert.equal(compactJoined.encoding, undefined, 'Control messages retain their object schema');
  assert.strictEqual(decodeSnapshot(compactJoined), compactJoined);
  legacy.send({ type: 'start' });
  await legacy.wait('state', state => state.status === 'playing');
  return { game, port, legacy, compact, room: game.rooms.get(joined.code) };
}

test('compact-v1 tuple schema preserves false, zero, null, Unicode and prediction fields', () => {
  assert.equal(PLAYER_FIELDS.length, 34);
  assert.equal(new Set(PLAYER_FIELDS).size, PLAYER_FIELDS.length);
  assert.ok(Object.isFrozen(PLAYER_FIELDS));
  const player = Object.fromEntries(PLAYER_FIELDS.map((field, index) => [field, index]));
  Object.assign(player, { id: 'p-1', name: 'Q "hi" \\ 🦝', role: 'worker', grounded: false, alive: true, carrying: false, upgradeGateId: null, upgradeKind: null, queenLives: 0, eliminated: false, speedBoost: true, emote: '' });
  const encoded = JSON.parse(JSON.stringify({ type: 'state', encoding: COMPACT_PROTOCOL, players: [encodePlayer(player)], startsAt: 1234 }));
  const decoded = decodeSnapshot(encoded);
  assert.deepEqual(decoded.players, [player]);
  assert.equal(decoded.startsAt, 1234);
  assert.ok(Array.isArray(encoded.players[0]), 'Decoding does not mutate the received packet');
  const legacy = { type: 'state', players: [player] };
  assert.strictEqual(decodeSnapshot(legacy), legacy);
  assert.throws(() => decodeSnapshot({ type: 'state', encoding: COMPACT_PROTOCOL, players: [[1]] }), /Invalid compact-v1/);
});

test('negotiated compact state matches legacy state through countdown, Queen lives and upgrades', async t => {
  const { legacy, compact, room } = await roomWithBothProtocols(t);
  const queen = room.players.get(legacy.id), worker = room.players.get(compact.id);
  queen.queenLives = 1; queen.emote = 'Q "hi" \\ 🦝'; queen.emoteUntil = Date.now() + 5000;
  worker.carrying = true; worker.speedBoost = true;
  worker.upgradeUntil = room.startsAt + 650; worker.upgradeGateId = room.gates[0].id; worker.upgradeKind = 'warrior';
  const { message: normal } = await legacy.wait('state', state => state.players.some(p => p.id === legacy.id && p.queenLives === 1));
  const { message: wire } = await compact.wait('state', state => state.time === normal.time);
  assert.equal(wire.encoding, COMPACT_PROTOCOL);
  assert.ok(wire.players.every(Array.isArray));
  assert.equal(normal.encoding, undefined);
  const { encoding, ...decoded } = decodeSnapshot(wire);
  assert.deepEqual(decoded, normal, 'Every field except the negotiated encoding marker is identical');
  assert.deepEqual(Object.keys(normal.players[0]), PLAYER_FIELDS, 'Adding a public field requires an explicit protocol version decision');
  assert.equal(decoded.players.find(p => p.id === legacy.id).name, 'Q "hi" \\ 🦝');
  assert.equal(decoded.players.find(p => p.id === compact.id).upgradeKind, 'warrior');
  assert.ok(normal.time < normal.startsAt);
  assert.equal(normal.countdownUntil, normal.startsAt);
  assert.equal(normal.elapsedSeconds, 0);
});

test('XXL compact snapshots preserve all 120 players with substantially fewer bytes', async t => {
  const { legacy, compact, room } = await roomWithBothProtocols(t, 'xxl');
  // One crowded view is the worst case for interest filtering. Countdown keeps
  // the exact same arena state frozen while both protocols receive this frame.
  for (const player of room.players.values()) { player.x = 1000; player.y = 500; }
  const normal = await legacy.wait('state', state => state.players.length === 120 && state.players.every(p => p.x === 1000));
  const compactPacket = await compact.wait('state', state => state.time === normal.message.time);
  const { encoding, ...decoded } = decodeSnapshot(compactPacket.message);
  assert.deepEqual(decoded, normal.message);
  assert.equal(decoded.players.length, 120);
  assert.equal(decoded.lobbyPlayers, undefined);
  assert.deepEqual(decoded.queenQuota, [12, 12]);
  assert.ok(compactPacket.bytes < normal.bytes * 0.55, `Compact ${compactPacket.bytes} B vs legacy ${normal.bytes} B`);
  t.diagnostic(`120-player same-frame snapshot: legacy ${normal.bytes} bytes; compact ${compactPacket.bytes} bytes; ${(100 * (1 - compactPacket.bytes / normal.bytes)).toFixed(1)}% less JSON`);
});

test('unknown protocol requests safely retain legacy snapshots', async t => {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 0 });
  const { port } = await game.listen(); t.after(() => game.close());
  const peer = await client(port, 'compact-v999');
  peer.send({ type: 'create', botCount: 0, private: true });
  const { message } = await peer.wait('state');
  assert.equal(message.encoding, undefined);
  assert.equal(message.players[0].id, peer.id);
  assert.strictEqual(decodeSnapshot(message), message);
});
