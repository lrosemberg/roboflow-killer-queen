import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';
import { PLAYER_H, PLAYER_W } from '../shared/world.js';

async function setup(t, countdownMs = 0) {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs });
  const { port } = await game.listen();
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await game.close();
  });
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    const queue = [],
      pending = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw);
      const index = pending.findIndex(
        (waiter) => waiter.type === message.type && waiter.predicate(message),
      );
      if (index >= 0) {
        const [waiter] = pending.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else if (message.type !== 'state') {
        queue.push(message);
        if (queue.length > 100) queue.shift();
      }
    });
    const rejectPending = (error) => {
      for (const waiter of pending.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    };
    ws.on('error', rejectPending);
    ws.on('close', () => rejectPending(new Error('Difficulty test socket closed')));
    const wait = (type, predicate = () => true) => {
      const index = queue.findIndex((message) => message.type === type && predicate(message));
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, predicate, resolve, reject };
        waiter.timer = setTimeout(() => {
          const index = pending.indexOf(waiter);
          if (index >= 0) pending.splice(index, 1);
          reject(new Error(`Timeout waiting for ${type}`));
        }, 4000);
        pending.push(waiter);
      });
    };
    const { id } = await wait('welcome');
    return { id, wait, send: (message) => ws.send(JSON.stringify(message)) };
  };
  const publicRoom = async (code) => {
    const listing = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((response) =>
      response.json(),
    );
    return listing.rooms.find((room) => room.code === code);
  };
  return { game, connect, publicRoom };
}

test('bot difficulty validates room creation and appears consistently in joined, state and public listings', async (t) => {
  const { game, connect, publicRoom } = await setup(t);
  let existingHost, existingCode;
  for (const requested of [undefined, 'easy', 'normal', 'hard']) {
    const expected = requested ?? 'normal';
    const host = await connect();
    host.send({ type: 'create', private: false, botCount: 0, botDifficulty: requested });
    const joined = await host.wait('joined');
    const state = await host.wait('state');
    assert.equal(joined.room.botDifficulty, expected);
    assert.equal(state.botDifficulty, expected);
    assert.equal((await publicRoom(joined.code)).botDifficulty, expected);
    assert.equal(game.rooms.get(joined.code).botDifficulty, expected);
    existingHost = host;
    existingCode = joined.code;
  }
  const roomCount = game.rooms.size;
  for (const invalid of ['nightmare', null, 3]) {
    const client = await connect();
    client.send({ type: 'create', botCount: 0, botDifficulty: invalid });
    assert.match((await client.wait('error')).message, /Easy, Normal or Hard/);
    assert.equal(game.rooms.size, roomCount, 'Invalid difficulty must not create a room');
  }
  // An invalid replacement request must not evict a player from their current room.
  await new Promise((resolve) => setTimeout(resolve, 410));
  existingHost.send({ type: 'create', botCount: 0, botDifficulty: 'nightmare' });
  assert.match((await existingHost.wait('error')).message, /Easy, Normal or Hard/);
  assert.equal(game.rooms.size, roomCount);
  assert.ok(game.rooms.get(existingCode).players.has(existingHost.id));
  assert.equal((await existingHost.wait('state')).botDifficulty, 'hard');
});

test('only the host changes difficulty between rounds; countdown and play are locked and rematch retains the choice', async (t) => {
  const { game, connect, publicRoom } = await setup(t, 500);
  const host = await connect();
  host.send({
    type: 'create',
    name: 'Difficulty host',
    private: false,
    botCount: 3,
    role: 'worker',
    botDifficulty: 'hard',
  });
  const joined = await host.wait('joined');
  const room = game.rooms.get(joined.code);
  const guest = await connect();
  guest.send({ type: 'join', code: joined.code, name: 'Difficulty guest', role: 'worker' });
  assert.equal((await guest.wait('joined')).room.botDifficulty, 'hard');
  const observer = await connect();
  guest.send({ type: 'bot-difficulty', difficulty: 'easy' });
  assert.match((await guest.wait('error')).message, /Only the host/);
  assert.equal(room.botDifficulty, 'hard');

  host.send({ type: 'bot-difficulty', difficulty: 'nightmare' });
  assert.match((await host.wait('error')).message, /Easy, Normal or Hard/);
  assert.equal(room.botDifficulty, 'hard');
  host.send({ type: 'bot-difficulty', difficulty: 'normal' });
  await Promise.all(
    [host, guest].map((client) =>
      client.wait(
        'state',
        (state) => state.botDifficulty === 'normal' && state.status === 'waiting',
      ),
    ),
  );
  assert.equal((await publicRoom(joined.code)).botDifficulty, 'normal');
  const announcement = await observer.wait('rooms', (message) =>
    message.rooms.some((room) => room.code === joined.code && room.botDifficulty === 'normal'),
  );
  assert.equal(
    announcement.rooms.find((room) => room.code === joined.code).botDifficulty,
    'normal',
  );

  host.send({ type: 'start' });
  await host.wait('state', (state) => state.status === 'playing' && state.time < state.startsAt);
  host.send({ type: 'bot-difficulty', difficulty: 'hard' });
  assert.match((await host.wait('error')).message, /between rounds/);
  assert.equal(room.botDifficulty, 'normal');
  await host.wait('state', (state) => state.status === 'playing' && state.time >= state.startsAt);
  host.send({ type: 'bot-difficulty', difficulty: 'hard' });
  assert.match((await host.wait('error')).message, /between rounds/);
  assert.equal(room.botDifficulty, 'normal');

  // End through a real deposit, so the between-rounds/rematch checks use the
  // same authoritative lifecycle as a completed game rather than a fake status.
  const player = room.players.get(host.id),
    home = room.map.bases[player.team];
  const chip = room.berries.find((berry) => berry.active);
  chip.active = false;
  player.carrying = true;
  player.carriedBerryId = chip.id;
  player.x = home.door.x + home.door.w / 2 - PLAYER_W / 2;
  player.y = home.y + home.h - PLAYER_H;
  player.vx = 0;
  player.vy = 0;
  player.grounded = true;
  player.input = {};
  player.invulnerableUntil = Date.now() + 5000;
  room.scores[player.team] = room.map.scoreTarget - 1;
  const ended = await host.wait('state', (state) => state.status === 'ended');
  assert.equal(ended.winType, 'economic');
  host.send({ type: 'bot-difficulty', difficulty: 'easy' });
  await host.wait('state', (state) => state.status === 'ended' && state.botDifficulty === 'easy');
  assert.equal((await publicRoom(joined.code)).botDifficulty, 'easy');
  host.send({ type: 'rematch' });
  const rematch = await host.wait('state', (state) => state.status === 'waiting');
  assert.equal(rematch.botDifficulty, 'easy');
  assert.deepEqual(rematch.scores, [0, 0]);
  assert.equal(room.botDifficulty, 'easy');
  host.send({ type: 'start' });
  assert.equal(
    (await host.wait('state', (state) => state.status === 'playing')).botDifficulty,
    'easy',
  );
});
