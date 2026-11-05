import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition timed out');
    await pause(5);
  }
}
async function connect(port, optIn = true) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${optIn ? '?resume=1&events=1' : ''}`);
  const messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw)));
  ws.on('error', () => {});
  const wait = async (type, predicate = () => true) => {
    let index;
    await until(() => (index = messages.findIndex((m) => m.type === type && predicate(m))) >= 0);
    return messages.splice(index, 1)[0];
  };
  const welcome = await wait('welcome');
  return {
    ws,
    messages,
    wait,
    id: welcome.id,
    token: welcome.resumeToken,
    send: (message) => ws.send(JSON.stringify(message)),
    welcome,
  };
}
async function setup(t, create = {}, options = {}) {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 0, ...options });
  const { port } = await game.listen();
  t.after(() => game.close());
  const host = await connect(port);
  host.send({ type: 'create', name: 'Host', private: true, botCount: 0, ...create });
  const joined = await host.wait('joined');
  return { game, port, host, joined, room: game.rooms.get(joined.code) };
}
async function join(port, code, optIn = true) {
  const peer = await connect(port, optIn);
  peer.send({ type: 'join', code, name: 'Peer' });
  peer.joined = await peer.wait('joined');
  return peer;
}
async function resume(port, previous, code, ack = 0) {
  const next = await connect(port);
  next.send({ type: 'resume', token: previous.token, eventEpoch: code, eventAck: ack });
  const joined = await next.wait('joined');
  next.id = joined.id;
  next.token = joined.resumeToken;
  return { next, joined };
}

// Real websocket disconnect/reconnect; the authoritative player is never rebuilt.
test('resume retains identity, stats, upgrades and monotonic input while clearing stale controls', async (t) => {
  const { game, port, host, room } = await setup(t, { botCount: 1 });
  host.send({ type: 'start' });
  await host.wait('state', (s) => s.status === 'playing');
  const player = room.players.get(host.id);
  Object.assign(player, {
    score: 7,
    kills: 4,
    speedBoost: true,
    queenLives: 2,
    invulnerableUntil: 0,
  });
  for (const bot of room.players.values())
    if (bot.bot) {
      bot.nextThink = Date.now() + 10000;
      bot.botInput = {};
    }
  host.send({ type: 'input', seq: 91, right: true, jump: true });
  await until(() => player.ack === 91);
  const token = host.token,
    identity = player;
  host.ws.terminate();
  await until(() => !game.clients.has(host.id));
  assert.equal(room.players.get(host.id), identity);
  assert.equal(player.input.right, false);
  assert.equal(player.jumpHeld, false);
  assert.equal(player.vx, 0);
  assert.equal(player.invulnerableUntil, 0, 'disconnect grants no immunity');
  const { next, joined } = await resume(port, host, room.code);
  assert.equal(joined.resumed, true);
  assert.equal(joined.id, host.id);
  assert.equal(joined.ack, 91);
  assert.equal(next.token, token, 'stable secret survives loss of a resumed joined reply');
  assert.equal(room.players.get(next.id), identity);
  assert.deepEqual(
    [player.team, player.role, player.queenLives, player.score, player.kills, player.speedBoost],
    [0, 'queen', 2, 7, 4, true],
  );
  next.send({ type: 'input', seq: 90, right: true });
  next.send({ type: 'input', seq: 92, reset: true });
  await until(() => player.ack === 92);
  assert.equal(player.input.right, false);
});

test('disconnected Queen remains vulnerable and resumes the life lost during grace', async (t) => {
  const { game, port, host, room } = await setup(t);
  const opponent = await join(port, room.code);
  host.send({ type: 'start' });
  await host.wait('state', (s) => s.status === 'playing');
  const victim = room.players.get(host.id),
    attacker = room.players.get(opponent.id);
  host.ws.terminate();
  await until(() => !game.clients.has(host.id));
  room.map.platforms = [room.map.platforms[0]];
  Object.assign(victim, { x: 500, y: room.map.height - 116, vx: 0, vy: 0, invulnerableUntil: 0 });
  Object.assign(attacker, {
    x: 490,
    y: victim.y - 20,
    vx: 0,
    vy: 0,
    facing: 1,
    invulnerableUntil: 0,
  });
  await until(() => !victim.alive);
  assert.equal(victim.queenLives, 2);
  assert.equal(attacker.kills, 1);
  const { joined } = await resume(port, host, room.code);
  const restored = joined.players.find((p) => p.id === host.id);
  assert.equal(restored.alive, false);
  assert.equal(restored.queenLives, 2);
  assert.equal(restored.respawnAt, victim.respawnAt);
  assert.equal(room.players.get(host.id), victim);
});

test('valid token takeover disables old socket; explicit leave revokes secret and never broadcasts it', async (t) => {
  const { game, port, host, room } = await setup(t);
  const spectator = await join(port, room.code);
  assert.match(host.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(host.token, spectator.token);
  const oldSocket = game.clients.get(host.id).socket;
  const oldClosed = once(host.ws, 'close');
  const { next } = await resume(port, host, room.code);
  assert.equal((await oldClosed)[0], 4000);
  oldSocket.emit('message', Buffer.from(JSON.stringify({ type: 'leave' })));
  oldSocket.emit('close');
  assert.ok(room.players.has(host.id));
  assert.equal(game.clients.get(host.id).socket.readyState, WebSocket.OPEN);
  assert.ok(!JSON.stringify(spectator.messages).includes(host.token));
  const invalid = await connect(port);
  invalid.send({ type: 'resume', token: 'x'.repeat(43) });
  await invalid.wait('resume-failed');
  next.send({ type: 'leave' });
  const left = await next.wait('left');
  assert.notEqual(left.resumeToken, host.token);
  assert.ok(!room.players.has(host.id));
  invalid.send({ type: 'resume', token: host.token });
  await invalid.wait('resume-failed');
});

test('XXL reserves all120 human slots through grace, then frees the expired slot', async (t) => {
  const { game, port, host, room } = await setup(t, { mode: 'xxl' }, { resumeGraceMs: 350 });
  const peers = await Promise.all(Array.from({ length: 119 }, () => join(port, room.code)));
  assert.equal(room.players.size, 120);
  const previous = peers[0];
  previous.ws.terminate();
  await until(() => !game.clients.has(previous.id));
  const overflow = await connect(port, false);
  overflow.send({ type: 'join', code: room.code });
  assert.match((await overflow.wait('error')).message, /full/i);
  const { next } = await resume(port, previous, room.code);
  assert.equal(room.players.size, 120);
  next.ws.terminate();
  await until(() => !room.players.has(next.id));
  const invalid = await connect(port);
  invalid.send({ type: 'resume', token: next.token });
  await invalid.wait('resume-failed');
  await pause(410); // Ordinary room-action rate limit still applies to overflow client.
  overflow.send({ type: 'join', code: room.code });
  await overflow.wait('joined');
  assert.equal(room.players.size, 120);
  assert.equal(room.hostId, host.id);
});

test('legacy disconnect removes immediately; reserved host transfers only on expiry', async (t) => {
  const { game, port, host, room } = await setup(t, {}, { resumeGraceMs: 150 });
  const legacy = await join(port, room.code, false);
  assert.equal(legacy.token, undefined);
  legacy.ws.terminate();
  await until(() => !room.players.has(legacy.id));
  const peer = await join(port, room.code);
  host.ws.terminate();
  await until(() => !game.clients.has(host.id));
  assert.equal(room.hostId, host.id);
  await until(() => !room.players.has(host.id));
  assert.equal(room.hostId, peer.id);
});

test('slow snapshot recipient recovers ordered events, acknowledges them, and keeps only latest state', async (t) => {
  const { game, port, host, room } = await setup(t);
  const peer = await join(port, room.code);
  const initial = await host.wait('state', (s) => s.eventLatest >= room.eventCounter);
  host.send({ type: 'event-ack', id: initial.eventLatest, eventEpoch: room.code });
  await until(() => game.clients.get(host.id).eventAck === initial.eventLatest);
  const socket = game.clients.get(host.id).socket,
    original = socket.send;
  let release;
  socket.send = function (data, options, callback) {
    if (JSON.parse(data).type === 'state' && !release) {
      return original.call(this, data, options, (err) => {
        release = () => callback(err);
      });
    }
    return original.call(this, data, options, callback);
  };
  await until(() => release);
  const before = room.eventCounter;
  peer.send({ type: 'role', role: 'worker' });
  await until(() => room.eventCounter > before);
  const eventId = room.eventCounter;
  await pause(310);
  assert.ok(game.metrics().skippedSnapshots > 0);
  assert.ok(
    game.clients.get(host.id).eventSent < eventId,
    'skipped states do not advance the delivered-event cursor',
  );
  socket.send = original;
  release();
  const recovered = await host.wait('state', (s) => s.events.some((e) => e.id === eventId));
  assert.ok(
    recovered.time >= Date.now() - 300,
    'recovered snapshot is current, not queued old state',
  );
  assert.deepEqual(
    recovered.events.map((e) => e.id),
    [...new Set(recovered.events.map((e) => e.id))].sort((a, b) => a - b),
  );
  host.send({ type: 'event-ack', id: eventId + 1000, eventEpoch: room.code });
  await pause(30);
  assert.equal(game.clients.get(host.id).eventAck, initial.eventLatest);
  host.send({ type: 'ping', eventAck: eventId, eventEpoch: room.code });
  await until(() => game.clients.get(host.id).eventAck === eventId);
  await host.wait('state', (s) => s.eventLatest === eventId && !s.events.length);
  host.send({ type: 'input', seq: 1, reset: true, eventAck: eventId, eventEpoch: 'WRONG' });
  await until(() => room.players.get(host.id).ack === 1);
  assert.equal(game.clients.get(host.id).eventAck, eventId);
});

test('live TCP sends events once while ACK is delayed; reconnect replays only unacknowledged events', async (t) => {
  const { game, port, host, room } = await setup(t);
  const peer = await join(port, room.code);
  const initial = await host.wait('state', (s) => s.eventLatest >= room.eventCounter);
  host.send({ type: 'event-ack', id: initial.eventLatest, eventEpoch: room.code });
  await until(() => game.clients.get(host.id).eventAck === initial.eventLatest);
  const acknowledged = initial.eventLatest;
  peer.send({ type: 'role', role: 'worker' });
  const delivered = await host.wait('state', (s) => s.events.some((e) => e.id > acknowledged));
  const unacknowledgedIds = delivered.events.map((e) => e.id);
  const latest = delivered.eventLatest;
  assert.equal(game.clients.get(host.id).eventAck, acknowledged);
  assert.equal(game.clients.get(host.id).eventSent, latest);
  for (let i = 0; i < 3; i++) {
    const next = await host.wait(
      'state',
      (s) => s.time > delivered.time && s.eventLatest === latest,
    );
    assert.deepEqual(
      next.events,
      [],
      'delayed application ACK must not repeat events on live ordered TCP',
    );
  }
  host.ws.terminate();
  await until(() => !game.clients.has(host.id));
  const { next, joined } = await resume(port, host, room.code, acknowledged);
  assert.equal(joined.eventAck, acknowledged);
  const replay = await next.wait('state');
  assert.deepEqual(
    replay.events.map((e) => e.id),
    unacknowledgedIds,
  );
  next.send({ type: 'event-ack', id: latest, eventEpoch: room.code });
  await until(() => game.clients.get(host.id).eventAck === latest);
  next.ws.terminate();
  await until(() => !game.clients.has(host.id));
  const second = await resume(port, next, room.code, latest);
  assert.deepEqual(
    (await second.next.wait('state')).events,
    [],
    'processed events stay acknowledged after another reconnect',
  );
});

test('event ring remains bounded and reports its floor across reconnect and round resets', async (t) => {
  const { game, port, host, room } = await setup(t, {}, { eventHistoryLimit: 8 });
  const peer = await join(port, room.code);
  const ack = (await host.wait('state')).eventLatest;
  host.send({ type: 'event-ack', id: ack, eventEpoch: room.code });
  await until(() => game.clients.get(host.id).eventAck === ack);
  host.ws.terminate();
  await until(() => !game.clients.has(host.id));
  for (let i = 0; i < 20; i++) {
    peer.send({ type: 'role', role: i % 2 ? 'queen' : 'worker' });
  }
  await until(() => room.eventCounter > ack + 15);
  assert.equal(room.eventHistory.length, 8);
  const { next, joined } = await resume(port, host, room.code, ack);
  assert.equal(joined.eventAck, ack);
  const state = await next.wait('state');
  assert.equal(state.eventEpoch, room.code);
  assert.equal(state.eventFloor, state.eventLatest - 7);
  assert.ok(state.eventFloor > ack + 1);
  assert.equal(state.events.length, 8);
  const latest = state.eventLatest;
  next.send({ type: 'map', mapId: 'brazil' });
  await next.wait('map-changed');
  assert.ok(room.eventCounter > latest, 'round reset never reuses event IDs');
});

test('critical map control under pressure closes for resync, resume returns current full map', async (t) => {
  const { game, port, host, room } = await setup(t);
  const peer = await join(port, room.code);
  const socket = game.clients.get(peer.id).socket;
  Object.defineProperty(socket, 'bufferedAmount', { configurable: true, value: 300 * 1024 });
  const closed = once(peer.ws, 'close');
  host.send({ type: 'map', mapId: 'singapore' });
  await host.wait('map-changed');
  const [code, reason] = await closed;
  assert.equal(code, 1013);
  assert.match(reason.toString(), /resync/i);
  const { joined } = await resume(port, peer, room.code);
  assert.equal(joined.map.mapId, 'singapore');
  assert.equal(joined.room.mapRevision, 1);
  assert.equal(joined.id, peer.id);
  assert.equal(room.players.size, 2);
});

test('unchanged lobby and ended snapshots run at4Hz; lobby mutations remain immediate and play stays20Hz', async (t) => {
  const { host, room } = await setup(t, { botCount: 1 });
  await pause(300);
  let states = 0;
  host.ws.on('message', (raw) => {
    if (JSON.parse(raw).type === 'state') states++;
  });
  await pause(1060);
  assert.ok(states >= 3 && states <= 5, `idle lobby sent ${states} states`);
  const sentAt = Date.now();
  host.send({ type: 'bot-difficulty', difficulty: 'hard' });
  await host.wait('state', (s) => s.botDifficulty === 'hard');
  assert.ok(Date.now() - sentAt < 180);
  host.send({ type: 'start' });
  await host.wait('state', (s) => s.status === 'playing');
  states = 0;
  await pause(1060);
  assert.ok(states >= 18 && states <= 23, `active game sent ${states} states`);
  room.status = 'ended';
  await pause(300);
  states = 0;
  await pause(1060);
  assert.ok(states >= 3 && states <= 5, `ended game sent ${states} states`);
});
