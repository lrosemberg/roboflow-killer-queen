import WebSocket from 'ws';
import { createGameServer } from '../server.js';
import assert from 'node:assert/strict';

const count = Math.min(120, Math.max(2, Number(process.env.PLAYERS) || 120));
const duration = Math.max(2000, Number(process.env.DURATION_MS) || 12000);
const game = createGameServer({ port: 0, host: '127.0.0.1' });
const { port } = await game.listen();
let code;
let snapshots = 0;
let bytes = 0;
let errors = 0;
const latencies = [];
const peers = [];
const start = performance.now();
async function connect(index) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const peer = { ws, seq: 0, states: 0, joined: false, id: '', status: '' };
    peers.push(peer);
    const timer = setTimeout(() => reject(new Error(`Client ${index} timed out`)), 5000);
    ws.on('error', reject);
    ws.on('message', (data) => {
      bytes += data.length;
      const msg = JSON.parse(data);
      if (msg.type === 'welcome') {
        peer.id = msg.id;
        ws.send(
          JSON.stringify(
            index === 0
              ? {
                  type: 'create',
                  mode: 'xxl',
                  bots: false,
                  roomName: '120-player load test',
                  name: `Tester ${index}`,
                }
              : { type: 'join', code, name: `Tester ${index}` },
          ),
        );
      }
      if (msg.type === 'joined') {
        code ||= msg.code;
        peer.joined = true;
        clearTimeout(timer);
        resolve(peer);
      }
      if (msg.type === 'state') {
        snapshots++;
        peer.states++;
        peer.status = msg.status;
      }
      if (msg.type === 'pong') latencies.push(performance.now() - msg.time);
      if (msg.type === 'error') {
        errors++;
        reject(new Error(msg.message));
      }
    });
  });
}
try {
  await connect(0);
  await Promise.all(Array.from({ length: count - 1 }, (_, i) => connect(i + 1)));
  assert.equal(game.rooms.get(code).players.size, count);
  if (count === 120) {
    const overflow = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const rejected = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('121st player was not rejected')), 3000);
      overflow.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'welcome')
          overflow.send(JSON.stringify({ type: 'join', code, name: 'Overflow' }));
        if (msg.type === 'error') {
          clearTimeout(timeout);
          resolve(msg.message);
        }
      });
    });
    assert.match(rejected, /full/);
    overflow.terminate();
  }
  peers[0].ws.send(JSON.stringify({ type: 'start' }));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(check);
      reject(new Error('Match failed to start'));
    }, 3000);
    const check = setInterval(() => {
      if (peers[0].status === 'playing') {
        clearTimeout(timeout);
        clearInterval(check);
        resolve();
      }
    }, 10);
  });
  const room = game.rooms.get(code);
  // Spread real socket clients across the XXL map to exercise interest management.
  [...room.players.values()].forEach((p, i) => {
    p.x = 400 + (i % 24) * 460;
    p.y = room.map.height - 116 - Math.floor(i / 24) * 180;
  });
  const inputTimer = setInterval(() => {
    const elapsed = performance.now() - start;
    for (let i = 0; i < peers.length; i++) {
      const p = peers[i];
      p.ws.send(
        JSON.stringify({
          type: 'input',
          seq: ++p.seq,
          right: (Math.floor(elapsed / 1700) + i) % 2 === 0,
          left: (Math.floor(elapsed / 1700) + i) % 2 === 1,
          jump: Math.floor(elapsed / 300 + i) % 3 === 0,
          action: true,
          dash: Math.floor(elapsed / 500 + i) % 5 === 0,
        }),
      );
    }
  }, 1000 / 30);
  const pingTimer = setInterval(() => {
    for (const p of peers) p.ws.send(JSON.stringify({ type: 'ping', time: performance.now() }));
  }, 1000);
  await new Promise((resolve) => setTimeout(resolve, duration));
  clearInterval(inputTimer);
  clearInterval(pingTimer);
  assert.equal(errors, 0);
  assert.ok(peers.every((p) => p.states > duration / 100));
  assert.ok(peers.every((p) => p.ws.readyState === WebSocket.OPEN));
  latencies.sort((a, b) => a - b);
  const wireBytes = peers.reduce((sum, peer) => sum + (peer.ws._socket?.bytesRead || 0), 0);
  console.log(
    JSON.stringify(
      {
        players: count,
        rejected121st: count === 120,
        durationSeconds: duration / 1000,
        snapshots,
        errors,
        meanSnapshotsPerPlayerPerSecond: +(snapshots / count / (duration / 1000)).toFixed(1),
        applicationPingMs: {
          p50: +latencies[Math.floor(latencies.length * 0.5)]?.toFixed(2),
          p95: +latencies[Math.floor(latencies.length * 0.95)]?.toFixed(2),
          max: +latencies.at(-1)?.toFixed(2),
        },
        decodedMegabytes: +(bytes / 1024 / 1024).toFixed(2),
        wireMegabytes: +(wireBytes / 1024 / 1024).toFixed(2),
        meanKbpsPerClient: +((wireBytes * 8) / count / (duration / 1000) / 1000).toFixed(1),
        server: game.metrics(),
        note: 'Localhost synthetic clients spread throughout XXL; server and clients share one Node event loop. This verifies capacity and simulation, not WAN latency or 120 physical laptops.',
      },
      null,
      2,
    ),
  );
} finally {
  for (const p of peers) p.ws.terminate();
  await game.close();
}
