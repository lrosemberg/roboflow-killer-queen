import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';
import { decodeSnapshot } from '../shared/protocol.js';

// Isolated localhost only. No target URL is accepted and no production service
// is contacted. Faults are deterministic WebSocket delivery/backpressure shims,
// not physical packet loss, a browser benchmark, or an internet latency test.
const reportPath = process.argv[2];
if (reportPath && /^https?:/i.test(reportPath))
  throw new Error('Only a local report path is accepted.');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const peers = [],
  restorers = [],
  phases = [],
  pingSamples = [];
let game,
  port,
  room,
  code,
  closing = false,
  deadlineExceeded = false,
  inputTimer,
  pingTimer;
const started = performance.now();
const result = {
  testedAt: new Date().toISOString(),
  success: false,
  players: 120,
  note: '120 real localhost WebSocket clients using ordinary lobby and input messages. No player teleportation. Fault injection wraps WebSocket delivery and reported backpressure; it is not real packet loss. Server and generator share a process, so timing is not a capacity benchmark.',
  phases,
};
async function sourceHashes() {
  return Object.fromEntries(
    await Promise.all(
      ['server.js', 'shared/protocol.js', 'shared/input-buffer.js'].map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(new URL(`../${path}`, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  );
}
const deadline = setTimeout(() => {
  deadlineExceeded = true;
  for (const peer of peers) peer.ws.terminate();
}, 100000);
const distribution = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) =>
    sorted.length
      ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(3)
      : null;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
};
async function until(predicate, label, timeout = 6000) {
  const end = performance.now() + timeout;
  while (!predicate()) {
    assert.ok(!deadlineExceeded, 'Overall 100-second deadline exceeded');
    if (performance.now() >= end) throw new Error(`Timed out: ${label}`);
    await sleep(15);
  }
}
async function phase(name, run) {
  const before = performance.now();
  const beforeSkips = game?.metrics().skippedSnapshots ?? 0;
  const details = await run();
  phases.push({
    name,
    success: true,
    seconds: +((performance.now() - before) / 1000).toFixed(3),
    skippedSnapshots: (game?.metrics().skippedSnapshots ?? 0) - beforeSkips,
    ...details,
  });
}
function send(peer, message) {
  if (peer.ws.readyState !== WebSocket.OPEN) return;
  if (peer.outbox) {
    peer.outbox.push(message);
    peer.maxQueued = Math.max(peer.maxQueued, peer.outbox.length);
  } else peer.ws.send(JSON.stringify(message));
}
function input(peer, values = {}) {
  send(peer, { type: 'input', seq: ++peer.seq, ...values });
  return peer.seq;
}
function wait(peer, type, predicate = () => true, timeout = 8000) {
  const current = peer.latest.get(type);
  if (current && predicate(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const pending = { type, predicate, resolve, reject };
    pending.timer = setTimeout(() => {
      peer.pending.delete(pending);
      reject(new Error(`Client ${peer.index}: timed out waiting for ${type}`));
    }, timeout);
    peer.pending.add(pending);
  });
}
// Keep this protocol adapter explicit so the script tests the shipped contract.
function connectionUrl() {
  const url = new URL(`ws://127.0.0.1:${port}/ws`);
  url.searchParams.set('protocol', 'compact-v1');
  url.searchParams.set('resume', '1');
  url.searchParams.set('events', '1');
  return url;
}
async function connect(index, resumeToken = null, eventAck = 0) {
  const ws = new WebSocket(connectionUrl(), { perMessageDeflate: true });
  const peer = {
    index,
    ws,
    seq: 0,
    states: 0,
    events: new Map(),
    eventDeliveries: new Map(),
    deferEventProcessing: false,
    latest: new Map(),
    pending: new Set(),
    failures: [],
    expectedClose: false,
    outbox: null,
    maxQueued: 0,
    maxBufferedBytes: 0,
    gaps: [],
    lastStateAt: 0,
    mapRevision: 0,
    eventAck: 0,
  };
  peers.push(peer);
  ws.on('error', (error) => {
    if (!closing && !peer.expectedClose) peer.failures.push(error.message);
  });
  ws.on('close', (status, reason) => {
    peer.closeCode = status;
    if (!closing && !peer.expectedClose)
      peer.failures.push(`Unexpected close ${status}: ${reason}`);
    for (const pending of peer.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Client ${index} closed while waiting for ${pending.type}`));
    }
    peer.pending.clear();
  });
  ws.on('message', (bytes) => {
    try {
      const message = decodeSnapshot(JSON.parse(bytes));
      if (message.type === 'welcome') {
        peer.id = message.id;
        peer.resumeToken = message.resumeToken;
      }
      if (message.type === 'joined' || message.type === 'map-changed') {
        peer.mapRevision = message.mapRevision ?? message.room?.mapRevision ?? 0;
        peer.map = message.map;
        peer.id = message.id || peer.id;
        peer.resumeToken = message.resumeToken || peer.resumeToken;
        peer.eventEpoch = message.eventEpoch || peer.eventEpoch;
        peer.eventAck = message.eventAck ?? peer.eventAck;
        peer.seq = Math.max(peer.seq, message.ack || 0);
      }
      if (message.type === 'state') {
        peer.states++;
        if (peer.lastStateAt) peer.gaps.push(performance.now() - peer.lastStateAt);
        peer.lastStateAt = performance.now();
        peer.own = message.players.find((p) => p.id === peer.id);
        peer.seq = Math.max(peer.seq, message.ack || 0);
        peer.eventEpoch = message.eventEpoch || peer.eventEpoch;
        for (const event of message.events || [])
          peer.eventDeliveries.set(event.id, (peer.eventDeliveries.get(event.id) || 0) + 1);
        if (!peer.deferEventProcessing) {
          for (const event of message.events || []) peer.events.set(event.id, event);
          const latestEvent = Math.max(
            peer.eventAck,
            (message.eventFloor || 1) - 1,
            ...(message.events || []).map((event) => event.id),
          );
          if (latestEvent > peer.eventAck) {
            peer.eventAck = latestEvent;
            send(peer, { type: 'event-ack', id: latestEvent, eventEpoch: peer.eventEpoch });
          }
        }
      }
      if (message.type === 'pong') pingSamples.push(performance.now() - message.time);
      peer.latest.set(message.type, message);
      for (const pending of [...peer.pending])
        if (pending.type === message.type && pending.predicate(message)) {
          clearTimeout(pending.timer);
          peer.pending.delete(pending);
          pending.resolve(message);
        }
    } catch (error) {
      peer.failures.push(error.stack);
    }
  });
  await wait(peer, 'welcome');
  if (resumeToken) {
    send(peer, { type: 'resume', token: resumeToken, eventAck, eventEpoch: code });
    await wait(peer, 'joined', (message) => message.resumed === true);
  }
  return peer;
}
function forceBackpressure(peer) {
  const socket = game.clients.get(peer.id).socket;
  const own = Object.getOwnPropertyDescriptor(socket, 'bufferedAmount');
  const original = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount').get;
  let active = true;
  Object.defineProperty(socket, 'bufferedAmount', {
    configurable: true,
    get: () => (active ? 300 * 1024 : original.call(socket)),
  });
  const restore = () => {
    active = false;
    if (own) Object.defineProperty(socket, 'bufferedAmount', own);
    else delete socket.bufferedAmount;
  };
  restorers.push(restore);
  return restore;
}
function stallOneSnapshot(peer) {
  const socket = game.clients.get(peer.id).socket;
  const original = socket.send;
  let held,
    active = true;
  socket.send = function (data, options, callback) {
    if (active && !held && JSON.parse(data.toString()).type === 'state') {
      held = [data, options, callback];
      return;
    }
    return original.call(this, data, options, callback);
  };
  const release = () => {
    active = false;
    socket.send = original;
    if (held) {
      original.call(socket, ...held);
      held = null;
    }
  };
  restorers.push(release);
  return { held: () => Boolean(held), release };
}

try {
  result.sourceSha256 = await sourceHashes();
  game = createGameServer({
    port: 0,
    host: '127.0.0.1',
    countdownMs: 250,
    resumeGraceMs: 1500,
    maintenanceMs: 300,
    emptyRoomTtlMs: 300,
  });
  ({ port } = await game.listen());
  let participants = [],
    host,
    initialMetrics,
    measurementStart;
  await phase('120 clients join; capacity enforced', async () => {
    host = await connect(0);
    send(host, {
      type: 'create',
      mode: 'xxl',
      name: 'Resilience fixture',
      private: true,
      botCount: 0,
      role: 'worker',
    });
    const joined = await wait(host, 'joined');
    code = joined.code;
    room = game.rooms.get(code);
    participants.push(host);
    for (let start = 1; start < 120; start += 12) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(12, 120 - start) }, async (_, offset) => {
          const peer = await connect(start + offset);
          send(peer, { type: 'join', code, name: `Resilience ${peer.index}`, role: 'worker' });
          await wait(peer, 'joined');
          return peer;
        }),
      );
      participants.push(...batch);
    }
    assert.equal(room.players.size, 120);
    assert.ok(
      participants.every((p) => typeof p.resumeToken === 'string' && p.resumeToken.length >= 16),
      'Opt-in clients receive resume credentials',
    );
    const overflow = await connect(120);
    send(overflow, { type: 'join', code, name: 'Overflow' });
    assert.match((await wait(overflow, 'error')).message, /full/i);
    overflow.expectedClose = true;
    overflow.ws.terminate();
    initialMetrics = game.metrics();
    measurementStart = performance.now();
    return {
      capacity: 120,
      rejected121st: true,
      encoding: 'compact-v1',
      compression: participants.every((p) => p.ws.extensions.includes('permessage-deflate')),
    };
  });
  await phase('Skipped snapshots recover genuine role events', async () => {
    const slow = participants[119],
      fast = participants[118];
    const stall = stallOneSnapshot(slow),
      before = room.eventCounter,
      skips = game.metrics().skippedSnapshots;
    await until(stall.held, 'first state held');
    for (const team of [0, 1]) {
      const crew = participants.filter((p) => room.players.get(p.id).team === team).slice(0, 12);
      for (const peer of crew) send(peer, { type: 'role', role: 'queen' });
    }
    await until(
      () =>
        [...fast.events.values()].filter((event) => event.id > before && event.type === 'role')
          .length === 24,
      'fast recipient gets24 role events',
    );
    const expected = [...fast.events.values()]
      .filter((event) => event.id > before && event.type === 'role')
      .map((event) => event.id);
    await sleep(250);
    assert.ok(game.metrics().skippedSnapshots > skips);
    assert.equal(expected.filter((id) => slow.events.has(id)).length, 0);
    stall.release();
    await until(
      () => expected.every((id) => slow.events.has(id)),
      'slow recipient catches every missed role event',
    );
    await until(
      () => game.clients.get(slow.id).eventAck >= Math.max(...expected),
      'server records recovered event acknowledgement',
    );
    const acknowledgedAt = Date.now();
    await wait(
      slow,
      'state',
      (state) =>
        state.time > acknowledgedAt && state.events.every((event) => !expected.includes(event.id)),
    );
    return {
      recoveredEventCount: expected.length,
      skippedSnapshots: game.metrics().skippedSnapshots - skips,
      heldSnapshotFrames: 1,
      acknowledgedEventsStopReplaying: true,
    };
  });
  await phase('Live events send once; unprocessed events recover on resume', async () => {
    const deferred = participants[118],
      roleActor = participants.find((peer) => room.players.get(peer.id).role === 'queen');
    await until(
      () => game.clients.get(deferred.id).eventAck === room.eventCounter,
      'deferred recipient starts from a processed cursor',
    );
    const acknowledged = deferred.eventAck;
    deferred.deferEventProcessing = true;
    send(roleActor, { type: 'role', role: 'worker' });
    await until(() => room.eventCounter > acknowledged, 'ordinary role event generated');
    const eventId = room.eventCounter;
    await until(() => deferred.eventDeliveries.has(eventId), 'event reaches deferred recipient');
    const deliveredAtState = deferred.states;
    await until(
      () => deferred.states >= deliveredAtState + 3,
      'three subsequent live snapshots arrive',
    );
    assert.equal(deferred.eventDeliveries.get(eventId), 1);
    assert.equal(deferred.events.has(eventId), false);
    assert.equal(game.clients.get(deferred.id).eventAck, acknowledged);
    deferred.expectedClose = true;
    deferred.ws.terminate();
    await until(() => !game.clients.has(deferred.id), 'deferred transport disconnects');
    const fresh = await connect(deferred.index, deferred.resumeToken, acknowledged);
    assert.equal(fresh.id, deferred.id);
    await until(() => fresh.events.has(eventId), 'resume replays the unprocessed role event');
    await until(
      () => game.clients.get(fresh.id).eventAck >= eventId,
      'recovered event becomes acknowledged',
    );
    assert.equal(fresh.eventDeliveries.get(eventId), 1);
    participants[118] = fresh;
    send(roleActor, { type: 'role', role: 'queen' });
    await until(() => room.players.get(roleActor.id).role === 'queen', 'restore chosen Queen');
    return {
      liveDeliveriesWhileUnacknowledged: 1,
      subsequentSnapshotsChecked: 3,
      replayedUnprocessedEvents: 1,
      resumedSameIdentity: true,
    };
  });
  await phase('Congested map control closes transport; resume restores full geometry', async () => {
    const slow = participants[119],
      oldRevision = room.mapRevision;
    const release = forceBackpressure(slow);
    slow.expectedClose = true;
    send(host, { type: 'map', mapId: 'singapore' });
    await until(() => room.mapRevision > oldRevision, 'host changes map');
    await until(() => slow.closeCode !== undefined, 'congested control closes transport');
    assert.equal(slow.closeCode, 1013);
    release();
    const fresh = await connect(slow.index, slow.resumeToken, slow.eventAck);
    assert.equal(fresh.id, slow.id);
    assert.equal(fresh.map.mapId, 'singapore');
    assert.equal(fresh.mapRevision, room.mapRevision);
    assert.deepEqual(fresh.map.platforms, room.map.platforms);
    participants[119] = fresh;
    return {
      mapId: room.mapId,
      mapRevision: room.mapRevision,
      congestedCloseCode: slow.closeCode,
      syntheticBufferedBytes: 300 * 1024,
      resumedSameIdentity: true,
      fullGeometryMatches: true,
    };
  });
  await phase('All120 move through acknowledged ordinary inputs', async () => {
    send(host, { type: 'start' });
    await Promise.all(
      participants.map((p) =>
        wait(p, 'state', (s) => s.status === 'playing' && s.time >= s.startsAt),
      ),
    );
    const originalX = new Map(participants.map((p) => [p.id, room.players.get(p.id).x]));
    inputTimer = setInterval(() => {
      for (const peer of participants)
        if (peer.ws.readyState === WebSocket.OPEN && !peer.pauseInput) {
          const player = room.players.get(peer.id);
          input(peer, { right: player.team === 0, left: player.team === 1 });
          peer.maxBufferedBytes = Math.max(peer.maxBufferedBytes, peer.ws.bufferedAmount);
        }
    }, 1000 / 30);
    pingTimer = setInterval(() => {
      for (const peer of participants)
        if (!peer.pauseInput) send(peer, { type: 'ping', time: performance.now() });
    }, 1000);
    await until(
      () =>
        participants.every((p) => p.own?.ack > 0 && Math.abs(p.own.x - originalX.get(p.id)) > 25),
      '120 clients move at least25px',
    );
    return { moved: 120, acknowledged: 120 };
  });
  await phase('Short disconnects preserve identity, state and full-room reservations', async () => {
    const originals = [participants[0], participants[57], participants[118]];
    const preserved = originals.map((peer) => ({
      peer,
      player: room.players.get(peer.id),
      token: peer.resumeToken,
      state: Object.fromEntries(
        ['name', 'team', 'role', 'queenLives', 'score', 'kills', 'carrying', 'carriedBerryId'].map(
          (key) => [key, room.players.get(peer.id)[key]],
        ),
      ),
    }));
    for (const { peer } of preserved) {
      peer.expectedClose = true;
      peer.pauseInput = true;
      peer.ws.terminate();
    }
    await sleep(150);
    assert.equal(room.players.size, 120);
    const overflow = await connect(121);
    send(overflow, { type: 'join', code });
    assert.match((await wait(overflow, 'error')).message, /full/i);
    overflow.expectedClose = true;
    overflow.ws.terminate();
    for (const entry of preserved) {
      const fresh = await connect(entry.peer.index, entry.token, entry.peer.eventAck);
      await wait(fresh, 'joined');
      assert.equal(fresh.id, entry.peer.id);
      assert.strictEqual(
        room.players.get(fresh.id),
        entry.player,
        'Same authoritative player object survives transport interruption',
      );
      for (const [key, value] of Object.entries(entry.state))
        assert.equal(room.players.get(fresh.id)[key], value, `Resume preserves ${key}`);
      assert.ok(
        fresh.resumeToken === entry.token,
        'Resume credential survives a transport reconnect',
      );
      participants[entry.peer.index] = fresh;
      if (entry.peer === host) host = fresh;
    }
    assert.equal(room.hostId, host.id);
    assert.equal(room.players.size, 120);
    return {
      resumed: originals.length,
      sameIdentity: true,
      samePlayerObjects: true,
      preservedFields: Object.keys(preserved[0].state),
      preservedHost: true,
      rejectedNewcomerDuringGrace: true,
    };
  });
  await phase('Grace expiry releases exactly one reserved slot', async () => {
    const old = participants[119];
    old.expectedClose = true;
    old.pauseInput = true;
    old.ws.terminate();
    await until(() => !room.players.has(old.id), 'expired reservation removed', 6000);
    assert.equal(room.players.size, 119);
    const replacement = await connect(119);
    send(replacement, {
      type: 'resume',
      token: old.resumeToken,
      eventAck: old.eventAck,
      eventEpoch: code,
    });
    assert.equal((await wait(replacement, 'resume-failed')).reason, 'expired-or-invalid');
    send(replacement, { type: 'join', code, name: 'Released slot replacement', role: 'worker' });
    await wait(replacement, 'joined');
    assert.notEqual(replacement.id, old.id);
    participants[119] = replacement;
    assert.equal(room.players.size, 120);
    return { released: 1, restoredCapacity: 120, expiredTokenRejected: true };
  });
  await phase(
    'Bounded ordered delivery stall preserves final release; oversized stale burst is rejected',
    async () => {
      const stalled = participants[117];
      stalled.outbox = [];
      await sleep(400);
      const queued = stalled.outbox;
      stalled.outbox = null;
      assert.ok(queued.filter((m) => m.type === 'input').length >= 8);
      for (const message of queued) send(stalled, message);
      stalled.pauseInput = true;
      const resetSeq = input(stalled, { reset: true });
      await wait(stalled, 'state', (s) => s.ack >= resetSeq);
      assert.equal(stalled.ws.readyState, WebSocket.OPEN);
      assert.ok(
        Object.values(room.players.get(stalled.id).input).every((value) => value === false),
      );
      // Deliberately bypass the browser's bounded sender to validate server
      // protection against obsolete/unbounded input replay, not to recommend it.
      stalled.expectedClose = true;
      for (let i = 0; i < 180; i++) input(stalled, { right: true });
      await until(() => stalled.closeCode !== undefined, 'oversized stale burst rejected');
      assert.equal(stalled.closeCode, 1008);
      const fresh = await connect(stalled.index, stalled.resumeToken, stalled.eventAck);
      assert.equal(fresh.id, stalled.id);
      fresh.pauseInput = true;
      const freshReset = input(fresh, { reset: true });
      await wait(fresh, 'state', (s) => s.ack >= freshReset);
      assert.ok(Object.values(room.players.get(fresh.id).input).every((value) => value === false));
      participants[117] = fresh;
      return {
        heldMilliseconds: 400,
        releasedMessages: queued.length,
        finalResetAcknowledged: true,
        maxHeldMessages: stalled.maxQueued,
        oversizedBurstMessages: 180,
        intentionalPolicyCloseCode: stalled.closeCode,
        resumedAfterRejection: true,
      };
    },
  );
  clearInterval(inputTimer);
  clearInterval(pingTimer);
  const finalMetrics = game.metrics(),
    elapsed = (performance.now() - measurementStart) / 1000;
  assert.ok(!deadlineExceeded);
  assert.ok(
    peers.every((p) => p.failures.length === 0),
    JSON.stringify(peers.flatMap((p) => p.failures)),
  );
  result.server = {
    seconds: elapsed,
    simulationHz: (finalMetrics.totalTicks - initialMetrics.totalTicks) / elapsed,
    skippedSnapshots: finalMetrics.skippedSnapshots - initialMetrics.skippedSnapshots,
    maxTickMs: finalMetrics.maxTickMs,
    maxSnapshotMs: finalMetrics.maxSnapshotMs,
  };
  assert.ok(result.server.simulationHz >= 55, 'Simulation keeps near60Hz during fault checks');
  result.clients = {
    pingMs: distribution(pingSamples),
    snapshotGapMs: distribution(peers.flatMap((p) => p.gaps)),
    maxBufferedBytes: Math.max(...peers.map((p) => p.maxBufferedBytes)),
    maxSyntheticHeldMessages: Math.max(...peers.map((p) => p.maxQueued)),
  };
  await phase('Every participant leaves; no private room or reservation remains', async () => {
    const leaving = participants[0],
      oldToken = leaving.resumeToken;
    send(leaving, { type: 'leave' });
    const left = await wait(leaving, 'left');
    assert.ok(left.resumeToken !== oldToken, 'Explicit leave rotates the credential');
    const probe = await connect(122);
    send(probe, { type: 'resume', token: oldToken, eventAck: leaving.eventAck, eventEpoch: code });
    assert.equal((await wait(probe, 'resume-failed')).reason, 'expired-or-invalid');
    await Promise.all(
      participants.slice(1).map(async (peer) => {
        send(peer, { type: 'leave' });
        await wait(peer, 'left');
      }),
    );
    assert.equal(room.players.size, 0);
    await until(() => !game.rooms.has(code), 'empty room removed');
    return {
      remainingPlayers: room.players.size,
      roomRemoved: true,
      explicitLeaveInvalidatesToken: true,
    };
  });
  result.sourcesStableDuringRun =
    JSON.stringify(result.sourceSha256) === JSON.stringify(await sourceHashes());
  assert.ok(result.sourcesStableDuringRun, 'Source changed during the fault-validation run');
  result.success = true;
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
} finally {
  closing = true;
  clearTimeout(deadline);
  clearInterval(inputTimer);
  clearInterval(pingTimer);
  for (const restore of restorers.reverse()) restore();
  for (const peer of peers) {
    for (const pending of peer.pending) clearTimeout(pending.timer);
    peer.ws.terminate();
  }
  if (game) await game.close();
  result.totalSeconds = +((performance.now() - started) / 1000).toFixed(3);
  if (reportPath) await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
