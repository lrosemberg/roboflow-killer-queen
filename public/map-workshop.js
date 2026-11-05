import { PLAYABLE_MAPS, getMapDefinition, normalizeMapId } from '../shared/maps.js';
import { createMap } from '../shared/world.js';
import { Renderer } from './renderer.js';
import { drawRaccoon, drawRide } from './sprites.js';
import { bindPageGestureGuard } from './gesture-guard.js';

bindPageGestureGuard();
const query = new URLSearchParams(location.search);
const mapSelect = document.querySelector('#workshop-map');
const modeSelect = document.querySelector('#workshop-mode');
const cameraSlider = document.querySelector('#workshop-camera');
const pauseButton = document.querySelector('#workshop-pause');
const crewCanvas = document.querySelector('#crew-canvas');
const crewContext = crewCanvas.getContext('2d');
const renderer = new Renderer(document.querySelector('#arena-canvas'));
renderer.setNameMode('off');

for (const destination of PLAYABLE_MAPS) {
  const option = document.createElement('option');
  option.value = destination.id;
  option.textContent = destination.name;
  mapSelect.append(option);
}
mapSelect.value = normalizeMapId(query.get('map'));
modeSelect.value = query.get('mode') === 'xxl' ? 'xxl' : 'normal';

let map, definition, state, focus;
let elapsed = 0,
  last = performance.now(),
  paused = false;

function makePlayer(id, team, role, x, y) {
  return {
    id,
    team,
    role,
    x,
    y,
    vx: 90,
    vy: 0,
    alive: true,
    bot: true,
    grounded: true,
    facing: team === 0 ? 1 : -1,
    carrying: role === 'worker',
    queenLives: 3,
    invulnerableUntil: 0,
    name: `Preview ${role}`,
  };
}

function rebuild() {
  definition = getMapDefinition(mapSelect.value);
  const mode = modeSelect.value;
  const total = mode === 'xxl' ? 120 : 10;
  map = createMap(mode, total, definition.id);
  focus = makePlayer('preview-focus', 0, 'worker', map.width / 2, map.height - 116);
  const players = map.bases.flatMap((base) => [
    makePlayer(`queen-${base.team}`, base.team, 'queen', base.x + 60, base.y + base.h - 36),
    makePlayer(`worker-${base.team}`, base.team, 'worker', base.x + 120, base.y + base.h - 36),
  ]);
  players.push(focus);
  const pileCounts = new Map();
  for (const chip of map.berrySpawns)
    pileCounts.set(chip.pileId, (pileCounts.get(chip.pileId) || 0) + 1);
  state = {
    players,
    gates: map.gates,
    scores: [3, 2],
    queenLives: [3, 3],
    events: [],
    berries: [],
    piles: map.berryPiles.map((pile) => ({ ...pile, remaining: pileCounts.get(pile.id) || 0 })),
    gator: { x: map.width / 2, y: map.gatorTrack.y, riderId: null, progress: 0 },
    time: Date.now(),
  };
  renderer.setMap(map);
  document.querySelector('#destination-kicker').textContent = definition.kicker;
  document.querySelector('#destination-title').textContent =
    `${definition.name} · ${definition.subtitle}`;
  document.querySelector('#destination-size').textContent =
    mode === 'normal' ? 'CLASSIC · 5 VS 5' : 'XXL · 60 VS 60';
  document.querySelector('#workshop-stats').textContent =
    `${map.width.toLocaleString()} × ${map.height.toLocaleString()} · ${map.platforms.length - 1} raised platforms · ${map.gates.length} AI1 stations · ${map.berryPiles.length} supply piles · ${map.resourceCount} total chips · ${map.scoreTarget} to win per team`;
  document.querySelector('#crew-description').textContent =
    `${definition.queen.name} × Purple / Sunset. Getaway: ${definition.ride.name}. Cosmetic variants share the same gameplay rules.`;
  document.querySelector('#camera-control').hidden = mode !== 'xxl';
  moveCamera();
  const url = new URL(location.href);
  url.searchParams.set('map', definition.id);
  url.searchParams.set('mode', mode);
  history.replaceState(null, '', url);
}

function moveCamera() {
  if (!focus) return;
  focus.x = Math.max(0, Math.min(map.width - 28, (map.width * Number(cameraSlider.value)) / 100));
  renderer.initialCamera = true;
}

function renderCrew() {
  const c = crewContext;
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, crewCanvas.width, crewCanvas.height);
  c.fillStyle = '#d9cfea';
  c.fillRect(28, 202, 944, 3);
  for (const [index, team] of [0, 1].entries()) {
    drawRaccoon(c, makePlayer(`sample-${team}`, team, 'queen', 175 + index * 245, 166), elapsed, {
      scale: 3,
      mapId: definition.id,
      now: Date.now(),
    });
  }
  c.save();
  c.translate(780, 173);
  c.scale(1.6, 1.6);
  drawRide(c, { x: 0, y: 0, riderId: null, progress: 0 }, elapsed, null, definition.id);
  c.restore();
  c.fillStyle = '#493762';
  c.textAlign = 'center';
  c.font = 'bold 13px monospace';
  c.fillText('PURPLE QUEEN', 190, 234);
  c.fillText('SUNSET QUEEN', 435, 234);
  c.fillText(definition.ride.name.toUpperCase(), 780, 234);
}

mapSelect.addEventListener('change', rebuild);
modeSelect.addEventListener('change', rebuild);
cameraSlider.addEventListener('input', moveCamera);
pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseButton.textContent = paused ? 'Resume animation' : 'Pause animation';
});
rebuild();
function frame(now) {
  const dt = paused ? 0 : Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  state.time = Date.now();
  renderer.setState(state, focus.id);
  renderer.render(dt);
  renderCrew();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
