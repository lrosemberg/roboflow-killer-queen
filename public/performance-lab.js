import { Renderer } from './renderer.js';
import { createMap } from '../shared/world.js';
import { PLAYABLE_MAPS } from '../shared/maps.js';

const canvas = document.querySelector('#benchmark-canvas');
const result = document.querySelector('#result');
const button = document.querySelector('#benchmark-start');
const mapSelect = document.querySelector('#benchmark-map');
const drawing = document.querySelector('#benchmark-drawing');
const scene = document.querySelector('#benchmark-scene');
for (const map of PLAYABLE_MAPS) {
  const option = document.createElement('option');
  option.value = map.id;
  option.textContent = map.name;
  mapSelect.append(option);
}
let renderer,
  map,
  state,
  started,
  previous,
  lastSnapshot,
  samples,
  intervals,
  running = false;
let activeDrawing, activeScene;
const percentile = (values, q) =>
  values[Math.min(values.length - 1, Math.floor(values.length * q))] || 0;
function start() {
  renderer?.destroy();
  activeDrawing = drawing.value;
  activeScene = scene.value;
  renderer = new Renderer(canvas, { spriteCache: activeDrawing === 'cached' });
  renderer.setNameMode('nearby');
  map = createMap('xxl', 120, mapSelect.value);
  const players = Array.from({ length: 120 }, (_, i) => ({
    id: `fixture-${i}`,
    name: `Vision ${i}`,
    team: i % 2,
    role: i % 5 === 0 ? 'queen' : i % 3 === 0 ? 'warrior' : 'worker',
    x: map.width / 2 + ((i % 15) - 7) * 48,
    y: map.height - 140 - Math.floor(i / 15) * 42,
    vx: i % 2 ? 270 : -270,
    vy: 0,
    facing: i % 2 ? 1 : -1,
    alive: true,
    bot: false,
    grounded: i % 3 !== 0,
    queenLives: 3,
    carrying: i % 3 === 1,
    speedBoost: i % 7 === 0,
    invulnerableUntil: 0,
    attackUntil: 0,
  }));
  state = {
    players,
    gates: map.gates,
    scores: [72, 69],
    queenLives: [36, 36],
    events: [],
    berries: [],
    piles: map.berryPiles.map((pile) => ({ ...pile, remaining: 60 })),
    gator: { x: map.width / 2, y: map.gatorTrack.y, riderId: null, progress: 0 },
    time: Date.now(),
  };
  renderer.setMap(map);
  renderer.setState(state, players[67].id);
  started = previous = performance.now();
  lastSnapshot = 0;
  samples = [];
  intervals = [];
  running = true;
  button.disabled = true;
  mapSelect.disabled = drawing.disabled = scene.disabled = true;
  result.textContent = 'Warming up…';
  requestAnimationFrame(frame);
}
function frame(now) {
  if (!running) return;
  const elapsed = now - started;
  const dt = Math.min(0.05, (now - previous) / 1000);
  if (now - lastSnapshot >= 50) {
    const phase = elapsed / 1000;
    for (const [i, p] of state.players.entries()) {
      p.x =
        activeScene === 'spread'
          ? 100 + (i / 119) * (map.width - 200)
          : map.width / 2 + ((i % 15) - 7) * 48 + Math.sin(phase * 1.2 + i) * 24;
      p.y = map.height - 140 - Math.floor(i / 15) * 42 + Math.sin(phase * 2 + i) * 12;
      p.attackUntil = i % 7 === Math.floor(phase) % 7 ? Date.now() + 120 : 0;
    }
    state.time = Date.now();
    renderer.setState(state, state.players[67].id);
    lastSnapshot = now;
  }
  const before = performance.now();
  renderer.render(dt);
  const renderMs = performance.now() - before;
  if (elapsed > 2000) {
    samples.push(renderMs);
    intervals.push(now - previous);
  }
  previous = now;
  result.textContent =
    elapsed < 2000
      ? 'Warming up…'
      : `Sampling… ${Math.min(10, Math.floor((elapsed - 2000) / 1000))}/10 seconds`;
  if (elapsed < 12000) return requestAnimationFrame(frame);
  running = false;
  button.disabled = false;
  mapSelect.disabled = drawing.disabled = scene.disabled = false;
  const totalMs = intervals.reduce((sum, n) => sum + n, 0);
  const sortedFrames = [...intervals].sort((a, b) => a - b);
  const sortedRender = [...samples].sort((a, b) => a - b);
  const round = (n) => Math.round(n * 100) / 100;
  result.textContent = JSON.stringify(
    {
      map: map.mapId,
      scene: activeScene,
      drawing: activeDrawing,
      simulatedPlayers: 120,
      lastFrame: { drawnPlayers: renderer.drawnPlayers, visiblePlayers: renderer.visiblePlayers },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      canvas: { width: canvas.width, height: canvas.height },
      samples: samples.length,
      fps: round((samples.length * 1000) / totalMs),
      renderMs: {
        p50: round(percentile(sortedRender, 0.5)),
        p95: round(percentile(sortedRender, 0.95)),
        max: round(sortedRender.at(-1)),
      },
      frameIntervalMs: {
        p50: round(percentile(sortedFrames, 0.5)),
        p95: round(percentile(sortedFrames, 0.95)),
      },
      longFramesOver50ms: intervals.filter((n) => n > 50).length,
      cache: renderer.spriteCache?.stats() || null,
      note: 'Synthetic browser scene. CPU render time excludes final GPU presentation. Not proof for every device or WAN connection.',
    },
    null,
    2,
  );
}
button.addEventListener('click', start);
