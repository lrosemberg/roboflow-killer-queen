import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { RoomSession, EventCursor } from '../public/network-session.js';

const TOKEN = 'a'.repeat(64);
function storageFixture() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function savedSession(storage = storageFixture()) {
  const session = new RoomSession(storage);
  session.joined(
    { code: 'ABC123', id: 'same-player', resumeToken: TOKEN, ack: 40, eventAck: 9 },
    '',
  );
  return session;
}

test('per-tab saved session resumes privately after reload and preserves sequence/event cursors', () => {
  const storage = storageFixture();
  const session = savedSession(storage);
  session.progress(50, 12, true);
  const reloaded = new RoomSession(storage);
  assert.deepEqual(reloaded.resume('ABC123'), {
    type: 'resume',
    token: TOKEN,
    eventAck: 12,
    eventEpoch: 'ABC123',
  });
  assert.equal(reloaded.resume('DEF456'), null);
  const joined = reloaded.joined(
    { code: 'ABC123', id: 'same-player', resumed: true, ack: 48, eventAck: 10, resumeToken: TOKEN },
    'provisional'.repeat(8),
    0,
  );
  assert.equal(joined.seq, 50);
  assert.equal(joined.eventAck, 12);
  assert.equal(joined.token, TOKEN);
  const other = reloaded.joined({ code: 'DEF456', id: 'new-player', ack: 0, eventAck: 2 }, TOKEN);
  assert.equal(other.seq, 0);
  assert.equal(other.eventAck, 2);
  reloaded.clear();
  assert.equal(new RoomSession(storage).resume('DEF456'), null);
});

test('event replay is filtered before effects and advances only after successful processing', () => {
  const cursor = new EventCursor();
  cursor.reset('ABC123', 8);
  const snapshot = {
    eventEpoch: 'ABC123',
    eventFloor: 1,
    eventLatest: 11,
    events: [{ id: 8 }, { id: 9 }, { id: 10 }],
  };
  const filtered = cursor.filter(snapshot);
  assert.deepEqual(
    filtered.events.map((event) => event.id),
    [9, 10],
  );
  assert.equal(cursor.id, 8, 'Filtering alone must not acknowledge effects');
  cursor.commit(filtered);
  assert.equal(cursor.id, 10, 'eventLatest must not acknowledge unseen event11');
  assert.deepEqual(cursor.filter(snapshot).events, []);
  const laterRound = cursor.filter({ ...snapshot, events: [{ id: 10 }, { id: 11 }] });
  cursor.commit(laterRound);
  assert.equal(cursor.id, 11, 'Same-room rounds preserve monotonic IDs');
  const expired = cursor.filter({ ...snapshot, eventFloor: 20, events: [{ id: 20 }, { id: 21 }] });
  cursor.commit(expired);
  assert.equal(cursor.id, 21);
  cursor.reset('DEF456', 0);
  assert.deepEqual(cursor.fields(), { eventEpoch: 'DEF456', eventAck: 0 });
});

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const section = (from, to) =>
  app.slice(app.indexOf(`function ${from}`), app.indexOf(`function ${to}`));

// Execute the app's real connection handlers against a controllable WebSocket
// and clock. No network/server is started, and no source-pattern assertion can
// substitute for a transition actually sending the expected wire message.
function connectionFixture({ reload = false, saved = true } = {}) {
  const sockets = [],
    timers = new Map(),
    nodes = new Map();
  let nextTimer = 0;
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.handlers = new Map();
      this.sent = [];
      sockets.push(this);
    }
    addEventListener(type, callback) {
      this.handlers.set(type, callback);
    }
    emit(type, message) {
      this.handlers.get(type)?.(
        type === 'message' ? { data: JSON.stringify(message) } : message || {},
      );
    }
    open() {
      this.readyState = 1;
      this.emit('open');
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  const roomSession = saved ? savedSession() : new RoomSession(storageFixture());
  const cursor = new EventCursor();
  cursor.reset('ABC123', 9);
  let resets = 0;
  const context = vm.createContext({
    WebSocket: Socket,
    URLSearchParams,
    location: { protocol: 'https:', host: 'game.test', search: saved ? '?room=ABC123' : '' },
    performance: { now: () => 1000 },
    socket: null,
    socketReady: false,
    room: reload || !saved ? null : { code: 'ABC123' },
    localId: 'same-player',
    seq: 40,
    roomSession,
    eventCursor: cursor,
    pendingAction: null,
    connectionAttempt: 0,
    reconnectTimer: null,
    handshakeTimer: null,
    joiningRoom: false,
    joinFailed: false,
    resumeRequested: false,
    provisionalResumeToken: '',
    pendingResumeToken: '',
    pendingActionSent: false,
    pendingFallbackUsed: false,
    roomDestinationSignature: '',
    setTimeout: (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, {});
      return nodes.get(id);
    },
    setConnection: (online) => (context.socketReady = online),
    networkInput: { reset() {} },
    prediction: { reset() {} },
    resetInput() {
      resets++;
    },
    updateTouchControls() {},
    updateRoomDestination() {},
    playerName: () => 'Player',
    toast() {},
    renderRooms() {},
    recordPing() {},
    enterGame(data) {
      context.joined = data;
      context.joiningRoom = false;
      context.pendingAction = null;
      context.pendingResumeToken = '';
      context.pendingActionSent = false;
      context.clearTimeout(context.handshakeTimer);
    },
    goHome() {
      context.wentHome = true;
    },
  });
  vm.runInContext(
    section('send(message)', 'roundStartsAt') +
      section('reconnectDelay()', 'clearCountdown') +
      section('requestAction(', 'recordPing'),
    context,
  );
  return {
    context,
    sockets,
    timers,
    nodes,
    get resets() {
      return resets;
    },
    fire(id) {
      const timer = timers.get(id);
      assert.ok(timer, `Missing timer ${id}`);
      timers.delete(id);
      timer.fn();
    },
  };
}

test('manual/stale OPEN recovery replaces transport, resumes the saved seat and ignores old callbacks', () => {
  const f = connectionFixture();
  f.context.connect();
  const old = f.sockets[0];
  old.open();
  old.emit('message', { type: 'welcome', id: 'provisional', resumeToken: 'b'.repeat(64) });
  assert.equal(f.context.localId, 'same-player');
  assert.equal(f.context.roomSession.value.token, TOKEN);
  f.context.recoverConnection();
  const fresh = f.sockets[1];
  assert.equal(old.readyState, 3);
  assert.ok(f.resets > 0);
  fresh.open();
  assert.equal(fresh.sent[0].type, 'resume');
  assert.equal(fresh.sent[0].token, TOKEN);
  assert.equal(fresh.sent[0].eventAck, 9);
  assert.ok(!fresh.url.includes(TOKEN), 'Credentials must never enter URL');
  old.emit('message', { type: 'left' });
  old.emit('message', { type: 'welcome', id: 'wrong-player', resumeToken: 'c'.repeat(64) });
  old.emit('close');
  assert.equal(f.context.socket, fresh);
  assert.equal(f.context.wentHome, undefined);
  assert.equal(f.context.localId, 'same-player');
});

test('tab reload uses stored resume before joining and expired resume falls back once', () => {
  const f = connectionFixture({ reload: true });
  f.context.connect();
  const ws = f.sockets[0];
  ws.open();
  assert.equal(ws.sent[0].type, 'resume');
  ws.emit('message', { type: 'welcome', id: 'new-player', resumeToken: 'b'.repeat(64) });
  ws.emit('message', { type: 'resume-failed', reason: 'expired-or-invalid' });
  assert.equal(ws.sent.filter((message) => message.type === 'join').length, 1);
  assert.equal(f.context.roomSession.value, null);
  ws.emit('message', { type: 'error', message: 'This room is full. Try another room.' });
  assert.equal(f.context.joiningRoom, false);
  assert.equal(f.context.joinFailed, true);
  assert.equal(f.timers.size, 0, 'Definitive refusal waits for user retry instead of looping');
});

test('a session takeover stops the displaced tab instead of creating a reconnect fight', () => {
  const f = connectionFixture();
  f.context.connect();
  const ws = f.sockets[0];
  ws.open();
  ws.readyState = 3;
  ws.emit('close', { code: 4000 });
  assert.equal(f.context.joinFailed, true);
  assert.equal(f.context.roomSession.value, null);
  assert.equal(f.timers.size, 0);
  assert.match(f.nodes.get('#disconnect-message').textContent, /another tab/);
  // Only the user choosing Reconnect creates a fresh player, never reclaims
  // the same token from the tab that now owns it.
  f.context.recoverConnection();
  f.sockets[1].open();
  f.sockets[1].emit('message', { type: 'welcome', id: 'new-player', resumeToken: 'b'.repeat(64) });
  assert.equal(f.sockets[1].sent.filter((message) => message.type === 'join').length, 1);
  assert.equal(
    f.sockets[1].sent.some((message) => message.type === 'resume'),
    false,
  );
});

test('first create waits for a credential and a lost joined response resumes without duplicate creation', () => {
  const f = connectionFixture({ saved: false });
  f.context.connect();
  const initial = f.sockets[0];
  initial.open();
  f.context.requestAction({ type: 'create', mode: 'normal', botCount: 9 });
  assert.equal(
    initial.sent.some((message) => message.type === 'create'),
    false,
  );
  initial.emit('message', { type: 'welcome', id: 'first-player', resumeToken: TOKEN });
  assert.equal(initial.sent.filter((message) => message.type === 'create').length, 1);
  assert.equal(f.context.pendingAction.type, 'create', 'Keep intent until joined arrives');
  // Server accepted create, but the full joined control response never arrives.
  f.fire(f.context.handshakeTimer);
  f.fire(f.context.reconnectTimer);
  const retry = f.sockets[1];
  retry.open();
  assert.equal(retry.sent[0].type, 'resume');
  assert.equal(retry.sent[0].token, TOKEN);
  assert.equal(
    retry.sent[0].eventEpoch,
    undefined,
    'A first seat can resume before room code is known',
  );
  retry.emit('message', { type: 'welcome', id: 'provisional', resumeToken: 'b'.repeat(64) });
  assert.equal(
    retry.sent.some((message) => message.type === 'create'),
    false,
  );
  retry.emit('message', {
    type: 'joined',
    resumed: true,
    code: 'ABC123',
    id: 'first-player',
    ack: 0,
  });
  assert.equal(f.context.joined.id, 'first-player');
  assert.equal(f.context.pendingAction, null);
  assert.equal(f.timers.size, 0);
});

test('unsent first action survives synchronous transport recovery and invalid resume gets only one fallback', () => {
  const f = connectionFixture({ saved: false });
  f.context.connect();
  const initial = f.sockets[0];
  initial.open();
  initial.emit('message', { type: 'welcome', id: 'first-player', resumeToken: TOKEN });
  initial.bufferedAmount = 100000;
  f.context.requestAction({ type: 'create', mode: 'xxl', botCount: 0 });
  assert.equal(
    initial.sent.some((message) => message.type === 'create'),
    false,
  );
  assert.equal(f.context.pendingAction.type, 'create');
  const retry = f.sockets[1];
  retry.open();
  retry.emit('message', { type: 'welcome', id: 'retry-player', resumeToken: 'b'.repeat(64) });
  retry.emit('message', { type: 'resume-failed', reason: 'expired-or-invalid' });
  assert.equal(retry.sent.filter((message) => message.type === 'create').length, 1);
  f.context.recoverConnection();
  const again = f.sockets[2];
  again.open();
  again.emit('message', { type: 'welcome', id: 'third-player', resumeToken: 'c'.repeat(64) });
  again.emit('message', { type: 'resume-failed', reason: 'expired-or-invalid' });
  assert.equal(
    again.sent.some((message) => message.type === 'create'),
    false,
  );
  assert.equal(f.context.pendingAction, null);
  assert.equal(f.context.joinFailed, true);
  assert.equal(f.timers.size, 0);
});

test('CONNECTING and unfinished OPEN join handshakes time out with bounded retry backoff', () => {
  for (const open of [false, true]) {
    const f = connectionFixture();
    f.context.connect();
    if (open) f.sockets[0].open();
    assert.equal(f.timers.get(f.context.handshakeTimer).delay, 8000);
    f.fire(f.context.handshakeTimer);
    assert.equal(f.context.socket, null);
    assert.equal(f.timers.get(f.context.reconnectTimer).delay, 1000);
    f.fire(f.context.reconnectTimer);
    f.fire(f.context.handshakeTimer);
    assert.equal(f.timers.get(f.context.reconnectTimer).delay, 2000);
  }
  const home = connectionFixture({ saved: false });
  home.context.connect();
  home.sockets[0].open();
  home.sockets[0].emit('message', { type: 'welcome', id: 'home-player', resumeToken: TOKEN });
  assert.equal(home.timers.size, 0, 'Healthy home connection does not reconnect repeatedly');
});

test('fresh authoritative snapshots clear the stale overlay and deduplicate every effects path', () => {
  const cursor = new EventCursor();
  cursor.reset('ABC123', 4);
  const nodes = new Map([['#connection-overlay', { hidden: false }]]);
  const rendered = [],
    heard = [],
    feed = [];
  const context = vm.createContext({
    room: { code: 'ABC123' },
    map: { scoreTarget: 12 },
    eventCursor: cursor,
    localId: 'self',
    seq: 10,
    state: null,
    predicted: null,
    correction: { x: 0, y: 0 },
    ping: 40,
    lastSnapshot: 0,
    serverOffset: 0,
    lastStatus: 'playing',
    seenEvents: new Set(),
    performance: { now: () => 1000 },
    $: (id) => nodes.get(id),
    $$: () => [],
    validDifficulty: () => 'normal',
    countdownLocked: () => false,
    prediction: { reconcile: (player) => ({ ...player }) },
    gameRenderer: { setState: (snapshot) => rendered.push(snapshot.events.map((e) => e.id)) },
    playSound: (type) => heard.push(type),
    activityFeed: { consume: (events) => events },
    renderActivityFeed: (events) => feed.push(events.map((e) => e.id)),
    updateCountdown() {},
    updateHUD() {},
    roomSession: { progress() {} },
  });
  vm.runInContext(section('receiveState(', 'updateHUD'), context);
  const snapshot = {
    players: [{ id: 'self', x: 0, y: 0, alive: true }],
    scores: [0, 0],
    time: Date.now(),
    status: 'playing',
    gator: {},
    eventEpoch: 'ABC123',
    eventFloor: 1,
    events: [
      { id: 4, type: 'pickup', x: 0 },
      { id: 5, type: 'deposit', x: 0 },
    ],
  };
  context.receiveState(snapshot);
  context.receiveState(snapshot);
  assert.equal(nodes.get('#connection-overlay').hidden, true);
  assert.deepEqual(
    rendered.map((ids) => Array.from(ids)),
    [[5], []],
  );
  assert.deepEqual(
    feed.map((ids) => Array.from(ids)),
    [[5], []],
  );
  assert.deepEqual(heard, ['deposit']);
  assert.equal(cursor.id, 5);
});
