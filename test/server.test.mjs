import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';

async function client(port, protocol = '') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${protocol ? `?protocol=${protocol}` : ''}`);
  const queue = [],
    pending = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const index = pending.findIndex(
      (w) => w.type === msg.type && (!w.predicate || w.predicate(msg)),
    );
    if (index >= 0) {
      const [w] = pending.splice(index, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
    } else if (msg.type !== 'state') queue.push(msg);
    if (queue.length > 100) queue.shift();
  });
  const wait = (type, predicate) => {
    const index = queue.findIndex((m) => m.type === type && (!predicate || predicate(m)));
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const entry = {
        type,
        predicate,
        resolve,
        timer: setTimeout(() => {
          const i = pending.indexOf(entry);
          if (i >= 0) pending.splice(i, 1);
          reject(new Error(`Timeout waiting for ${type}`));
        }, 4000),
      };
      pending.push(entry);
    });
  };
  const welcome = await wait('welcome');
  return { id: welcome.id, ws, send: (msg) => ws.send(JSON.stringify(msg)), wait };
}
async function setup(t, create = {}, options = {}) {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 0, ...options });
  const { port } = await game.listen();
  t.after(() => game.close());
  const host = await client(port);
  host.send({
    type: 'create',
    name: 'Host',
    mode: 'normal',
    private: true,
    botCount: 0,
    ...create,
  });
  const joined = await host.wait('joined');
  const room = game.rooms.get(joined.code);
  return { game, port, host, room, joined, player: room.players.get(host.id) };
}
const floorY = (r) => r.map.height - 116;
const waitFor = async (predicate) => {
  const end = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Condition timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const stop = (p) => {
  p.input = {};
  p.botInput = {};
  p.botTarget = null;
  p.nextThink = Date.now() + 100000;
  p.vx = 0;
  p.vy = 0;
};
const awardChip = (r, p) => {
  const b = r.berries.find((b) => b.active);
  assert.ok(b);
  b.active = false;
  p.carrying = true;
  p.carriedBerryId = b.id;
  return b;
};
async function start(host) {
  host.send({ type: 'start' });
  return host.wait('state', (s) => s.status === 'playing');
}

test('same-frame input packets preserve jump and action taps, but explicit resets and dead-player input cannot queue a respawn jump', async (t) => {
  const { game, room: r, host, player: p } = await setup(t, { botCount: 1 });
  await start(host);
  for (const bot of r.players.values()) if (bot.bot) stop(bot);
  // Keep this input-buffer fixture in the open vertical gap between ledges,
  // so the jump returns to the same floor instead of landing on a platform.
  p.role = 'worker';
  p.x = 560;
  p.y = floorY(r);
  p.vx = 0;
  p.vy = 0;
  p.grounded = true;
  p.jumpHeld = false;
  let seq = 0;
  // Deliver decoded WebSocket messages in one event-loop turn: the timer
  // cannot run between press and release, exactly reproducing a network burst.
  const packet = (data) =>
    game.clients
      .get(host.id)
      .socket.emit('message', Buffer.from(JSON.stringify({ type: 'input', seq: ++seq, ...data })));
  packet({ jump: true });
  packet({});
  assert.equal(p.input.jump, false);
  assert.equal(p.pendingJumpPress, true);
  await waitFor(() => p.vy < -600);
  await waitFor(() => p.grounded);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(p.y, floorY(r));

  packet({ jump: true });
  packet({ reset: true });
  assert.equal(p.pendingJumpPress, false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(p.y, floorY(r));

  p.x = r.gator.x - 14;
  p.y = floorY(r);
  p.vx = 0;
  p.vy = 0;
  p.grounded = true;
  packet({ action: true });
  packet({});
  await waitFor(() => r.gator.riderId === p.id);
  packet({ jump: true });
  packet({});
  await waitFor(() => r.gator.riderId === null);

  p.alive = false;
  p.respawnAt = Date.now() + 70;
  p.vx = 0;
  p.vy = 0;
  packet({ jump: true });
  packet({});
  assert.equal(p.pendingJumpPress, false);
  assert.equal(p.input.jump, false);
  await waitFor(() => p.alive);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(p.grounded, true);
  assert.equal(p.vy, 0);
});

test('a full XXL team can overlap without blocking left or right movement or causing friendly damage', async (t) => {
  const {
    room: r,
    host,
    player: p,
  } = await setup(t, { mode: 'xxl', botCount: 119, role: 'worker' });
  await start(host);
  const x = 3000,
    y = floorY(r);
  for (const other of r.players.values()) {
    stop(other);
    other.x = other.team === p.team ? x + 30 : 9000;
    other.y = y;
    other.grounded = true;
    other.invulnerableUntil = 0;
  }
  p.x = x;
  p.lastInput = Date.now();
  assert.equal(
    [...r.players.values()].filter((other) => other.team === p.team && other.id !== p.id).length,
    59,
  );
  host.send({ type: 'input', seq: 1, right: true });
  await waitFor(() => p.x > x + 150);
  assert.equal(p.vx, 270);
  assert.equal(p.alive, true);
  host.send({ type: 'input', seq: 2, left: true });
  await waitFor(() => p.x < x - 20);
  assert.equal(p.vx, -270);
  assert.equal(p.alive, true);
  assert.equal(
    [...r.players.values()].filter((other) => other.team === p.team && !other.alive).length,
    0,
  );
});

test('opposing workers pass through each other while armed enemy contact causes a knockout rather than body blocking', async (t) => {
  const { room: r, host, player: p } = await setup(t, { botCount: 3, role: 'worker' });
  await start(host);
  for (const other of r.players.values()) {
    stop(other);
    other.x = 1200;
    other.y = floorY(r);
    other.invulnerableUntil = Date.now() + 10000;
  }
  const enemy = [...r.players.values()].find((other) => other.team !== p.team);
  p.x = 100;
  p.y = floorY(r);
  p.grounded = true;
  p.invulnerableUntil = 0;
  enemy.role = 'worker';
  enemy.x = 140;
  enemy.y = p.y;
  enemy.grounded = true;
  enemy.invulnerableUntil = 0;
  host.send({ type: 'input', seq: 1, right: true });
  await waitFor(() => p.x > enemy.x + 45);
  assert.equal(p.alive, true);
  assert.equal(enemy.alive, true);
  assert.equal(p.vx, 270);
  enemy.role = 'warrior';
  enemy.x = p.x + 28;
  enemy.y = p.y;
  enemy.facing = -1;
  await waitFor(() => !p.alive);
  assert.equal(enemy.kills, 1);
  assert.equal(p.role, 'worker');
});

test('only the current room leader can start, including after leadership transfers on leave', async (t) => {
  const { room: r, host, port } = await setup(t);
  const nextLeader = await client(port),
    guest = await client(port);
  nextLeader.send({ type: 'join', code: r.code, name: 'Next Leader' });
  await nextLeader.wait('joined');
  guest.send({ type: 'join', code: r.code, name: 'Guest' });
  await guest.wait('joined');
  nextLeader.send({ type: 'start' });
  assert.match((await nextLeader.wait('error')).message, /Only the host/);
  assert.equal(r.status, 'waiting', 'A ready roster must not let a guest start the room');

  host.send({ type: 'leave' });
  await host.wait('left');
  const transferred = await nextLeader.wait('state', (s) => s.hostId === nextLeader.id);
  assert.equal(transferred.status, 'waiting');
  assert.equal(
    transferred.lobbyPlayers.find((p) => p.id === transferred.hostId).name,
    'Next Leader',
  );
  assert.equal(
    transferred.lobbyPlayers.some((p) => p.id === host.id),
    false,
  );
  host.send({ type: 'start' });
  assert.match((await host.wait('error')).message, /Only the host/);
  guest.send({ type: 'start' });
  assert.match((await guest.wait('error')).message, /Only the host/);
  // The remaining team needs its vacated Queen seat before the new leader starts.
  guest.send({ type: 'role', role: 'queen' });
  await guest.wait('state', (s) => s.lobbyPlayers.find((p) => p.id === guest.id).role === 'queen');
  const playing = await start(nextLeader);
  assert.equal(playing.hostId, nextLeader.id);
  assert.equal(playing.status, 'playing');
});

test('lobby choices enforce proportional Queen slots, host start validation and locked round roles/bots', async (t) => {
  const { room: r, host: a, port, player: p } = await setup(t, { role: 'worker' });
  assert.equal(p.role, 'worker');
  a.send({ type: 'start' });
  assert.match((await a.wait('error')).message, /Waiting for players/);
  a.send({ type: 'role', role: 'queen' });
  await a.wait('state', (s) => s.lobbyPlayers.find((p) => p.id === a.id).role === 'queen');
  const b = await client(port),
    c = await client(port);
  b.send({ type: 'join', code: r.code, name: 'B' });
  await b.wait('joined');
  c.send({ type: 'join', code: r.code, name: 'C' });
  await c.wait('joined');
  c.send({ type: 'role', role: 'queen' });
  assert.match((await c.wait('error')).message, /Queen slots/);
  a.send({ type: 'role', role: 'worker' });
  await a.wait('state', (s) => s.lobbyPlayers.find((p) => p.id === a.id).role === 'worker');
  a.send({ type: 'start' });
  assert.match((await a.wait('error')).message, /Queen slot/);
  c.send({ type: 'role', role: 'queen' });
  await c.wait('state', (s) => s.lobbyPlayers.find((p) => p.id === c.id).role === 'queen');
  const state = await start(a);
  assert.deepEqual(state.queenQuota, [1, 1]);
  assert.deepEqual(state.queenLives, [3, 3]);
  assert.equal(state.remaining, null);
  a.send({ type: 'role', role: 'queen' });
  assert.match((await a.wait('error')).message, /locked/);
  a.send({ type: 'bots', count: 3 });
  assert.match((await a.wait('error')).message, /between rounds/);
  c.send({ type: 'input', seq: 1, right: true, x: 999999 });
  const x = r.players.get(c.id).x;
  await c.wait('state', (s) => s.ack === 1 && s.players.find((p) => p.id === c.id)?.x > x + 10);
  assert.ok(r.players.get(c.id).x < x + 400);
});

test('XXL fills 12 Queens per full team, each with three lives; late join preserves a dead Queen slot', async (t) => {
  const { room: r, host, port } = await setup(t, { mode: 'xxl', botCount: 119, role: 'worker' });
  const before = await host.wait('state', (s) => s.botCount === 119);
  assert.deepEqual(before.queenQuota, [12, 12]);
  assert.equal(before.lobbyPlayers.filter((p) => p.role === 'queen').length, 24);
  for (const p of r.players.values()) if (p.bot) stop(p);
  await start(host);
  const q = [...r.players.values()].find((p) => p.bot && p.team === 1 && p.role === 'queen');
  q.alive = false;
  q.queenLives = 0;
  q.eliminated = true;
  q.respawnAt = Date.now() + 10000;
  q.invulnerableUntil = 0;
  const slot = r.queenSlots[1].find((s) => s.id === q.queenSlot);
  slot.lives = 0;
  const b = await client(port);
  b.send({ type: 'join', code: r.code, name: 'Late Queen', role: 'queen' });
  const joined = await b.wait('joined');
  const inherited = r.players.get(b.id);
  assert.equal(inherited.role, 'queen');
  assert.equal(inherited.queenLives, 0);
  assert.equal(inherited.alive, false);
  assert.equal(inherited.eliminated, true);
  assert.equal(inherited.queenSlot, q.queenSlot);
  assert.deepEqual(r.queenQuota, [12, 12]);
  assert.equal(joined.players.length, 120);
});

test('only all rival Queens exhausted triggers military; eliminated Queens never respawn and victory freezes state', async (t) => {
  const { room: r, host: a, player: p } = await setup(t, { mode: 'xxl', botCount: 11 });
  for (const bot of r.players.values()) if (bot.bot) stop(bot);
  await start(a);
  assert.deepEqual(r.queenQuota, [2, 2]);
  p.invulnerableUntil = 0;
  p.facing = 1;
  stop(p);
  const rivals = [...r.players.values()].filter((q) => q.team === 1 && q.role === 'queen');
  for (const [index, q] of rivals.entries()) {
    for (let life = 2; life >= 0; life--) {
      p.x = 2000;
      p.y = floorY(r) - 22;
      p.vy = 0;
      p.facing = 1;
      p.invulnerableUntil = 0;
      q.x = 2028;
      q.y = floorY(r);
      q.alive = true;
      q.vy = 0;
      q.invulnerableUntil = 0;
      q.facing = -1;
      stop(q);
      await waitFor(() => q.queenLives === life);
    }
    assert.equal(q.eliminated, true);
    q.respawnAt = 0;
    if (index === 0) {
      assert.equal(r.status, 'playing');
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(q.alive, false);
    }
  }
  const state = await a.wait('state', (s) => s.status === 'ended');
  assert.equal(state.winType, 'military');
  assert.equal(state.winner, 0);
  assert.deepEqual(state.queensRemaining, [2, 0]);
  assert.equal(state.victory.actorName, 'Host');
  const frozen = JSON.stringify(state.victory);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(JSON.stringify(r.victory), frozen);
  a.send({ type: 'rematch' });
  await a.wait('state', (s) => s.status === 'waiting');
  assert.equal(r.winType, null);
  assert.ok(
    [...r.players.values()].filter((p) => p.role === 'queen').every((p) => p.queenLives === 3),
  );
});

test('finite stockpiles stream counts, carried chips drop on death and deposits produce only Economic victory', async (t) => {
  const { room: r, host: a, port, player: p } = await setup(t, { role: 'worker', botCount: 1 });
  const b = await client(port);
  b.send({ type: 'join', code: r.code, name: 'Enemy' });
  await b.wait('joined');
  for (const bot of r.players.values()) if (bot.bot) stop(bot);
  // A bot fills host's crown and a real opponent gives us a controlled collision.
  if (![...r.players.values()].some((q) => q.team === 0 && q.role === 'queen')) {
    a.send({ type: 'bots', count: 3 });
    await a.wait('state', (s) => s.botCount === 3);
  }
  for (const bot of r.players.values()) if (bot.bot) stop(bot);
  await start(a);
  const q = r.players.get(b.id);
  const stock = r.players.size * 6,
    target = r.map.scoreTarget;
  const state = await a.wait('state', (s) => s.status === 'playing');
  assert.equal(state.piles.length, 6);
  assert.equal(state.berries.length, 0);
  assert.equal(
    state.piles.reduce((n, p) => n + p.remaining, 0),
    stock,
  );
  const chip = awardChip(r, p);
  p.x = 1000;
  p.y = floorY(r);
  p.invulnerableUntil = 0;
  stop(p);
  q.x = 1028;
  q.y = floorY(r) - 20;
  q.facing = -1;
  q.invulnerableUntil = 0;
  stop(q);
  await waitFor(() => !p.alive);
  assert.equal(chip.active, true);
  assert.equal(chip.pileId, null);
  assert.equal(p.carrying, false);
  assert.equal(r.berries.length, stock);
  q.x = 2500;
  p.respawnAt = 0;
  await waitFor(() => p.alive);
  p.x = r.map.bases[p.team].x + 5;
  p.y = r.map.bases[p.team].y + r.map.bases[p.team].h - 36;
  stop(p);
  r.scores[p.team] = target - 1;
  awardChip(r, p);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(r.status, 'playing');
  assert.equal(p.carrying, true);
  assert.equal(r.scores[p.team], target - 1);
  p.x = r.map.bases[p.team].x + r.map.bases[p.team].w / 2 - 14;
  const ended = await a.wait('state', (s) => s.status === 'ended');
  assert.equal(ended.winType, 'economic');
  assert.equal(ended.victory.data[p.team], target);
  assert.equal(ended.victory.type, 'economic');
});

test('economic targets follow humans and bots in the lobby, lock through countdown/play/results, and recalculate for rematch', async (t) => {
  const {
    room: r,
    host: a,
    port,
    player: p,
    joined,
  } = await setup(t, { mode: 'xxl', botCount: 9, role: 'worker' }, { countdownMs: 400 });
  assert.equal(joined.map.scoreTarget, 12);
  assert.equal(joined.map.resourceCount, 60);
  a.send({ type: 'bots', count: 19 });
  const twenty = await a.wait('state', (s) => s.botCount === 19);
  assert.equal(twenty.scoreTarget, 24);
  assert.equal(twenty.resourceCount, 120);
  assert.equal(twenty.economyPlayerCount, 20);
  const guest = await client(port);
  guest.send({ type: 'join', code: r.code, name: 'Second human', role: 'worker' });
  const guestJoined = await guest.wait('joined');
  assert.equal(guestJoined.map.scoreTarget, 26);
  assert.equal(guestJoined.map.resourceCount, 126);
  const countdown = await start(a);
  assert.ok(countdown.time < countdown.startsAt);
  assert.equal(countdown.scoreTarget, 26);
  assert.equal(countdown.economyPlayerCount, 21);

  const late = await client(port);
  late.send({ type: 'join', code: r.code, name: 'Late human', role: 'worker' });
  const lateJoined = await late.wait('joined');
  assert.equal(r.players.size, 22);
  assert.equal(lateJoined.map.scoreTarget, 26);
  assert.equal(r.berries.length, 126);
  a.send({ type: 'bots', count: 29 });
  assert.match((await a.wait('error')).message, /between rounds/);
  await a.wait('state', (s) => s.time >= s.startsAt);
  for (const player of r.players.values()) stop(player);
  late.send({ type: 'leave' });
  await late.wait('left');
  const playing = await a.wait('state', (s) => s.playerCount === 2);
  assert.equal(playing.scoreTarget, 26);
  assert.equal(playing.resourceCount, 126);
  assert.equal(playing.economyPlayerCount, 21);

  // Finish through the real delivery path and retain the completed round's
  // denominator while the host changes next round's bot roster.
  const home = r.map.bases[p.team];
  awardChip(r, p);
  stop(p);
  p.x = home.x + home.w / 2 - 14;
  p.y = home.y + home.h - 36;
  p.grounded = true;
  r.scores[p.team] = 25;
  const ended = await a.wait('state', (s) => s.status === 'ended');
  assert.equal(ended.winType, 'economic');
  assert.equal(ended.victory.scoreTarget, 26);
  assert.equal(ended.victory.data[p.team], 26);
  a.send({ type: 'bots', count: 29 });
  const changed = await a.wait('state', (s) => s.botCount === 29);
  assert.equal(changed.scoreTarget, 26);
  assert.equal(changed.resourceCount, 126);
  assert.equal(changed.victory.scoreTarget, 26);
  a.send({ type: 'rematch' });
  const waiting = await a.wait('state', (s) => s.status === 'waiting');
  assert.equal(waiting.economyPlayerCount, 31);
  assert.equal(waiting.scoreTarget, 38);
  assert.equal(waiting.resourceCount, 186);
  assert.equal(
    waiting.piles.reduce((total, pile) => total + pile.remaining, 0),
    186,
  );
  const restarted = await start(a);
  assert.equal(restarted.scoreTarget, 38);
  assert.equal(restarted.resourceCount, 186);
  assert.deepEqual(restarted.scores, [0, 0]);
});

test('activity events identify actual collectors, depositors, killers and victims in both wire protocols', async (t) => {
  const {
    room: r,
    host: a,
    port,
    player: p,
  } = await setup(t, { name: 'Pixel & Lens', role: 'worker', botCount: 3 });
  const b = await client(port, 'compact-v1');
  b.send({ type: 'join', code: r.code, name: 'False Positive' });
  await b.wait('joined');
  const q = r.players.get(b.id);
  assert.equal(q.role, 'queen');
  assert.notEqual(p.team, q.team);
  await start(a);
  for (const player of r.players.values()) {
    stop(player);
    player.x = 50;
    player.y = floorY(r);
    player.invulnerableUntil = Date.now() + 10000;
  }
  q.x = 1200;
  const collector = { id: p.id, name: 'Pixel & Lens', team: p.team, bot: false };
  const killer = { id: q.id, name: 'False Positive', team: q.team, bot: false };
  const eventPackets = (type) =>
    Promise.all(
      [a, b].map((c) =>
        c.wait('state', (s) =>
          s.events.some(
            (e) => e.type === type && (type === 'ko' ? e.target?.id : e.actor?.id) === p.id,
          ),
        ),
      ),
    );
  const checkPackets = (packets, type) => {
    assert.equal(packets[0].encoding, undefined);
    assert.equal(packets[1].encoding, 'compact-v1');
    const events = packets.map((s) =>
      s.events.find(
        (e) => e.type === type && (type === 'ko' ? e.target?.id : e.actor?.id) === p.id,
      ),
    );
    assert.deepEqual(events[0], events[1]);
    return events[0];
  };

  // Move a real worker through a stockpile and then its delivery door. The
  // resulting gameplay events must be self-contained on both public wires.
  const pickupPackets = eventPackets('pickup');
  p.x = r.map.berryPiles[0].x - 14;
  p.y = floorY(r);
  const pickup = checkPackets(await pickupPackets, 'pickup');
  assert.deepEqual(pickup.actor, collector);
  assert.equal(pickup.amount, 1);
  assert.equal(p.carrying, true);

  const depositPackets = eventPackets('deposit');
  const home = r.map.bases[p.team];
  stop(p);
  p.x = home.x + home.w / 2 - 14;
  p.y = home.y + home.h - 36;
  p.grounded = true;
  const deposit = checkPackets(await depositPackets, 'deposit');
  assert.deepEqual(deposit.actor, collector);
  assert.equal(deposit.amount, 1);
  assert.equal(deposit.score, 1);
  assert.equal(deposit.scoreTarget, r.map.scoreTarget);
  assert.equal(p.carrying, false);
  assert.equal(r.status, 'playing');

  const koPackets = eventPackets('ko');
  stop(p);
  p.x = 1000;
  p.y = floorY(r);
  p.invulnerableUntil = 0;
  stop(q);
  q.x = 1028;
  q.y = floorY(r) - 20;
  q.facing = -1;
  q.invulnerableUntil = 0;
  const ko = checkPackets(await koPackets, 'ko');
  assert.equal(p.alive, false);
  assert.deepEqual(ko.actor, killer);
  assert.deepEqual(ko.target, collector);
  assert.equal(ko.team, killer.team);
  assert.match(ko.text, /False Positive recycled Pixel & Lens/);

  // Names in the feed remain available after either identity leaves the room.
  a.send({ type: 'leave' });
  await a.wait('left');
  b.send({ type: 'leave' });
  await b.wait('left');
  assert.equal(r.players.has(p.id), false);
  assert.equal(r.players.has(q.id), false);
  assert.deepEqual(ko.actor, killer);
  assert.deepEqual(ko.target, collector);
});

test('AI1 wing/speed gates require one chip, usable ownership and a vulnerable transformation channel', async (t) => {
  const { room: r, host: a, player: p, port } = await setup(t, { role: 'worker', botCount: 3 });
  for (const bot of r.players.values()) if (bot.bot) stop(bot);
  const b = await client(port);
  b.send({ type: 'join', code: r.code, name: 'Enemy Queen' });
  await b.wait('joined');
  for (const bot of r.players.values()) if (bot.bot) stop(bot);
  await start(a);
  const enemy = r.players.get(b.id),
    wing = r.gates.find((g) => g.kind === 'warrior'),
    speed = r.gates.find((g) => g.kind === 'speed');
  stop(p);
  p.x = wing.x + 15;
  p.y = wing.y + wing.h - 36;
  p.input = { action: true };
  p.lastInput = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(p.upgradeUntil, 0);
  assert.equal(p.role, 'worker');
  awardChip(r, p);
  await waitFor(() => p.upgradeUntil > 0);
  assert.equal(p.role, 'worker');
  const x = p.x;
  p.input = { action: true, right: true };
  p.lastInput = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(p.x, x);
  // Capture cancels the channel without consuming its resource.
  enemy.x = wing.x + 15;
  enemy.y = wing.y + wing.h - 36;
  enemy.invulnerableUntil = Date.now() + 5000;
  stop(enemy);
  await waitFor(() => wing.team === enemy.team && p.upgradeUntil === 0);
  assert.equal(p.carrying, true);
  assert.equal(p.role, 'worker');
  enemy.x = r.map.width - 700;
  wing.team = p.team;
  p.input = { action: true };
  p.lastInput = Date.now();
  await a.wait('state', (s) => s.players.find((q) => q.id === p.id)?.role === 'warrior');
  assert.equal(p.carrying, false);
  // Warriors cannot collect stock or ride the gator.
  p.x = r.map.berryPiles[0].x;
  p.y = floorY(r);
  r.gator.x = p.x + 14;
  p.input = { action: true };
  p.lastInput = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(p.carrying, false);
  assert.notEqual(r.gator.riderId, p.id);
  // Death removes wings and earned speed.
  p.speedBoost = true;
  p.invulnerableUntil = 0;
  p.x = 1000;
  p.y = floorY(r);
  enemy.x = 1028;
  enemy.y = floorY(r) - 20;
  enemy.facing = -1;
  enemy.invulnerableUntil = 0;
  await waitFor(() => !p.alive);
  assert.equal(p.role, 'worker');
  assert.equal(p.speedBoost, false);
  enemy.x = r.map.width - 700;
  p.respawnAt = 0;
  await waitFor(() => p.alive);
  p.x = speed.x + 15;
  p.y = speed.y + speed.h - 36;
  awardChip(r, p);
  p.input = { action: true };
  p.lastInput = Date.now();
  await a.wait('state', (s) => s.players.find((q) => q.id === p.id)?.speedBoost);
  assert.equal(p.role, 'worker');
  assert.equal(p.carrying, false);
});

test('Gator victory requires a worker reaching own goal; time alone cannot end a round', async (t) => {
  const { room: r, host: a, player: p } = await setup(t, { role: 'worker', botCount: 3 });
  for (const bot of r.players.values()) if (bot.bot) stop(bot);
  await start(a);
  r.startedAt = Date.now() - 9 * 60 * 1000;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(r.status, 'playing');
  p.x = r.gator.x - 14;
  p.y = floorY(r);
  p.input = { action: true };
  p.lastInput = Date.now();
  await waitFor(() => r.gator.riderId === p.id);
  r.gator.x = r.map.gatorTrack.x1 + 0.1;
  const result = await a.wait('state', (s) => s.status === 'ended');
  assert.equal(result.winType, 'gator');
  assert.equal(result.winner, p.team);
  assert.equal(result.victory.gatorProgress, -1);
});

test('quick play does not start another host lobby, private rooms stay unlisted, empty rooms expire', async (t) => {
  const game = createGameServer({
    port: 0,
    host: '127.0.0.1',
    emptyRoomTtlMs: 80,
    maintenanceMs: 100,
    countdownMs: 0,
  });
  const { port } = await game.listen();
  t.after(() => game.close());
  const a = await client(port),
    b = await client(port);
  a.send({ type: 'create', botCount: 0, private: true });
  const ja = await a.wait('joined');
  const listing = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((r) => r.json());
  assert.equal(listing.rooms.length, 0);
  b.send({ type: 'quick', name: 'Quick' });
  const jb = await b.wait('joined');
  assert.notEqual(ja.code, jb.code);
  assert.equal(game.rooms.get(ja.code).status, 'waiting');
  a.send({ type: 'leave' });
  await a.wait('left');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(game.rooms.has(ja.code), false);
});

test('default 3-2-1 countdown freezes the arena and discards buffered inputs before GO', async (t) => {
  const game = createGameServer({ port: 0, host: '127.0.0.1' });
  const { port } = await game.listen();
  t.after(() => game.close());
  const a = await client(port);
  a.send({ type: 'create', name: 'Countdown', botCount: 9 });
  const joined = await a.wait('joined');
  const r = game.rooms.get(joined.code),
    p = r.players.get(a.id);
  // A held lobby jump/input must not carry into the first active frame.
  a.send({ type: 'input', seq: 1, right: true, jump: true });
  a.send({ type: 'start' });
  const countdown = await a.wait('state', (s) => s.status === 'playing' && s.time < s.startsAt);
  assert.equal(countdown.startsAt, countdown.countdownUntil);
  assert.equal(countdown.elapsedSeconds, 0);
  const timeLeft = countdown.startsAt - countdown.time;
  assert.ok(timeLeft > 2700 && timeLeft <= 3000);
  assert.equal(p.invulnerableUntil, r.startsAt + 1800);
  assert.deepEqual(p.input, {
    left: false,
    right: false,
    jump: false,
    action: false,
    dash: false,
    down: false,
  });
  const positions = [...r.players.values()].map((p) => [p.id, p.x, p.y]);
  const piles = r.berries.filter((b) => b.active).length;
  const gator = r.gator.x;
  a.send({ type: 'input', seq: 2, right: true, jump: true, action: true });
  await a.wait('state', (s) => s.ack === 2 && s.time < s.startsAt);
  assert.equal(p.input.jump, false);
  assert.equal(p.input.right, false);
  const lastCountdown = await a.wait(
    'state',
    (s) => s.time >= s.startsAt - 250 && s.time < s.startsAt,
  );
  assert.equal(lastCountdown.elapsedSeconds, 0);
  assert.deepEqual(
    [...r.players.values()].map((p) => [p.id, p.x, p.y]),
    positions,
  );
  assert.equal(r.berries.filter((b) => b.active).length, piles);
  assert.equal(r.gator.x, gator);
  assert.ok(r.gates.every((g) => g.team === null));
  const originalX = p.x,
    originalY = p.y;
  await a.wait('state', (s) => s.time >= s.startsAt + 80);
  assert.equal(p.x, originalX);
  assert.equal(p.y, originalY);
  a.send({ type: 'input', seq: 3, right: true, jump: true });
  await a.wait(
    'state',
    (s) => s.ack === 3 && s.players.find((q) => q.id === p.id)?.x > originalX + 10,
  );
  assert.ok(p.y < originalY);
  assert.equal(r.status, 'playing');
});
