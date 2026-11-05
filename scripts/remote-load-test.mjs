import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { decodeSnapshot } from '../shared/protocol.js';
import { NetworkInput } from '../public/network-input.js';

// Usage: node scripts/remote-load-test.mjs https://your-game [report.json]
// Run internet-smoke.mjs first. This test owns one new private room only.
// DURATION_MS explicitly permits 2–120 seconds (default 12s); total deadline also
// includes bounded join ramp, countdown, stop acknowledgements and cleanup.
if (!process.argv[2]) throw new Error('Provide the explicit http:// or https:// game URL to test.');
const base = new URL(process.argv[2]);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
  throw new Error('Use an HTTP(S) game URL without credentials.');
const target = new URL('/ws', base);
target.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
target.searchParams.set('protocol', 'compact-v1');
target.searchParams.set('resume', '1');
target.searchParams.set('events', '1');
const players = Math.min(120, Math.max(2, Math.floor(Number(process.env.PLAYERS) || 120)));
const durationMs = Math.min(120000, Math.max(2000, Number(process.env.DURATION_MS) || 12000));
const rampBatchSize = Math.min(
  120,
  Math.max(1, Math.floor(Number(process.env.RAMP_BATCH_SIZE) || 12)),
);
const rampPauseMs = Math.min(5000, Math.max(0, Number(process.env.RAMP_PAUSE_MS) || 0));
const deadlineMs = Math.max(
  60000,
  durationMs + 45000 + Math.ceil(players / rampBatchSize) * rampPauseMs,
);
assert.ok(
  deadlineMs <= 240000,
  'Requested ramp and duration exceed the four-minute test bound. Reduce RAMP_PAUSE_MS or raise RAMP_BATCH_SIZE.',
);
const peers = [];
const latencies = [];
const snapshotGaps = [];
const visiblePlayers = [];
const serverTimingSamples = [];
const timers = new Set();
let cleanup = false;
let measuring = false;
let deadlineExceeded = false;
let measuredStart = 0;
let decodedBytes = 0;
let inputTimer;
let healthTimer;
let code;
let stage = 'health';
const result = {
  testedAt: new Date().toISOString(),
  url: base.origin,
  success: false,
  requestedPlayers: players,
  requestedDurationSeconds: durationMs / 1000,
  overallDeadlineSeconds: deadlineMs / 1000,
  joinRamp: { batchSize: rampBatchSize, pauseMs: rampPauseMs },
  note: 'Bounded synthetic clients from one machine through the supplied public or local route. Clients start at normal spawn positions and move via inputs; no teleportation or server internals. This does not measure Brazil/USA player latency, browser rendering, long-running stability, or 120 physical laptops. Health maxima are cumulative since server startup.',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(7000) });
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return response.json();
}

function wait(peer, type, predicate = () => true, timeoutMs = 10000) {
  const latest = peer.latest.get(type);
  if (latest && predicate(latest)) return Promise.resolve(latest);
  if (peer.failure) return Promise.reject(new Error(peer.failure));
  return new Promise((resolve, reject) => {
    const pending = { type, predicate, resolve, reject };
    pending.timer = setTimeout(() => {
      peer.pending = peer.pending.filter((item) => item !== pending);
      reject(new Error(`Client ${peer.index}: timed out waiting for ${type}`));
    }, timeoutMs);
    peer.pending.push(pending);
  });
}

function fail(peer, message) {
  peer.failure ||= `Client ${peer.index}: ${message}`;
  for (const pending of peer.pending.splice(0)) {
    clearTimeout(pending.timer);
    pending.reject(new Error(peer.failure));
  }
}

async function connect(index, expectedRejection = false) {
  if (deadlineExceeded) throw new Error('Overall test deadline exceeded');
  const ws = new WebSocket(target, {
    origin: base.origin,
    handshakeTimeout: 10000,
    perMessageDeflate: true,
  });
  const peer = {
    index,
    ws,
    expectedRejection,
    latest: new Map(),
    pending: [],
    seq: 0,
    states: 0,
    maxAck: 0,
    maxMovement: 0,
    skippedInputs: 0,
    inputMessages: 0,
    eventAck: 0,
    eventEpoch: null,
    deliveredEvents: 0,
    replayedEvents: 0,
  };
  peers.push(peer);
  peer.send = (message) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  };
  peer.input = new NetworkInput({
    isOpen: () => ws.readyState === WebSocket.OPEN,
    bufferedAmount: () => ws.bufferedAmount,
    onStall: () => fail(peer, 'upload queue stayed congested for 250 ms'),
    send: (input) => {
      const sent = peer.send({
        type: 'input',
        ...input,
        seq: peer.seq + 1,
        eventEpoch: peer.eventEpoch,
        eventAck: peer.eventAck,
      });
      if (sent) {
        peer.seq++;
        peer.inputMessages++;
      }
      return sent;
    },
  });
  ws.on('error', (error) => fail(peer, error.message));
  ws.on('close', (status, reason) => {
    if (!cleanup && !peer.expectedClose)
      fail(peer, `unexpected close ${status}: ${reason.toString()}`);
  });
  ws.on('message', (bytes) => {
    let message;
    try {
      message = decodeSnapshot(JSON.parse(bytes));
    } catch {
      fail(peer, 'invalid JSON or compact snapshot from server');
      return;
    }
    if (measuring && !expectedRejection) decodedBytes += bytes.length;
    peer.latest.set(message.type, message);
    if (message.type === 'joined') {
      peer.eventEpoch = message.eventEpoch || message.code;
      peer.eventAck = message.eventAck || 0;
    }
    if (message.type === 'state' && message.eventEpoch === peer.eventEpoch) {
      peer.eventAck = Math.max(peer.eventAck, (message.eventFloor || 1) - 1);
      const priorAck = peer.eventAck;
      for (const event of message.events || []) {
        if (event.id <= peer.eventAck) peer.replayedEvents++;
        else {
          peer.eventAck = event.id;
          peer.deliveredEvents++;
        }
      }
      if (peer.eventAck > priorAck)
        peer.send({ type: 'event-ack', id: peer.eventAck, eventEpoch: peer.eventEpoch });
    }
    if (message.type === 'error' && !expectedRejection) fail(peer, message.message);
    if (message.type === 'state' && measuring && !expectedRejection) {
      const receivedAt = performance.now();
      if (peer.lastStateAt) snapshotGaps.push(receivedAt - peer.lastStateAt);
      peer.lastStateAt = receivedAt;
      visiblePlayers.push(message.players.length);
      peer.states++;
      peer.maxAck = Math.max(peer.maxAck, message.ack || 0);
      peer.lastTick = message.tick;
      const own = message.players.find((player) => player.id === peer.id);
      if (own) peer.maxMovement = Math.max(peer.maxMovement, Math.abs(own.x - peer.startX));
      if (message.playerCount !== players || message.botCount !== 0 || message.status !== 'playing')
        fail(peer, 'test match lost players, gained bots, or stopped');
    }
    if (message.type === 'pong' && measuring && Number.isFinite(message.time))
      latencies.push(performance.now() - message.time);
    for (const pending of [...peer.pending]) {
      if (pending.type === message.type && pending.predicate(message)) {
        peer.pending = peer.pending.filter((item) => item !== pending);
        clearTimeout(pending.timer);
        pending.resolve(message);
      }
    }
  });
  const welcome = await wait(peer, 'welcome');
  peer.id = welcome.id;
  return peer;
}

async function join(index) {
  const peer = await connect(index);
  peer.send(
    index === 0
      ? {
          type: 'create',
          mode: 'xxl',
          private: true,
          botCount: 0,
          role: 'worker',
          roomName: 'Private deployment capacity test',
          name: `Load ${index + 1}`,
        }
      : { type: 'join', code, role: 'worker', name: `Load ${index + 1}` },
  );
  const joined = await wait(peer, 'joined');
  peer.joined = true;
  code ||= joined.code;
  assert.equal(joined.code, code);
  assert.equal(joined.room.private, true);
  assert.equal(joined.room.botTarget, 0);
  assert.equal(joined.room.mode, 'xxl');
  assert.equal(joined.room.maxPlayers, 120);
  peer.team = joined.players.find((player) => player.id === peer.id).team;
  return peer;
}

const deadline = setTimeout(() => {
  deadlineExceeded = true;
  clearInterval(inputTimer);
  for (const peer of peers) {
    fail(peer, 'overall test deadline exceeded');
    peer.ws.terminate();
  }
}, deadlineMs);

try {
  result.healthBefore = await json('/api/health');
  assert.equal(result.healthBefore.ok, true);
  stage = 'creating-room';
  await join(0);
  stage = 'joining-players';
  // Ramp in groups rather than opening all 120 TLS handshakes at once.
  for (let first = 1; first < players; first += rampBatchSize) {
    await Promise.all(
      Array.from({ length: Math.min(rampBatchSize, players - first) }, (_, offset) =>
        join(first + offset),
      ),
    );
    if (rampPauseMs > 0 && first + rampBatchSize < players) await sleep(rampPauseMs);
  }
  const participants = peers.filter((peer) => !peer.expectedRejection);
  stage = 'waiting-for-full-lobby';
  const lobby = await wait(
    participants[0],
    'state',
    (state) =>
      state.status === 'waiting' &&
      state.playerCount === players &&
      state.lobbyPlayers?.length === players,
  );
  assert.ok(Array.isArray(lobby.queenQuota), 'Server must advertise the lobby Queen quotas');
  stage = 'selecting-queen-roles';
  for (const team of [0, 1]) {
    const crew = participants.filter((peer) => peer.team === team);
    assert.equal(
      lobby.queenQuota[team],
      Math.ceil(crew.length / 5),
      'Queen quota must scale with team size',
    );
    for (const peer of crew.slice(0, lobby.queenQuota[team]))
      peer.send({ type: 'role', role: 'queen' });
  }
  stage = 'waiting-for-selected-queen-roster';
  const selected = await wait(
    participants[0],
    'state',
    (state) =>
      state.status === 'waiting' &&
      state.lobbyPlayers?.length === players &&
      [0, 1].every(
        (team) =>
          state.lobbyPlayers.filter((player) => player.team === team && player.role === 'queen')
            .length === lobby.queenQuota[team],
      ),
  );
  for (const peer of participants)
    peer.role = selected.lobbyPlayers.find((player) => player.id === peer.id).role;
  result.lobby = {
    queenQuota: selected.queenQuota,
    selectedQueens: selected.lobbyPlayers.filter((player) => player.role === 'queen').length,
    workers: selected.lobbyPlayers.filter((player) => player.role === 'worker').length,
  };
  stage = 'checking-room-privacy-and-capacity';
  const listed = await json('/api/rooms');
  assert.ok(
    !listed.rooms.some((room) => room.code === code),
    'Private test room leaked into public listing',
  );
  if (players === 120) {
    const overflow = await connect(120, true);
    overflow.send({ type: 'join', code, name: 'Capacity overflow probe' });
    const rejection = await wait(overflow, 'error');
    assert.match(rejection.message, /full/i);
    overflow.expectedClose = true;
    overflow.ws.terminate();
    result.rejected121st = true;
  } else result.rejected121st = false;
  stage = 'starting-match';
  participants[0].send({ type: 'start' });
  await Promise.all(
    participants.map(async (peer) => {
      const state = await wait(
        peer,
        'state',
        (value) =>
          value.status === 'playing' &&
          value.playerCount === players &&
          value.botCount === 0 &&
          value.time >= (value.startsAt || 0),
      );
      assert.equal(
        state.encoding,
        'compact-v1',
        'Server must send the requested compact snapshot encoding',
      );
      peer.encoding = state.encoding;
      peer.startX = state.players.find((player) => player.id === peer.id).x;
      peer.startTick = state.tick;
      peer.lastTick = state.tick;
      peer.wireStart = peer.ws._socket?.bytesRead || 0;
    }),
  );
  result.transport = {
    websocket: target.protocol.slice(0, -1),
    encoding: participants[0].encoding,
    compressionNegotiated: participants.every((peer) =>
      peer.ws.extensions.includes('permessage-deflate'),
    ),
    extensions: [...new Set(participants.map((peer) => peer.ws.extensions))],
  };
  stage = 'measuring-match';
  measuring = true;
  measuredStart = performance.now();
  healthTimer = setInterval(async () => {
    try {
      const health = await json('/api/health');
      if (measuring)
        serverTimingSamples.push({
          lastTickMs: health.lastTickMs,
          lastSnapshotMs: health.lastSnapshotMs,
        });
    } catch {
      /* Endpoint validation still runs before/after load. */
    }
  }, 2000);
  inputTimer = setInterval(() => {
    const elapsed = performance.now() - measuredStart;
    for (const peer of participants) {
      if (peer.ws.bufferedAmount > 4096) peer.skippedInputs++;
      // Same bounded input sender as the browser: transitions plus a 250 ms
      // active keepalive. The 30 Hz sampling loop does not imply 30 Hz uploads.
      // Workers tap-jump; Queens stay grounded to keep the load match running.
      peer.input.update({
        right: peer.team === 0,
        left: peer.team === 1,
        jump: peer.role === 'worker' && Math.floor(elapsed / 350 + peer.index) % 4 === 0,
        down: false,
        action: false,
      });
    }
  }, 1000 / 30);
  for (const peer of participants) {
    const starter = setTimeout(
      () => {
        peer.send({ type: 'ping', time: performance.now() });
        const timer = setInterval(() => peer.send({ type: 'ping', time: performance.now() }), 1000);
        timers.add(timer);
      },
      (peer.index * 1000) / players,
    );
    timers.add(starter);
  }
  await sleep(durationMs);
  measuring = false;
  clearInterval(inputTimer);
  clearInterval(healthTimer);
  for (const timer of timers) clearTimeout(timer);
  const seconds = (performance.now() - measuredStart) / 1000;
  const wireBytes = participants.reduce(
    (sum, peer) => sum + Math.max(0, (peer.ws._socket?.bytesRead || 0) - peer.wireStart),
    0,
  );
  latencies.sort((a, b) => a - b);
  const percentile = (fraction) =>
    latencies.length
      ? +latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))].toFixed(
          2,
        )
      : null;
  const distribution = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) =>
      sorted.length
        ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2)
        : null;
    return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
  };
  result.serverTimingSamples = {
    count: serverTimingSamples.length,
    tickMs: distribution(serverTimingSamples.map((sample) => sample.lastTickMs)),
    snapshotMs: distribution(serverTimingSamples.map((sample) => sample.lastSnapshotMs)),
    note: 'HTTP samples of last timings every 2s, not every server callback. For exact loop percentiles use the isolated local load harness. Railway CPU/RSS must be obtained separately from service metrics.',
  };
  result.measurement = {
    players: participants.length,
    durationSeconds: +seconds.toFixed(3),
    snapshots: participants.reduce((sum, peer) => sum + peer.states, 0),
    meanSnapshotsPerPlayerPerSecond: +(
      participants.reduce((sum, peer) => sum + peer.states, 0) /
      players /
      seconds
    ).toFixed(2),
    minimumSnapshotsPerPlayerPerSecond: +(
      Math.min(...participants.map((peer) => peer.states)) / seconds
    ).toFixed(2),
    minimumObservedTickRate: +(
      Math.min(...participants.map((peer) => peer.lastTick - peer.startTick)) / seconds
    ).toFixed(2),
    playersWithMovement: participants.filter((peer) => peer.maxMovement > 25).length,
    playersWithAcknowledgedInputs: participants.filter((peer) => peer.maxAck > 0).length,
    congestedInputSamples: participants.reduce((sum, peer) => sum + peer.skippedInputs, 0),
    inputMessages: participants.reduce((sum, peer) => sum + peer.inputMessages, 0),
    meanInputMessagesPerPlayerPerSecond: +(
      participants.reduce((sum, peer) => sum + peer.inputMessages, 0) /
      players /
      seconds
    ).toFixed(2),
    deliveredEvents: participants.reduce((sum, peer) => sum + peer.deliveredEvents, 0),
    deduplicatedReplayEvents: participants.reduce((sum, peer) => sum + peer.replayedEvents, 0),
    decodedMegabytes: +(decodedBytes / 1024 / 1024).toFixed(2),
    socketReceivedMegabytes: +(wireBytes / 1024 / 1024).toFixed(2),
    meanSocketKbpsPerClient: +((wireBytes * 8) / players / seconds / 1000).toFixed(2),
    snapshotGapMs: distribution(snapshotGaps),
    visiblePlayersPerSnapshot: distribution(visiblePlayers),
    applicationPingMs: {
      samples: latencies.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: latencies.length ? +latencies.at(-1).toFixed(2) : null,
    },
  };
  assert.ok(!deadlineExceeded, 'Overall test deadline exceeded');
  assert.ok(
    participants.every((peer) => !peer.failure),
    participants.find((peer) => peer.failure)?.failure,
  );
  assert.ok(
    participants.every((peer) => peer.ws.readyState === WebSocket.OPEN),
    'A participant disconnected',
  );
  assert.ok(
    participants.every((peer) => peer.states / seconds >= 10),
    'A participant received fewer than 10 snapshots/second',
  );
  assert.ok(
    participants.every((peer) => peer.maxAck > 0),
    'A participant had no acknowledged input',
  );
  assert.ok(
    participants.every((peer) => peer.maxMovement > 25),
    'A participant did not move at least 25 pixels',
  );
  assert.ok(latencies.length >= players, 'Missing expected application ping replies');
  // Stop movement and observe the final input acknowledgement before leaving.
  stage = 'stopping-inputs';
  await Promise.all(
    participants.map(async (peer) => {
      peer.input.update({}, { reset: true, active: false });
      await wait(peer, 'state', (state) => state.ack >= peer.seq);
    }),
  );
  result.healthAfterLoad = await json('/api/health');
  assert.equal(result.healthAfterLoad.ok, true);
  stage = 'leaving-test-room';
  await Promise.all(
    participants.map(async (peer) => {
      peer.send({ type: 'leave' });
      await wait(peer, 'left', () => true, 5000);
    }),
  );
  result.success = true;
  result.checks = [
    'Healthy HTTP endpoint',
    'New private XXL room with zero bots',
    `${players} WebSocket players joined`,
    'Compact-v1 snapshot encoding verified for every client',
    'Proportional Queen slots selected in the lobby before match start',
    ...(players === 120 ? ['121st player rejected as full'] : []),
    'Room absent from public listing',
    'All players received running match snapshots',
    'All players moved via acknowledged inputs',
    'All players received at least 10 snapshots per second',
    'Application ping replies collected',
    'Connections remained open',
    'Final stop inputs acknowledged',
    'All test players left cleanly',
  ];
} catch (error) {
  result.error = error.message;
  result.failedStage = stage;
  const latest = peers[0]?.latest.get('state');
  result.latestHostState = latest
    ? {
        status: latest.status,
        tick: latest.tick,
        ack: latest.ack,
        playerCount: latest.playerCount,
        botCount: latest.botCount,
        rosterLength: latest.lobbyPlayers?.length ?? null,
        queenQuota: latest.queenQuota,
        queensSelected: [0, 1].map(
          (team) =>
            latest.lobbyPlayers?.filter((player) => player.team === team && player.role === 'queen')
              .length ?? null,
        ),
      }
    : null;
  result.connectionProgress = {
    created: peers.length,
    handshaken: peers.filter((peer) => peer.id).length,
    joined: peers.filter((peer) => peer.joined).length,
  };
  process.exitCode = 1;
} finally {
  cleanup = true;
  measuring = false;
  clearTimeout(deadline);
  clearInterval(inputTimer);
  clearInterval(healthTimer);
  for (const timer of timers) clearTimeout(timer);
  for (const peer of peers) {
    // Explicit leave avoids retaining resume-enabled test seats during grace.
    // A failure before this can reserve a seat for at most the bounded grace.
    if (peer.ws.readyState === WebSocket.OPEN && peer.joined) peer.send({ type: 'leave' });
    for (const pending of peer.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Test cleanup'));
    }
    peer.ws.terminate();
  }
  result.clientFailures = peers
    .filter((peer) => !peer.expectedRejection && peer.failure)
    .map((peer) => peer.failure);
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (process.argv[3]) await writeFile(process.argv[3], serialized);
  process.stdout.write(serialized);
}
