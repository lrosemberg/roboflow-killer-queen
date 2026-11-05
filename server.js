import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import packageInfo from './package.json' with { type: 'json' };
import {
  createMap,
  configureMapEconomy,
  movePlayer,
  PLAYER_W,
  PLAYER_H,
  BOT_DIFFICULTIES,
} from './shared/world.js';
import { COMPACT_PROTOCOL, encodePlayer } from './shared/protocol.js';
import { createNavigator } from './shared/navigation.js';
import { queuePlayerInput, consumePlayerInput, resetPlayerInput } from './shared/input-buffer.js';
import { getLobbyReadiness } from './shared/lobby.js';
import { createBotStrategy, queenRetreatTarget, isQueenGateSafe } from './shared/bot-strategy.js';
import { getGatorSpeed } from './shared/pacing.js';
import { pulseBotFlight } from './shared/bot-flight.js';
import { canContactStrike, bumpOpponents } from './shared/combat.js';
import { getMapDefinition, isMapId, normalizeMapId } from './shared/maps.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const NO_INPUT = Object.freeze({
  left: false,
  right: false,
  jump: false,
  action: false,
  dash: false,
  down: false,
});
const BOT_NAMES = [
  'YOLO Swaggins',
  'False Positive',
  'Blurlock Holmes',
  'Sir BBox-a-Lot',
  'Seg McMask',
  'Pixel Peeker',
  'Overfit Happens',
  'Edge Lord',
  'IoU Owe Me',
  'Mean Average Pat',
  'Lenny Lens',
  'Mask R-Coon',
  'Crop It Like Hot',
  'Batch Please',
  'NMS Nemesis',
  'Label Goblin',
  'Ground Truth-ish',
  'Coco Loco',
  'Blur Force One',
  'Box Office Hit',
  'Resize Guy',
  'Tensor Tantrum',
  'Track Sparrow',
  'Pixel Bandit',
  'Depth Vader',
  'Recall Me Maybe',
  'Feature Creature',
  'Dropout Dolly',
  'Optical Flo',
  'Vision Possible',
  'Segmental Case',
  'Max Pool Party',
];
const BOT_BEHAVIOR = Object.freeze({
  easy: {
    thinkMs: 280,
    jitterMs: 35,
    engageDistance: 220,
    aimHeight: 8,
    threatWeight: 0,
    gatorAfter: 20000,
  },
  normal: {
    thinkMs: 100,
    jitterMs: 10,
    engageDistance: 330,
    aimHeight: 28,
    threatWeight: 180,
    gatorAfter: 12000,
  },
  hard: {
    thinkMs: 70,
    jitterMs: 10,
    engageDistance: 520,
    aimHeight: 42,
    threatWeight: 260,
    gatorAfter: 8000,
  },
});
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const clean = (value, fallback, max = 22) =>
  typeof value === 'string'
    ? value
        .replace(/[\x00-\x1f<>]/g, '')
        .trim()
        .slice(0, max) || fallback
    : fallback;
const overlaps = (a, b, pad = 0) =>
  a.x + PLAYER_W + pad > b.x &&
  a.x - pad < b.x + b.w &&
  a.y + PLAYER_H + pad > b.y &&
  a.y - pad < b.y + b.h;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lowestBy = (items, score) => {
  let best = null,
    value = Infinity;
  for (const item of items) {
    const candidate = score(item);
    if (candidate < value) {
      best = item;
      value = candidate;
    }
  }
  return best;
};

export function createGameServer({
  port = Number(process.env.PORT) || 8787,
  host = '0.0.0.0',
  maxRooms = 32,
  emptyRoomTtlMs = 15000,
  maintenanceMs = 15000,
  countdownMs = 3000,
  resumeGraceMs = 15000,
  eventHistoryLimit = 256,
} = {}) {
  countdownMs = Number.isFinite(countdownMs) ? Math.max(0, Math.min(10000, countdownMs)) : 3000;
  resumeGraceMs = Number.isFinite(resumeGraceMs)
    ? Math.max(50, Math.min(30000, resumeGraceMs))
    : 15000;
  eventHistoryLimit = Number.isSafeInteger(eventHistoryLimit)
    ? Math.max(8, Math.min(512, eventHistoryLimit))
    : 256;
  const sessions = new Map();
  let closing = false;
  const hosted =
    process.env.PUBLIC_HOSTED === '1' ||
    Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RENDER);
  const rooms = new Map();
  const clients = new Map();
  let idCounter = 0;
  let botCounter = 0;
  let maxTickMs = 0;
  let lastTickMs = 0;
  let maxSnapshotMs = 0;
  let lastSnapshotMs = 0;
  let totalTicks = 0;
  let skippedSnapshots = 0;
  const startedAt = Date.now();
  const publicRooms = () =>
    [...rooms.values()]
      .filter((r) => !r.private && humans(r).length)
      .map((r) => ({
        code: r.code,
        name: r.name,
        mode: r.mode,
        mapId: r.mapId,
        mapName: r.map.name,
        mapRevision: r.mapRevision,
        players: humans(r).length,
        bots: bots(r).length,
        botDifficulty: r.botDifficulty,
        maxPlayers: r.maxPlayers,
        status: r.status,
        private: r.private,
      }));
  const humans = (r) => [...r.players.values()].filter((p) => !p.bot);
  const bots = (r) => [...r.players.values()].filter((p) => p.bot);
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health')
        return json(res, 200, {
          ok: true,
          version: packageInfo.version,
          rooms: rooms.size,
          players: clients.size,
          uptime: Math.round((Date.now() - startedAt) / 1000),
          tickRate: 60,
          snapshotRate: 20,
          lastTickMs: +lastTickMs.toFixed(2),
          maxTickMs: +maxTickMs.toFixed(2),
          lastSnapshotMs: +lastSnapshotMs.toFixed(2),
          maxSnapshotMs: +maxSnapshotMs.toFixed(2),
          skippedSnapshots,
        });
      if (url.pathname === '/api/rooms') return json(res, 200, { rooms: publicRooms() });
      if (url.pathname === '/api/network')
        return json(res, 200, {
          hosted,
          port: server.address()?.port || port,
          addresses: hosted
            ? []
            : Object.values(networkInterfaces())
                .flat()
                .filter((n) => n?.family === 'IPv4' && !n.internal)
                .map((n) => `http://${n.address}:${server.address()?.port || port}`),
        });
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return json(res, 405, { error: 'Method not allowed' });
      const pathname = decodeURIComponent(url.pathname);
      const root = pathname.startsWith('/shared/')
        ? resolve(HERE, 'shared')
        : resolve(HERE, 'public');
      const relative = pathname.startsWith('/shared/')
        ? pathname.slice(8)
        : pathname === '/'
          ? 'index.html'
          : pathname.slice(1);
      const path = resolve(root, relative);
      if (!path.startsWith(root + sep)) return json(res, 403, { error: 'Forbidden' });
      if (!(await stat(path)).isFile()) return json(res, 404, { error: 'Not found' });
      const body = await readFile(path);
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': body.length,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      json(res, 404, { error: 'Not found' });
    }
  });
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 4096,
    perMessageDeflate: {
      threshold: 2048,
      serverNoContextTakeover: false,
      clientNoContextTakeover: true,
      zlibDeflateOptions: { level: 1 },
      concurrencyLimit: 10,
    },
  });
  // Reuse each connection's deflate dictionary for similar consecutive states.
  // Small control replies skip compression, and gameplay never queues old states.
  const snapshotSending = new WeakSet();
  const resyncSockets = new WeakSet();
  function closeTransport(socket, code, reason) {
    if (!socket || resyncSockets.has(socket)) return;
    resyncSockets.add(socket);
    socket.close(code, reason);
    // A close frame can itself sit behind a blocked write. Bound the old
    // transport's lifetime; the private session remains resumable afterward.
    const timer = setTimeout(() => socket.terminate(), 300);
    timer.unref();
    socket.once('close', () => clearTimeout(timer));
  }
  const requireResync = (socket) => closeTransport(socket, 1013, 'Reconnect to resync');
  const send = (socket, data) => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount >= 256 * 1024) {
      if (!['rooms', 'pong'].includes(data.type)) requireResync(socket);
      return false;
    }
    socket.send(
      JSON.stringify(data),
      {
        compress: ['joined', 'map-changed'].includes(data.type),
      },
      (err) => {
        if (err) requireResync(socket);
      },
    );
    return true;
  };
  function revokeSession(c) {
    if (c.resumeToken) sessions.delete(c.resumeToken);
    clearTimeout(c.resumeTimer);
    c.resumeTimer = null;
    c.resumeExpiresAt = 0;
  }
  function renewSession(c) {
    revokeSession(c);
    if (!c.resumable) return;
    c.resumeToken = randomBytes(32).toString('base64url');
    sessions.set(c.resumeToken, c);
  }
  const sessionFields = (c) => (c.resumable ? { resumeToken: c.resumeToken, resumeGraceMs } : {});
  function acknowledgeEvents(c, id, epoch) {
    if (
      c.eventReplay &&
      epoch === c.roomCode &&
      Number.isSafeInteger(id) &&
      id > c.eventAck &&
      id <= c.eventSent
    )
      c.eventAck = id;
  }
  const error = (client, message) => send(client.socket, { type: 'error', message });
  const broadcastRooms = () => {
    const data = { type: 'rooms', rooms: publicRooms() };
    for (const c of clients.values()) if (!c.roomCode) send(c.socket, data);
  };
  // Copy identity into the event: the feed must remain readable after a player
  // leaves, respawns, or falls outside an XXL client's interest area.
  const eventPlayer = (p) => ({ id: p.id, name: p.name, team: p.team, bot: Boolean(p.bot) });
  const event = (r, type, x, y, team, text, details = {}) => {
    const entry = { id: ++r.eventCounter, type, x, y, team, text, ...details };
    r.events.push(entry);
    r.eventHistory.push(entry);
    if (r.events.length > 80) r.events.shift();
    if (r.eventHistory.length > eventHistoryLimit) r.eventHistory.shift();
    r.snapshotDirty = true;
  };
  const crewFor = (r, team) => [...r.players.values()].filter((p) => p.team === team);
  const lobbyQuota = (r, team, extra = 0) => Math.ceil((crewFor(r, team).length + extra) / 5);
  const quotas = (r) =>
    r.status === 'playing' ? r.queenQuota : [lobbyQuota(r, 0), lobbyQuota(r, 1)];
  function makePlayer(r, id, name, team, bot = false, requestedRole = null) {
    const queens = crewFor(r, team).filter((p) => p.role === 'queen').length;
    const role =
      r.status === 'playing' || requestedRole === 'worker' || queens >= lobbyQuota(r, team, 1)
        ? 'worker'
        : 'queen';
    const p = {
      id,
      name,
      team,
      role,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facing: team === 0 ? 1 : -1,
      grounded: true,
      alive: true,
      respawnAt: 0,
      carrying: false,
      carriedBerryId: null,
      speedBoost: false,
      dive: false,
      queenLives: role === 'queen' ? 3 : 0,
      queenSlot: null,
      eliminated: false,
      upgradeUntil: 0,
      upgradeGateId: null,
      upgradeKind: null,
      bot,
      invulnerableUntil: 0,
      attackUntil: 0,
      emote: '',
      emoteUntil: 0,
      score: 0,
      kills: 0,
      ack: 0,
      input: { ...NO_INPUT },
      joinedAt: Date.now(),
      lastInput: Date.now(),
      nextAttack: 0,
      nextEmote: 0,
      botSeed: ++botCounter,
    };
    spawnPlayer(r, p);
    return p;
  }
  function spawnPlayer(r, p) {
    p.botRetreatTarget = null;
    p.botRetreatUntil = 0;
    resetPlayerInput(p);
    const base = r.map.bases[p.team];
    p.x = base.x + 40 + ((p.botSeed * 37) % 90);
    p.y = base.y + base.h - PLAYER_H;
    p.vx = 0;
    p.vy = 0;
    p.bumpVx = 0;
    p.nextBumpAt = 0;
    p.alive = true;
    p.respawnAt = 0;
    p.carrying = false;
    p.carriedBerryId = null;
    p.speedBoost = false;
    p.dive = false;
    p.eliminated = false;
    p.navigationEdge = null;
    p.botTarget = null;
    cancelUpgrade(p);
    p.grounded = true;
    p.jumps = 0;
    p.jumpHeld = false;
    p.dashHeld = false;
    p.attackUntil = 0;
    p.invulnerableUntil = Math.max(Date.now(), r.status === 'playing' ? r.startsAt || 0 : 0) + 1800;
  }
  function dropChip(r, p) {
    if (!p.carrying) return;
    let berry = r.berries.find((b) => b.id === p.carriedBerryId);
    if (!berry) {
      berry = { id: ++r.nextBerryId, active: false };
      r.berries.push(berry);
    }
    const x = Math.max(20, Math.min(r.map.width - 20, p.x + PLAYER_W / 2));
    const below = r.map.platforms
      .filter(
        (platform) =>
          x >= platform.x && x <= platform.x + platform.w && platform.y >= p.y + PLAYER_H - 2,
      )
      .sort((a, b) => a.y - b.y)[0];
    berry.x = x;
    berry.y = (below?.y ?? r.map.height - 80) - 22;
    berry.active = true;
    berry.pileId = null;
    p.carrying = false;
    p.carriedBerryId = null;
  }
  function cancelUpgrade(p) {
    p.upgradeUntil = 0;
    p.upgradeGateId = null;
    p.upgradeKind = null;
  }
  function consumeChip(p) {
    p.carrying = false;
    p.carriedBerryId = null;
  }
  function syncQueenLives(r) {
    r.queenLives = r.queenSlots.map((slots) => slots.reduce((sum, slot) => sum + slot.lives, 0));
  }
  function inheritQueenState(r, successor, previous) {
    dropChip(r, successor);
    for (const key of [
      'x',
      'y',
      'vx',
      'vy',
      'facing',
      'grounded',
      'alive',
      'respawnAt',
      'invulnerableUntil',
      'attackUntil',
      'nextAttack',
      'nextFlap',
      'jumps',
      'dive',
      'queenLives',
      'queenSlot',
      'eliminated',
    ])
      successor[key] = previous[key];
    successor.role = 'queen';
    successor.speedBoost = false;
    cancelUpgrade(successor);
    resetPlayerInput(successor);
    const slot = r.queenSlots[successor.team].find((slot) => slot.id === successor.queenSlot);
    if (slot) slot.playerId = successor.id;
  }
  function maintainQueens(r, team) {
    if (r.status === 'playing') return;
    const crew = crewFor(r, team),
      quota = lobbyQuota(r, team);
    let queens = crew.filter((p) => p.role === 'queen');
    for (const bot of queens.filter((p) => p.bot).reverse()) {
      if (queens.length <= quota) break;
      bot.role = 'worker';
      bot.queenLives = 0;
      queens = queens.filter((p) => p !== bot);
    }
    for (const bot of crew.filter((p) => p.bot && p.role !== 'queen')) {
      if (queens.length >= quota) break;
      dropChip(r, bot);
      bot.role = 'queen';
      bot.queenLives = 3;
      bot.speedBoost = false;
      queens.push(bot);
    }
  }
  function removePlayer(r, p) {
    dropChip(r, p);
    if (r.gator.riderId === p.id) r.gator.riderId = null;
    r.players.delete(p.id);
    if (p.role === 'queen' && r.status === 'playing') {
      if (p.queenLives === 0) {
        const slot = r.queenSlots[p.team].find((slot) => slot.id === p.queenSlot);
        if (slot) slot.playerId = null;
        return;
      }
      const successor = crewFor(r, p.team)
        .filter((q) => q.role !== 'queen')
        .sort((a, b) => Number(b.bot) - Number(a.bot))[0];
      if (successor) inheritQueenState(r, successor, p);
      else {
        // An abandoned Queen slot is forfeited, never silently recreated by a late join.
        const slot = r.queenSlots[p.team].find((slot) => slot.id === p.queenSlot);
        if (slot) {
          slot.lives = 0;
          slot.playerId = null;
        }
        syncQueenLives(r);
        if (
          Date.now() >= (r.startsAt || 0) &&
          r.queenSlots[p.team].length &&
          r.queenLives[p.team] === 0 &&
          crewFor(r, 1 - p.team).length
        )
          win(r, 1 - p.team, 'military', null, Date.now());
      }
    }
    maintainQueens(r, p.team);
  }
  function addBots(r) {
    const targetBots = Math.min(r.botTarget, r.maxPlayers - humans(r).length);
    const extras = bots(r).sort((a, b) => Number(a.role === 'queen') - Number(b.role === 'queen'));
    while (extras.length > targetBots) removePlayer(r, extras.shift());
    while (bots(r).length < targetBots) {
      const counts = [0, 0];
      for (const p of r.players.values()) counts[p.team]++;
      const team = counts[0] <= counts[1] ? 0 : 1;
      const id = `bot-${++idCounter}`;
      r.players.set(id, makePlayer(r, id, BOT_NAMES[botCounter % BOT_NAMES.length], team, true));
    }
    for (const team of [0, 1]) maintainQueens(r, team);
    if (r.status === 'waiting') resetEconomy(r);
  }
  function selectRole(c, r, p, role) {
    if (!['queen', 'worker'].includes(role))
      return error(c, 'Choose Queen or Worker. Warriors are earned at a wing gate.');
    if (r.status === 'playing')
      return error(c, 'Roles are locked for this round. Workers can earn wings at a gate.');
    if (p.role === role) return;
    if (role === 'queen') {
      const current = crewFor(r, p.team).filter((q) => q.role === 'queen');
      if (current.length >= lobbyQuota(r, p.team)) {
        const bot = current.find((q) => q.bot);
        if (!bot)
          return error(c, 'All Queen slots are held by teammates. Ask one to choose Worker first.');
        bot.role = 'worker';
        bot.queenLives = 0;
      }
    }
    dropChip(r, p);
    p.role = role;
    p.speedBoost = false;
    p.queenLives = role === 'queen' ? 3 : 0;
    p.eliminated = false;
    if (role === 'worker') maintainQueens(r, p.team);
    event(r, 'role', p.x, p.y, p.team, role === 'queen' ? 'QUEEN SELECTED' : 'WORKER SELECTED', {
      actor: eventPlayer(p),
    });
  }
  function readyToStart(r) {
    return getLobbyReadiness(r.players.values()).ready;
  }
  function selectTeam(c, r, p, team) {
    if (team !== 0 && team !== 1) return error(c, 'Choose Purple Pixels or Sunset Syndicate.');
    if (r.status !== 'waiting')
      return error(c, 'Teams are locked for this round. Change teams in the next round lobby.');
    if (p.team === team) return;
    const destination = crewFor(r, team);
    if (destination.length >= r.maxPlayers / 2) {
      const replacement = destination
        .filter((player) => player.bot)
        .sort((a, b) => Number(a.role === 'queen') - Number(b.role === 'queen'))[0];
      if (!replacement)
        return error(c, 'That team is full. Choose the other team or wait for a player to leave.');
      dropChip(r, replacement);
      if (r.gator.riderId === replacement.id) r.gator.riderId = null;
      r.players.delete(replacement.id);
    }
    dropChip(r, p);
    if (r.gator.riderId === p.id) r.gator.riderId = null;
    const retainQueen =
      p.role === 'queen' &&
      crewFor(r, team).filter((player) => player.role === 'queen').length < lobbyQuota(r, team, 1);
    p.team = team;
    p.role = retainQueen ? 'queen' : 'worker';
    p.queenLives = retainQueen ? 3 : 0;
    p.queenSlot = null;
    p.facing = team === 0 ? 1 : -1;
    spawnPlayer(r, p);
    addBots(r);
    event(
      r,
      'team',
      p.x,
      p.y,
      team,
      team === 0 ? 'JOINED PURPLE PIXELS' : 'JOINED SUNSET SYNDICATE',
      { actor: eventPlayer(p) },
    );
    broadcastRooms();
  }
  function selectMap(c, r, mapId) {
    if (!r || c.id !== r.hostId) return error(c, 'Only the host can change the map.');
    if (r.status !== 'waiting') return error(c, 'Change maps in the next round lobby.');
    if (!isMapId(mapId)) return error(c, 'Choose an available map.');
    if (r.mapId === mapId) return;
    r.mapId = mapId;
    r.mapRevision++;
    r.map = createMap(r.mode, r.players.size, mapId);
    r.navigation = createNavigator(r.map);
    r.botStrategy = null;
    resetRound(r, 'waiting');
    const message = {
      type: 'map-changed',
      map: r.map,
      mapId,
      mapName: r.map.name,
      mapRevision: r.mapRevision,
      players: [...r.players.values()].map(publicPlayer),
    };
    for (const client of clients.values())
      if (client.roomCode === r.code) {
        send(client.socket, message);
        sendSnapshot(r, client);
      }
    broadcastRooms();
  }
  function resetEconomy(r) {
    // Lobby previews follow the roster; once countdown starts these values and
    // the finite stock stay locked until the next round, even for late joins.
    configureMapEconomy(r.map, r.players.size);
    r.berries = r.map.berrySpawns.map((b, id) => ({
      id,
      x: b.x,
      y: b.y,
      active: true,
      pileId: b.pileId ?? null,
    }));
    r.nextBerryId = r.berries.length;
  }
  function resetRound(r, status = 'playing') {
    r.botStrategy = null;
    r.nextBotStrategy = 0;
    r.status = status;
    r.winner = null;
    r.winReason = '';
    r.winType = null;
    r.victory = null;
    r.scores = [0, 0];
    r.startsAt = status === 'playing' ? Date.now() + countdownMs : 0;
    r.startedAt = r.startsAt || Date.now();
    r.countdownPending = status === 'playing' && countdownMs > 0;
    r.events = [];
    r.queenQuota = [lobbyQuota(r, 0), lobbyQuota(r, 1)];
    r.queenSlots = [[], []];
    resetEconomy(r);
    r.gates = r.map.gates.map((g) => ({ ...g, team: null }));
    r.gator = { x: r.map.width / 2, y: r.map.gatorTrack.y, riderId: null, progress: 0 };
    for (const p of r.players.values()) {
      p.score = 0;
      p.kills = 0;
      p.input = { ...NO_INPUT };
      p.botInput = { ...NO_INPUT };
      p.lastInput = 0;
      p.nextThink = 0;
      if (p.role === 'warrior') p.role = 'worker';
      p.queenLives = p.role === 'queen' ? 3 : 0;
      p.queenSlot = null;
      p.eliminated = false;
      if (p.role === 'queen') {
        p.queenSlot = `${p.team}-${r.queenSlots[p.team].length}`;
        r.queenSlots[p.team].push({ id: p.queenSlot, lives: 3, playerId: p.id });
      }
      spawnPlayer(r, p);
    }
    syncQueenLives(r);
    event(
      r,
      r.countdownPending ? 'countdown' : 'start',
      r.map.width / 2,
      r.map.height / 2,
      null,
      r.countdownPending
        ? 'GET READY!'
        : status === 'playing'
          ? 'LET THE TRASH TALK BEGIN!'
          : 'PICK YOUR ROLE · HOST STARTS THE MATCH',
    );
  }
  function newRoom(c, msg, start) {
    if (rooms.size >= maxRooms) return error(c, 'All server rooms are busy. Try an existing room.');
    if (msg.botDifficulty !== undefined && !BOT_DIFFICULTIES.includes(msg.botDifficulty))
      return error(c, 'Choose Easy, Normal or Hard bot difficulty.');
    if (msg.mapId !== undefined && !isMapId(msg.mapId)) return error(c, 'Choose an available map.');
    const mapId = normalizeMapId(msg.mapId),
      definition = getMapDefinition(mapId);
    leaveRoom(c);
    let code;
    do {
      code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    } while (rooms.has(code));
    const mode = msg.mode === 'xxl' ? 'xxl' : 'normal';
    const maxPlayers = mode === 'xxl' ? 120 : 10;
    const botTarget = Number.isFinite(msg.botCount)
      ? Math.max(0, Math.min(maxPlayers - 1, Math.floor(msg.botCount)))
      : msg.bots === false
        ? 0
        : mode === 'xxl'
          ? 23
          : 9;
    const r = {
      code,
      name: clean(msg.roomName, `${definition.subtitle}${mode === 'xxl' ? ' XXL' : ''}`, 32),
      mode,
      maxPlayers,
      private: Boolean(msg.private),
      botTarget,
      botDifficulty: msg.botDifficulty || 'normal',
      hostId: c.id,
      players: new Map(),
      mapId,
      mapRevision: 0,
      map: createMap(mode, undefined, mapId),
      status: 'waiting',
      tick: 0,
      events: [],
      eventCounter: 0,
      eventHistory: [],
      snapshotDirty: true,
      lastSnapshotAt: 0,
      emptySince: 0,
    };
    r.navigation = createNavigator(r.map);
    rooms.set(code, r);
    resetRound(r, 'waiting');
    joinRoom(c, r, msg.name, msg.role);
    addBots(r);
    if (start && readyToStart(r)) resetRound(r, 'playing');
    broadcastRooms();
  }
  function joinRoom(c, r, name, requestedRole = null) {
    if (c.roomCode === r.code) return;
    if (humans(r).length >= r.maxPlayers) return error(c, 'This room is full. Try another room.');
    leaveRoom(c);
    const counts = [0, 0];
    for (const p of humans(r)) counts[p.team]++;
    const team = counts[0] <= counts[1] ? 0 : 1;
    const teamQueen = bots(r).find(
      (p) => p.team === team && p.role === 'queen' && (!p.eliminated || requestedRole === 'queen'),
    );
    const needsSpace =
      r.players.size >= r.maxPlayers || crewFor(r, team).length >= r.maxPlayers / 2;
    const replace =
      requestedRole !== 'worker' && teamQueen
        ? teamQueen
        : needsSpace
          ? bots(r)
              .filter((p) => p.team === team)
              .sort((a, b) => Number(a.role === 'queen') - Number(b.role === 'queen'))[0] ||
            bots(r)[0]
          : null;
    // Replacing a bot controller must preserve a live round's exact Queen state.
    if (replace) {
      dropChip(r, replace);
      r.players.delete(replace.id);
      if (r.gator.riderId === replace.id) r.gator.riderId = null;
    }
    const p = makePlayer(r, c.id, clean(name, 'Lenny'), team, false, requestedRole);
    if (replace?.role === 'queen' && r.status === 'playing') inheritQueenState(r, p, replace);
    r.players.set(c.id, p);
    c.roomCode = r.code;
    c.eventAck = r.eventCounter;
    c.eventSent = r.eventCounter;
    r.emptySince = 0;
    if (!r.hostId || !r.players.has(r.hostId)) r.hostId = c.id;
    addBots(r);
    sendJoined(r, c);
    event(r, 'join', p.x, p.y, p.team, `${p.name} joined the chaos`, { actor: eventPlayer(p) });
    sendSnapshot(r, c);
    broadcastRooms();
  }
  function sendJoined(r, c, resumed = false) {
    send(c.socket, {
      type: 'joined',
      resumed,
      ack: r.players.get(c.id)?.ack || 0,
      ...sessionFields(c),
      ...(c.eventReplay ? { eventEpoch: r.code, eventAck: c.eventAck } : {}),
      id: c.id,
      code: r.code,
      hostId: r.hostId,
      map: r.map,
      room: {
        name: r.name,
        mode: r.mode,
        mapId: r.mapId,
        mapName: r.map.name,
        mapRevision: r.mapRevision,
        maxPlayers: r.maxPlayers,
        private: r.private,
        botTarget: r.botTarget,
        botDifficulty: r.botDifficulty,
      },
      players: [...r.players.values()].map(publicPlayer),
    });
  }
  function resumeSession(c, msg, socket) {
    const previous =
      typeof msg.token === 'string' && msg.token.length === 43 ? sessions.get(msg.token) : null;
    const room = previous && rooms.get(previous.roomCode);
    if (
      !c.resumable ||
      c.roomCode ||
      !previous ||
      !room?.players.has(previous.id) ||
      (previous.resumeExpiresAt && previous.resumeExpiresAt <= Date.now())
    ) {
      send(socket, { type: 'resume-failed', reason: 'expired-or-invalid' });
      return c;
    }
    const oldSocket = previous.socket;
    revokeSession(c);
    clients.delete(c.id);
    clearTimeout(previous.resumeTimer);
    previous.resumeTimer = null;
    previous.resumeExpiresAt = 0;
    previous.socket = socket;
    previous.compact = c.compact;
    previous.eventReplay = c.eventReplay;
    previous.rateCount = c.rateCount;
    previous.rateWindow = c.rateWindow;
    previous.alive = true;
    clients.set(previous.id, previous);
    // Superseded sockets cannot remove or control the restored player.
    if (oldSocket !== socket && oldSocket.readyState === WebSocket.OPEN)
      closeTransport(oldSocket, 4000, 'Session resumed elsewhere');
    stopDisconnectedPlayer(room, room.players.get(previous.id));
    acknowledgeEvents(previous, msg.eventAck, msg.eventEpoch);
    // A new transport must replay retained events not yet processed by the client.
    previous.eventSent = previous.eventAck;
    sendJoined(room, previous, true);
    sendSnapshot(room, previous);
    return previous;
  }
  function stopDisconnectedPlayer(room, player) {
    resetPlayerInput(player);
    player.jumpHeld = false;
    player.dashHeld = false;
    player.lastInput = 0;
    player.vx = 0;
    player.dive = false;
    if (room.gator.riderId === player.id) room.gator.riderId = null;
  }
  function disconnect(c) {
    clients.delete(c.id);
    const room = rooms.get(c.roomCode),
      player = room?.players.get(c.id);
    if (!closing && c.resumable && player) {
      stopDisconnectedPlayer(room, player);
      c.resumeExpiresAt = Date.now() + resumeGraceMs;
      c.resumeTimer = setTimeout(() => {
        revokeSession(c);
        leaveRoom(c);
      }, resumeGraceMs);
      c.resumeTimer.unref();
    } else {
      revokeSession(c);
      leaveRoom(c);
    }
  }
  function leaveRoom(c, notify = false) {
    const r = rooms.get(c.roomCode);
    if (r) {
      const p = r.players.get(c.id);
      if (p) removePlayer(r, p);
      if (r.hostId === c.id) r.hostId = humans(r)[0]?.id || null;
      if (!humans(r).length) r.emptySince = Date.now();
      else addBots(r);
    }
    c.roomCode = null;
    c.eventAck = 0;
    c.eventSent = 0;
    if (r) r.snapshotDirty = true;
    if (notify) {
      renewSession(c);
      send(c.socket, { type: 'left', ...sessionFields(c) });
    }
    if (r) broadcastRooms();
  }
  function publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      role: p.role,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      // Match position precision on the wire. Full-precision decay stays in the
      // simulation; sub-tenth velocity noise needlessly churns compression.
      vx: Math.round(p.vx * 10) / 10,
      vy: Math.round(p.vy),
      facing: p.facing,
      grounded: p.grounded,
      alive: p.alive,
      respawnAt: p.respawnAt,
      carrying: p.carrying,
      upgradeUntil: p.upgradeUntil || 0,
      upgradeGateId: p.upgradeGateId ?? null,
      upgradeKind: p.upgradeKind ?? null,
      queenLives: p.queenLives,
      eliminated: Boolean(p.eliminated),
      speedBoost: Boolean(p.speedBoost),
      dive: Boolean(p.dive),
      bot: p.bot,
      invulnerableUntil: p.invulnerableUntil,
      attackUntil: p.attackUntil,
      emote: p.emote,
      emoteUntil: p.emoteUntil,
      score: p.score,
      kills: p.kills,
      ack: p.ack,
      jumps: p.jumps,
      jumpHeld: p.jumpHeld,
      dashHeld: p.dashHeld,
      nextFlap: p.nextFlap || 0,
      nextDash: p.nextDash || 0,
      dashUntil: p.dashUntil || 0,
      bumpVx: Math.round((p.bumpVx || 0) * 10) / 10,
    };
  }
  function prepareSnapshot(r, now, formats = { legacy: true, compact: true }) {
    // Every recipient sees the same player objects. Serialize each only once per
    // tick, then select its JSON fragment for the recipient's interest window.
    const players = [...r.players.values()].map((player) => {
      const p = publicPlayer(player);
      const json = formats.legacy ? JSON.stringify(p) : null;
      const compactJson = formats.compact ? JSON.stringify(encodePlayer(p)) : null;
      return Object.assign(p, { json, compactJson });
    });
    const berries = [],
      pileCounts = new Map();
    // Count all stockpiles together instead of filtering the full finite stock
    // once for each pile. Dropped resources retain the original wire schema.
    for (const b of r.berries) {
      if (b.active && b.pileId !== null)
        pileCounts.set(b.pileId, (pileCounts.get(b.pileId) || 0) + 1);
      if (b.pileId === null)
        berries.push({
          ...b,
          json: JSON.stringify({ id: b.id, x: b.x, y: b.y, active: b.active, pileId: b.pileId }),
        });
    }
    const humanCount = players.reduce((count, p) => count + Number(!p.bot), 0);
    const head = JSON.stringify({
      type: 'state',
      // Keep compact-v1's tuple unchanged. Older clients ignore this sparse
      // extension; current clients merge it into their prediction state.
      bumps: Object.fromEntries(players.filter((p) => p.bumpVx).map((p) => [p.id, p.bumpVx])),
      time: now,
      tick: r.tick,
      mapId: r.mapId,
      mapName: r.map.name,
      mapRevision: r.mapRevision,
      gator: r.gator,
      scores: r.scores,
      scoreTarget: r.map.scoreTarget,
      resourceCount: r.map.resourceCount,
      economyPlayerCount: r.map.economyPlayerCount,
      queenLives:
        r.status === 'playing' || r.status === 'ended'
          ? r.queenLives
          : [0, 1].map((team) => crewFor(r, team).filter((p) => p.role === 'queen').length * 3),
      queenQuota: r.status === 'ended' ? r.queenQuota : quotas(r),
      queensRemaining: [0, 1].map((team) =>
        r.status === 'playing' || r.status === 'ended'
          ? r.queenSlots[team].filter((slot) => slot.lives > 0).length
          : crewFor(r, team).filter((p) => p.role === 'queen').length,
      ),
      piles: r.map.berryPiles.map((pile) => ({
        ...pile,
        remaining: pileCounts.get(pile.id) || 0,
      })),
      status: r.status,
      startsAt: r.startsAt || 0,
      countdownUntil: r.startsAt || 0,
      winner: r.winner,
      winReason: r.winReason,
      winType: r.winType,
      victory: r.victory,
      gates: r.gates,
      lobbyPlayers:
        r.status !== 'playing'
          ? players.map(({ id, name, team, role, bot }) => ({ id, name, team, role, bot }))
          : undefined,
      elapsedSeconds:
        r.status === 'waiting'
          ? 0
          : Math.floor((r.victory?.durationMs ?? Math.max(0, now - r.startedAt)) / 1000),
      playerCount: humanCount,
      botCount: players.length - humanCount,
      configuredBots: r.botTarget,
      botDifficulty: r.botDifficulty,
      hostId: r.hostId,
      remaining: null,
    }).slice(0, -1);
    return { players, berries, head, events: r.events, packets: new Map() };
  }
  function sendSnapshot(r, c, cachedSnapshot = null, now = Date.now()) {
    const local = r.players.get(c.id);
    if (!local) return;
    const socket = c.socket;
    if (socket.readyState !== WebSocket.OPEN) return;
    if (snapshotSending.has(socket) || socket.bufferedAmount > 64 * 1024) {
      skippedSnapshots++;
      return;
    }
    const snapshot =
      cachedSnapshot || prepareSnapshot(r, now, { legacy: !c.compact, compact: c.compact });
    const visible =
      r.mode === 'xxl'
        ? snapshot.players.filter(
            (p) =>
              p.id === local.id ||
              (Math.abs(p.x - local.x) < 1100 && Math.abs(p.y - local.y) < 800),
          )
        : snapshot.players;
    const berries =
      r.mode === 'xxl'
        ? snapshot.berries.filter(
            (b) => Math.abs(b.x - local.x) < 1100 && Math.abs(b.y - local.y) < 800,
          )
        : snapshot.berries;
    // Crowded clients often have the exact same view and input ack. Reuse the
    // immutable UTF-8 packet for that snapshot only; each socket still owns its
    // deflate dictionary and backpressure. No interest-window rounding/deltas.
    // Ordered TCP already delivers each admitted snapshot. ACK lag must not
    // duplicate the same feed in every live state; ACK is the resume boundary.
    const eventKey = c.eventReplay ? c.eventSent : 'legacy';
    const key = `${Number(c.compact)}/${eventKey}/${local.ack}/${visible.map((p) => p.id).join(',')}/${berries.map((b) => b.id).join(',')}`;
    let data = snapshot.packets.get(key);
    if (!data) {
      const replay = c.eventReplay
        ? {
            eventEpoch: r.code,
            eventLatest: r.eventCounter,
            eventFloor: r.eventHistory[0]?.id ?? r.eventCounter + 1,
            events: r.eventHistory.filter((e) => e.id > c.eventSent),
          }
        : { events: snapshot.events };
      const eventJson = JSON.stringify(replay).slice(1, -1);
      const encoding = c.compact ? `,"encoding":"${COMPACT_PROTOCOL}"` : '';
      data = Buffer.from(
        `${snapshot.head},${eventJson}${encoding},"ack":${local.ack},"players":[${visible.map((p) => (c.compact ? p.compactJson : p.json)).join(',')}],"berries":[${berries.map((b) => b.json).join(',')}]}`,
      );
      snapshot.packets.set(key, data);
    }
    if (c.eventReplay) c.eventSent = r.eventCounter;
    snapshotSending.add(socket);
    socket.send(data, { compress: true, binary: false }, (err) => {
      snapshotSending.delete(socket);
      if (err) requireResync(socket);
    });
  }
  function win(r, team, type, actor, now) {
    if (r.status !== 'playing') return;
    const reason = {
      economic: 'ECONOMIC VICTORY · Dataset complete',
      military: 'MILITARY VICTORY · All rival Queens eliminated',
      gator: `RIDE VICTORY · ${r.map.ride.name} delivered`,
    }[type];
    r.status = 'ended';
    r.winner = team;
    r.winReason = reason;
    r.winType = type;
    r.victory = {
      type,
      team,
      actorName: actor?.name || 'The crew',
      durationMs: Math.max(0, now - r.startedAt),
      data: [...r.scores],
      scoreTarget: r.map.scoreTarget,
      economyPlayerCount: r.map.economyPlayerCount,
      queenLives: [...r.queenLives],
      queenQuota: [...r.queenQuota],
      queensRemaining: r.queenSlots.map((slots) => slots.filter((slot) => slot.lives > 0).length),
      gatorProgress: r.gator.progress,
    };
    event(
      r,
      'win',
      r.map.width / 2,
      r.map.height / 2,
      team,
      reason,
      actor ? { actor: eventPlayer(actor) } : {},
    );
    broadcastRooms();
  }
  function kill(r, victim, killer, now) {
    if (r.status !== 'playing' || !victim.alive || now < victim.invulnerableUntil) return;
    dropChip(r, victim);
    victim.alive = false;
    victim.respawnAt = now + (victim.role === 'queen' ? 3500 : 2300);
    victim.speedBoost = false;
    victim.dive = false;
    victim.bumpVx = 0;
    cancelUpgrade(victim);
    if (r.gator.riderId === victim.id) r.gator.riderId = null;
    killer.kills++;
    killer.attackUntil = now + 170;
    event(r, 'ko', victim.x, victim.y, killer.team, `${killer.name} recycled ${victim.name}`, {
      actor: eventPlayer(killer),
      target: eventPlayer(victim),
    });
    if (victim.role === 'queen') {
      victim.queenLives = Math.max(0, victim.queenLives - 1);
      victim.eliminated = victim.queenLives === 0;
      const slot = r.queenSlots[victim.team].find((slot) => slot.id === victim.queenSlot);
      if (slot) slot.lives = victim.queenLives;
      syncQueenLives(r);
      if (r.queenSlots[victim.team].length && r.queenLives[victim.team] === 0)
        win(r, killer.team, 'military', killer, now);
    } else victim.role = 'worker';
  }
  function botInput(r, p, now) {
    const behavior = BOT_BEHAVIOR[r.botDifficulty];
    const age = now - r.startedAt;
    const base = r.map.bases[p.team];
    if (!r.botStrategy || now >= r.nextBotStrategy) {
      r.botStrategy = createBotStrategy(r, now);
      r.nextBotStrategy = now + 250;
    }
    const mates = r.botStrategy.teams[p.team];
    const job = r.botStrategy.jobs.get(p.id) || 'runner';
    const threat = (q) =>
      distance(p, q) -
      (q.carrying || r.gator.riderId === q.id ? behavior.threatWeight : 0) +
      (q.role === 'queen' && behavior.threatWeight ? 80 : 0);
    // Spawn protection prevents combat, not vision. Queens must see an armed
    // rival approaching a gate before both protections expire together.
    const visibleEnemies = r.botStrategy.teams[1 - p.team].filter((q) => q.alive);
    const enemies = visibleEnemies.filter((q) => now >= q.invulnerableUntil);
    const assignment = r.botStrategy.defense.get(p.id);
    const objective = assignment && r.players.get(assignment.targetId);
    const protectedQueen = assignment?.protectedId && r.players.get(assignment.protectedId);
    const stillThreatening =
      objective &&
      (assignment.kind === 'gator'
        ? r.gator.riderId === objective.id
        : assignment.kind === 'carrier'
          ? objective.carrying
          : protectedQueen?.alive &&
            protectedQueen.role === 'queen' &&
            objective.role !== 'worker' &&
            distance(objective, protectedQueen) < 550);
    const defenderTarget =
      objective?.alive &&
      objective.team !== p.team &&
      now >= objective.invulnerableUntil &&
      stillThreatening
        ? objective
        : null;
    const enemy = defenderTarget || lowestBy(enemies, threat);
    let target,
      action = false,
      retreating = false;
    if (p.role === 'queen' || p.role === 'warrior') {
      const waitingCarrier = (gate) =>
        mates.some(
          (q) =>
            q.alive &&
            q.role === 'worker' &&
            q.carrying &&
            distance(q, { x: gate.x + 20, y: gate.y + gate.h - PLAYER_H }) < 110,
        );
      const gatePriority = (gate) => distance(p, gate) - (waitingCarrier(gate) ? 600 : 0);
      const unclaimedGate =
        p.role === 'queen' &&
        lowestBy(
          r.gates.filter((g) => g.team !== p.team && isQueenGateSafe(p, g, visibleEnemies)),
          gatePriority,
        );
      const escort =
        p.role === 'warrior' &&
        lowestBy(
          mates.filter((q) => q.alive && (q.carrying || q.role === 'queen')),
          (q) => distance(p, q),
        );
      const engage =
        enemy &&
        (distance(p, enemy) <
          behavior.engageDistance + (enemy.carrying ? behavior.threatWeight : 0) ||
          (escort && distance(escort, enemy) < 330));
      const patrolPile = r.map.berryPiles[p.botSeed % r.map.berryPiles.length];
      target =
        unclaimedGate && waitingCarrier(unclaimedGate)
          ? { x: unclaimedGate.x + 20, y: unclaimedGate.y + 25 }
          : engage
            ? { x: enemy.x, y: enemy.y - behavior.aimHeight }
            : unclaimedGate
              ? { x: unclaimedGate.x + 20, y: unclaimedGate.y + 25 }
              : escort
                ? { x: escort.x + (p.team === 0 ? 60 : -60), y: escort.y - 70 }
                : { x: patrolPile.x - 14, y: patrolPile.y - 90 };
      if (defenderTarget)
        target = { x: defenderTarget.x, y: defenderTarget.y - behavior.aimHeight };
      const survival = queenRetreatTarget(p, visibleEnemies, r.map, r.botDifficulty);
      if (survival) {
        p.botRetreatTarget = survival;
        p.botRetreatUntil = now + 1100;
      }
      if (p.role === 'queen' && p.botRetreatTarget && now < p.botRetreatUntil) {
        target = p.botRetreatTarget;
        retreating = true;
      } else if (p.role === 'queen' && p.queenLives === 1) {
        target = { x: base.x + base.w / 2, y: Math.max(20, base.y - 80) };
        retreating = true;
      }
      action = Boolean(enemy && distance(p, enemy) < 70);
    } else if (job === 'gator' && (p.speedBoost || age > behavior.gatorAfter)) {
      target = { x: r.gator.x - PLAYER_W / 2, y: r.gator.y - PLAYER_H };
      action = distance(p, target) < 85;
    } else if (p.carrying) {
      const kind =
        job === 'fighter' ? 'warrior' : job === 'gator' && !p.speedBoost ? 'speed' : null;
      const gates = r.gates.filter((g) => g.kind === kind);
      const usable = gates.filter((g) => g.team === null || g.team === p.team);
      const gate = (usable.length ? usable : job === 'fighter' ? gates : []).sort(
        (a, b) => distance(p, a) - distance(p, b),
      )[0];
      if (gate) {
        target = { x: gate.x + 22, y: gate.y + gate.h - PLAYER_H };
        action = overlaps(p, gate, 14);
      } else if (job === 'gator') {
        target = { x: r.gator.x - PLAYER_W / 2, y: r.gator.y - PLAYER_H };
        action = distance(p, target) < 85;
      } else target = { x: base.x + base.w / 2 - PLAYER_W / 2, y: base.y + base.h - PLAYER_H };
    } else {
      const available = [],
        seenPiles = new Set();
      for (const berry of r.berries)
        if (berry.active && (berry.pileId === null || !seenPiles.has(berry.pileId))) {
          available.push(berry);
          seenPiles.add(berry.pileId);
        }
      let best = Infinity;
      for (const b of available) {
        const candidate = { x: b.x - 14, y: b.y - 20 };
        const d = r.navigation.distance(p, candidate);
        if (d < best) {
          best = d;
          target = candidate;
        }
      }
      target ||= { x: r.gator.x - PLAYER_W / 2, y: r.gator.y - PLAYER_H };
      if (!available.length) action = distance(p, target) < 85;
    }
    if (r.gator.riderId === p.id) return { ...NO_INPUT, action: true };
    if (p.role === 'worker') {
      p.botTarget = target;
      return { ...NO_INPUT, ...r.navigation.steer(p, target), action };
    }
    const dx = target.x - p.x;
    const jump =
      target.y < p.y - 10 ||
      Boolean(enemy && Math.abs(dx) < 200 && Math.sin(age / 700 + p.botSeed) > 0.45);
    return {
      left: dx < -10,
      right: dx > 10,
      jump,
      action,
      dash: false,
      down:
        p.role === 'queen'
          ? Boolean(!retreating && enemy && enemy.y > p.y + 25 && Math.abs(enemy.x - p.x) < 22)
          : target.y > p.y + 120,
    };
  }
  function resolveContact(r, now) {
    const active = [...r.players.values()].filter((p) => p.alive);
    for (let i = 0; i < active.length; i++)
      for (let j = i + 1; j < active.length; j++) {
        if (r.status !== 'playing') return;
        const a = active[i],
          b = active[j];
        if (
          !a.alive ||
          !b.alive ||
          a.team === b.team ||
          Math.abs(a.x - b.x) >= 45 ||
          Math.abs(a.y - b.y) >= 36
        )
          continue;
        if (canContactStrike(a, b, now)) kill(r, b, a, now);
        else if (canContactStrike(b, a, now)) kill(r, a, b, now);
        else if (bumpOpponents(a, b, now)) {
          cancelUpgrade(a);
          cancelUpgrade(b);
        }
      }
  }
  function tickRoom(r, now, dt) {
    r.tick++;
    if (!humans(r).length || r.status === 'ended') return;
    if (r.status === 'playing' && now < r.startsAt) return;
    if (r.countdownPending) {
      r.countdownPending = false;
      event(r, 'start', r.map.width / 2, r.map.height / 2, null, 'GO! LET THE TRASH TALK BEGIN!');
      for (const team of [0, 1])
        if (r.queenSlots[team].length && r.queenLives[team] === 0 && crewFor(r, 1 - team).length) {
          win(r, 1 - team, 'military', null, now);
          return;
        }
    }
    for (const p of r.players.values()) {
      if (!p.alive) {
        if (now >= p.respawnAt && (p.role !== 'queen' || p.queenLives > 0)) spawnPlayer(r, p);
        else continue;
      }
      if (p.bot && now >= (p.nextThink || 0)) {
        const behavior = BOT_BEHAVIOR[r.botDifficulty];
        p.botInput = botInput(r, p, now);
        p.nextThink = now + behavior.thinkMs + (p.botSeed % 4) * behavior.jitterMs;
      }
      if (!p.bot && now - p.lastInput >= 900) resetPlayerInput(p);
      let input = p.bot ? p.botInput || NO_INPUT : consumePlayerInput(p);
      if (p.bot) input = pulseBotFlight(p, input, now);
      if (p.bot && p.role === 'worker' && p.botTarget && r.gator.riderId !== p.id)
        input = { ...input, ...r.navigation.steer(p, p.botTarget) };
      if (r.gator.riderId === p.id) {
        if (input.jump) {
          r.gator.riderId = null;
          p.y = r.gator.y - PLAYER_H - 25;
          p.vy = -500;
          p.grounded = false;
          p.jumpHeld = true;
          p.jumps = 1;
        } else {
          p.x = r.gator.x - 14;
          p.y = r.gator.y - 58;
          p.vx = 0;
          p.vy = 0;
          p.grounded = false;
        }
      }
      if (p.upgradeUntil) {
        p.vx = 0;
        p.vy = 0;
      } else if (r.gator.riderId !== p.id) movePlayer(p, input, r.map, dt, now);
      if (r.status !== 'playing') continue;
      if (p.role === 'queen') {
        for (const gate of r.gates)
          if (gate.team !== p.team && overlaps(p, gate)) {
            gate.team = p.team;
            for (const other of r.players.values())
              if (other.team !== p.team && other.upgradeGateId === gate.id) cancelUpgrade(other);
            event(r, 'gate', gate.x, gate.y, p.team, 'GATE CLAIMED', {
              actor: eventPlayer(p),
              gateKind: gate.kind,
            });
          }
      }
      if (p.role === 'worker' && !p.carrying) {
        for (const berry of r.berries)
          if (
            berry.active &&
            Math.abs(p.x + 14 - berry.x) < 31 &&
            Math.abs(p.y + 20 - berry.y) < 36
          ) {
            berry.active = false;
            p.carrying = true;
            p.carriedBerryId = berry.id;
            event(r, 'pickup', berry.x, berry.y, p.team, '+1 data', {
              actor: eventPlayer(p),
              amount: 1,
            });
            break;
          }
      }
      const home = r.map.bases[p.team];
      const atDoor =
        p.grounded &&
        Math.abs(p.y + PLAYER_H - home.y - home.h) < 3 &&
        p.x + PLAYER_W / 2 >= home.door.x &&
        p.x + PLAYER_W / 2 <= home.door.x + home.door.w;
      if (p.role === 'worker' && p.carrying && atDoor) {
        consumeChip(p);
        p.score++;
        r.scores[p.team]++;
        event(r, 'deposit', p.x, p.y, p.team, 'DATA DELIVERED', {
          actor: eventPlayer(p),
          amount: 1,
          score: r.scores[p.team],
          scoreTarget: r.map.scoreTarget,
        });
        if (r.scores[p.team] >= r.map.scoreTarget) {
          win(r, p.team, 'economic', p, now);
          return;
        }
      }
      if (p.upgradeUntil) {
        const gate = r.gates.find((g) => g.id === p.upgradeGateId);
        if (
          p.role !== 'worker' ||
          !p.carrying ||
          !gate ||
          (gate.team !== null && gate.team !== p.team) ||
          !overlaps(p, gate, 12)
        )
          cancelUpgrade(p);
        else if (now >= p.upgradeUntil) {
          consumeChip(p);
          if (gate.kind === 'speed') {
            p.speedBoost = true;
            event(r, 'upgrade', p.x, p.y, p.team, 'SPEED UPGRADE', {
              actor: eventPlayer(p),
              upgradeKind: gate.kind,
            });
          } else {
            p.role = 'warrior';
            if (r.gator.riderId === p.id) r.gator.riderId = null;
            event(r, 'upgrade', p.x, p.y, p.team, 'WARRIOR WINGS', {
              actor: eventPlayer(p),
              upgradeKind: gate.kind,
            });
          }
          cancelUpgrade(p);
        }
      }
      if (input.action && p.role === 'worker' && !p.upgradeUntil && now >= (p.nextBumpAt || 0)) {
        const gate = r.gates.find(
          (g) =>
            overlaps(p, g, 12) &&
            (g.team === null || g.team === p.team) &&
            (g.kind !== 'speed' || !p.speedBoost),
        );
        if (p.carrying && gate && r.gator.riderId !== p.id) {
          p.upgradeGateId = gate.id;
          p.upgradeKind = gate.kind;
          p.upgradeUntil = now + 650;
          p.vx = 0;
          p.vy = 0;
          event(r, 'upgrade-start', p.x, p.y, p.team, 'AI1 TRANSFORMING…', {
            actor: eventPlayer(p),
            upgradeKind: gate.kind,
          });
        } else if (
          !r.gator.riderId &&
          Math.abs(p.x + 14 - r.gator.x) < 75 &&
          Math.abs(p.y + 24 - r.gator.y) < 80
        ) {
          r.gator.riderId = p.id;
          event(r, 'ride', p.x, p.y, p.team, `${r.map.ride.name.toUpperCase()} EXPRESS!`, {
            actor: eventPlayer(p),
          });
        }
      }
      // E can animate the sword; actual combat uses facing, contact and height.
      if (input.action && p.role !== 'worker' && now >= p.nextAttack) {
        p.nextAttack = now + 430;
        p.attackUntil = now + 170;
      }
    }
    if (r.status !== 'playing') return;
    resolveContact(r, now);
    if (r.status !== 'playing') return;
    if (r.gator.riderId) {
      const rider = r.players.get(r.gator.riderId);
      if (!rider?.alive || rider.role !== 'worker') r.gator.riderId = null;
      else {
        const speed = getGatorSpeed(r.map.gatorTrack, rider.speedBoost);
        r.gator.x += (rider.team === 0 ? -1 : 1) * speed * dt;
        r.gator.x = Math.max(r.map.gatorTrack.x1, Math.min(r.map.gatorTrack.x2, r.gator.x));
        rider.x = r.gator.x - 14;
        rider.y = r.gator.y - 58;
        r.gator.progress =
          (r.gator.x - r.map.width / 2) / ((r.map.gatorTrack.x2 - r.map.gatorTrack.x1) / 2);
        const reachedOwnGoal =
          rider.team === 0 ? r.gator.x <= r.map.gatorTrack.x1 : r.gator.x >= r.map.gatorTrack.x2;
        if (reachedOwnGoal) {
          win(r, rider.team, 'gator', rider, now);
          return;
        }
      }
    }
    r.gator.progress =
      (r.gator.x - r.map.width / 2) / ((r.map.gatorTrack.x2 - r.map.gatorTrack.x1) / 2);
  }
  wss.on('connection', (socket, request) => {
    if (clients.size >= 1000) return socket.close(1013, 'Server is full');
    const params = new URL(request.url, 'http://localhost').searchParams;
    const compact = params.get('protocol') === COMPACT_PROTOCOL;
    let c = {
      id: `p-${++idCounter}`,
      socket,
      compact,
      resumable: params.get('resume') === '1',
      eventReplay: params.get('events') === '1',
      eventAck: 0,
      eventSent: 0,
      roomCode: null,
      rateCount: 0,
      rateWindow: Date.now(),
      alive: true,
      lastRoomAction: 0,
    };
    clients.set(c.id, c);
    renewSession(c);
    send(socket, { type: 'welcome', id: c.id, ...sessionFields(c) });
    send(socket, { type: 'rooms', rooms: publicRooms() });
    socket.on('pong', () => {
      if (c.socket === socket) c.alive = true;
    });
    socket.on('message', (raw) => {
      if (c.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - c.rateWindow >= 1000) {
        c.rateWindow = now;
        c.rateCount = 0;
      }
      if (++c.rateCount > 150) return socket.close(1008, 'Too many messages');
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return error(c, 'Invalid message');
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      if (msg.type === 'resume') {
        c = resumeSession(c, msg, socket);
        return;
      }
      acknowledgeEvents(c, msg.type === 'event-ack' ? msg.id : msg.eventAck, msg.eventEpoch);
      if (msg.type === 'event-ack') return;
      const r = rooms.get(c.roomCode);
      const p = r?.players.get(c.id);
      if (msg.type === 'ping')
        return send(socket, { type: 'pong', time: typeof msg.time === 'number' ? msg.time : now });
      if (msg.type === 'input') {
        if (!p || !Number.isSafeInteger(msg.seq) || msg.seq < 0 || msg.seq <= p.ack) return;
        p.ack = msg.seq;
        p.lastInput = now;
        if (msg.reset === true || r.status !== 'playing' || now < r.startsAt || !p.alive) {
          resetPlayerInput(p);
          p.jumpHeld = false;
          p.dashHeld = false;
          return;
        }
        queuePlayerInput(p, msg);
        return;
      }
      if (msg.type === 'emote') {
        if (p && now >= p.nextEmote && ['GG', 'HEY', 'LOL'].includes(msg.emoji)) {
          r.snapshotDirty = true;
          p.emote = msg.emoji;
          p.emoteUntil = now + 2200;
          p.nextEmote = now + 1200;
        }
        return;
      }
      if (msg.type === 'role') {
        if (p) selectRole(c, r, p, msg.role);
        return;
      }
      if (msg.type === 'team') {
        if (p) selectTeam(c, r, p, msg.team);
        return;
      }
      if (msg.type === 'bots') {
        if (!r || c.id !== r.hostId) return error(c, 'Only the host can change the bots.');
        if (r.status === 'playing')
          return error(
            c,
            'Change the bot crew between rounds. Queen slots are fixed during a match.',
          );
        if (!Number.isFinite(msg.count)) return error(c, 'Choose a valid bot count.');
        r.snapshotDirty = true;
        r.botTarget = Math.max(0, Math.min(r.maxPlayers - 1, Math.floor(msg.count)));
        addBots(r);
        broadcastRooms();
        return;
      }
      if (msg.type === 'map') {
        selectMap(c, r, msg.mapId);
        return;
      }
      if (msg.type === 'bot-difficulty') {
        if (!r || c.id !== r.hostId) return error(c, 'Only the host can change bot difficulty.');
        if (r.status === 'playing') return error(c, 'Change bot difficulty between rounds.');
        if (!BOT_DIFFICULTIES.includes(msg.difficulty))
          return error(c, 'Choose Easy, Normal or Hard bot difficulty.');
        r.snapshotDirty = true;
        r.botDifficulty = msg.difficulty;
        r.botStrategy = null;
        for (const bot of bots(r)) bot.nextThink = 0;
        broadcastRooms();
        return;
      }
      if (msg.type === 'start' || msg.type === 'rematch') {
        if (!r || c.id !== r.hostId) return error(c, 'Only the host can start a match.');
        if (msg.type === 'start' && r.status !== 'waiting') return;
        if (msg.type === 'rematch' && r.status !== 'ended') return;
        addBots(r);
        if (msg.type === 'start') {
          const readiness = getLobbyReadiness(r.players.values());
          if (readiness.reason === 'players')
            return error(
              c,
              'Waiting for players: each team needs at least one player or bot. Invite a friend or add bots.',
            );
          if (!readiness.ready)
            return error(
              c,
              'Fill every Queen slot before starting: one Queen per five players, rounded up.',
            );
        }
        resetRound(r, msg.type === 'rematch' ? 'waiting' : 'playing');
        broadcastRooms();
        return;
      }
      if (msg.type === 'leave') return leaveRoom(c, true);
      if (!['create', 'join', 'quick'].includes(msg.type)) return;
      if (now - c.lastRoomAction < 400) return error(c, 'One moment — try again.');
      c.lastRoomAction = now;
      if (msg.type === 'create') return newRoom(c, msg, false);
      if (msg.type === 'join') {
        const room = rooms.get(
          String(msg.code || '')
            .trim()
            .toUpperCase(),
        );
        if (!room) return error(c, 'Room not found. Check the six-character code.');
        return joinRoom(c, room, msg.name, msg.role);
      }
      if (msg.mapId !== undefined && !isMapId(msg.mapId))
        return error(c, 'Choose an available map.');
      const mapId = normalizeMapId(msg.mapId);
      const mode = msg.mode === 'xxl' ? 'xxl' : 'normal';
      const room = [...rooms.values()].find(
        (q) =>
          !q.private &&
          q.mode === mode &&
          q.mapId === mapId &&
          q.status === 'playing' &&
          humans(q).length < q.maxPlayers,
      );
      if (room) joinRoom(c, room, msg.name, msg.role);
      else newRoom(c, { ...msg, botCount: mode === 'xxl' ? 23 : 9, private: false }, true);
    });
    socket.on('close', () => {
      if (c.socket === socket) disconnect(c);
    });
    socket.on('error', () => {});
  });
  let previousTick = performance.now();
  let simulationClock = Date.now();
  let accumulator = 0;
  const tickTimer = setInterval(() => {
    const t0 = performance.now();
    const elapsed = t0 - previousTick;
    previousTick = t0;
    if (elapsed > 250) simulationClock = Date.now() - 250;
    accumulator += Math.min(250, elapsed);
    while (accumulator >= 1000 / 60) {
      simulationClock += 1000 / 60;
      for (const r of rooms.values()) tickRoom(r, simulationClock, 1 / 60);
      accumulator -= 1000 / 60;
      totalTicks++;
    }
    lastTickMs = performance.now() - t0;
    maxTickMs = Math.max(maxTickMs, lastTickMs);
  }, 8);
  const snapshotTimer = setInterval(() => {
    const t0 = performance.now();
    const now = Date.now();
    for (const r of rooms.values()) {
      if (r.status !== 'playing' && !r.snapshotDirty && now - r.lastSnapshotAt < 250) continue;
      r.lastSnapshotAt = now;
      r.snapshotDirty = false;
      const recipients = humans(r)
        .map((p) => clients.get(p.id))
        .filter(Boolean);
      if (!recipients.length) {
        r.events = [];
        continue;
      }
      const snapshot = prepareSnapshot(r, now, {
        legacy: recipients.some((c) => !c.compact),
        compact: recipients.some((c) => c.compact),
      });
      for (const c of recipients) sendSnapshot(r, c, snapshot, now);
      r.events = [];
    }
    lastSnapshotMs = performance.now() - t0;
    maxSnapshotMs = Math.max(maxSnapshotMs, lastSnapshotMs);
  }, 50);
  const maintenanceTimer = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values())
      if (r.emptySince && now - r.emptySince > emptyRoomTtlMs) rooms.delete(r.code);
    for (const c of clients.values()) {
      if (!c.alive) c.socket.terminate();
      else {
        c.alive = false;
        c.socket.ping();
      }
    }
    broadcastRooms();
  }, maintenanceMs);
  return {
    server,
    wss,
    rooms,
    clients,
    async listen() {
      await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, host, ok);
      });
      return server.address();
    },
    async close() {
      closing = true;
      for (const c of sessions.values()) clearTimeout(c.resumeTimer);
      sessions.clear();
      clearInterval(tickTimer);
      clearInterval(snapshotTimer);
      clearInterval(maintenanceTimer);
      for (const c of clients.values()) c.socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
    metrics: () => ({
      totalTicks,
      lastTickMs,
      maxTickMs,
      lastSnapshotMs,
      maxSnapshotMs,
      skippedSnapshots,
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer();
  const address = await game.listen();
  console.log(`ROBOQUEEN is live · http://localhost:${address.port}`);
  for (const n of Object.values(networkInterfaces()).flat())
    if (n?.family === 'IPv4' && !n.internal)
      console.log(`LAN · http://${n.address}:${address.port}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await game.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
