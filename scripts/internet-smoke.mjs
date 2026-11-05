import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { decodeSnapshot } from '../shared/protocol.js';

const base = new URL(process.argv[2] || 'http://localhost:8787');
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Pass an http:// or https:// game URL.');
const websocketUrl = new URL('/ws', base);
websocketUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
websocketUrl.searchParams.set('protocol', 'compact-v1');
const outputPath = process.argv[3] || fileURLToPath(new URL('./internet-test-result.json', import.meta.url));
const peers = [];
const result = {
  testedAt: new Date().toISOString(),
  url: base.origin,
  success: false,
  transport: { http: base.protocol.slice(0, -1), websocket: websocketUrl.protocol.slice(0, -1) },
  note: `Two synthetic clients on this host used the ${base.protocol === 'https:' ? 'public HTTPS/WSS' : 'HTTP/WS'} route. This is not a test from a different physical network or a guarantee of WAN latency.`,
};

function waitMessage(peer, type, predicate = () => true) {
  const queued = peer.queue.findIndex(message => message.type === type && predicate(message));
  if (queued >= 0) return Promise.resolve(peer.queue.splice(queued, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { type, predicate, resolve, reject };
    waiter.timer = setTimeout(() => {
      const index = peer.pending.indexOf(waiter); if (index >= 0) peer.pending.splice(index, 1);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 10000);
    peer.pending.push(waiter);
  });
}

async function connect() {
  const ws = new WebSocket(websocketUrl, { origin: base.origin, perMessageDeflate: true, handshakeTimeout: 10000 });
  const peer = { ws, pending: [], queue: [], messages: 0, encoding: null };
  peers.push(peer);
  ws.on('message', bytes => {
    const message = decodeSnapshot(JSON.parse(bytes)); peer.messages++;
    if (message.type === 'state') peer.encoding = message.encoding;
    const index = peer.pending.findIndex(waiter => waiter.type === message.type && waiter.predicate(message));
    if (index >= 0) { const [waiter] = peer.pending.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    else if (message.type !== 'state') { peer.queue.push(message); if (peer.queue.length > 50) peer.queue.shift(); }
  });
  ws.on('error', error => {
    for (const waiter of peer.pending.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); }
  });
  ws.on('close', () => {
    for (const waiter of peer.pending.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error('WebSocket closed unexpectedly')); }
  });
  peer.send = message => ws.send(JSON.stringify(message));
  peer.wait = (type, predicate) => waitMessage(peer, type, predicate);
  const welcome = await peer.wait('welcome'); peer.id = welcome.id;
  return peer;
}

try {
  const started = performance.now();
  const healthResponse = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(10000) });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json(); assert.equal(health.ok, true);
  result.health = { status: healthResponse.status, roundTripMs: +(performance.now() - started).toFixed(2), version: health.version, tickRate: health.tickRate, snapshotRate: health.snapshotRate };
  const [host, guest] = await Promise.all([connect(), connect()]);
  result.transport.extensions = peers.map(peer => peer.ws.extensions);
  result.transport.compressionNegotiated = peers.every(peer => peer.ws.extensions.includes('permessage-deflate'));
  if (!result.transport.compressionNegotiated) result.warning = 'This route did not negotiate permessage-deflate. Gameplay uses uncompressed WebSocket messages; bandwidth will be higher than the compressed localhost capacity test.';
  host.send({ type: 'create', name: 'Network Host', roomName: 'Private network smoke test', mode: 'normal', private: true, botCount: 0, role: 'worker' });
  const joinedHost = await host.wait('joined');
  assert.equal(joinedHost.room.private, true); assert.equal(joinedHost.room.botTarget, 0);
  assert.equal(joinedHost.map.width, 1440); assert.equal(joinedHost.map.height, 820);
  assert.equal(joinedHost.map.scoreTarget, 2); assert.equal(joinedHost.map.berrySpawns.length, 6);
  result.classicMap = { width: joinedHost.map.width, height: joinedHost.map.height, scoreTarget: joinedHost.map.scoreTarget };
  guest.send({ type: 'join', code: joinedHost.code, name: 'Network Guest', role: 'worker' });
  const joinedGuest = await guest.wait('joined'); assert.equal(joinedGuest.code, joinedHost.code);
  assert.equal(joinedGuest.players.filter(player => !player.bot).length, 2);
  assert.equal(joinedGuest.map.scoreTarget, 3); assert.equal(joinedGuest.map.berrySpawns.length, 12);
  host.send({ type: 'role', role: 'queen' }); guest.send({ type: 'role', role: 'queen' });
  const selected = await host.wait('state', state => state.status === 'waiting' && state.lobbyPlayers?.filter(player => player.role === 'queen').length === 2);
  assert.deepEqual(selected.queenQuota, [1, 1]);
  assert.equal(selected.scoreTarget, 3); assert.equal(selected.resourceCount, 12); assert.equal(selected.economyPlayerCount, 2);
  result.classicMap.lobbyTargetAfterJoin = selected.scoreTarget;
  const listedRooms = await fetch(new URL('/api/rooms', base), { signal: AbortSignal.timeout(10000) }).then(response => response.json());
  assert.ok(!listedRooms.rooms.some(room => room.code === joinedHost.code), 'Private test room leaked into public listing');
  host.send({ type: 'start' });
  const playing = await host.wait('state', state => state.status === 'playing' && state.playerCount === 2 && state.time >= (state.startsAt || 0));
  assert.equal(playing.scoreTarget, 3); assert.equal(playing.resourceCount, 12);
  await guest.wait('state', state => state.status === 'playing' && state.time >= (state.startsAt || 0));
  for (const peer of peers) assert.equal(peer.encoding, 'compact-v1', 'Server must send the requested compact snapshot encoding');
  result.transport.encoding = playing.encoding;
  const hostX = playing.players.find(player => player.id === host.id).x;
  const guestX = playing.players.find(player => player.id === guest.id).x;
  host.send({ type: 'input', seq: 1, right: true }); guest.send({ type: 'input', seq: 1, left: true });
  const moved = await host.wait('state', state => state.ack === 1 && state.players.find(player => player.id === host.id)?.x > hostX + 25 && state.players.find(player => player.id === guest.id)?.x < guestX - 25);
  host.send({ type: 'input', seq: 2 }); guest.send({ type: 'input', seq: 2 });
  const latencies = [];
  for (let index = 0; index < 8; index++) {
    const peer = peers[index % peers.length]; const time = performance.now();
    peer.send({ type: 'ping', time }); await peer.wait('pong', message => message.time === time);
    latencies.push(performance.now() - time);
  }
  latencies.sort((a, b) => a - b);
  result.room = { private: true, botCount: moved.botCount, humanPlayers: moved.playerCount, status: moved.status, hostMovementPixels: +(moved.players.find(player => player.id === host.id).x - hostX).toFixed(1), guestMovementPixels: +(guestX - moved.players.find(player => player.id === guest.id).x).toFixed(1) };
  result.applicationPingMs = { samples: latencies.length, min: +latencies[0].toFixed(2), p50: +latencies[Math.floor(latencies.length * .5)].toFixed(2), p95: +latencies[Math.floor(latencies.length * .95)].toFixed(2), max: +latencies.at(-1).toFixed(2) };
  guest.send({ type: 'leave' }); await guest.wait('left');
  const afterDeparture = await host.wait('state', state => state.playerCount === 1);
  assert.equal(afterDeparture.scoreTarget, 3, 'A departure must not lower the locked round target');
  assert.equal(afterDeparture.resourceCount, 12); assert.equal(afterDeparture.economyPlayerCount, 2);
  host.send({ type: 'leave' }); await host.wait('left');
  host.send({ type: 'create', name: 'Network Host', roomName: 'Private XXL configuration check', mode: 'xxl', private: true, botCount: 0, role: 'worker' });
  const xxl = await host.wait('joined');
  assert.equal(xxl.map.scoreTarget, 2); assert.equal(xxl.map.berrySpawns.length, 6);
  result.xxlMap = { width: xxl.map.width, height: xxl.map.height, scoreTarget: xxl.map.scoreTarget, resourceCount: xxl.map.berrySpawns.length };
  host.send({ type: 'bots', count: 119 });
  const fullXxl = await host.wait('state', state => state.status === 'waiting' && state.botCount === 119);
  assert.equal(fullXxl.scoreTarget, 144); assert.equal(fullXxl.resourceCount, 720); assert.equal(fullXxl.economyPlayerCount, 120);
  assert.equal(fullXxl.piles.reduce((total, pile) => total + pile.remaining, 0), 720);
  host.send({ type: 'bots', count: 19 });
  const smallerXxl = await host.wait('state', state => state.status === 'waiting' && state.botCount === 19);
  assert.equal(smallerXxl.scoreTarget, 24); assert.equal(smallerXxl.resourceCount, 120); assert.equal(smallerXxl.economyPlayerCount, 20);
  result.xxlMap.proportionalLobbyChecks = [{ players: 120, scoreTarget: fullXxl.scoreTarget, resourceCount: fullXxl.resourceCount }, { players: 20, scoreTarget: smallerXxl.scoreTarget, resourceCount: smallerXxl.resourceCount }];
  host.send({ type: 'leave' }); await host.wait('left');
  result.success = true;
  result.checks = [`${base.protocol === 'https:' ? 'HTTPS' : 'HTTP'} health response`, `Two ${websocketUrl.protocol === 'wss:' ? 'WSS' : 'WS'} handshakes`, 'Compression extension inspected', 'Compact-v1 snapshot encoding verified for both clients', 'Private zero-bot room creation', 'Compact Classic map configuration verified', 'Second player joins by code and updates economic target', 'Lobby Queen roles selected and quotas verified', 'Private room absent from public listing', 'Host starts authoritative match', 'Both players move over the route', 'Application ping echoes', 'Active-round economy stays locked when a player leaves', 'XXL waiting lobby scales from 1 to 120 to 20 participants', 'Full XXL target 144 and stock 720 verified without starting bot simulation', 'Both test players leave cleanly'];
} catch (error) {
  result.error = error.message; process.exitCode = 1;
} finally {
  for (const peer of peers) peer.ws.terminate();
  const serialized = JSON.stringify(result, null, 2) + '\n';
  await writeFile(outputPath, serialized); process.stdout.write(serialized);
}
