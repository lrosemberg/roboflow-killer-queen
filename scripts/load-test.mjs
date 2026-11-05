import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import WebSocket from 'ws';
import { COMPACT_PROTOCOL, decodeSnapshot } from '../shared/protocol.js';

// Local, isolated capacity fixture. SCENARIO=distributed|dense|bots, PLAYERS=120,
// DURATION_MS=20000 (up to 120000), optional report path as the first argument.
// Server and clients run in separate processes; no production URL is accepted.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) =>
    sorted.length
      ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(3)
      : null;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
};

if (process.argv[2] === '--server-child') {
  const { createGameServer } = await import('../server.js');
  const { PLAYER_H, PLAYER_W } = await import('../shared/world.js');
  let game,
    childClosing = false,
    measuring = false,
    started = 0,
    cpuStart,
    initialMetrics;
  let ticks = [],
    activeTicks = [],
    snapshots = [],
    rss = [],
    alive = [];
  const nativeInterval = globalThis.setInterval;
  // Wrap only the server's existing timer callbacks. This records every callback
  // without changing server.js or periodically sampling the same last timing.
  globalThis.setInterval = (callback, interval, ...args) =>
    nativeInterval(() => {
      const beforeTicks = game?.metrics().totalTicks || 0;
      const start = performance.now();
      try {
        callback(...args);
      } finally {
        if (measuring && interval === 8) {
          const ms = performance.now() - start;
          ticks.push(ms);
          const advanced = game.metrics().totalTicks - beforeTicks;
          if (advanced) activeTicks.push(ms / advanced);
        }
        if (measuring && interval === 50) snapshots.push(performance.now() - start);
      }
    }, interval);
  game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 500 });
  globalThis.setInterval = nativeInterval;
  const { port } = await game.listen();
  const memoryTimer = setInterval(() => {
    if (!measuring) return;
    rss.push(process.memoryUsage().rss / 1024 / 1024);
    for (const room of game.rooms.values())
      alive.push([...room.players.values()].filter((p) => p.alive).length);
  }, 200);
  process.on('message', async (message) => {
    try {
      if (message.type === 'measure') {
        const room = game.rooms.get(message.code);
        assert.equal(room.status, 'playing');
        assert.ok(Date.now() >= room.startsAt);
        const players = [...room.players.values()];
        if (message.scenario !== 'bots') {
          const floor = room.map.platforms.find((p) => p.kind === 'ground').y;
          for (const [i, player] of players.entries()) {
            player.x =
              message.scenario === 'dense'
                ? room.map.width / 2 - 120 + (i % 20) * 12
                : 80 + (i * (room.map.width - 160 - PLAYER_W)) / Math.max(1, players.length - 1);
            player.y = floor - PLAYER_H;
            player.vx = player.vy = 0;
            player.grounded = true;
            assert.ok(player.x >= 0 && player.x + PLAYER_W <= room.map.width);
          }
        }
        ticks = [];
        activeTicks = [];
        snapshots = [];
        rss = [];
        alive = [];
        initialMetrics = game.metrics();
        cpuStart = process.cpuUsage();
        started = performance.now();
        measuring = true;
        process.send({
          type: 'measuring',
          dimensions: { width: room.map.width, height: room.map.height },
          players: players.map((p) => ({ id: p.id, x: p.x, role: p.role })),
          initialMetrics,
        });
      } else if (message.type === 'finish') {
        measuring = false;
        const elapsed = (performance.now() - started) / 1000;
        const cpu = process.cpuUsage(cpuStart),
          metrics = game.metrics();
        process.send({
          type: 'metrics',
          elapsedSeconds: elapsed,
          simulationHz: (metrics.totalTicks - initialMetrics.totalTicks) / elapsed,
          skippedSnapshots: metrics.skippedSnapshots - initialMetrics.skippedSnapshots,
          tickLoopMs: summarize(ticks),
          amortizedActiveTickMs: summarize(activeTicks),
          snapshotLoopMs: summarize(snapshots),
          rssMiB: summarize(rss),
          alivePlayers: summarize(alive),
          cpu: {
            userMs: cpu.user / 1000,
            systemMs: cpu.system / 1000,
            averageCores: (cpu.user + cpu.system) / 1e6 / elapsed,
          },
          note: 'Tick-loop timings include callbacks with zero fixed steps; active timing divides a callback by fixed steps performed. Snapshot-loop time includes serialization and queueing, not asynchronous compression. CPU/RSS belong only to the server process.',
        });
      } else if (message.type === 'close') {
        childClosing = true;
        clearInterval(memoryTimer);
        await game.close();
        process.disconnect();
      }
    } catch (error) {
      process.send({ type: 'error', message: error.stack });
    }
  });
  process.on('disconnect', () => {
    clearInterval(memoryTimer);
    if (!childClosing) void game.close();
  });
  process.send({ type: 'ready', port });
} else {
  const scenario = process.env.SCENARIO || 'distributed';
  assert.ok(['distributed', 'dense', 'bots'].includes(scenario));
  const count = Math.min(120, Math.max(2, Math.floor(Number(process.env.PLAYERS) || 120)));
  const duration = Math.min(120000, Math.max(2000, Number(process.env.DURATION_MS) || 20000));
  const clientCount = scenario === 'bots' ? 1 : count;
  const child = fork(fileURLToPath(import.meta.url), ['--server-child'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const childMessages = new Map(),
    childPending = [];
  child.on('message', (message) => {
    childMessages.set(message.type, message);
    for (const pending of [...childPending])
      if (message.type === pending.type || message.type === 'error') {
        childPending.splice(childPending.indexOf(pending), 1);
        clearTimeout(pending.timer);
        if (message.type === 'error') pending.reject(new Error(message.message));
        else pending.resolve(message);
      }
  });
  const childWait = (type) =>
    childMessages.has(type)
      ? Promise.resolve(childMessages.get(type))
      : new Promise((resolve, reject) => {
          const pending = { type, resolve, reject };
          pending.timer = setTimeout(
            () => reject(new Error(`Server child timed out: ${type}`)),
            15000,
          );
          childPending.push(pending);
        });
  const peers = [],
    ping = [],
    gaps = [],
    visible = [];
  let measuring = false,
    closing = false,
    code,
    inputTimer,
    pingTimer,
    decodedBytes = 0;
  const result = {
    testedAt: new Date().toISOString(),
    scenario,
    requestedPlayers: count,
    humanConnections: clientCount,
    bots: count - clientCount,
    requestedDurationSeconds: duration / 1000,
    success: false,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
    },
    note: 'Synthetic localhost capacity fixture; separate server/client processes. Human fixtures position players once after countdown using current map bounds, then ordinary inputs. Dense keeps a ground crowd without jumping; distributed exercises interest culling and worker jumps. Bots use natural spawns/AI. This is not WAN latency or browser-rendering proof.',
  };
  const deadline = setTimeout(() => {
    for (const peer of peers) peer.ws.terminate();
    child.kill('SIGTERM');
  }, duration + 60000);
  function wait(peer, type, predicate = () => true, timeout = 12000) {
    const current = peer.latest.get(type);
    if (current && predicate(current)) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const pending = { type, predicate, resolve, reject };
      pending.timer = setTimeout(() => {
        peer.pending.splice(peer.pending.indexOf(pending), 1);
        reject(new Error(`Client ${peer.index} timed out: ${type}`));
      }, timeout);
      peer.pending.push(pending);
    });
  }
  try {
    const sources = await Promise.all(
      [
        'server.js',
        'shared/world.js',
        'shared/combat.js',
        'shared/bot-flight.js',
        'shared/bot-strategy.js',
        'shared/protocol.js',
      ].map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(new URL(`../${path}`, import.meta.url)))
          .digest('hex'),
      ]),
    );
    result.sourceSha256 = Object.fromEntries(sources);
    const { port } = await childWait('ready');
    async function connect(index, overflow = false) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=${COMPACT_PROTOCOL}`, {
        perMessageDeflate: true,
      });
      const peer = {
        ws,
        index,
        overflow,
        latest: new Map(),
        pending: [],
        seq: 0,
        states: 0,
        failures: [],
        acks: 0,
      };
      peers.push(peer);
      peer.send = (message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };
      ws.on('error', (error) => peer.failures.push(error.message));
      ws.on('close', () => {
        if (!closing && !peer.expectedClose) peer.failures.push('Unexpected disconnect');
      });
      ws.on('message', (bytes) => {
        const message = decodeSnapshot(JSON.parse(bytes));
        peer.latest.set(message.type, message);
        if (message.type === 'error' && !overflow) peer.failures.push(message.message);
        if (message.type === 'state') {
          const own = message.players.find((p) => p.id === peer.id);
          if (own) peer.own = own;
          if (measuring && !overflow) {
            const now = performance.now();
            if (peer.lastStateAt) gaps.push(now - peer.lastStateAt);
            peer.lastStateAt = now;
            decodedBytes += bytes.length;
            peer.states++;
            peer.acks = Math.max(peer.acks, message.ack || 0);
            visible.push(message.players.length);
          }
        }
        if (measuring && message.type === 'pong') ping.push(performance.now() - message.time);
        for (const pending of [...peer.pending])
          if (pending.type === message.type && pending.predicate(message)) {
            peer.pending.splice(peer.pending.indexOf(pending), 1);
            clearTimeout(pending.timer);
            pending.resolve(message);
          }
      });
      peer.id = (await wait(peer, 'welcome')).id;
      peer.send(
        index === 0
          ? {
              type: 'create',
              private: true,
              mode: 'xxl',
              botCount: count - clientCount,
              botDifficulty: 'normal',
              role: scenario === 'bots' ? 'queen' : 'worker',
              name: 'Load 1',
              roomName: 'Local capacity fixture',
            }
          : { type: 'join', code, role: 'worker', name: `Load ${index + 1}` },
      );
      if (overflow) {
        const rejection = await wait(peer, 'error');
        assert.match(rejection.message, /full/i);
        peer.expectedClose = true;
        ws.terminate();
        return peer;
      }
      const joined = await wait(peer, 'joined');
      code ||= joined.code;
      peer.team = joined.players.find((p) => p.id === peer.id).team;
      return peer;
    }
    await connect(0);
    for (let first = 1; first < clientCount; first += 12)
      await Promise.all(
        Array.from({ length: Math.min(12, clientCount - first) }, (_, offset) =>
          connect(first + offset),
        ),
      );
    const participants = peers.filter((p) => !p.overflow);
    let lobby = await wait(
      peers[0],
      'state',
      (s) =>
        s.status === 'waiting' &&
        s.playerCount === clientCount &&
        s.botCount === count - clientCount,
    );
    if (scenario !== 'bots')
      for (const team of [0, 1])
        for (const peer of participants
          .filter((p) => p.team === team)
          .slice(0, lobby.queenQuota[team]))
          peer.send({ type: 'role', role: 'queen' });
    lobby = await wait(
      peers[0],
      'state',
      (s) =>
        s.status === 'waiting' &&
        s.lobbyPlayers?.length === count &&
        [0, 1].every(
          (team) =>
            s.lobbyPlayers.filter((p) => p.team === team && p.role === 'queen').length ===
            s.queenQuota[team],
        ),
    );
    result.lobby = {
      queenQuota: lobby.queenQuota,
      selectedQueens: lobby.lobbyPlayers.filter((p) => p.role === 'queen').length,
    };
    if (count === 120 && clientCount === 120) {
      await connect(clientCount, true);
      result.rejected121st = true;
    }
    peers[0].send({ type: 'start' });
    await Promise.all(
      participants.map((peer) =>
        wait(peer, 'state', (s) => s.status === 'playing' && s.time >= s.startsAt),
      ),
    );
    await sleep(1000);
    child.send({ type: 'measure', code, scenario });
    const initial = await childWait('measuring');
    result.map = initial.dimensions;
    for (const peer of participants) {
      assert.equal(peer.latest.get('state').encoding, COMPACT_PROTOCOL);
      peer.anchor = initial.players.find((p) => p.id === peer.id).x;
      peer.wireStart = peer.ws._socket.bytesRead;
      peer.lastStateAt = 0;
    }
    result.transport = {
      encoding: COMPACT_PROTOCOL,
      compression: participants.every((p) => p.ws.extensions.includes('permessage-deflate')),
    };
    measuring = true;
    const started = performance.now();
    inputTimer = setInterval(() => {
      const elapsed = performance.now() - started;
      for (const peer of participants) {
        const own = peer.own;
        const target = peer.anchor + Math.sin(elapsed / 1400 + peer.index) * 60;
        peer.send({
          type: 'input',
          seq: ++peer.seq,
          right: (own?.x || 0) < target - 5,
          left: (own?.x || 0) > target + 5,
          jump:
            scenario === 'distributed' &&
            own?.role === 'worker' &&
            Math.floor(elapsed / 350 + peer.index) % 4 === 0,
          action: false,
          down: false,
        });
      }
    }, 1000 / 30);
    pingTimer = setInterval(() => {
      for (const peer of participants) peer.send({ type: 'ping', time: performance.now() });
    }, 1000);
    while (
      performance.now() - started < duration &&
      peers[0].latest.get('state')?.status === 'playing'
    )
      await sleep(100);
    measuring = false;
    clearInterval(inputTimer);
    clearInterval(pingTimer);
    const seconds = (performance.now() - started) / 1000;
    child.send({ type: 'finish' });
    result.server = await childWait('metrics');
    const wire = participants.reduce((sum, p) => sum + p.ws._socket.bytesRead - p.wireStart, 0);
    result.measurement = {
      durationSeconds: +seconds.toFixed(3),
      ended: peers[0].latest.get('state').status === 'ended',
      snapshotsPerClientPerSecond: +(
        participants.reduce((n, p) => n + p.states, 0) /
        clientCount /
        seconds
      ).toFixed(2),
      minimumSnapshotsPerClientPerSecond: +(
        Math.min(...participants.map((p) => p.states)) / seconds
      ).toFixed(2),
      applicationPingMs: summarize(ping),
      snapshotGapMs: summarize(gaps),
      visiblePlayersPerSnapshot: summarize(visible),
      decodedMiB: decodedBytes / 1024 / 1024,
      wireMiB: wire / 1024 / 1024,
      meanWireKbpsPerClient: (wire * 8) / clientCount / seconds / 1000,
    };
    assert.ok(
      participants.every((p) => p.failures.length === 0),
      participants.flatMap((p) => p.failures).join('; '),
    );
    assert.ok(
      participants.every((p) => p.states / seconds >= 10),
      'Fewer than 10 snapshots/s',
    );
    assert.ok(
      participants.every((p) => p.acks > 0),
      'Inputs were not acknowledged',
    );
    assert.ok(result.server.simulationHz >= 55, 'Simulation below 55Hz');
    assert.ok(result.server.tickLoopMs.samples >= seconds * 20, 'Missing tick-loop timing samples');
    assert.ok(
      result.server.snapshotLoopMs.samples >= seconds * 10,
      'Missing snapshot-loop timing samples',
    );
    assert.ok(ping.length >= clientCount, 'Missing ping samples');
    if (!result.measurement.ended) {
      await Promise.all(
        participants.map(async (peer) => {
          peer.send({ type: 'input', seq: ++peer.seq });
          await wait(peer, 'state', (s) => s.ack >= peer.seq);
        }),
      );
    }
    await Promise.all(
      participants.map(async (peer) => {
        peer.send({ type: 'leave' });
        await wait(peer, 'left');
      }),
    );
    result.success = true;
  } catch (error) {
    result.error = error.stack;
    process.exitCode = 1;
  } finally {
    closing = true;
    measuring = false;
    clearTimeout(deadline);
    clearInterval(inputTimer);
    clearInterval(pingTimer);
    for (const peer of peers) {
      for (const pending of peer.pending) clearTimeout(pending.timer);
      peer.ws.terminate();
    }
    if (child.connected) child.send({ type: 'close' });
    const exited = await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve(true))),
      sleep(3000).then(() => false),
    ]);
    if (!exited) child.kill('SIGTERM');
    if (result.sourceSha256) {
      const after = await Promise.all(
        Object.keys(result.sourceSha256).map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(new URL(`../${path}`, import.meta.url)))
            .digest('hex'),
        ]),
      );
      result.sourcesStableDuringRun = after.every(
        ([path, hash]) => result.sourceSha256[path] === hash,
      );
    }
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (process.argv[2]) await writeFile(process.argv[2], serialized);
    process.stdout.write(serialized);
  }
}
