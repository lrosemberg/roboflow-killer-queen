import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';
import { getLobbyReadiness } from '../shared/lobby.js';

async function connect(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queued = [], pending = [], errors = [];
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type === 'error') errors.push(message.message);
    const index = pending.findIndex(item => item.type === message.type && (!item.predicate || item.predicate(message)));
    if (index >= 0) {
      const [item] = pending.splice(index, 1);
      clearTimeout(item.timer);
      item.resolve(message);
    } else if (message.type !== 'state') queued.push(message);
  });
  const wait = (type, predicate) => {
    const index = queued.findIndex(message => message.type === type && (!predicate || predicate(message)));
    if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = { type, predicate, resolve, timer: setTimeout(() => {
        pending.splice(pending.indexOf(item), 1);
        reject(new Error(`Timeout waiting for ${type}`));
      }, 4000) };
      pending.push(item);
    });
  };
  const welcome = await wait('welcome');
  return { id: welcome.id, errors, wait, send: message => socket.send(JSON.stringify(message)) };
}

async function setup(t, options = {}) {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 0 });
  const { port } = await game.listen();
  t.after(() => game.close());
  const host = await connect(port);
  host.send({ type: 'create', name: 'Leader', mode: 'normal', private: true, botCount: 0, role: 'queen', ...options });
  const joined = await host.wait('joined');
  return { game, port, host, room: game.rooms.get(joined.code) };
}

async function join(port, room, name, options = {}) {
  const peer = await connect(port);
  peer.send({ type: 'join', code: room.code, name, ...options });
  await peer.wait('joined');
  return peer;
}

const teamCounts = roster => [0, 1].map(team => roster.filter(player => player.team === team).length);
const queenCounts = roster => [0, 1].map(team => roster.filter(player => player.team === team && player.role === 'queen').length);

test('shared lobby readiness counts bots, scales Queen quotas, and rejects empty teams or excess Queens', () => {
  const roster = [{ team: 0, role: 'queen', bot: false }];
  assert.equal(getLobbyReadiness(roster).reason, 'players');
  roster.push({ team: 1, role: 'queen', bot: true });
  const ready = getLobbyReadiness(roster);
  assert.equal(ready.ready, true);
  assert.equal(ready.reason, 'ready');
  assert.deepEqual(ready.teams, [
    { team: 0, count: 1, humans: 1, bots: 0, queens: 1, quota: 1 },
    { team: 1, count: 1, humans: 0, bots: 1, queens: 1, quota: 1 },
  ]);
  for (let index = 0; index < 5; index++) roster.push({ team: 0, role: 'worker', bot: true });
  assert.equal(getLobbyReadiness(roster).teams[0].quota, 2);
  assert.equal(getLobbyReadiness(roster).reason, 'queens');
  roster[2].role = 'queen';
  assert.equal(getLobbyReadiness(roster).ready, true);
  roster[3].role = 'queen';
  assert.equal(getLobbyReadiness(roster).ready, false);
  assert.equal(getLobbyReadiness(roster).reason, 'queens');
});

test('lobby team choices update the roster, preserve the leader, and require both teams and their Queens before starting', async t => {
  const { host, port, room } = await setup(t);
  const guest = await join(port, room, 'Guest');
  assert.equal(room.players.get(host.id).team, 0);
  assert.equal(room.players.get(guest.id).team, 1);

  host.send({ type: 'team', team: 1 });
  const joinedSide = await guest.wait('state', state => state.lobbyPlayers?.find(player => player.id === host.id)?.team === 1);
  assert.equal(joinedSide.hostId, host.id, 'Switching sides cannot transfer room leadership');
  assert.deepEqual(teamCounts(joinedSide.lobbyPlayers), [0, 2]);
  assert.deepEqual(joinedSide.queenQuota, [0, 1]);
  assert.equal(room.players.get(host.id).role, 'worker', 'An occupied Queen slot must demote the incoming Queen');
  assert.equal(room.players.get(guest.id).role, 'queen');
  host.send({ type: 'start' });
  assert.match((await host.wait('error')).message, /player|team/i);
  assert.equal(room.status, 'waiting', 'A populated side cannot play against an empty team');

  guest.send({ type: 'team', team: 0 });
  const split = await host.wait('state', state => state.lobbyPlayers?.find(player => player.id === guest.id)?.team === 0);
  assert.deepEqual(teamCounts(split.lobbyPlayers), [1, 1]);
  assert.equal(room.players.get(guest.id).role, 'queen', 'A Queen keeps her role when the new side has an available slot');
  assert.equal(room.players.get(host.id).role, 'worker', 'Team changes cannot silently promote a human');
  host.send({ type: 'start' });
  assert.match((await host.wait('error')).message, /Queen/i);
  assert.equal(room.status, 'waiting');

  host.send({ type: 'role', role: 'queen' });
  await host.wait('state', state => state.lobbyPlayers?.find(player => player.id === host.id)?.role === 'queen');
  const before = { ...room.players.get(host.id) }, errorCount = host.errors.length;
  host.send({ type: 'team', team: 1 });
  const unchanged = await host.wait('state');
  assert.equal(unchanged.hostId, host.id);
  assert.equal(room.players.get(host.id).role, before.role);
  assert.equal(room.players.get(host.id).x, before.x);
  assert.equal(room.players.get(host.id).y, before.y);
  assert.equal(host.errors.length, errorCount, 'Selecting the current team is an accepted no-op');

  host.send({ type: 'start' });
  const playing = await host.wait('state', state => state.status === 'playing');
  assert.equal(playing.hostId, host.id);
  assert.deepEqual(playing.queenQuota, [1, 1]);
});

test('team selection rejects malformed sides and cannot alter a playing or completed round', async t => {
  const { host, room } = await setup(t, { botCount: 1 });
  await host.wait('state', state => state.botCount === 1);
  const original = room.players.get(host.id).team;
  for (const team of [-1, 2, '0', null, undefined]) {
    host.send({ type: 'team', team });
    assert.match((await host.wait('error')).message, /team|choose/i);
    assert.equal(room.players.get(host.id).team, original);
  }
  host.send({ type: 'start' });
  await host.wait('state', state => state.status === 'playing');
  const originalQuotas = [...room.queenQuota];
  host.send({ type: 'team', team: 1 });
  assert.match((await host.wait('error')).message, /lobby|round|waiting/i);
  assert.equal(room.players.get(host.id).team, original);
  assert.deepEqual(room.queenQuota, originalQuotas);

  // Finish the fixture deterministically, without waiting for a bot victory.
  room.status = 'ended';
  host.send({ type: 'team', team: 1 });
  assert.match((await host.wait('error')).message, /lobby|round|waiting/i);
  assert.equal(room.players.get(host.id).team, original);
  assert.deepEqual(room.queenQuota, originalQuotas);
});

for (const [mode, maxPlayers] of [['normal', 10], ['xxl', 120]]) {
  test(`${mode}: joining a full side yields a worker bot, replenishes the old side, and preserves both Queen quotas`, async t => {
    const { host, room } = await setup(t, { mode, botCount: maxPlayers - 1 });
    const before = await host.wait('state', state => state.botCount === maxPlayers - 1);
    assert.deepEqual(teamCounts(before.lobbyPlayers), [maxPlayers / 2, maxPlayers / 2]);
    const destination = before.lobbyPlayers.filter(player => player.team === 1);
    const destinationQueens = destination.filter(player => player.role === 'queen').map(player => player.id);
    const beforeIds = new Set(before.lobbyPlayers.map(player => player.id));

    host.send({ type: 'team', team: 1 });
    const after = await host.wait('state', state => state.lobbyPlayers?.find(player => player.id === host.id)?.team === 1);
    assert.equal(after.status, 'waiting');
    assert.equal(after.hostId, host.id);
    assert.equal(after.configuredBots, maxPlayers - 1);
    assert.equal(after.botCount, maxPlayers - 1);
    assert.deepEqual(teamCounts(after.lobbyPlayers), [maxPlayers / 2, maxPlayers / 2]);
    assert.deepEqual(queenCounts(after.lobbyPlayers), after.queenQuota);
    assert.equal(after.lobbyPlayers.find(player => player.id === host.id).role, 'worker');
    for (const id of destinationQueens) assert.equal(after.lobbyPlayers.find(player => player.id === id)?.role, 'queen');
    const removed = before.lobbyPlayers.filter(player => !room.players.has(player.id));
    assert.equal(removed.length, 1);
    assert.equal(removed[0].team, 1);
    assert.equal(removed[0].bot, true);
    assert.equal(removed[0].role, 'worker', 'A full side yields a worker before its Queen');
    const added = after.lobbyPlayers.filter(player => !beforeIds.has(player.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].bot, true);
    assert.equal(added[0].team, 0, 'The configured bot total is restored in the available side');
  });
}

test('a full human team cannot be entered and no human is removed to make space', async t => {
  const { host, port, room } = await setup(t);
  const guests = [];
  for (let index = 0; index < 9; index++) guests.push(await join(port, room, `Guest ${index + 1}`));
  const before = await host.wait('state', state => state.playerCount === 10);
  assert.deepEqual(teamCounts(before.lobbyPlayers), [5, 5]);
  const ids = before.lobbyPlayers.map(player => player.id).sort();
  const role = room.players.get(host.id).role;
  host.send({ type: 'team', team: 1 });
  assert.match((await host.wait('error')).message, /full|space|capacity/i);
  const after = await guests[0].wait('state');
  assert.deepEqual(after.lobbyPlayers.map(player => player.id).sort(), ids);
  assert.deepEqual(teamCounts(after.lobbyPlayers), [5, 5]);
  assert.equal(after.playerCount, 10);
  assert.equal(after.botCount, 0);
  assert.equal(after.hostId, host.id);
  assert.equal(room.players.get(host.id).team, 0);
  assert.equal(room.players.get(host.id).role, role);
});

test('automatic joining respects a full bot-populated side after manual moves even when the room has spare capacity', async t => {
  const { host, port, room } = await setup(t, { botCount: 6 });
  const guest = await join(port, room, 'Guest');
  const worker = await join(port, room, 'Worker', { role: 'worker' });
  guest.send({ type: 'team', team: 0 });
  await host.wait('state', state => state.lobbyPlayers?.find(player => player.id === guest.id)?.team === 0);
  worker.send({ type: 'team', team: 1 });
  const before = await host.wait('state', state => state.lobbyPlayers?.find(player => player.id === worker.id)?.team === 1);
  assert.deepEqual(teamCounts(before.lobbyPlayers), [4, 5]);
  assert.deepEqual(teamCounts(before.lobbyPlayers.filter(player => !player.bot)), [2, 1]);
  const humanIds = before.lobbyPlayers.filter(player => !player.bot).map(player => player.id);

  const arriving = await join(port, room, 'Arriving Worker', { role: 'worker' });
  const after = await host.wait('state', state => state.playerCount === 4);
  assert.equal(room.players.get(arriving.id).team, 1);
  assert.deepEqual(teamCounts(after.lobbyPlayers), [5, 5]);
  assert.equal(after.botCount, 6);
  for (const id of humanIds) assert.ok(room.players.has(id), 'Automatic assignment cannot evict an existing human');
  const removed = before.lobbyPlayers.filter(player => !room.players.has(player.id));
  assert.equal(removed.length, 1);
  assert.equal(removed[0].team, 1);
  assert.equal(removed[0].bot, true);
  assert.equal(removed[0].role, 'worker');
});
