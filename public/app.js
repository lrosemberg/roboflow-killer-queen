import { Renderer, renderPreview } from './renderer.js';
import { movePlayer, SCORE_TARGETS, BOT_DIFFICULTIES, economyForPlayers } from '/shared/world.js';
import { decodeSnapshot } from '/shared/protocol.js';
import { drawRaccoon, drawRide, drawData, TEAM } from './sprites.js';
import { InputPrediction } from './prediction.js';
import { ActivityFeed } from './activity-feed.js';
import { TouchInput } from './touch-input.js';
import { bindTouchControls } from './touch-controls.js';
import { bindPageGestureGuard } from './gesture-guard.js';
import { getLobbyReadiness } from '/shared/lobby.js';
import { queuePlayerInput, consumePlayerInput, resetPlayerInput } from '/shared/input-buffer.js';
import { ScreenAwake, fullscreenElement, toggleGameFullscreen } from './screen-session.js';
import { DEFAULT_MAP_ID, isMapId, getMapDefinition } from '/shared/maps.js';
import { createMapPicker } from './map-picker.js';

bindPageGestureGuard();
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const TEAM_NAMES = TEAM.map((team) => team.name);
$$('[data-score-target-mode]').forEach(
  (el) => (el.textContent = SCORE_TARGETS[el.dataset.scoreTargetMode]),
);
const blankInput = () => ({
  left: false,
  right: false,
  jump: false,
  action: false,
  dash: false,
  down: false,
});
const storage = {
  get(k, f = '') {
    try {
      return localStorage.getItem(k) ?? f;
    } catch {
      return f;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
let selectedMapId = isMapId(storage.get('rumble-map')) ? storage.get('rumble-map') : DEFAULT_MAP_ID;
let mapPickers,
  roomDestinationSignature = '';
let socket,
  localId,
  room = null,
  state = null,
  map = null,
  selectedMode = 'normal';
let input = blankInput(),
  seq = 0,
  predicted = null,
  correction = { x: 0, y: 0 },
  serverOffset = 0;
const pingSamples = [];
const prediction = new InputPrediction();
const activityFeed = new ActivityFeed({ limit: 3, ttl: 3800, mergeWindow: 3800 });
const touchInput = new TouchInput();
let touchControls;
const localInputBuffer = {};
resetPlayerInput(localInputBuffer);
const screenAwake = new ScreenAwake(navigator.wakeLock);
let layoutWidth = 0,
  layoutFrame = 0;
const coarsePointer = matchMedia('(pointer: coarse)');
let touchMode = ['auto', 'on', 'off'].includes(storage.get('mayhem-touch-controls'))
  ? storage.get('mayhem-touch-controls')
  : 'auto';
let touchDetected = false,
  touchEnabled = false,
  touchPortrait = false,
  touchAvailable = false,
  stickRadius = 36;
const activityRows = new Map();
let activityList,
  activitySignature = '';
let rolePickerSignature = '',
  scoreboardSignature = '',
  resultScene = null,
  pendingBriefingAction = null,
  publicRooms = [];
let countdownWasActive = false,
  countdownValue = '',
  countdownGoUntil = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let ping = 0,
  lastSnapshot = 0,
  socketReady = false,
  pendingAction = null,
  connectionAttempt = 0,
  reconnectTimer;
let seenEvents = new Set(),
  lastStatus = '',
  gameRenderer,
  previewCleanup,
  toastTimer,
  announceTimer;
let lowPower = storage.get('mayhem-low-power') === '1';
let nameMode = ['nearby', 'all', 'off'].includes(storage.get('mayhem-player-names'))
  ? storage.get('mayhem-player-names')
  : 'nearby';
let soundEnabled = storage.get('mayhem-sound') === '1';
let audioContext,
  audioTimer,
  beat = 0;
const nameField = $('#player-name');
nameField.value = storage.get('mayhem-name', 'Lenny');
nameField.addEventListener('input', () => storage.set('mayhem-name', nameField.value));
const playerName = () => nameField.value.trim().slice(0, 18) || 'Lenny';
const DIFFICULTY_COPY = {
  easy: 'Relaxed reactions · Learn the ropes',
  normal: 'Balanced team play',
  hard: 'Faster decisions · Stronger pressure',
};
const validDifficulty = (value) => (BOT_DIFFICULTIES.includes(value) ? value : 'normal');
const difficultyName = (value) => {
  const difficulty = validDifficulty(value);
  return difficulty[0].toUpperCase() + difficulty.slice(1);
};
function savedBotCount(mode) {
  const maximum = mode === 'xxl' ? 119 : 9,
    value = Number(storage.get(`mayhem-bots-${mode}`, mode === 'xxl' ? '23' : '9'));
  return Number.isInteger(value) ? Math.max(0, Math.min(maximum, value)) : mode === 'xxl' ? 23 : 9;
}
function updateCreateDifficulty() {
  const value = validDifficulty($('#create-bot-difficulty').value);
  $('#create-bot-difficulty').value = value;
  $('#create-difficulty-description').textContent = DIFFICULTY_COPY[value];
  storage.set('mayhem-bot-difficulty', value);
}
$('#create-bot-difficulty').value = validDifficulty(storage.get('mayhem-bot-difficulty', 'normal'));
updateCreateDifficulty();

function currentDestination() {
  return getMapDefinition(map?.mapId || room?.mapId || selectedMapId);
}
function selectDestination(mapId) {
  if (!isMapId(mapId)) return;
  selectedMapId = mapId;
  storage.set('rumble-map', mapId);
  mapPickers?.home.update(mapId);
  mapPickers?.create.update(mapId);
  const destination = getMapDefinition(mapId);
  $('#selected-map-note').textContent = `${destination.name} · ${destination.ride.name}`;
  $('#destination-create').firstChild.textContent = `PLAY IN ${destination.name.toUpperCase()} `;
  $('#create-map-detail').textContent = `Your getaway: ${destination.ride.name}`;
  updateCreateSummary();
}
function updateCreateSummary() {
  const destination = getMapDefinition(selectedMapId);
  const mode = document.querySelector('input[name="create-mode"]:checked')?.value || selectedMode;
  const count = Number($('#create-bot-count')?.value ?? savedBotCount(mode));
  $('#create-room-summary').textContent =
    `${destination.name} · ${mode === 'xxl' ? 'XXL' : 'Classic'} · ${count} bots + you`;
}
function updateRoomDestination() {
  if (!room || !map) return;
  const destination = currentDestination();
  const canChange = room.hostId === localId && state?.status === 'waiting';
  const signature = `${destination.id}:${room.mode}:${room.hostId}:${localId}:${state?.status}`;
  if (signature === roomDestinationSignature) return;
  roomDestinationSignature = signature;
  $('#game').dataset.mapId = destination.id;
  $('#match-destination').textContent = destination.name.toUpperCase();
  $('#match-destination').title = `${destination.name} · ${destination.subtitle}`;
  $('#lobby-map-name').textContent = destination.name;
  $('#lobby-map-description').textContent =
    `${room.mode === 'xxl' ? 'XXL' : 'Classic'} · ${destination.ride.name}`;
  for (const id of ['#lobby-map-preview', '#menu-map-preview']) {
    if ($(id).getAttribute('src') !== destination.preview) $(id).src = destination.preview;
  }
  $('#lobby-change-map').textContent = canChange ? 'CHANGE MAP ↗' : 'VIEW MAPS ↗';
  $('#menu-map-name').textContent =
    `${destination.name} · ${room.mode === 'xxl' ? 'XXL' : 'Classic'}`;
  $('#menu-map-note').textContent = canChange
    ? 'Change your room’s destination ↗'
    : 'View the map lineup ↗';
  $('#map-dialog-title').textContent = canChange
    ? 'Choose the next destination.'
    : 'The world is your arcade.';
  $('#map-dialog-note').textContent = canChange
    ? 'Choose a map for the whole room.'
    : state?.status === 'playing' || state?.status === 'ended'
      ? 'The leader can change maps after this round.'
      : 'The room leader chooses the map.';
  mapPickers?.lobby.update(destination.id, { disabled: !canChange });
  $('#ride-route-label').textContent = `${destination.ride.name.toUpperCase()} GETAWAY`;
  $('.gator-hud').setAttribute(
    'aria-label',
    `${destination.ride.name} progress toward each team’s goal`,
  );
  $('#touch-action').setAttribute(
    'aria-label',
    `Action. Use an AI1 station or ride the ${destination.ride.name}`,
  );
}
function openMapSelection() {
  if (!room) return;
  updateRoomDestination();
  showDialog('#map-dialog');
}
function changeRoomDestination(mapId) {
  if (!isMapId(mapId) || room?.hostId !== localId || state?.status !== 'waiting') return;
  if (mapId === room.mapId) return;
  // The server confirms the change for the whole room before selection moves.
  mapPickers.lobby.update(room.mapId, { disabled: true });
  send({ type: 'map', mapId });
}
function receiveMapChange(data) {
  if (!room || !data.map) return;
  resetInput();
  prediction.reset();
  predicted = null;
  correction = { x: 0, y: 0 };
  accumulator = 0;
  seenEvents.clear();
  clearCountdown();
  resetActivityFeed();
  setScoreboard(false);
  rolePickerSignature = '';
  scoreboardSignature = '';
  resultScene = null;
  map = data.map;
  room.mapId = data.mapId || map.mapId;
  room.mapName = data.mapName || map.name;
  room.mapRevision = data.mapRevision;
  state = null;
  roomDestinationSignature = '';
  lastStatus = 'waiting';
  gameRenderer.setMap(map);
  gameRenderer.resize();
  gameRenderer.setState(
    {
      players: data.players || [],
      berries: [],
      scores: [0, 0],
      queenLives: [0, 0],
      events: [],
      time: Date.now(),
      status: 'waiting',
    },
    localId,
  );
  $$('.score-target').forEach((el) => (el.textContent = `/ ${map.scoreTarget} DATA`));
  $('#respawn-overlay').hidden = true;
  if ($('#map-dialog').open) $('#map-dialog').close();
  updateRoomDestination();
  updateTouchControls();
  toast(`Destination set: ${currentDestination().name}. Your crew is ready in the lobby.`);
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 4200);
}
function showDialog(id) {
  resetInput();
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
  updateTouchControls();
}
function closeDialogs() {
  $$('dialog[open]').forEach((d) => d.close());
}
function showAnnouncement(text, duration = 2600) {
  clearTimeout(announceTimer);
  $('#match-announcement').textContent = text;
  $('#match-announcement').hidden = false;
  announceTimer = setTimeout(() => ($('#match-announcement').hidden = true), duration);
}
function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}
function roundStartsAt(data = state) {
  return Number(data?.startsAt || data?.countdownUntil) || 0;
}
function countdownLocked(data = state) {
  return Boolean(data?.status === 'playing' && roundStartsAt(data) > data.time);
}
function sendInput({ reset = false } = {}) {
  if (room && socketReady) {
    const packet = {
      type: 'input',
      seq: ++seq,
      ...(countdownLocked() ? blankInput() : input),
      ...(reset ? { reset: true } : {}),
    };
    if (send(packet))
      prediction.record({ seq: packet.seq, input: packet, time: performance.now() });
  }
}
function clearCountdown() {
  countdownWasActive = false;
  countdownValue = '';
  countdownGoUntil = 0;
  $('#round-countdown').hidden = true;
}
function updateCountdown() {
  if (!room || state?.status !== 'playing') {
    clearCountdown();
    return;
  }
  const overlay = $('#round-countdown'),
    locked = countdownLocked();
  if (locked) {
    if (!countdownWasActive) {
      heldKeys.clear();
      resetInput();
      prediction.reset();
      correction = { x: 0, y: 0 };
      clearTimeout(announceTimer);
      $('#match-announcement').hidden = true;
    }
    countdownWasActive = true;
    countdownGoUntil = 0;
    // Animate against the estimated server clock, but never show GO before
    // an authoritative snapshot confirms the countdown has actually ended.
    const remaining = roundStartsAt() - Date.now() - serverOffset;
    const value = String(Math.max(1, Math.min(3, Math.ceil(remaining / 1000))));
    if (countdownValue !== value) {
      countdownValue = value;
      $('#countdown-value').textContent = value;
      tone(440, 0.08, 'square', 0.025);
    }
    $('#countdown-label').textContent = 'GET READY, CREW';
    $('#countdown-note').textContent = 'Same start. Every raccoon.';
    overlay.dataset.phase = 'ready';
    overlay.hidden = false;
  } else if (countdownWasActive) {
    countdownWasActive = false;
    heldKeys.clear();
    resetInput();
    prediction.reset();
    correction = { x: 0, y: 0 };
    countdownGoUntil = performance.now() + 800;
    countdownValue = 'GO!';
    $('#countdown-value').textContent = 'GO!';
    $('#countdown-label').textContent = 'LET THE MAYHEM BEGIN';
    $('#countdown-note').textContent = 'Three ways to win. Make one happen.';
    overlay.dataset.phase = 'go';
    overlay.hidden = false;
    playSound('start');
  } else if (performance.now() >= countdownGoUntil) {
    overlay.hidden = true;
  }
}
function resetInput() {
  heldKeys.clear();
  touchInput.reset();
  touchControls?.reset({ notify: false });
  resetPlayerInput(localInputBuffer);
  paintTouchInput();
  input = blankInput();
  sendInput({ reset: true });
}

function setConnection(online) {
  socketReady = online;
  $('#connection-status').textContent = online ? 'Server online' : 'Reconnecting';
  $('.server-status').classList.toggle('online', online);
}
// Keep players outside the arena until they have read and confirmed the briefing.
function joinAction(action) {
  pendingAction = null;
  pendingBriefingAction = { ...action };
  closeDialogs();
  $('#briefing-name').value = action.name || playerName();
  const mode = action.mode === 'xxl' ? 'XXL 60v60' : 'Classic 5v5';
  const listed = action.type === 'join' ? publicRooms.find((r) => r.code === action.code) : null;
  const destination = getMapDefinition(action.mapId || listed?.mapId || selectedMapId);
  $('#briefing-destination').textContent =
    action.type === 'create'
      ? `${destination.name} · ${mode}\n${action.roomName} · ${action.botCount} ${difficultyName(action.botDifficulty)} bots · ${action.role === 'worker' ? 'Worker' : 'Queen'}`
      : action.type === 'join'
        ? `Room ${action.code}${listed ? ` · ${destination.name} · ${difficultyName(listed.botDifficulty)} bots` : ''}`
        : `Quick play · ${destination.name} · ${mode}\n${difficultyName(action.botDifficulty)} bots`;
  showDialog('#briefing-dialog');
  $('#briefing-title').focus({ preventScroll: true });
}
function cancelBriefing() {
  pendingBriefingAction = null;
  pendingAction = null;
  if (!room && new URLSearchParams(location.search).has('room'))
    history.replaceState(null, '', location.pathname);
}
function confirmBriefing() {
  if (!pendingBriefingAction) return;
  const action = pendingBriefingAction;
  pendingBriefingAction = null;
  nameField.value = $('#briefing-name').value.trim().slice(0, 18) || 'Lenny';
  storage.set('mayhem-name', nameField.value);
  action.name = playerName();
  $('#briefing-dialog').close();
  unlockAudio();
  requestAction(action);
}
function requestAction(action) {
  if (!socketReady) {
    pendingAction = action;
    toast('Connecting to the arcade…');
    if (!socket || socket.readyState === WebSocket.CLOSED) connect();
    return;
  }
  send(action);
}
function connect() {
  clearTimeout(reconnectTimer);
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  const ws = new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?protocol=compact-v1`,
  );
  socket = ws;
  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    setConnection(true);
    connectionAttempt = 0;
    if (pendingAction) {
      send(pendingAction);
      pendingAction = null;
    } else if (room) {
      send({ type: 'join', code: room.code, name: playerName() });
    }
    send({ type: 'ping', time: performance.now() });
  });
  ws.addEventListener('message', (e) => {
    if (socket !== ws) return;
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    handleMessage(data);
  });
  ws.addEventListener('close', () => {
    if (socket !== ws) return;
    setConnection(false);
    resetInput();
    if (room) {
      $('#connection-overlay').hidden = false;
      $('#disconnect-message').textContent = 'Trying to reconnect to your room…';
      updateTouchControls();
    }
    reconnectTimer = setTimeout(
      connect,
      Math.min(6000, 1000 * 2 ** Math.min(connectionAttempt++, 3)),
    );
  });
  ws.addEventListener('error', () => {});
}
function handleMessage(data) {
  switch (data.type) {
    case 'welcome':
      localId = data.id;
      break;
    case 'rooms':
      renderRooms(data.rooms);
      break;
    case 'pong':
      recordPing(data.time);
      break;
    case 'joined':
      enterGame(data);
      break;
    case 'state':
      receiveState(decodeSnapshot(data));
      break;
    case 'map-changed':
      receiveMapChange(data);
      break;
    case 'left':
      goHome();
      break;
    case 'error':
      toast(data.message);
      roomDestinationSignature = '';
      updateRoomDestination();
      if (room && !$('#connection-overlay').hidden)
        $('#disconnect-message').textContent = data.message;
      break;
  }
}
function recordPing(sentAt) {
  if (!Number.isFinite(sentAt)) return;
  const sample = Math.max(0, performance.now() - sentAt);
  pingSamples.push(sample);
  if (pingSamples.length > 20) pingSamples.shift();
  const sorted = [...pingSamples].sort((a, b) => a - b);
  // Prediction uses a robust estimate; the HUD still displays the latest real RTT.
  ping = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  $('#ping').textContent = `${Math.round(sample)} ms`;
  $('#ping').style.color = sample > 150 ? '#ffb58a' : '#cce8c3';
  $('#ping').title =
    `Round-trip latency: latest ${Math.round(sample)} ms · median ${Math.round(ping)} ms · p95 ${Math.round(p95)} ms (${sorted.length} samples)`;
  $('#network-detail').textContent =
    `NETWORK ROUND TRIP · Latest ${Math.round(sample)} ms / typical ${Math.round(ping)} ms / p95 ${Math.round(p95)} ms. Includes the route to this server; FPS is measured separately.`;
}
function enterGame(data) {
  closeDialogs();
  room = { ...data.room, code: data.code, hostId: data.hostId };
  map = data.map;
  room.mapId ||= map.mapId || DEFAULT_MAP_ID;
  roomDestinationSignature = '';
  localId = data.id;
  state = null;
  predicted = null;
  correction = { x: 0, y: 0 };
  seenEvents.clear();
  lastStatus = '';
  seq = 0;
  prediction.reset();
  rolePickerSignature = '';
  scoreboardSignature = '';
  resultScene = null;
  clearCountdown();
  $('#home').hidden = true;
  $('#game').hidden = false;
  $('#game').dataset.mode = map.mode;
  document.body.classList.add('playing');
  $('#connection-overlay').hidden = true;
  $('#respawn-overlay').hidden = true;
  setScoreboard(false);
  resetActivityFeed();
  $('#game-code').textContent = room.code;
  $('#match-mode').textContent = room.mode === 'xxl' ? 'XXL · UP TO 120' : 'CLASSIC · 5 VS 5';
  $$('.score-target').forEach((el) => (el.textContent = `/ ${map.scoreTarget} DATA`));
  if (!gameRenderer) gameRenderer = new Renderer($('#game-canvas'));
  gameRenderer.setNameMode(nameMode);
  gameRenderer.setMap(map);
  gameRenderer.resize();
  if (data.players?.length)
    gameRenderer.setState(
      {
        players: data.players,
        berries: [],
        scores: [0, 0],
        queenLives: [3, 3],
        events: [],
        time: Date.now(),
      },
      localId,
    );
  history.replaceState(null, '', `${location.pathname}?room=${room.code}`);
  $('#game-canvas').focus();
  unlockAudio();
  updateTouchLayout();
  updateRoomDestination();
  for (const id of ['#menu-bots', '#lobby-bots']) {
    const field = $(id);
    field.max = room.maxPlayers - 1;
    field.value = data.room.botTarget ?? data.room.botCount ?? (room.mode === 'xxl' ? 23 : 9);
    field.dataset.botTarget = field.value;
  }
}
function receiveState(data) {
  if (!room) return;
  // The target follows the lobby roster, then stays fixed for the whole round.
  // Renderer and victory panels share this map, so update it before either reads it.
  if (
    Number.isInteger(data.scoreTarget) &&
    data.scoreTarget > 0 &&
    data.scoreTarget !== map.scoreTarget
  ) {
    map.scoreTarget = data.scoreTarget;
    $$('.score-target').forEach((el) => (el.textContent = `/ ${map.scoreTarget} DATA`));
  }
  for (const field of ['resourceCount', 'economyPlayerCount'])
    if (Number.isFinite(data[field])) map[field] = data[field];
  lastSnapshot = performance.now();
  serverOffset = data.time - Date.now() + ping / 2;
  const authoritative = data.players.find((p) => p.id === localId);
  if (authoritative) {
    const before = predicted
      ? { x: predicted.x + correction.x, y: predicted.y + correction.y }
      : null;
    const wasAlive = predicted?.alive;
    predicted = prediction.reconcile(authoritative, {
      ack: data.ack ?? authoritative.ack,
      map,
      receivedAt: lastSnapshot,
      serverTime: data.time,
      active: data.status === 'playing' && !countdownLocked(data),
      riding: data.gator.riderId === localId,
      resetKey: `${room.code}:${room.mapRevision || 1}`,
    });
    if (
      before &&
      wasAlive === predicted.alive &&
      Math.hypot(before.x - predicted.x, before.y - predicted.y) < 140
    ) {
      correction.x = before.x - predicted.x;
      correction.y = before.y - predicted.y;
    } else {
      correction = { x: 0, y: 0 };
    }
  }
  state = data;
  room.hostId = data.hostId;
  room.mapId = data.mapId || room.mapId;
  room.mapName = data.mapName || room.mapName;
  room.mapRevision = data.mapRevision || room.mapRevision;
  room.botDifficulty = validDifficulty(data.botDifficulty ?? room.botDifficulty);
  gameRenderer.setState(data, localId);
  if (data.status !== lastStatus) {
    if (data.status === 'waiting') {
      closeDialogs();
      rolePickerSignature = '';
    }
    if (data.status === 'playing') {
      closeDialogs();
      if (!roundStartsAt(data)) {
        showAnnouncement('LET THE TRASH TALK BEGIN!');
        playSound('start');
      }
    }
    if (data.status === 'ended') showResults();
    lastStatus = data.status;
  }
  for (const event of data.events || []) {
    if (seenEvents.has(event.id)) continue;
    seenEvents.add(event.id);
    if (seenEvents.size > 1000) seenEvents.delete(seenEvents.values().next().value);
    if (event.type !== 'start' && authoritative && Math.abs(event.x - authoritative.x) < 650)
      playSound(event.type);
  }
  renderActivityFeed(
    activityFeed.consume(data.events || [], {
      localId,
      localPlayer: authoritative,
      mode: room.mode,
      now: performance.now(),
    }),
  );
  updateCountdown();
  updateHUD(authoritative);
}
function updateHUD(player) {
  if (!state) return;
  const destination = currentDestination();
  updateRoomDestination();
  for (let t = 0; t < 2; t++) {
    $(`#score-${t}`).textContent = state.scores[t];
    $(`#progress-${t}`).style.width =
      `${Math.min(100, (100 * state.scores[t]) / map.scoreTarget)}%`;
    const quota = state.queenQuota?.[t] ?? 1,
      alive = state.queensRemaining?.[t] ?? Number(state.queenLives[t] > 0);
    $(`#lives-${t}`).textContent =
      quota > 1
        ? `${alive}/${quota} ♛ · ${state.queenLives[t]} ♥`
        : '♛ '.repeat(Math.max(0, state.queenLives[t])) || '—';
    $(`#lives-${t}`).title =
      `${alive} of ${quota} queens remaining · ${state.queenLives[t]} total lives`;
    $(`#lives-${t}`).classList.toggle('many-queens', quota > 1);
  }
  const secs = Math.max(
    0,
    Math.floor(state.elapsedSeconds ?? (state.victory?.durationMs || 0) / 1000),
  );
  $('#match-clock').textContent =
    state.status === 'waiting' ? 'LOBBY' : countdownLocked() ? 'GET READY' : formatTime(secs);
  $('#match-clock').title = 'Round elapsed time · win by an objective, not a timer';
  $('#game-players').textContent =
    `${state.playerCount} HUMAN${state.playerCount === 1 ? '' : 'S'} · ${state.botCount} CPU`;
  $('#gator-marker').style.left =
    `${Math.min(98, Math.max(0, ((state.gator.progress || 0) + 1) * 50))}%`;
  $('#waiting-banner').hidden = state.status !== 'waiting';
  if ($('#host-bots-control')) $('#host-bots-control').hidden = room.hostId !== localId;
  if ($('#current-bot-count'))
    $('#current-bot-count').textContent =
      state.status === 'playing'
        ? `${state.botCount} bot${state.botCount === 1 ? '' : 's'} · change between rounds`
        : `${state.botCount} bot${state.botCount === 1 ? '' : 's'} in this room`;
  $('#apply-bots').disabled = state.status === 'playing';
  $('#menu-bots').disabled = state.status === 'playing';
  $('#lobby-bot-count-control').hidden = room.hostId !== localId;
  $('#lobby-current-bot-count').textContent =
    `${state.botCount} bot${state.botCount === 1 ? '' : 's'} in the room`;
  for (const id of ['#lobby-bots', '#menu-bots']) {
    const field = $(id);
    field.max = room.maxPlayers - 1;
    field.disabled = room.hostId !== localId || state.status === 'playing';
    const target = String(state.configuredBots ?? state.botCount);
    if (document.activeElement !== field && field.dataset.botTarget !== target) {
      field.value = target;
      field.dataset.botTarget = target;
    }
  }
  $('#lobby-apply-bots').disabled = room.hostId !== localId || state.status !== 'waiting';
  const difficulty = validDifficulty(state.botDifficulty ?? room.botDifficulty),
    host = room.hostId === localId;
  for (const select of $$('[data-room-difficulty]')) {
    select.value = difficulty;
    select.disabled = !host || state.status === 'playing';
  }
  $('#lobby-difficulty-control').hidden = !host;
  $('#lobby-difficulty-title').hidden = host;
  $('#lobby-difficulty-title').textContent = `${difficultyName(difficulty).toUpperCase()} BOTS`;
  $('#lobby-difficulty-description').textContent = DIFFICULTY_COPY[difficulty];
  $('#menu-difficulty-description').textContent =
    state.status === 'playing'
      ? `${DIFFICULTY_COPY[difficulty]} · Change between rounds`
      : DIFFICULTY_COPY[difficulty];

  if (player) {
    const role = player.role;
    $('#role-icon').textContent = role === 'queen' ? '♛' : role === 'warrior' ? '⚔' : '▣';
    $('#role-name').textContent =
      `${role === 'queen' ? 'QUEEN' : role === 'warrior' ? 'WARRIOR' : 'WORKER'} ${player.name || 'Lenny'}`.toUpperCase();
    $('#role-tip').textContent =
      state.status === 'waiting'
        ? 'Choose your role · One queen slot per five teammates'
        : countdownLocked()
          ? 'Get ready · Movement starts on GO'
          : player.upgradeUntil > Date.now() + serverOffset
            ? `Installing ${player.upgradeKind === 'speed' ? 'speed' : 'wings'}… Stay inside the AI1 station.`
            : state.gator.riderId === localId
              ? `${destination.ride.name} engaged. Jump to hop off.`
              : role === 'queen'
                ? 'Tap Space to fly · S / Shift to dive · Touch AI1 to claim'
                : role === 'warrior'
                  ? 'Tap Space to fly · Strike from above · Defend the crew'
                  : player.carrying
                    ? 'Deliver to HQ, or enter AI1 and press E to install an upgrade.'
                    : `${player.speedBoost ? 'SPEED BOOST · ' : ''}Roboflow supply piles · E for ${destination.ride.name} / AI1`;
    $('#carrying-tag').hidden = !player.carrying;
    $('#respawn-overlay').hidden = player.alive || state.status !== 'playing';
    if (touchEnabled)
      $('#role-tip').textContent = $('#role-tip')
        .textContent.replace('Tap Space', 'Tap FLAP')
        .replace('S / Shift', 'DIVE or joystick ↓')
        .replace('Jump to hop off.', 'Tap JUMP to hop off.')
        .replace('press E', 'tap USE CHIP')
        .replace('E for ', 'ACTION for ');
    if (!player.alive) {
      const eliminated = Boolean(player.eliminated);
      $('#respawn-title').textContent = eliminated ? 'QUEEN ELIMINATED.' : 'YOU’VE BEEN BONKED.';
      $('#respawn-message').hidden = eliminated;
      $('#eliminated-message').hidden = !eliminated;
      if (!eliminated)
        $('#respawn-count').textContent = Math.max(
          0,
          Math.ceil((player.respawnAt - Date.now() - serverOffset) / 1000),
        );
    }
    if ($('#swap-role'))
      $('#swap-role').textContent =
        state.status === 'playing' ? 'R · ROLE GUIDE' : 'R · CHOOSE ROLE';
  }
  renderRoleSelection();
  if (!$('#scoreboard').hidden) renderScoreboard();
  updateTouchControls(player);
}
function resetActivityFeed() {
  activityFeed.reset();
  activityRows.clear();
  activitySignature = '';
  const container = $('#game-feed');
  container.replaceChildren();
  container.hidden = true;
  activityList = document.createElement('div');
  activityList.className = 'feed-list';
  container.setAttribute('aria-label', 'Live match activity');
  container.setAttribute('aria-relevant', 'additions text');
  container.append(activityList);
}
function activityCopy(entry) {
  const count = Math.max(1, entry.count || 1),
    chip = count === 1 ? 'chip' : 'chips';
  switch (entry.type) {
    case 'ko':
      return { action: 'KO', description: 'eliminated', target: entry.target };
    case 'pickup':
      return {
        action: `picked +${count}`,
        description: `collected ${count} Roboflow data ${chip}`,
      };
    case 'deposit':
      return {
        action: `banked +${count}`,
        description: `delivered ${count} data ${chip} to ${entry.actor?.team === 1 ? 'Sunset' : 'Purple'} HQ`,
      };
    case 'upgrade':
      return { action: entry.upgradeKind === 'speed' ? 'gained speed' : 'gained wings' };
    case 'ride':
      return { action: `rides ${currentDestination().ride.name}` };
    case 'gate':
      return { action: 'claimed AI1' };
    default:
      return { action: entry.text || 'joined the action' };
  }
}
function createActivityRow() {
  const node = document.createElement('div');
  node.className = 'feed-item';
  node.setAttribute('aria-atomic', 'true');
  const actor = document.createElement('strong');
  actor.className = 'feed-actor feed-person';
  const action = document.createElement('span');
  action.className = 'feed-action';
  const target = document.createElement('span');
  target.className = 'feed-target feed-person';
  node.append(actor, action, target);
  return { node, actor, action, target, signature: '' };
}
function renderActivityFeed(entries) {
  // Snapshots arrive frequently. Only touch the DOM when visible content changes.
  if (!activityList) resetActivityFeed();
  if ((touchEnabled && innerHeight <= 600) || innerWidth <= 760) {
    entries = [...entries]
      .sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt || b.order - a.order)
      .slice(0, 2);
    entries.sort((a, b) => a.updatedAt - b.updatedAt || a.order - b.order);
  }
  const signature = JSON.stringify(
    entries.map((entry) => [
      entry.id ?? entry.key,
      entry.type,
      entry.actor,
      entry.target,
      entry.count,
      entry.text,
      entry.upgradeKind,
    ]),
  );
  if (signature === activitySignature) return;
  activitySignature = signature;
  const previousPositions = new Map(
    [...activityRows].map(([key, row]) => [key, row.node.getBoundingClientRect().top]),
  );
  const keys = new Set(entries.map((entry) => entry.id ?? entry.key));
  for (const [key, row] of activityRows) {
    if (!keys.has(key)) {
      row.node.remove();
      activityRows.delete(key);
    }
  }
  const added = [];
  entries.forEach((entry, index) => {
    const key = entry.id ?? entry.key;
    let row = activityRows.get(key);
    if (!row) {
      row = createActivityRow();
      activityRows.set(key, row);
      added.push(row.node);
    }
    const rowSignature = JSON.stringify([
      entry.type,
      entry.actor,
      entry.target,
      entry.count,
      entry.text,
      entry.upgradeKind,
    ]);
    if (row.signature !== rowSignature) {
      row.signature = rowSignature;
      const copy = activityCopy(entry),
        actorName = entry.actor?.name || 'A raccoon';
      row.node.dataset.kind = entry.type;
      row.node.dataset.team = entry.actor?.team ?? entry.team ?? 0;
      row.actor.textContent = actorName;
      row.actor.dataset.team = entry.actor?.team ?? entry.team ?? 0;
      row.actor.title = actorName;
      row.action.textContent = copy.action;
      row.target.hidden = !copy.target;
      row.target.textContent = copy.target?.name || '';
      row.target.dataset.team = copy.target?.team ?? 0;
      row.target.title = copy.target?.name || '';
      const description = `${actorName} ${copy.description || copy.action}${copy.target?.name ? ` ${copy.target.name}` : ''}`;
      row.node.setAttribute('aria-label', description);
      row.node.title = description;
    }
    if (activityList.children[index] !== row.node)
      activityList.insertBefore(row.node, activityList.children[index] || null);
  });
  $('#game-feed').hidden = entries.length === 0;
  if (!reducedMotion.matches) {
    for (const [key, row] of activityRows) {
      const previousTop = previousPositions.get(key),
        delta = previousTop === undefined ? 0 : previousTop - row.node.getBoundingClientRect().top;
      if (delta)
        row.node.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'ease-out' },
        );
    }
    for (const node of added)
      node.animate(
        [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 180, easing: 'ease-out' },
      );
  }
}
function renderScoreboard() {
  const players = state?.players || [],
    signature = JSON.stringify([
      room?.mode,
      localId,
      players.map((p) => [p.id, p.name, p.team, p.role, p.bot, p.score, p.kills]),
    ]);
  // Position snapshots arrive much more often than crew statistics change.
  if (signature === scoreboardSignature) return;
  scoreboardSignature = signature;
  const container = $('#scoreboard-players');
  container.replaceChildren();
  const label = document.createElement('p');
  label.textContent =
    room?.mode === 'xxl'
      ? 'Nearby crew · XXL only streams players near your camera'
      : 'Your crew · DATA delivered / BONKS';
  container.append(label);
  for (const p of [...players].sort(
    (a, b) =>
      a.team - b.team ||
      Number(b.role === 'queen') - Number(a.role === 'queen') ||
      b.score - a.score,
  )) {
    const row = document.createElement('div');
    row.className = 'scoreboard-row';
    row.dataset.team = p.team;
    for (const value of [
      p.role === 'queen' ? '♛' : p.role === 'warrior' ? '⚔' : '▣',
      `${p.name}${p.id === localId ? ' (YOU)' : ''}${p.bot ? ' · CPU' : ''}`,
      `${p.score} DATA`,
      `${p.kills} KO`,
    ]) {
      const span = document.createElement('span');
      span.textContent = value;
      row.append(span);
    }
    container.append(row);
  }
}
function setScoreboard(open) {
  $('#scoreboard').hidden = !open;
  $('#touch-crew').setAttribute('aria-pressed', String(open));
  if (open) renderScoreboard();
  updateTouchControls();
}
function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function roleRoster() {
  return state?.lobbyPlayers || state?.players || [];
}
function renderRoleSelection(force = false) {
  if (!state || !room) return;
  // Result actions follow host changes independently of lobby rendering.
  if (state.status === 'ended') {
    $('#rematch').disabled = room.hostId !== localId;
    $('#rematch').textContent =
      room.hostId === localId ? 'NEXT ROUND LOBBY ↻' : 'WAITING FOR HOST’S NEXT ROUND';
  }
  if (!force && state.status === 'playing' && !$('#role-dialog').open) return;
  const roster = roleRoster(),
    me = roster.find((p) => p.id === localId) || predicted;
  if (!me) return;
  const team = roster.filter((p) => p.team === me.team),
    queens = team.filter((p) => p.role === 'queen'),
    quota = state.queenQuota?.[me.team] ?? Math.ceil(team.length / 5),
    cpuQueen = queens.find((p) => p.bot);
  const myQueen = me.role === 'queen';
  const editable = state.status === 'waiting' || state.status === 'ended';
  const signature = JSON.stringify([
    state.status,
    localId,
    room.hostId,
    me.team,
    me.role,
    room.mode,
    room.mapId,
    room.botDifficulty,
    map.scoreTarget,
    map.economyPlayerCount,
    state.queenQuota,
    roster.map((p) => [p.id, p.name, p.team, p.role, p.bot]),
  ]);
  if (!force && signature === rolePickerSignature) return;
  rolePickerSignature = signature;
  const unavailableQueen = !myQueen && queens.length >= quota && !cpuQueen;
  for (const button of $$('[data-pick-role]')) {
    const wanted = button.dataset.pickRole,
      selected = me.role === wanted;
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = !editable || (wanted === 'queen' && unavailableQueen);
    button.querySelector('em').textContent = selected
      ? 'YOUR ROLE'
      : !editable
        ? 'LOCKED THIS ROUND'
        : wanted === 'queen'
          ? unavailableQueen
            ? 'CROWN TAKEN'
            : cpuQueen
              ? 'REPLACE CPU QUEEN'
              : 'TAKE THE CROWN'
          : 'JOIN THE CREW';
  }
  const note = !editable
    ? 'Roles are locked. Workers can earn wings at AI1 stations with one chip.'
    : unavailableQueen
      ? `All ${quota} Queen ${quota === 1 ? 'seat is' : 'seats are'} taken. Choose Worker.`
      : myQueen
        ? `Your Queen has 3 lives. Protect them.`
        : cpuQueen
          ? `You can take a bot’s Queen seat before the round.`
          : `Queen seats: ${queens.length}/${quota}. Workers earn wings at AI1 stations.`;
  $('#lobby-role-note').textContent = note;
  $('#dialog-role-note').textContent = note;
  $('#lobby-team-label').textContent =
    `${TEAM_NAMES[me.team]} · ${team.length}/${room.maxPlayers / 2} CREW`;
  $('#role-dialog-eyebrow').textContent = TEAM_NAMES[me.team];
  $('#role-dialog-title').textContent = editable
    ? 'Pick your starting role.'
    : 'Earn your next upgrade.';
  // During play only the role guide is visible. Camera streaming must not
  // rebuild an invisible lobby roster whenever nearby players change.
  if (!editable) return;
  $('#lobby-rules').textContent =
    `Win: ${map.scoreTarget} chips · all enemy Queens · your getaway home`;
  const readiness = getLobbyReadiness(roster),
    isLeader = room.hostId === localId;
  const leader = roster.find((p) => p.id === room.hostId),
    leaderName = leader?.name || 'the room leader';
  $('#lobby-leader').textContent = `Leader: ${leaderName}${isLeader ? ' (you)' : ''}`;
  const humans = roster.filter((p) => !p.bot).length,
    bots = roster.length - humans;
  $('#lobby-population').textContent =
    `${humans} player${humans === 1 ? '' : 's'} + ${bots} bot${bots === 1 ? '' : 's'} · ${roster.length}/${room.maxPlayers}`;
  const missing = readiness.teams
    .filter((t) => t.queens !== t.quota)
    .map((t) =>
      t.queens < t.quota
        ? `${TEAM_NAMES[t.team]} needs ${t.quota - t.queens} Queen${t.quota - t.queens === 1 ? '' : 's'}`
        : `${TEAM_NAMES[t.team]} has ${t.queens - t.quota} extra Queen${t.queens - t.quota === 1 ? '' : 's'} — choose Worker to free the extra crown`,
    );
  const title =
    readiness.reason === 'players'
      ? 'WAITING FOR PLAYERS'
      : readiness.reason === 'queens'
        ? 'WAITING FOR QUEENS'
        : isLeader
          ? 'READY TO START'
          : 'WAITING FOR THE LEADER';
  $('#lobby-status-title').textContent = title;
  const explanation =
    readiness.reason === 'players'
      ? 'Add a player or bot to each team.'
      : readiness.reason === 'queens'
        ? `${missing.join(' · ')}.`
        : isLeader
          ? 'Your crew is ready.'
          : `${leaderName} will start the match.`;
  $('#lobby-status-detail').textContent = explanation;
  $('#waiting-banner').dataset.ready = String(readiness.ready);
  const holder = $('#lobby-roster');
  holder.replaceChildren();
  for (const stats of readiness.teams) {
    const t = stats.team,
      members = roster.filter((p) => p.team === t),
      capacity = room.maxPlayers / 2,
      current = me.team === t;
    const card = document.createElement('section');
    card.className = 'lobby-team';
    card.dataset.team = t;
    card.dataset.current = String(current);
    card.setAttribute('aria-label', `${TEAM_NAMES[t]} roster`);
    const heading = document.createElement('div');
    heading.className = 'lobby-team-heading';
    const name = document.createElement('b');
    name.textContent = TEAM_NAMES[t];
    const count = document.createElement('small');
    count.textContent = `${stats.count}/${capacity} players`;
    const crown = document.createElement('small');
    crown.textContent = `${stats.queens}/${stats.quota} Queen${stats.quota === 1 ? '' : 's'}`;
    heading.append(name, count, crown);
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'lobby-join-team';
    join.dataset.pickTeam = String(t);
    const full = stats.count >= capacity && stats.bots === 0;
    join.disabled = current || state.status !== 'waiting' || full;
    join.textContent = current
      ? 'YOUR TEAM ✓'
      : full
        ? 'TEAM FULL'
        : `JOIN ${t === 0 ? 'PURPLE' : 'SUNSET'} →`;
    join.setAttribute(
      'aria-label',
      current ? `Your team: ${TEAM_NAMES[t]}` : `Join ${TEAM_NAMES[t]}`,
    );
    join.addEventListener('click', () => {
      if (state?.status === 'waiting') send({ type: 'team', team: t });
    });
    card.append(heading, join);
    if (!members.length) {
      const empty = document.createElement('p');
      empty.className = 'lobby-team-empty';
      empty.textContent = 'Waiting for players. Join this team!';
      card.append(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'lobby-members';
      list.setAttribute('aria-label', `${TEAM_NAMES[t]} players`);
      for (const member of [...members].sort(
        (a, b) =>
          Number(a.bot) - Number(b.bot) ||
          Number(b.id === room.hostId) - Number(a.id === room.hostId) ||
          Number(b.role === 'queen') - Number(a.role === 'queen'),
      )) {
        const row = document.createElement('li');
        row.className = 'lobby-member';
        row.dataset.self = String(member.id === localId);
        const role = document.createElement('span');
        role.className = 'lobby-member-role';
        role.textContent = member.role === 'queen' ? '♛' : '▣';
        role.setAttribute('aria-label', member.role === 'queen' ? 'Queen' : 'Worker');
        const label = document.createElement('span');
        label.className = 'lobby-member-name';
        label.textContent = member.name;
        label.title = member.name;
        const tags = document.createElement('span');
        tags.className = 'lobby-member-tags';
        tags.textContent = [
          member.id === room.hostId ? 'LEADER' : '',
          member.id === localId ? 'YOU' : '',
          member.bot ? 'BOT' : '',
        ]
          .filter(Boolean)
          .join(' · ');
        row.append(role, label, tags);
        list.append(row);
      }
      card.append(list);
    }
    holder.append(card);
  }
  const start = $('#start-match');
  start.hidden = false;
  start.disabled = !isLeader || !readiness.ready || state.status !== 'waiting';
  start.textContent = !isLeader
    ? 'WAITING FOR LEADER'
    : readiness.reason === 'players'
      ? 'WAITING FOR PLAYERS'
      : readiness.reason === 'queens'
        ? 'WAITING FOR QUEENS'
        : 'START MATCH ↗';
  start.setAttribute('aria-describedby', 'lobby-status-detail');
}
function chooseRole(role) {
  if (!room || !state) return;
  if (state.status === 'playing') {
    toast('Queen seats are locked. Enter an AI1 station with a chip to earn wings.');
    return;
  }
  send({ type: 'role', role });
}
function openRoleGuide() {
  if (!room) return;
  renderRoleSelection(true);
  showDialog('#role-dialog');
}
const VICTORY_COPY = {
  military: {
    label: 'MILITARY VICTORY',
    headline: 'LONG LIVE THE QUEEN.',
    reason: 'Every rival queen has been eliminated. Three lives per queen. No crowns left.',
    actor: 'landed the final royal knockout.',
  },
  economic: {
    label: 'ECONOMIC VICTORY',
    headline: 'DATA SECURED. TRASH TALK EARNED.',
    reason: 'Every slot in the winning team’s data vault is full.',
    actor: 'delivered the winning data chip.',
  },
  gator: {
    label: 'RIDE VICTORY',
    headline: 'SLOW RIDE. BIG FINISH.',
    reason: 'A worker brought the getaway ride all the way into their team’s finish arch.',
    actor: 'brought the getaway ride home.',
  },
};
function showResults() {
  resetInput();
  const destination = currentDestination();
  const winner = state.winner,
    type =
      state.winType ||
      state.victory?.type ||
      (/DATA/.test(state.winReason)
        ? 'economic'
        : /GATOR/.test(state.winReason)
          ? 'gator'
          : 'military'),
    copy =
      type === 'gator'
        ? {
            ...VICTORY_COPY.gator,
            label: `${destination.ride.name.toUpperCase()} VICTORY`,
            reason: `A worker rode the ${destination.ride.name} all the way into their team’s finish arch.`,
            actor: `brought the ${destination.ride.name} home.`,
          }
        : VICTORY_COPY[type] || VICTORY_COPY.military;
  const victory = state.victory || {},
    dialog = $('#results-dialog');
  dialog.dataset.victory = type;
  dialog.dataset.team = winner;
  dialog.dataset.outcome = predicted?.team === winner ? 'won' : 'lost';
  $('#victory-type').textContent = copy.label;
  $('#victory-location').textContent = `${destination.name.toUpperCase()} · ROUND COMPLETE`;
  $('#results-location').textContent = `YOUR ROUND IN ${destination.name.toUpperCase()}`;
  $('#victory-headline').textContent = copy.headline;
  $('#winner-title').textContent = `${TEAM_NAMES[winner] || 'THE CREW'} WIN!`;
  $('#winner-reason').textContent = copy.reason;
  $('#victory-duration').textContent =
    `ROUND ${formatTime((victory.durationMs || 0) / 1000 || state.elapsedSeconds || 0)}`;
  $('#victory-actor').textContent = victory.actorName
    ? `${victory.actorName} ${copy.actor}`
    : 'One crew. One decisive play.';
  const objectives = $('#victory-objectives');
  objectives.replaceChildren();
  const data = victory.data || state.scores,
    lives = victory.queenLives || state.queenLives,
    progress = Number.isFinite(victory.gatorProgress)
      ? victory.gatorProgress
      : state.gator.progress || 0;
  for (const [key, title, values] of [
    [
      'economic',
      '▣ DATA VAULT',
      [`${data[0]} / ${map.scoreTarget}`, `${data[1]} / ${map.scoreTarget}`],
    ],
    [
      'military',
      '♛ QUEEN LIVES',
      [
        `${lives[0]} / ${(victory.queenQuota || state.queenQuota || [1, 1])[0] * 3}`,
        `${lives[1]} / ${(victory.queenQuota || state.queenQuota || [1, 1])[1] * 3}`,
      ],
    ],
    [
      'gator',
      `≈ ${destination.ride.name.toUpperCase()} ROUTE`,
      [
        `${Math.round(Math.max(0, -progress) * 100)}% HOME`,
        `${Math.round(Math.max(0, progress) * 100)}% HOME`,
      ],
    ],
  ]) {
    const card = document.createElement('section');
    card.className = 'victory-objective';
    card.dataset.winning = String(key === type);
    const heading = document.createElement('h3');
    heading.textContent = title;
    card.append(heading);
    for (let t = 0; t < 2; t++) {
      const row = document.createElement('div');
      row.dataset.team = t;
      const name = document.createElement('span');
      name.textContent = t === 0 ? 'PURPLE' : 'SUNSET';
      const value = document.createElement('strong');
      value.textContent = values[t];
      row.append(name, value);
      card.append(row);
    }
    if (key === type) {
      const badge = document.createElement('small');
      badge.textContent = 'WINNING OBJECTIVE';
      card.append(badge);
    }
    objectives.append(card);
  }
  const container = $('#results-stats');
  container.replaceChildren();
  const me = state.players.find((p) => p.id === localId) || predicted;
  for (const [value, label] of [
    [me?.score || 0, 'DATA DELIVERED'],
    [me?.kills || 0, 'KNOCKOUTS'],
  ]) {
    const d = document.createElement('div'),
      n = document.createElement('strong'),
      labelNode = document.createElement('span');
    n.textContent = value;
    labelNode.textContent = label;
    d.append(n, labelNode);
    container.append(d);
  }
  const confetti = $('.victory-confetti');
  confetti.replaceChildren();
  for (let i = 0; i < 22; i++) {
    const bit = document.createElement('i');
    bit.style.setProperty('--i', i);
    bit.style.left = `${(i * 37) % 100}%`;
    bit.style.animationDelay = `-${(i % 8) * 0.3}s`;
    confetti.append(bit);
  }
  resultScene = { type, team: winner, mapId: destination.id, started: performance.now() };
  $('#rematch').disabled = room.hostId !== localId;
  $('#rematch').textContent =
    room.hostId === localId ? 'NEXT ROUND LOBBY ↻' : 'WAITING FOR HOST’S NEXT ROUND';
  showDialog('#results-dialog');
  $('#winner-title').focus({ preventScroll: true });
  playSound('win');
}
function renderVictoryScene(now) {
  if (!resultScene || !$('#results-dialog').open) return;
  const canvas = $('#victory-scene'),
    ctx = canvas.getContext('2d'),
    t = reducedMotion.matches ? 0 : (now - resultScene.started) / 1000,
    team = resultScene.team;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = TEAM[team].main;
  ctx.globalAlpha = 0.13;
  for (let i = 0; i < 5; i++) ctx.fillRect(200 - i * 18, 110 - i * 17, 200 + i * 36, 5);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(300, resultScene.type === 'gator' ? 115 : 124);
  const scale = resultScene.type === 'gator' ? 1.35 : 2;
  ctx.scale(scale, scale);
  const p = {
    x: -14,
    y: -42,
    team,
    role: resultScene.type === 'military' ? 'queen' : 'worker',
    facing: 1,
    grounded: true,
    alive: true,
    vx: 0,
    vy: 0,
    carrying: resultScene.type === 'economic',
  };
  if (resultScene.type === 'gator') {
    drawRide(ctx, { x: 0, y: -2, riderId: 'winner' }, t, team, resultScene.mapId);
    p.x = -14;
    p.y = -66;
    drawRaccoon(ctx, p, t, { state: 'ride', mapId: resultScene.mapId });
  } else {
    drawRaccoon(ctx, p, t, { state: 'idle', mapId: resultScene.mapId });
    if (resultScene.type === 'economic')
      for (let i = 0; i < 6; i++)
        drawData(ctx, (i < 3 ? -1 : 1) * (35 + (i % 3) * 18), -8 - (i % 3) * 12, t + i, 0.75);
    else {
      ctx.fillStyle = '#ffdf66';
      ctx.font = '26px serif';
      ctx.textAlign = 'center';
      ctx.fillText('✦', -45, -25 - Math.sin(t * 2) * 3);
      ctx.fillText('✦', 45, -25 + Math.sin(t * 2) * 3);
    }
  }
  ctx.restore();
}

function goHome() {
  setScoreboard(false);
  pendingAction = null;
  pendingBriefingAction = null;
  resetInput();
  room = null;
  state = null;
  predicted = null;
  map = null;
  prediction.reset();
  resultScene = null;
  rolePickerSignature = '';
  scoreboardSignature = '';
  clearCountdown();
  resetActivityFeed();
  closeDialogs();
  $('#game').hidden = true;
  $('#home').hidden = false;
  document.body.classList.remove('playing');
  history.replaceState(null, '', location.pathname);
  refreshRooms();
  window.scrollTo(0, 0);
  if (fullscreenElement()) void toggleGameFullscreen($('#game'));
  try {
    screen.orientation?.unlock?.();
  } catch {}
  updateTouchLayout();
}
function leaveGame() {
  send({ type: 'leave' });
  goHome();
}
function renderRooms(rooms) {
  publicRooms = rooms;
  $('#room-count').textContent = rooms.length;
  const container = $('#room-list');
  if (!rooms.length) {
    container.innerHTML =
      '<div class="empty-rooms"><span aria-hidden="true">✳</span><div><strong>Start the next rumble.</strong><p>Choose a destination, create a room, and bring your crew.</p></div><button class="text-button">CREATE ROOM ↗</button></div>';
    container.querySelector('button').addEventListener('click', openCreate);
    return;
  }
  container.replaceChildren();
  for (const r of rooms) {
    const row = document.createElement('div');
    row.className = 'room-row';
    row.dataset.roomCode = r.code;
    const info = document.createElement('div');
    info.className = 'room-info';
    const title = document.createElement('span');
    title.className = 'room-name';
    title.textContent = r.name;
    title.title = r.name;
    const mode = document.createElement('span');
    mode.className = 'room-mode';
    mode.textContent = r.mode === 'xxl' ? 'XXL' : 'CLASSIC';
    const difficulty = document.createElement('span');
    difficulty.className = 'room-difficulty';
    difficulty.textContent = `${difficultyName(r.botDifficulty)} CPU`;
    difficulty.title = DIFFICULTY_COPY[validDifficulty(r.botDifficulty)];
    info.append(title, mode, difficulty);
    const meta = document.createElement('div');
    meta.className = 'room-meta';
    const destination = getMapDefinition(r.mapId);
    const mapName = document.createElement('span');
    mapName.className = 'room-map';
    mapName.textContent = destination.name;
    mapName.title = `${destination.name} · ${destination.subtitle}`;
    row.dataset.mapId = destination.id;
    const occupancy = document.createElement('span');
    occupancy.className = 'room-occupancy';
    occupancy.textContent = `${r.players}/${r.maxPlayers} PLAYERS · ${r.bots || 0} BOTS`;
    const status = document.createElement('span');
    status.className = 'room-status';
    status.dataset.playing = String(r.status === 'playing');
    status.textContent =
      r.status === 'playing' ? 'IN PROGRESS' : r.status === 'ended' ? 'NEXT ROUND' : 'IN LOBBY';
    meta.append(mapName, occupancy, status);
    const join = document.createElement('button');
    join.textContent = r.players >= r.maxPlayers ? 'FULL' : 'JOIN ↗';
    join.disabled = r.players >= r.maxPlayers;
    join.setAttribute('aria-label', `Join ${r.name}`);
    join.addEventListener('click', () =>
      joinAction({ type: 'join', code: r.code, name: playerName() }),
    );
    row.append(info, meta, join);
    container.append(row);
  }
}
async function refreshRooms() {
  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderRooms(data.rooms || []);
  } catch {
    toast('Can’t reach the server yet. Reconnecting…');
  }
}
function openCreate() {
  document.querySelector(`input[name="create-mode"][value="${selectedMode}"]`).checked = true;
  const range = $('#create-bot-count');
  range.max = selectedMode === 'xxl' ? 119 : 9;
  range.dataset.mode = selectedMode;
  range.value = savedBotCount(selectedMode);
  syncBotRange();
  selectDestination(selectedMapId);
  showDialog('#create-dialog');
}
async function copyInvite() {
  if (!room) return;
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast(`Invite copied! Room ${room.code}`);
  } catch {
    const t = document.createElement('textarea');
    t.value = link;
    document.body.append(t);
    t.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {}
    t.remove();
    toast(copied ? `Invite copied! Room ${room.code}` : `Room ${room.code} · ${link}`);
  }
}
function syncBotRange() {
  const mode = document.querySelector('input[name="create-mode"]:checked').value;
  const range = $('#create-bot-count');
  if (!range) return;
  const previousMode = range.dataset.mode || 'normal';
  if (previousMode !== mode) storage.set(`mayhem-bots-${previousMode}`, range.value);
  range.max = mode === 'xxl' ? 119 : 9;
  range.dataset.mode = mode;
  if (previousMode !== mode) range.value = savedBotCount(mode);
  if (+range.value > +range.max) range.value = range.max;
  storage.set(`mayhem-bots-${mode}`, range.value);
  $('#bot-count-label').textContent = range.value;
  $('#bot-count-max').textContent = range.max;
  const { scoreTarget, economyPlayerCount } = economyForPlayers(Number(range.value) + 1);
  $('#create-economy-preview').textContent =
    `${scoreTarget} chips per team · ${economyPlayerCount} players, including bots`;
  updateCreateSummary();
}

// Keyboard state is cleared on blur and dialogs, avoiding stuck movement in a live room.
const keyMap = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  KeyW: 'jump',
  ArrowUp: 'jump',
  KeyE: 'action',
  KeyJ: 'action',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyK: 'dash',
  KeyS: 'down',
  ArrowDown: 'down',
};
const heldKeys = new Set();
function composeInput() {
  const before = input;
  const next = touchInput.snapshot();
  for (const key of heldKeys) if (keyMap[key]) next[keyMap[key]] = true;
  if (
    !room ||
    state?.status !== 'playing' ||
    countdownLocked() ||
    document.hidden ||
    document.querySelector('dialog[open]')
  )
    input = blankInput();
  else input = next;
  if (Object.keys(next).some((key) => input[key] !== before[key])) {
    queuePlayerInput(localInputBuffer, input);
    sendInput();
  }
}
function paintTouchInput() {
  const stick = touchInput.stick,
    knob = $('#touch-stick-knob');
  if (knob)
    knob.style.transform = `translate(${stick.x * stickRadius}px,${stick.y * stickRadius}px)`;
  if ($('#touch-stick')) $('#touch-stick').dataset.active = String(stick.active);
  const values = touchInput.snapshot();
  for (const action of ['jump', 'action', 'down']) {
    const button = $(`#touch-${action}`);
    if (button) {
      button.dataset.pressed = String(values[action]);
      button.setAttribute('aria-pressed', String(values[action]));
    }
  }
}
function updateTouchControls(player = state?.players?.find((p) => p.id === localId)) {
  const available = Boolean(
    touchEnabled &&
    room &&
    socketReady &&
    state?.status === 'playing' &&
    !countdownLocked() &&
    !document.hidden &&
    player?.alive &&
    $('#scoreboard').hidden &&
    !document.querySelector('dialog[open]'),
  );
  if (touchAvailable && !available) resetInput();
  touchAvailable = available;
  $('#touch-controls').hidden = !available;
  $('#game').dataset.inputActive = String(
    Boolean(
      touchEnabled &&
      room &&
      state?.status === 'playing' &&
      !document.hidden &&
      $('#scoreboard').hidden &&
      !document.querySelector('dialog[open]'),
    ),
  );
  screenAwake.setActive(
    touchEnabled && room && socketReady && state?.status === 'playing' && !document.hidden,
  );
  if (player) {
    $('#touch-jump-label').textContent = player.role === 'worker' ? 'JUMP' : 'FLAP';
    $('#touch-jump').setAttribute(
      'aria-label',
      player.role === 'worker' ? 'Jump' : 'Flap wings — tap repeatedly to fly',
    );
    $('#touch-down-label').textContent = player.role === 'queen' ? 'DIVE' : 'DROP';
    $('#touch-action-label').textContent = player.carrying ? 'USE CHIP' : 'ACTION';
    $('#touch-action').disabled = player.role !== 'worker';
  }
}
function updateTouchLayout() {
  const enabled =
    touchMode === 'on' ||
    (touchMode === 'auto' &&
      (touchDetected || coarsePointer.matches || navigator.maxTouchPoints > 0));
  const portrait = innerHeight > innerWidth;
  // Browser address bars resize the viewport during a hold. Keep that hold;
  // only a changed control mode/orientation/width releases old finger positions.
  if (
    enabled !== touchEnabled ||
    (enabled &&
      (portrait !== touchPortrait || (layoutWidth && Math.abs(innerWidth - layoutWidth) > 1)))
  )
    resetInput();
  touchEnabled = enabled;
  touchPortrait = portrait;
  layoutWidth = innerWidth;
  const viewport = window.visualViewport;
  const height = viewport && Math.abs(viewport.scale - 1) < 0.01 ? viewport.height : innerHeight;
  $('#game').style.setProperty('--game-height', `${Math.round(height)}px`);
  document.body.dataset.touch = String(enabled);
  $('#game').dataset.touch = String(enabled);
  updateTouchControls();
  gameRenderer?.resize();
  touchControls?.rebase();
}
function scheduleTouchLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    updateTouchLayout();
  });
}
touchControls = bindTouchControls({
  input: touchInput,
  stick: $('#touch-stick'),
  buttons: { jump: $('#touch-jump'), action: $('#touch-action'), down: $('#touch-down') },
  game: $('#game'),
  enabled: () => touchAvailable,
  gestureEnabled: () => $('#game').dataset.inputActive === 'true',
  onChange: () => {
    paintTouchInput();
    composeInput();
  },
  onEngage: () => {
    unlockAudio();
    void screenAwake.acquire();
  },
  onRadius: (radius) => {
    stickRadius = radius;
  },
  onTouchDetected: () => {
    if (!touchDetected) {
      touchDetected = true;
      updateTouchLayout();
    }
  },
});
$('#touch-crew').addEventListener('click', () => {
  resetInput();
  setScoreboard($('#scoreboard').hidden);
});
$('#scoreboard-close').addEventListener('click', () => setScoreboard(false));
$('#touch-controls-mode').value = touchMode;
$('#touch-controls-mode').addEventListener('change', () => {
  touchMode = $('#touch-controls-mode').value;
  storage.set('mayhem-touch-controls', touchMode);
  updateTouchLayout();
});
window.addEventListener('resize', scheduleTouchLayout);
window.visualViewport?.addEventListener('resize', scheduleTouchLayout);
screen.orientation?.addEventListener?.('change', scheduleTouchLayout);
window.addEventListener('orientationchange', scheduleTouchLayout);
if (coarsePointer.addEventListener) coarsePointer.addEventListener('change', updateTouchLayout);
else coarsePointer.addListener?.(updateTouchLayout);
async function fullscreenGame() {
  const result = await toggleGameFullscreen($('#game'));
  if (result === 'unsupported' || result === 'denied')
    toast('Fullscreen is unavailable here. You can keep playing in either orientation.');
  updateTouchLayout();
}
for (const type of ['fullscreenchange', 'webkitfullscreenchange'])
  document.addEventListener(type, () => {
    const active = Boolean(fullscreenElement());
    $('#fullscreen').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    $('#fullscreen').setAttribute('aria-pressed', String(active));
    scheduleTouchLayout();
  });
// Space is a gameplay jump, not an implicit click on the results dialog's
// autofocused control. Mouse clicks and deliberate Enter activation still work.
function guardResultsSpace(event) {
  if (event.code !== 'Space' || !$('#results-dialog').open) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  heldKeys.delete('Space');
  input.jump = false;
}
window.addEventListener('keydown', guardResultsSpace, true);
window.addEventListener('keyup', guardResultsSpace, true);
window.addEventListener('keydown', (event) => {
  if (!room || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (event.code === 'Escape') {
    if (!document.querySelector('dialog[open]')) {
      event.preventDefault();
      showDialog(state?.status === 'ended' ? '#results-dialog' : '#menu-dialog');
    }
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (event.code === 'Tab') {
    event.preventDefault();
    setScoreboard(true);
    return;
  }
  if (keyMap[event.code] && countdownLocked()) {
    event.preventDefault();
    return;
  }
  if (keyMap[event.code]) {
    event.preventDefault();
    heldKeys.add(event.code);
    if (!event.repeat) composeInput();
  }
  if (!event.repeat && ['Digit1', 'Digit2', 'Digit3'].includes(event.code))
    send({ type: 'emote', emoji: ['HEY', 'LOL', 'GG'][+event.code.slice(-1) - 1] });
  if (event.code === 'KeyR' && !event.repeat) {
    event.preventDefault();
    openRoleGuide();
  }
});
window.addEventListener('keyup', (event) => {
  heldKeys.delete(event.code);
  if (event.code === 'Tab') setScoreboard(false);
  if (keyMap[event.code]) composeInput();
});
window.addEventListener('blur', () => {
  heldKeys.clear();
  resetInput();
  setScoreboard(false);
});
window.addEventListener('pagehide', () => {
  resetInput();
  screenAwake.setActive(false);
});
window.addEventListener('pageshow', () => {
  updateTouchLayout();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetInput();
  updateTouchControls();
});
$$('.close-dialog').forEach((button) =>
  button.addEventListener('click', () => {
    button.closest('dialog').close();
    if (room) $('#game-canvas').focus();
  }),
);
$$('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    resetInput();
    updateTouchControls();
  });
});
$$('[data-help]').forEach((button) =>
  button.addEventListener('click', () => showDialog('#help-dialog')),
);
$$('[data-scroll]').forEach((button) =>
  button.addEventListener('click', () =>
    document.getElementById(button.dataset.scroll).scrollIntoView({ behavior: 'smooth' }),
  ),
);
$$('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => {
    selectedMode = button.dataset.mode;
    $$('[data-mode]').forEach((b) => {
      b.classList.toggle('selected', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
  }),
);
$('#briefing-confirm').addEventListener('click', confirmBriefing);
$('#briefing-cancel').addEventListener('click', () => {
  cancelBriefing();
  $('#briefing-dialog').close();
});
$('#briefing-close').addEventListener('click', cancelBriefing);
$('#briefing-dialog').addEventListener('cancel', cancelBriefing);
$('#briefing-dialog').addEventListener('close', () => {
  if (!$('#briefing-dialog').open && pendingBriefingAction) cancelBriefing();
});
$('#open-join').addEventListener('click', () => {
  $('#rooms-section').scrollIntoView({
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
    block: 'start',
  });
  refreshRooms();
});
$('#open-create').addEventListener('click', openCreate);
$('#destination-create').addEventListener('click', openCreate);
$('#lobby-change-map').addEventListener('click', openMapSelection);
$('#menu-map').addEventListener('click', openMapSelection);
$('#empty-create')?.addEventListener('click', openCreate);
$('#create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinAction({
    type: 'create',
    name: playerName(),
    roomName: $('#create-name').value,
    mapId: selectedMapId,
    mode: document.querySelector('input[name="create-mode"]:checked').value,
    private: $('#create-private').checked,
    botCount: +$('#create-bot-count').value,
    botDifficulty: validDifficulty($('#create-bot-difficulty').value),
    role: document.querySelector('input[name="create-role"]:checked').value,
  });
});
$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinAction({
    type: 'join',
    code: $('#room-code').value.trim().toUpperCase(),
    name: playerName(),
  });
});
$('#refresh-rooms').addEventListener('click', refreshRooms);
$('#start-match').addEventListener('click', () => {
  if (
    room?.hostId === localId &&
    state?.status === 'waiting' &&
    getLobbyReadiness(roleRoster()).ready
  )
    send({ type: 'start' });
});
$('#game-menu').addEventListener('click', () =>
  showDialog(state?.status === 'ended' ? '#results-dialog' : '#menu-dialog'),
);
$('#copy-room').addEventListener('click', copyInvite);
$('#menu-invite').addEventListener('click', copyInvite);
$('#leave-game').addEventListener('click', leaveGame);
$('#results-home').addEventListener('click', leaveGame);
$('#disconnect-home').addEventListener('click', leaveGame);
$('#rematch').addEventListener('click', () => send({ type: 'rematch' }));
$('#lobby-invite').addEventListener('click', copyInvite);
$('#results-roles').addEventListener('click', openRoleGuide);
$('#menu-roles').addEventListener('click', openRoleGuide);
$$('[data-pick-role]').forEach((button) =>
  button.addEventListener('click', () => chooseRole(button.dataset.pickRole)),
);
$('#reconnect').addEventListener('click', () => {
  if (socket?.readyState === WebSocket.OPEN) {
    send({ type: 'join', code: room?.code, name: playerName() });
  } else {
    connect();
  }
  $('#disconnect-message').textContent = 'Reconnecting…';
});
$('#fullscreen').addEventListener('click', fullscreenGame);
$('#player-names').value = nameMode;
$('#player-names').addEventListener('change', () => {
  nameMode = ['nearby', 'all', 'off'].includes($('#player-names').value)
    ? $('#player-names').value
    : 'nearby';
  storage.set('mayhem-player-names', nameMode);
  gameRenderer?.setNameMode(nameMode);
});
$('#reduced-fx').checked = lowPower;
$('#reduced-fx').addEventListener('change', (e) => {
  lowPower = e.target.checked;
  storage.set('mayhem-low-power', lowPower ? '1' : '0');
});
$('#network-info').addEventListener('click', async () => {
  showDialog('#network-dialog');
  try {
    const response = await fetch('/api/network');
    const data = await response.json();
    const holder = $('#lan-addresses');
    holder.replaceChildren();
    for (const url of data.addresses || []) {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url;
      holder.append(a);
    }
    if (data.hosted) {
      const a = document.createElement('a');
      a.href = location.origin;
      a.textContent = location.origin;
      holder.append(a);
      const paragraphs = $$('#network-dialog p');
      paragraphs[0].textContent =
        'Your crew can join from anywhere. Open this address, create a room, and share its code.';
      paragraphs[1].textContent = 'Room invitations use this public address automatically.';
      paragraphs[2].textContent =
        'Your laptop does not need to host the game. Everyone connects to the online server.';
    } else if (!holder.children.length)
      holder.textContent = 'No local network found. Connect to Wi-Fi and try again.';
  } catch {
    $('#lan-addresses').textContent = 'Network details unavailable. Check your server connection.';
  }
});

// Add selectable bots to both create and the host menu.
const botToggle = $('#create-bots').closest('label');
botToggle.outerHTML =
  '<div class="bot-picker"><label for="create-bot-count">BOTS <strong><output id="bot-count-label">9</output></strong></label><input type="range" id="create-bot-count" min="0" max="9" value="9"><div><span>0</span><span id="bot-count-max">9</span></div><small>Friends can replace bots.</small><small id="create-economy-preview" aria-live="polite"></small></div>';
$('#create-bot-count').value = savedBotCount('normal');
syncBotRange();
$('#create-bot-difficulty').addEventListener('change', updateCreateDifficulty);
$('#create-bot-count').addEventListener('input', syncBotRange);
$$('input[name="create-mode"]').forEach((el) => el.addEventListener('change', syncBotRange));
const botControl = document.createElement('div');
botControl.id = 'host-bots-control';
botControl.innerHTML =
  '<label class="host-bot-label" for="menu-bots">BOT CREW <small id="current-bot-count"></small></label><div class="host-bot-actions"><input id="menu-bots" type="number" min="0" max="9" value="9" aria-label="Bot count"><button class="button secondary" id="apply-bots">UPDATE BOTS</button></div>';
$('.menu-actions').insertBefore(botControl, $('#reduced-fx').closest('label'));
const menuDifficulty = document.createElement('div');
menuDifficulty.className = 'bot-difficulty-picker';
menuDifficulty.innerHTML =
  '<label for="menu-bot-difficulty">BOT DIFFICULTY<select id="menu-bot-difficulty" data-room-difficulty aria-describedby="menu-difficulty-description"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label><small id="menu-difficulty-description">Balanced team play</small>';
botControl.append(menuDifficulty);
$$('[data-room-difficulty]').forEach((select) =>
  select.addEventListener('change', () => {
    if (!room || room.hostId !== localId || state?.status === 'playing') return;
    const difficulty = validDifficulty(select.value);
    storage.set('mayhem-bot-difficulty', difficulty);
    $('#create-bot-difficulty').value = difficulty;
    updateCreateDifficulty();
    send({ type: 'bot-difficulty', difficulty });
  }),
);

function applyBotCount(field) {
  if (!room || room.hostId !== localId || state?.status === 'playing') return;
  const count = Number(field.value);
  if (!Number.isInteger(count) || count < 0 || count >= room.maxPlayers) {
    toast(`Choose between 0 and ${room.maxPlayers - 1} bots.`);
    return;
  }
  storage.set(`mayhem-bots-${room.mode}`, count);
  send({ type: 'bots', count });
  toast(`Bot crew requested: ${count}`);
}
$('#apply-bots').addEventListener('click', () => applyBotCount($('#menu-bots')));
$('#lobby-apply-bots').addEventListener('click', () => applyBotCount($('#lobby-bots')));
const swapButton = document.createElement('button');
swapButton.id = 'swap-role';
swapButton.className = 'role-swap';
swapButton.textContent = 'R · ROLES';
swapButton.title = 'Choose your starting role in the lobby, or learn how to earn upgrades';
$('.player-card').append(swapButton);
swapButton.addEventListener('click', openRoleGuide);

// Tiny synthesized arcade sounds; all generated locally and opt-in.
function unlockAudio() {
  if (!soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    if (!audioTimer) audioTimer = setInterval(musicTick, 280);
  } catch {}
}
function tone(frequency, duration = 0.09, type = 'square', volume = 0.035, delay = 0) {
  if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
  const start = audioContext.currentTime + delay,
    osc = audioContext.createOscillator(),
    gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(start);
  osc.stop(start + duration + 0.01);
}
function playSound(type) {
  if (!soundEnabled) return;
  switch (type) {
    case 'pickup':
      tone(880);
      tone(1175, 0.12, 'square', 0.025, 0.08);
      break;
    case 'deposit':
      tone(523);
      tone(659, 0.12, 'square', 0.035, 0.07);
      tone(784, 0.17, 'square', 0.035, 0.14);
      break;
    case 'ko':
      tone(130, 0.2, 'sawtooth', 0.025);
      break;
    case 'attack':
      tone(220, 0.045, 'triangle', 0.025);
      break;
    case 'ride':
    case 'upgrade':
      tone(440);
      tone(880, 0.2, 'triangle', 0.05, 0.1);
      break;
    case 'win':
    case 'start':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'square', 0.035, i * 0.13));
      break;
  }
}
function musicTick() {
  if (!room || state?.status !== 'playing' || countdownLocked() || document.hidden) return;
  const bass = [130.81, 130.81, 164.81, 196, 110, 110, 146.83, 164.81];
  tone(bass[Math.floor(beat / 2) % bass.length], 0.15, 'triangle', 0.025);
  if (beat % 4 === 0) tone(55, 0.12, 'sine', 0.065);
  if (beat % 8 === 6) tone([523.25, 659.25, 783.99][Math.floor(beat / 8) % 3], 0.12, 'sine', 0.02);
  beat++;
}
function updateSoundButtons() {
  $$('.sound-toggle').forEach((b) => {
    b.classList.toggle('sound-on', soundEnabled);
    b.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Enable sound');
    b.title = soundEnabled ? 'Mute sound' : 'Enable sound';
    if (!b.querySelector('.sound-slash')) b.textContent = soundEnabled ? '♫' : '♪';
  });
}
$$('.sound-toggle').forEach((b) =>
  b.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    storage.set('mayhem-sound', soundEnabled ? '1' : '0');
    updateSoundButtons();
    if (soundEnabled) {
      unlockAudio();
      tone(660);
    } else {
      clearInterval(audioTimer);
      audioTimer = null;
      audioContext?.suspend();
    }
  }),
);
updateSoundButtons();

// Simulation prediction runs at fixed steps; rendering can independently save battery.
let previous = performance.now(),
  accumulator = 0,
  lastRender = 0,
  fpsStart = performance.now(),
  frameCount = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  updateCountdown();
  if (room && state && predicted && !document.hidden) {
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      const stepInput = consumePlayerInput(localInputBuffer);
      if (
        state.status === 'playing' &&
        !countdownLocked() &&
        Date.now() + serverOffset >= roundStartsAt() &&
        state.gator.riderId !== localId &&
        !(predicted.upgradeUntil > Date.now() + serverOffset) &&
        performance.now() - lastSnapshot < 2000
      )
        movePlayer(predicted, stepInput, map, 1 / 60, Date.now() + serverOffset);
      accumulator -= 1 / 60;
    }
    correction.x *= Math.exp(-dt * 18);
    correction.y *= Math.exp(-dt * 18);
    if (!lowPower || now - lastRender >= 32) {
      gameRenderer.render(Math.min(0.05, (now - lastRender) / 1000), {
        ...predicted,
        x: predicted.x + correction.x,
        y: predicted.y + correction.y,
      });
      lastRender = now;
      frameCount++;
    }
    if (now - lastSnapshot > 8000) {
      $('#connection-overlay').hidden = false;
      $('#disconnect-message').textContent =
        'The server is taking too long to respond. Reconnect to continue.';
    }
  } else accumulator = 0;
  if (now - fpsStart > 1000) {
    $('#fps').textContent = `${Math.round((frameCount * 1000) / (now - fpsStart))} FPS`;
    frameCount = 0;
    fpsStart = now;
  }
  if (!document.hidden) renderVictoryScene(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(sendInput, 1000 / 30);
setInterval(() => {
  if (socketReady) send({ type: 'ping', time: performance.now() });
}, 1500);
const hero = $('#hero-image');
mapPickers = {
  home: createMapPicker($('#home-map-picker'), { name: 'home-map', onSelect: selectDestination }),
  create: createMapPicker($('#create-map-picker'), {
    name: 'create-map',
    onSelect: selectDestination,
  }),
  lobby: createMapPicker($('#lobby-map-picker'), {
    name: 'lobby-map',
    onSelect: changeRoomDestination,
  }),
};
selectDestination(selectedMapId);
function revealHero() {
  if (hero.naturalWidth) {
    hero.hidden = false;
    $('#attract-canvas').hidden = true;
    previewCleanup?.();
    previewCleanup = null;
  }
}
hero.addEventListener('load', revealHero);
if (hero.complete && hero.naturalWidth) revealHero();
else previewCleanup = renderPreview($('#attract-canvas'));
const invite = new URLSearchParams(location.search).get('room');
if (invite) {
  $('#room-code').value = invite.toUpperCase();
  joinAction({ type: 'join', code: invite.toUpperCase(), name: playerName() });
}
updateTouchLayout();
connect();
