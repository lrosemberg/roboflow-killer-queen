import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';
import { decodeSnapshot } from '../shared/protocol.js';

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=compact-v1`),
    queue = [],
    pending = [];
  ws.on('message', (raw) => {
    const message = decodeSnapshot(JSON.parse(raw));
    const index = pending.findIndex(
      (waiter) => waiter.type === message.type && waiter.predicate(message),
    );
    if (index >= 0) {
      const [waiter] = pending.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else if (message.type !== 'state') queue.push(message);
  });
  const wait = (type, predicate = () => true) => {
    const index = queue.findIndex((message) => message.type === type && predicate(message));
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve };
      waiter.timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 4000);
      pending.push(waiter);
    });
  };
  const welcome = await wait('welcome');
  return { id: welcome.id, send: (message) => ws.send(JSON.stringify(message)), wait };
}
async function setup(t, options = {}) {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 3000, ...options });
  const { port } = await game.listen();
  t.after(() => game.close());
  return { game, port, host: await connect(port), guest: await connect(port) };
}

test('small waiting crews keep twelve-chip goals and sixty-chip stock across bot and human roster changes', async (t) => {
  const { port, host, guest } = await setup(t);
  host.send({ type: 'create', mode: 'xxl', mapId: 'singapore', botCount: 0 });
  const joined = await host.wait('joined');
  assert.equal(joined.map.scoreTarget, 12);
  assert.equal(joined.map.resourceCount, 60);
  assert.equal(joined.map.economyPlayerCount, 1);
  host.send({ type: 'bots', count: 3 });
  const four = await host.wait('state', (s) => s.botCount === 3);
  assert.equal(four.scoreTarget, 12);
  assert.equal(four.resourceCount, 60);
  assert.equal(four.economyPlayerCount, 4);
  host.send({ type: 'bots', count: 0 });
  await host.wait('state', (s) => s.botCount === 0);
  guest.send({ type: 'join', code: joined.code, name: 'Friend' });
  const two = await guest.wait('joined');
  assert.equal(two.map.scoreTarget, 12);
  assert.equal(two.map.resourceCount, 60);
  assert.equal(two.map.economyPlayerCount, 2);
  host.send({ type: 'start' });
  await host.wait('state', (s) => s.status === 'playing');
  const late = await connect(port);
  late.send({ type: 'join', code: joined.code });
  const locked = await late.wait('joined');
  assert.equal(locked.map.scoreTarget, 12);
  assert.equal(locked.map.resourceCount, 60);
  assert.equal(locked.map.economyPlayerCount, 2);
});

test('lobby map changes require the leader, replace geometry for every peer, and preserve crew choices and economy', async (t) => {
  const { game, port, host, guest } = await setup(t);
  host.send({
    type: 'create',
    mapId: 'san-francisco',
    mode: 'xxl',
    name: 'Leader',
    botCount: 19,
    botDifficulty: 'hard',
    role: 'worker',
  });
  const first = await host.wait('joined');
  assert.equal(first.map.mapId, 'san-francisco');
  assert.equal(first.room.mapId, 'san-francisco');
  assert.equal(first.room.mapRevision, 0);
  guest.send({ type: 'join', code: first.code, name: 'Crew', role: 'worker' });
  await guest.wait('joined');
  const room = game.rooms.get(first.code),
    roster = [...room.players.values()].map((p) => [p.id, p.team, p.role]);
  guest.send({ type: 'map', mapId: 'brazil' });
  assert.match((await guest.wait('error')).message, /Only the host/);
  host.send({ type: 'map', mapId: 'next-onsite' });
  assert.match((await host.wait('error')).message, /available map/);
  assert.equal(room.mapId, 'san-francisco');
  assert.equal(room.mapRevision, 0);
  const oldNavigation = room.navigation;
  host.send({ type: 'map', mapId: 'brazil' });
  const [leaderChange, crewChange] = await Promise.all([
    host.wait('map-changed'),
    guest.wait('map-changed'),
  ]);
  assert.deepEqual(leaderChange, crewChange);
  assert.equal(leaderChange.mapId, 'brazil');
  assert.equal(leaderChange.mapRevision, 1);
  assert.equal(leaderChange.map.ride.name, 'Delivery Bike');
  assert.equal(leaderChange.map.scoreTarget, 26);
  assert.equal(leaderChange.map.resourceCount, 126);
  assert.deepEqual(
    leaderChange.players.map((p) => [p.id, p.team, p.role]),
    roster,
  );
  assert.notEqual(room.navigation, oldNavigation);
  assert.equal(room.botDifficulty, 'hard');
  assert.equal(room.botTarget, 19);
  assert.equal(room.status, 'waiting');
  assert.deepEqual(room.scores, [0, 0]);
  for (const player of leaderChange.players) {
    const base = leaderChange.map.bases[player.team];
    assert.equal(player.y + 36, base.y + base.h);
    assert.ok(player.x >= base.x && player.x < base.x + base.w);
  }
  const state = await guest.wait('state', (s) => s.mapRevision === 1);
  assert.equal(state.mapId, 'brazil');
  assert.equal(state.mapName, 'Brazil');
  assert.equal(state.scoreTarget, 26);
  const listing = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((r) => r.json());
  assert.equal(listing.rooms.find((r) => r.code === first.code).mapId, 'brazil');
  host.send({ type: 'start' });
  await host.wait('state', (s) => s.status === 'playing');
  host.send({ type: 'map', mapId: 'singapore' });
  assert.match((await host.wait('error')).message, /next round lobby/);
  assert.equal(room.mapId, 'brazil');
  assert.equal(room.mapRevision, 1);
  room.status = 'ended';
  host.send({ type: 'map', mapId: 'singapore' });
  assert.match((await host.wait('error')).message, /next round lobby/);
  host.send({ type: 'rematch' });
  await host.wait('state', (s) => s.status === 'waiting');
  host.send({ type: 'map', mapId: 'singapore' });
  const next = await guest.wait('map-changed');
  assert.equal(next.mapRevision, 2);
  assert.equal(next.map.name, 'Singapore');
});

test('invalid or future map creation fails without leaving the current room; omitted IDs preserve Miami compatibility', async (t) => {
  const { game, host, guest } = await setup(t);
  host.send({ type: 'create', botCount: 1 });
  const joined = await host.wait('joined');
  assert.equal(joined.map.mapId, 'miami');
  guest.send({ type: 'create', mapId: 'next-onsite' });
  assert.match((await guest.wait('error')).message, /available map/);
  assert.equal(game.clients.get(guest.id).roomCode, null);
  await new Promise((resolve) => setTimeout(resolve, 420));
  host.send({ type: 'create', mapId: 'not-a-city' });
  assert.match((await host.wait('error')).message, /available map/);
  assert.equal(game.clients.get(host.id).roomCode, joined.code);
  assert.equal(game.rooms.size, 1);
});

test('quick play matches both the selected city and size, and ride victory copy follows that city', async (t) => {
  const { game, port, host, guest } = await setup(t, { countdownMs: 0 });
  host.send({ type: 'quick', mapId: 'singapore', mode: 'normal', name: 'Riverboat crew' });
  const singapore = await host.wait('joined');
  await host.wait('state', (s) => s.status === 'playing');
  guest.send({ type: 'quick', mapId: 'new-york', mode: 'normal' });
  const newYork = await guest.wait('joined');
  assert.notEqual(newYork.code, singapore.code);
  const visitor = await connect(port);
  visitor.send({ type: 'quick', mapId: 'singapore', mode: 'normal' });
  assert.equal((await visitor.wait('joined')).code, singapore.code);
  const room = game.rooms.get(singapore.code),
    rider = room.players.get(host.id);
  for (const player of room.players.values()) {
    player.nextThink = Infinity;
    player.botInput = {};
    player.botTarget = null;
    player.input = {};
    player.x = 600;
    player.y = 200;
  }
  rider.role = 'worker';
  rider.alive = true;
  room.gator.riderId = rider.id;
  room.gator.x = room.map.gatorTrack.x1 + 0.01;
  const ended = await host.wait('state', (s) => s.status === 'ended');
  assert.equal(ended.winType, 'gator');
  assert.match(ended.winReason, /Riverboat delivered/);
});
