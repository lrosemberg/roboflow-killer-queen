import { drawRaccoon, drawRide, drawData, TEAM } from './sprites.js';
import { getMapDefinition } from '../shared/maps.js';
import {
  drawThemeBackground,
  drawThemeScenery,
  drawThemePlatform,
  drawFinishLabels,
  drawGlobalHero,
} from './theme-art.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
function box(c, color, x, y, w, h) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}
function text(c, s, x, y, size = 12, color = '#233d4b', align = 'center') {
  c.font = `bold ${size}px "Courier New", monospace`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(s, Math.round(x), Math.round(y));
}
const random = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.map = null;
    this.state = null;
    this.localId = null;
    this.nameMode = 'nearby';
    this.camera = { x: 0, y: 0 };
    this.initialCamera = true;
    this.elapsed = 0;
    this.received = performance.now();
    this.particles = [];
    this.popups = [];
    this.seenEvents = new Set();
    this.smooth = new Map();
    this.w = 1280;
    this.h = 720;
    this.scale = 1;
    this.dead = false;
    this.shake = 0;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(canvas);
    }
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    const style = getComputedStyle(this.canvas.parentElement);
    const touch = this.canvas.parentElement.dataset.touch === 'true';
    this.touchEnabled = touch;
    this.touchPortrait = touch && r.height >= r.width && r.width <= 1100;
    this.touchCompact = touch && (this.touchPortrait || r.height <= 600);
    this.safeTop = parseFloat(style.paddingTop) || 0;
    this.safeBottom = parseFloat(style.paddingBottom) || 0;
    this.arenaTop = (parseFloat(style.getPropertyValue('--arena-top')) || 128) + this.safeTop;
    this.arenaBottom =
      (parseFloat(style.getPropertyValue('--arena-bottom')) || 44) + this.safeBottom;
    const fullFit =
      this.map?.mode === 'normal'
        ? Math.min(
            (r.width - 28) / this.map.width,
            Math.max(100, r.height - this.arenaTop - this.arenaBottom) / this.map.height,
          )
        : 1;
    this.followCamera =
      this.map?.mode !== 'normal' || this.touchPortrait || (touch && fullFit < 0.5);
    this.touchFollow = touch && this.followCamera;
    if (this.touchFollow && this.touchCompact && !this.touchPortrait)
      this.arenaTop = Math.max(this.arenaTop, 130 + this.safeTop);
    if (this.map?.mode === 'normal' && !this.followCamera) {
      // Keep the full Classic arena when players remain readable at that scale.
      const top = this.arenaTop,
        bottom = this.arenaBottom,
        fit = fullFit;
      this.w = r.width / fit;
      this.h = r.height / fit;
      this.camera.x = (this.map.width - this.w) / 2;
      this.camera.y = -top / fit - (this.h - (top + bottom) / fit - this.map.height) / 2;
      this.initialCamera = false;
    } else if (this.touchPortrait) {
      // Keep raccoons large enough to play on a narrow display. The camera
      // follows within the clear area between the HUD and the thumb controls.
      this.w = clamp(r.width * 1.35, 480, 680);
      this.h = (this.w * r.height) / r.width;
      this.initialCamera = true;
    } else if (this.map?.mode === 'normal') {
      // On small landscape phones the full map made raccoons only9–12px tall.
      // Follow at a readable scale, with room to see adjacent platforms.
      const fit = clamp(r.width / 1120, 0.65, 0.9);
      this.w = r.width / fit;
      this.h = r.height / fit;
      this.initialCamera = true;
    } else {
      // XXL deliberately stays close to the local player.
      this.w = clamp(r.width * 0.8, 820, 1280);
      this.h = (this.w * r.height) / r.width;
      if (this.h > 880) {
        this.h = 880;
        this.w = (this.h * r.width) / r.height;
      }
      this.initialCamera = true;
    }
    this.cssScale = r.width / this.w;
    this.scale = this.canvas.width / this.w;
    this.ctx.imageSmoothingEnabled = false;
  }
  setMap(map) {
    this.map = map;
    this.initialCamera = true;
    this.particles = [];
    this.popups = [];
    this.smooth.clear();
    this.seenEvents.clear();
    this.resize();
  }
  setNameMode(mode) {
    this.nameMode = ['nearby', 'all', 'off'].includes(mode) ? mode : 'nearby';
  }
  setState(state, localId) {
    this.state = state;
    this.localId = localId;
    this.received = performance.now();
    for (const e of state.events || []) {
      if (this.seenEvents.has(e.id)) continue;
      this.seenEvents.add(e.id);
      if (this.seenEvents.size > 500) this.seenEvents.delete(this.seenEvents.values().next().value);
      const color = TEAM[e.team || 0].main;
      for (let i = 0; i < (['kill', 'ko'].includes(e.type) ? 18 : 9); i++)
        this.particles.push({
          x: e.x || 0,
          y: e.y || 0,
          vx: (random(i + this.elapsed) * 2 - 1) * 150,
          vy: -40 - random(i + 23 + this.elapsed) * 180,
          life: 0.4 + random(i + 99) * 0.5,
          color: i % 3 === 0 ? '#ffe481' : color,
          size: (i % 3) + 3,
        });
      // Knockout names already have a dedicated feed; avoid a second floating label.
      if (e.text && !['kill', 'ko'].includes(e.type))
        this.popups.push({ x: e.x || 0, y: e.y || 0, text: e.text, life: 1.7, color });
      if (
        ['kill', 'ko'].includes(e.type) &&
        Math.abs((e.x || 0) - this.camera.x - this.w / 2) < this.w / 2
      )
        this.shake = 4;
    }
    if (this.particles.length > 300) this.particles.splice(0, this.particles.length - 300);
    if (this.popups.length > 25) this.popups.splice(0, this.popups.length - 25);
  }
  getCamera() {
    return { ...this.camera, width: this.w, height: this.h };
  }
  destroy() {
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.dead = true;
  }
  visible(x, y, w = 40, h = 40, margin = 100) {
    return (
      x + w > this.camera.x - margin &&
      x < this.camera.x + this.w + margin &&
      y + h > this.camera.y - margin &&
      y < this.camera.y + this.h + margin
    );
  }
  render(dt = 1 / 60, localPlayerOverride) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    const c = this.ctx;
    const map = this.map;
    if (!map) {
      this.attract(c);
      return;
    }
    const rawLocal = this.state?.players?.find((p) => p.id === this.localId);
    const local = localPlayerOverride || rawLocal;
    if (local && this.followCamera) {
      // Permit a little space beyond the map edge on touch displays so a
      // spawning raccoon stays between the thumbs instead of under a button.
      const targetX = this.touchFollow
        ? clamp(
            local.x + 14 - this.w / 2 + (local.vx || 0) * 0.12,
            32 - this.w / 2,
            map.width - 32 - this.w / 2,
          )
        : clamp(
            local.x + 14 - this.w / 2 + (local.vx || 0) * 0.16,
            0,
            Math.max(0, map.width - this.w),
          );
      let targetY;
      if (this.touchFollow) {
        const top = this.arenaTop / this.cssScale,
          bottom = this.arenaBottom / this.cssScale;
        const clearHeight = Math.max(80 / this.cssScale, this.h - top - bottom);
        const minY = -top,
          maxY = map.height - (this.h - bottom);
        targetY =
          maxY < minY
            ? (minY + maxY) / 2
            : clamp(local.y + 18 - top - clearHeight * 0.52, minY, maxY);
      } else targetY = clamp(local.y + 18 - this.h * 0.52, 0, Math.max(0, map.height - this.h));
      const a = this.initialCamera ? 1 : 1 - Math.exp(-8 * dt);
      this.camera.x = mix(this.camera.x, targetX, a);
      this.camera.y = mix(this.camera.y, targetY, a);
      this.initialCamera = false;
    }
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.imageSmoothingEnabled = false;
    this.background(c);
    c.save();
    const shake = this.shake > 0 ? Math.sin(this.elapsed * 90) * this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 20);
    c.translate(Math.round(-this.camera.x + shake), Math.round(-this.camera.y));
    this.scenery(c);
    for (const p of map.platforms || []) if (this.visible(p.x, p.y, p.w, p.h)) this.platform(c, p);
    drawFinishLabels(c, map, this.camera, this.w, this.cssScale);
    for (const b of map.bases || [])
      if (this.visible(b.x - 40, b.y - 80, b.w + 80, b.h + 80)) this.base(c, b, local);
    for (const g of this.state?.gates || map.gates || [])
      if (this.visible(g.x, g.y - 50, g.w, g.h + 60)) this.gate(c, g, local);
    for (const b of this.state?.berries || [])
      if (b.active !== false && this.visible(b.x, b.y)) {
        c.globalAlpha = 0.18;
        box(c, '#ffdd68', b.x - 14, b.y + 9, 28, 4);
        c.globalAlpha = 1;
        drawData(c, b.x, b.y, this.elapsed);
      }
    for (const pile of this.state?.piles || [])
      if (this.visible(pile.x - 70, pile.y - 80, 140, 110)) this.dataPile(c, pile, local);
    const gator = this.state?.gator;
    if (gator && this.visible(gator.x - 80, gator.y - 60, 160, 90)) {
      const rider = this.state.players?.find((p) => p.id === gator.riderId);
      c.globalAlpha = 0.16;
      box(c, '#183c4c', gator.x - 66, gator.y + 18, 130, 7);
      c.globalAlpha = 1;
      drawRide(c, gator, this.elapsed, rider?.team, map.mapId);
      if (!gator.riderId && local && Math.hypot(local.x - gator.x, local.y - gator.y) < 150)
        this.tag(
          c,
          local.role === 'worker'
            ? `${this.touchEnabled ? 'ACTION' : 'E'} · RIDE ${getMapDefinition(map.mapId).ride.name.toUpperCase()}`
            : 'WORKERS RIDE',
          gator.x,
          gator.y - 76,
          '#effec6',
          '#244f50',
          12,
        );
    }
    const now = (this.state?.time || Date.now()) + Math.min(120, performance.now() - this.received);
    this.nameplateSlots = [];
    const nearHumans = (this.state?.players || [])
      .filter(
        (p) =>
          p.alive &&
          !p.bot &&
          p.id !== this.localId &&
          local &&
          Math.hypot(p.x - local.x, p.y - local.y) * this.cssScale < 190,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - local.x, a.y - local.y) - Math.hypot(b.x - local.x, b.y - local.y),
      )
      .slice(0, 4);
    this.namedPlayers = new Set([this.localId, ...nearHumans.map((p) => p.id)]);
    for (const p of this.state?.players || []) {
      if (!p.alive) continue;
      let drawP = p;
      if (p.id === this.localId && local) drawP = local;
      else {
        let sm = this.smooth.get(p.id);
        if (!sm || Math.abs(sm.x - p.x) > 300 || Math.abs(sm.y - p.y) > 300)
          sm = { x: p.x, y: p.y };
        sm.x = mix(sm.x, p.x, 1 - Math.exp(-22 * dt));
        sm.y = mix(sm.y, p.y, 1 - Math.exp(-22 * dt));
        this.smooth.set(p.id, sm);
        drawP = { ...p, x: sm.x, y: sm.y };
      }
      if (!this.visible(drawP.x, drawP.y, 30, 40)) continue;
      this.player(c, drawP, now, p.id === this.localId);
    }
    if (rawLocal && !rawLocal.alive) {
      c.globalAlpha = 0.3;
      drawRaccoon(c, { ...rawLocal, grounded: false }, this.elapsed, { mapId: map.mapId });
      c.globalAlpha = 1;
      this.tag(
        c,
        rawLocal.eliminated ? 'CROWN RETIRED · 0/3' : 'BACK IN A FLASH',
        rawLocal.x + 14,
        rawLocal.y - 45,
        '#fff7d6',
        '#334456',
      );
    }
    for (const q of this.particles) {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 300 * dt;
      c.globalAlpha = clamp(q.life * 3, 0, 1);
      box(c, q.color, q.x, q.y, q.size, q.size);
    }
    c.globalAlpha = 1;
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const q of this.popups) {
      q.life -= dt;
      q.y -= dt * 20;
      c.globalAlpha = clamp(q.life * 2, 0, 1);
      this.tag(c, q.text, q.x, q.y - 30, '#243c4b', q.color);
    }
    c.globalAlpha = 1;
    this.popups = this.popups.filter((q) => q.life > 0);
    c.restore();
    if (local && this.followCamera) {
      this.compass(c, local);
      this.radar(c, local);
    }
    // Soft border keeps the scene framed like an arcade cabinet.
    c.strokeStyle = 'rgba(27,52,64,.12)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, this.w - 2, this.h - 2);
  }
  background(c) {
    drawThemeBackground(c, {
      mapId: this.map.mapId,
      width: this.w,
      height: this.h,
      camera: this.camera,
      mapHeight: this.map.height,
    });
  }
  scenery(c) {
    drawThemeScenery(c, this.map, this.camera, this.w);
  }
  platform(c, platform) {
    drawThemePlatform(c, platform, this.map, this.camera, this.w);
  }
  base(c, b, local) {
    const t = TEAM[b.team || 0];
    const score = this.state?.scores?.[b.team] || 0;
    box(c, t.dark, b.x - 5, b.y + 10, b.w + 10, b.h - 10);
    box(c, t.main, b.x, b.y, b.w, b.h);
    box(c, t.light, b.x - 8, b.y - 6, b.w + 16, 12);
    box(c, t.light, b.x + 8, b.y + 12, b.w - 16, 5);
    box(c, '#243e4f', b.x + 18, b.y + 33, b.w - 36, b.h - 33);
    box(c, t.dark, b.x + 25, b.y + 40, b.w - 50, b.h - 40);
    text(c, b.team === 0 ? 'PURPLE HQ' : 'SUNSET HQ', b.x + b.w / 2, b.y + 25, 14, t.ink);
    const slots = this.map.scoreTarget || 12,
      groupSize = Math.max(1, Math.ceil(slots / 36));
    const cells = Math.ceil(slots / groupSize),
      cols = slots > 12 ? 6 : 4,
      rows = Math.ceil(cells / cols);
    const gridW = b.w - 52,
      gridH = slots > 12 ? 51 : 64,
      cellW = gridW / cols,
      cellH = gridH / rows;
    const top = b.y + 43;
    for (let i = 0; i < cells; i++) {
      const xx = b.x + 26 + ((i % cols) + 0.5) * cellW,
        yy = top + (Math.floor(i / cols) + 0.5) * cellH;
      if (slots <= 12) {
        box(c, '#101d2d', xx - 9, yy - 8, 18, 17);
        box(c, '#536073', xx - 8, yy + 7, 16, 2);
        if (i < score) drawData(c, xx, yy, 0, 0.75, { bob: false });
        else {
          box(c, '#3a4760', xx - 5, yy - 5, 10, 9);
          box(c, '#252b43', xx - 4, yy - 4, 8, 8);
        }
      } else {
        const capacity = Math.min(groupSize, slots - i * groupSize);
        const fill = clamp((score - i * groupSize) / capacity, 0, 1),
          cellHeight = Math.min(10, cellH - 2);
        box(c, '#142035', xx - cellW * 0.4, yy - cellHeight / 2, cellW * 0.8, cellHeight);
        if (fill)
          box(
            c,
            '#be8cff',
            xx - cellW * 0.3,
            yy + cellHeight / 2 - 1 - fill * (cellHeight - 2),
            cellW * 0.6,
            fill * (cellHeight - 2),
          );
      }
    }
    if (groupSize > 1)
      text(
        c,
        `${slots % groupSize ? 'UP TO' : 'EACH CELL ='} ${groupSize} CHIPS${slots % groupSize ? ' / CELL' : ''}`,
        b.x + b.w / 2,
        b.y + 100,
        7,
        '#e4d7ff',
      );
    const door = b.door || { x: b.x + b.w / 2 - 28, w: 56 };
    box(c, '#182d3f', door.x - 4, b.y + b.h - 5, door.w + 8, 8);
    box(c, '#edffb7', door.x, b.y + b.h - 5, door.w, 3);
    if (
      local?.team === b.team &&
      local.carrying &&
      Math.hypot(local.x + 14 - b.x - b.w / 2, local.y + 36 - b.y - b.h) < 210
    )
      this.tag(c, '↓ DELIVER HERE', b.x + b.w / 2, b.y + b.h + 35, '#fff4ce', t.ink, 12);
    const flagX = b.team === 0 ? b.x - 25 : b.x + b.w + 24;
    box(c, '#335a67', flagX, b.y - 75, 4, b.h + 75);
    box(c, t.main, flagX + 4, b.y - 75, 53, 29);
    box(c, t.light, flagX + 8, b.y - 71, 45, 4);
    text(c, b.team === 0 ? '01' : '02', flagX + 30, b.y - 57, 14, t.ink);
    this.tag(c, `DATA ${score} / ${slots}`, b.x + b.w / 2, b.y - 32, '#fff4ce', t.ink, 12);
  }
  dataPile(c, pile, local) {
    const { x, y } = pile,
      count = Math.max(0, pile.remaining || 0);
    box(c, '#322747', x - 43, y + 9, 86, 13);
    box(c, '#9b77d8', x - 46, y + 7, 92, 5);
    box(c, '#d4c0f5', x - 39, y + 8, 78, 2);
    box(c, '#171f32', x - 35, y + 15, 70, 6);
    for (let i = 0; i < 6; i++)
      box(c, count ? '#b586ff' : '#51435e', x - 27 + i * 10, y + 16, 4, 2);
    const visible = Math.min(15, count),
      levels = Math.ceil((Math.sqrt(8 * visible + 1) - 1) / 2);
    let shown = 0;
    for (let row = 0; row < levels; row++) {
      const inRow = Math.min(levels - row, visible - shown);
      for (let col = 0; col < inRow; col++, shown++)
        drawData(c, x + (col - (inRow - 1) / 2) * 15, y - row * 13, 0, 0.8, { bob: false });
    }
    this.tag(c, String(count), x, y - 85, '#302445', count ? '#e0c4ff' : '#9e95a8', 12);
    if (
      local?.role === 'worker' &&
      !local.carrying &&
      count &&
      Math.abs(local.x + 14 - x) < 100 &&
      Math.abs(local.y - y) < 100
    ) {
      const nearby = (this.state?.piles || [])
        .filter((other) => other.remaining > 0)
        .sort(
          (a, b) =>
            Math.hypot(local.x + 14 - a.x, local.y + 20 - a.y) -
            Math.hypot(local.x + 14 - b.x, local.y + 20 - b.y),
        );
      if (nearby[0]?.id === pile.id)
        this.tag(c, 'TAKE A CHIP', x, y + 39, '#fff4ce', '#413754', 12);
    }
  }
  gate(c, g, local) {
    const neutral = g.team == null;
    const t = neutral
      ? { main: '#f4efd9', dark: '#657b82', light: '#fffbea', ink: '#28424c' }
      : TEAM[g.team];
    const speed = g.kind === 'speed',
      cx = g.x + g.w / 2;
    const now = (this.state?.time || Date.now()) + Math.min(120, performance.now() - this.received);
    const installing = this.state?.players?.find(
      (p) => p.alive && p.upgradeGateId === g.id && p.upgradeUntil > now,
    );
    // Industrial AI1 upgrade cabinet: lens cap, fins, purple Roboflow badge,
    // glass chamber and a team-colored ownership bezel.
    box(c, '#1d2333', g.x - 4, g.y + 9, g.w + 8, g.h - 6);
    box(c, '#414653', g.x, g.y + 13, g.w, g.h - 14);
    box(c, '#171e2d', g.x + 11, g.y + 23, g.w - 22, g.h - 31);
    box(c, '#325263', g.x + 15, g.y + 27, g.w - 30, g.h - 40);
    box(c, t.main, g.x - 6, g.y + 4, g.w + 12, 9);
    box(c, t.light, g.x - 2, g.y + 5, g.w + 4, 2);
    box(c, '#111624', cx - 16, g.y - 12, 32, 24);
    box(c, '#9096a3', cx - 13, g.y - 10, 26, 20);
    box(c, '#222a3d', cx - 9, g.y - 8, 18, 16);
    box(c, '#563b80', cx - 6, g.y - 6, 12, 12);
    box(c, '#b69be6', cx - 3, g.y - 4, 5, 5);
    for (const side of [-1, 1])
      for (let i = 0; i < 5; i++)
        box(c, '#131a29', side < 0 ? g.x - 7 : g.x + g.w + 1, g.y + 21 + i * 11, 6, 5);
    box(c, '#9561d7', g.x + g.w - 11, g.y + 18, 8, g.h - 28);
    text(c, 'R', g.x + g.w - 7, g.y + 30, 8, '#fff8ef');
    box(c, t.main, g.x + 9, g.y + 22, 3, g.h - 31);
    box(c, t.main, g.x + g.w - 15, g.y + 22, 3, g.h - 31);
    box(c, '#171e2d', g.x - 8, g.y + g.h - 3, g.w + 16, 9);
    box(c, t.main, g.x - 5, g.y + g.h - 3, g.w + 10, 2);
    c.globalAlpha = 0.17 + Math.sin(this.elapsed * 3) * 0.04;
    box(c, t.light, g.x + 15, g.y + 28, g.w - 30, g.h - 40);
    c.globalAlpha = 1;
    const yy = g.y + 39 + Math.sin(this.elapsed * 2) * 3;
    if (speed) {
      box(c, '#fff2aa', cx - 2, yy, 8, 9);
      box(c, '#fff2aa', cx - 7, yy + 7, 10, 7);
      box(c, '#fff2aa', cx - 4, yy + 11, 5, 9);
    } else {
      for (const side of [-1, 1])
        for (let i = 0; i < 3; i++)
          box(
            c,
            '#fff2aa',
            cx + side * (7 + i * 5) - (side < 0 ? 5 : 0),
            yy - i * 3,
            6,
            13 - i * 2,
          );
      box(c, '#fff2aa', cx - 2, yy + 4, 4, 14);
    }
    if (installing) {
      const progress = clamp(1 - (installing.upgradeUntil - now) / 650, 0, 1);
      box(c, '#162333', g.x + 14, g.y + g.h + 10, g.w - 28, 5);
      box(c, t.main, g.x + 14, g.y + g.h + 10, (g.w - 28) * progress, 5);
      box(
        c,
        '#e9c7ff',
        g.x + 15,
        g.y + 30 + Math.round((this.elapsed * 38) % (g.h - 43)),
        g.w - 30,
        2,
      );
    }
    if (local && Math.abs(local.x + 14 - cx) < 100 && Math.abs(local.y - g.y) < 100) {
      const nearest = [...(this.state?.gates || this.map.gates || [])].sort(
        (a, b) =>
          Math.hypot(local.x + 14 - a.x - a.w / 2, local.y - a.y) -
          Math.hypot(local.x + 14 - b.x - b.w / 2, local.y - b.y),
      )[0];
      if (nearest?.id !== g.id) return;
      const available = neutral || g.team === local.team;
      const station = speed ? 'SPEED' : 'FLIGHT';
      const hint =
        local.role === 'queen'
          ? `CLAIM ${station}`
          : local.role === 'warrior'
            ? 'PROTECT YOUR WORKERS'
            : !available
              ? 'QUEEN MUST CLAIM'
              : !local.carrying
                ? `${station} · BRING 1 CHIP`
                : speed && local.speedBoost
                  ? 'SPEED EQUIPPED'
                  : installing
                    ? 'INSTALLING…'
                    : `${this.touchEnabled ? 'ACTION' : 'E'} · GET ${station}`;
      this.tag(c, hint, cx, g.y - 42, '#243c4b', available ? '#f8edc4' : '#ffb2a2', 12);
    }
  }
  player(c, p, now, isLocal) {
    const team = TEAM[p.team || 0];
    if (p.speedBoost && Math.abs(p.vx || 0) > 30) {
      c.globalAlpha = 0.5;
      for (let i = 0; i < 3; i++)
        box(
          c,
          '#ffe27a',
          p.x + 14 - (p.facing || 1) * (22 + i * 9),
          p.y + 14 + i * 7,
          9 - i * 2,
          3,
        );
      c.globalAlpha = 1;
    }
    if (p.dive) {
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = 0.5 - i * 0.12;
        box(c, team.light, p.x + 4 + i * 9, p.y - 14 - i * 6, 3, 20 + i * 3);
      }
      c.globalAlpha = 1;
      box(c, '#fff2aa', p.x + 11, p.y + 39, 6, 5);
      box(c, '#fff2aa', p.x + 13, p.y + 44, 2, 3);
    }
    c.globalAlpha = 0.15;
    box(c, '#193e48', p.x - 4, p.y + 34, 37, 5);
    c.globalAlpha = 1;
    const invulnerable = (p.invulnerableUntil || 0) > now;
    if (invulnerable) c.globalAlpha = 0.55 + Math.sin(this.elapsed * 22) * 0.2;
    drawRaccoon(c, p, this.elapsed, { now, mapId: this.map.mapId });
    c.globalAlpha = 1;
    if ((p.attackUntil || 0) > now) {
      c.save();
      c.translate(p.x + 14, p.y + 15);
      c.scale(p.facing || 1, 1);
      c.strokeStyle = '#fff7c3';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(4, 0, 37, -1.1, 1.1);
      c.stroke();
      c.strokeStyle = team.main;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(4, 0, 43, -0.8, 0.8);
      c.stroke();
      c.restore();
    }
    const name = String(p.name || 'Lenny').slice(0, 16);
    if (isLocal) {
      const y = p.y - (p.role === 'queen' ? 27 : 17);
      box(c, '#fff6d1', p.x + 8, y - 5, 12, 4);
      box(c, '#fff6d1', p.x + 11, y - 1, 6, 4);
      box(c, '#fff6d1', p.x + 13, y + 3, 2, 2);
    }
    const showName =
      this.nameMode === 'all' || (this.nameMode === 'nearby' && this.namedPlayers?.has(p.id));
    if (showName)
      this.nameplate(
        c,
        `${p.role === 'queen' ? '♛ ' : ''}${name}${isLocal ? ' · YOU' : ''}`,
        p.x + 14,
        p.y - (p.role === 'queen' ? 60 : 43),
        team.main,
        isLocal,
        p.role === 'queen' ? (p.queenLives ?? 3) : null,
      );
    else if (p.role === 'queen') {
      const lives = clamp(p.queenLives ?? 3, 0, 3);
      for (let i = 0; i < 3; i++) {
        box(c, '#253145', p.x + 3 + i * 8, p.y - 21, 7, 6);
        if (i < lives) box(c, '#ffe5a0', p.x + 4 + i * 8, p.y - 20, 5, 4);
      }
    }
    if (p.emote && (p.emoteUntil || 0) > now)
      this.tag(c, p.emote, p.x + 14, p.y - 74, '#fff8e2', '#395268');
  }
  nameplate(c, s, x, y, color, isLocal, queenLives = null) {
    // Keep names readable when the Classic arena is fitted to a laptop screen.
    const labelScale = this.map?.mode === 'normal' ? Math.max(1, 1.2 / this.cssScale) : 1;
    const hasLives = Number.isFinite(queenLives),
      lifeWidth = hasLives ? 32 : 0;
    c.font = 'bold 10px "Courier New", monospace';
    const w = c.measureText(s).width + 14 + lifeWidth;
    const slots = this.nameplateSlots || [];
    for (let row = 0; row < 4; row++) {
      if (
        !slots.some(
          (q) =>
            Math.abs(q.y - y) < 18 * labelScale &&
            q.x1 < x + (w * labelScale) / 2 &&
            q.x2 > x - (w * labelScale) / 2,
        )
      )
        break;
      y -= 19 * labelScale;
    }
    slots.push({ x1: x - (w * labelScale) / 2, x2: x + (w * labelScale) / 2, y });
    if (labelScale !== 1) {
      c.save();
      c.translate(x, y);
      c.scale(labelScale, labelScale);
      x = 0;
      y = 0;
    }
    c.globalAlpha = 0.88;
    box(c, '#20243a', x - w / 2, y - 9, w, 18);
    c.globalAlpha = 1;
    box(c, isLocal ? '#fff0bd' : color, x - w / 2, y + 8, w, 1);
    text(c, s, x - lifeWidth / 2, y + 1, 10, isLocal ? '#fff5ce' : color);
    if (hasLives) {
      // Three compact pips belong to this queen, even in a 12-queen XXL crew.
      const lives = clamp(Math.floor(queenLives), 0, 3);
      for (let i = 0; i < 3; i++) {
        const px = x + w / 2 - 29 + i * 9,
          full = i < lives;
        box(c, full ? '#fff3b3' : '#78778d', px, y - 3, 6, 6);
        box(c, full ? '#ffd76d' : '#20243a', px + 1, y - 2, 4, 4);
        if (!full) {
          box(c, '#78778d', px + 1, y - 2, 1, 1);
          box(c, '#78778d', px + 4, y + 1, 1, 1);
        }
      }
    }
    if (labelScale !== 1) c.restore();
  }
  tag(c, s, x, y, bg, fg, minCss = 8.5) {
    const labelScale =
      this.map?.mode === 'normal' && !this.followCamera
        ? Math.max(1, minCss / (10 * this.cssScale))
        : 1;
    if (labelScale !== 1) {
      c.save();
      c.translate(x, y);
      c.scale(labelScale, labelScale);
      x = 0;
      y = 0;
    }
    c.font = 'bold 10px "Courier New", monospace';
    const w = c.measureText(s).width + 16;
    box(c, bg, x - w / 2, y - 9, w, 19);
    text(c, s, x, y + 1, 10, fg);
    if (labelScale !== 1) c.restore();
  }
  compass(c, p) {
    const base = this.map.bases?.find((b) => b.team === p.team);
    const g = this.state?.gator;
    const indicators = [];
    if (base)
      indicators.push({
        x: base.x + base.w / 2,
        y: base.y,
        label: p.carrying ? 'DELIVER DATA' : 'YOUR HQ',
        color: TEAM[p.team].main,
      });
    if (g)
      indicators.push({
        x: g.x,
        y: g.y,
        label: getMapDefinition(this.map.mapId).ride.name.toUpperCase(),
        ride: true,
        color: '#e6ebbd',
      });
    for (const q of indicators) {
      const x = q.x - this.camera.x;
      if (x > 60 && x < this.w - 60) continue;
      if (this.touchCompact) {
        const right = x > this.w;
        c.save();
        c.scale(1 / this.cssScale, 1 / this.cssScale);
        this.tag(
          c,
          `${right ? '' : '‹ '}${q.label}${right ? ' ›' : ''}`,
          (this.w * this.cssScale) / 2 + (q.ride ? 82 : -82),
          this.h * this.cssScale -
            (this.touchPortrait ? this.arenaBottom + 15 : 49 + this.safeBottom),
          '#294c57',
          q.color,
        );
        c.restore();
        continue;
      }
      const right = x > this.w;
      const xx = right ? this.w - 55 : 55;
      const yy = this.h - 90 + (q.ride ? 27 : 0);
      this.tag(c, `${right ? '' : '‹ '}${q.label}${right ? ' ›' : ''}`, xx, yy, '#294c57', q.color);
    }
  }
  radar(c, p) {
    const compact = this.touchCompact;
    c.save();
    if (compact) c.scale(1 / this.cssScale, 1 / this.cssScale);
    const w = compact ? 150 : 170,
      h = compact ? 32 : 46,
      x = compact ? (this.w * this.cssScale - w) / 2 : 18,
      y = compact ? (this.touchPortrait ? 98 : 91) + this.safeTop : 174;
    c.globalAlpha = 0.78;
    box(c, '#253e4d', x, y, w, h);
    c.globalAlpha = 1;
    text(
      c,
      this.map.mode === 'xxl' ? 'XXL · DISTRICT RADAR' : 'CLASSIC · ARENA RADAR',
      x + 8,
      y + (compact ? 8 : 10),
      compact ? 7 : 8,
      '#c5dfd3',
      'left',
    );
    const line = y + (compact ? 22 : 31);
    box(c, '#54767a', x + 9, line, w - 18, 2);
    for (const b of this.map.bases || [])
      box(c, TEAM[b.team].main, x + 9 + (b.x / this.map.width) * (w - 18), line - 5, 5, 10);
    const g = this.state?.gator;
    if (g) box(c, '#e9d77b', x + 9 + (g.x / this.map.width) * (w - 18), line - 3, 5, 6);
    box(c, '#ffffff', x + 9 + (p.x / this.map.width) * (w - 18), line - 8, 3, 16);
    c.restore();
  }
  attract(c) {
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    drawGlobalHero(c, this.w, this.h);
  }
}

export function renderPreview(canvas) {
  const renderer = new Renderer(canvas);
  let last = performance.now(),
    handle;
  function frame(now) {
    renderer.render((now - last) / 1000);
    last = now;
    handle = requestAnimationFrame(frame);
  }
  handle = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(handle);
    renderer.destroy();
  };
}
