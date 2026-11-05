import { drawRaccoon, drawGator, drawData, TEAM } from './sprites.js';

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
    for (const b of map.bases || [])
      if (this.visible(b.x - 40, b.y - 80, b.w + 80, b.h + 80)) this.base(c, b);
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
      drawGator(c, gator, this.elapsed, rider?.team);
      if (!gator.riderId) {
        text(c, 'FLORIDA MAN’S UBER', gator.x, gator.y - 57, 10, '#417763');
        if (local && Math.abs(local.x - gator.x) < 130)
          this.tag(
            c,
            local.role === 'worker' ? 'E  HOP ON' : 'WORKERS RIDE · YOU PROTECT',
            gator.x,
            gator.y - 40,
            '#effec6',
            '#244f50',
          );
      }
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
      drawRaccoon(c, { ...rawLocal, grounded: false }, this.elapsed);
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
    const grad = c.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, '#f6b6aa');
    grad.addColorStop(0.55, '#ffe1ae');
    grad.addColorStop(1, '#fceac1');
    c.fillStyle = grad;
    c.fillRect(0, 0, this.w, this.h);
    const sunX = this.w * 0.73 - this.camera.x * 0.018,
      sunY = this.h * 0.24 - this.camera.y * 0.025;
    c.fillStyle = '#fff2b6';
    c.beginPath();
    c.arc(sunX, sunY, 75, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 4; i++) box(c, '#f8c3a7', sunX - 80, sunY + 20 + i * 13, 160, 3 + i);
    for (let i = -1; i < 7; i++) {
      const x = i * 260 - ((this.camera.x * 0.06) % 260),
        y = 70 + random(i + 4) * this.h * 0.3;
      box(c, '#ffe7c4', x, y, 90, 8);
      box(c, '#ffe7c4', x + 17, y - 8, 50, 12);
      box(c, '#ffe7c4', x - 15, y + 8, 130, 4);
    }
    const horizon = this.h * 0.73 + (this.map.height - this.camera.y - this.h) * 0.1;
    box(c, '#95d4cc', 0, horizon, this.w, this.h - horizon);
    box(c, '#b5e5d3', 0, horizon + 7, this.w, 5);
    for (let i = 0; i < 7; i++)
      box(
        c,
        i % 2 ? '#b4e6d6' : '#78c8c3',
        ((i * 211 - this.camera.x * 0.12) % (this.w + 300)) - 100,
        horizon + 20 + i * 21,
        90 + i * 11,
        3,
      );
    // Three skyline depths; deterministic towers scroll in parallax.
    this.skyline(c, horizon, '#c8b4ba', 0.12, 110, 1);
    this.skyline(c, horizon + 12, '#a7bbc0', 0.2, 75, 2);
  }
  skyline(c, bottom, color, parallax, maxHeight, seed) {
    const space = 150;
    const offset = this.camera.x * parallax;
    const start = Math.floor(offset / space) - 1;
    for (let i = start; i < start + Math.ceil(this.w / space) + 3; i++) {
      const r = random(i + seed * 90),
        x = i * space - offset,
        w = 60 + r * 70,
        h = 30 + random(i + 88) * maxHeight;
      box(c, color, x, bottom - h, w, h);
      box(c, color, x + 8, bottom - h - 8, w - 16, 9);
      if (r > 0.5) box(c, color, x + w * 0.5, bottom - h - 25, 3, 20);
      c.globalAlpha = 0.3;
      for (let yy = bottom - h + 14; yy < bottom - 8; yy += 18)
        box(c, '#fff0d5', x + 10, yy, w - 20, 3);
      c.globalAlpha = 1;
    }
  }
  scenery(c) {
    const floor = this.map.height - 80;
    const first = Math.floor((this.camera.x - 200) / 450);
    for (let i = first; i < first + Math.ceil(this.w / 450) + 2; i++) {
      const x = i * 450 + 100;
      if (x < 0 || x > this.map.width) continue;
      this.palm(c, x, floor, 1 + (i % 3) * 0.16);
      if (i % 2 === 0) this.beachUmbrella(c, x + 135, floor);
    }
    const start = Math.floor(this.camera.x / 1500) - 1;
    for (let i = start; i < start + 3; i++) {
      const x = i * 1500 + 750;
      if (x < 300 || x > this.map.width - 300) continue;
      // A roadside motel becomes a love letter to computer vision.
      box(c, '#cc8f9c', x, floor - 200, 176, 200);
      box(c, '#f4c4b7', x + 8, floor - 196, 160, 192);
      box(c, '#fff0cc', x - 5, floor - 205, 186, 8);
      box(c, '#c7899b', x + 14, floor - 164, 148, 5);
      for (let k = 0; k < 3; k++) {
        box(c, '#71aaa9', x + 18 + k * 50, floor - 141, 32, 42);
        box(c, '#d6e4c2', x + 20 + k * 50, floor - 139, 28, 3);
      }
      box(c, '#d291a3', x + 14, floor - 88, 148, 5);
      box(c, '#6ca5a3', x + 67, floor - 62, 42, 62);
      box(c, '#263d52', x + 13, floor - 190, 150, 22);
      text(c, 'ROBOFLOW', x + 88, floor - 178, 16, '#d6ffe5');
      text(c, 'VISION  MOTEL', x + 88, floor - 70, 10, '#895f76');
    }
    const track = this.map.gatorTrack;
    if (track) {
      const y = track.y + 27;
      box(c, '#e5b786', track.x1, y, track.x2 - track.x1, 9);
      const lo = Math.max(track.x1, Math.floor(this.camera.x / 65) * 65);
      for (let x = lo; x < Math.min(track.x2, this.camera.x + this.w + 65); x += 65)
        box(c, '#fff0c8', x, y + 2, 30, 3);
    }
  }
  palm(c, x, y, s = 1) {
    c.save();
    c.translate(Math.round(x), Math.round(y));
    c.scale(s, s);
    box(c, '#a57777', -6, -125, 11, 125);
    box(c, '#c3977c', -1, -118, 5, 118);
    for (let i = 0; i < 7; i++) box(c, '#926d70', -6, -110 + i * 16, 11, 4);
    const dark = '#3e8c7b',
      light = '#69b68c';
    for (const side of [-1, 1]) {
      box(c, dark, side === 1 ? 0 : -55, -137, 55, 12);
      box(c, light, side === 1 ? 0 : -46, -143, 46, 8);
      box(c, dark, side === 1 ? 43 : -68, -127, 25, 11);
      box(c, dark, side === 1 ? 61 : -74, -118, 13, 15);
      box(c, light, side === 1 ? 3 : -32, -156, 29, 12);
      box(c, dark, side === 1 ? 23 : -46, -167, 23, 11);
      box(c, dark, side === 1 ? 9 : -24, -119, 15, 32);
      box(c, light, side === 1 ? 9 : -17, -124, 8, 28);
    }
    box(c, '#8c676a', -10, -128, 20, 12);
    box(c, '#c3a07b', -7, -127, 7, 6);
    c.restore();
  }
  beachUmbrella(c, x, y) {
    box(c, '#d1a181', x, y - 68, 4, 68);
    box(c, '#da8c94', x - 35, y - 70, 74, 7);
    box(c, '#f3acaa', x - 28, y - 79, 60, 10);
    box(c, '#ffe3bf', x - 17, y - 85, 38, 9);
    box(c, '#f3acaa', x - 6, y - 91, 17, 9);
    box(c, '#fff1d1', x - 8, y - 80, 20, 15);
    box(c, '#ac8b84', x - 30, y - 11, 25, 6);
    box(c, '#ac8b84', x - 27, y - 28, 4, 22);
  }
  platform(c, p) {
    const floor = p.y >= this.map.height - 90;
    if (floor) {
      box(c, '#a4c8aa', p.x, p.y, p.w, p.h);
      box(c, '#e6e3bd', p.x, p.y, p.w, 10);
      box(c, '#f9efce', p.x, p.y, p.w, 4);
      box(c, '#78aa97', p.x, p.y + 22, p.w, 4);
      for (
        let x = Math.max(p.x, Math.floor(this.camera.x / 70) * 70);
        x < Math.min(p.x + p.w, this.camera.x + this.w + 80);
        x += 70
      ) {
        box(c, '#8db69d', x, p.y + 40, 28, 4);
        box(c, '#bdd4af', x + 30, p.y + 58, 15, 4);
      }
      return;
    }
    const tone = p.kind === 'center' ? '#e79999' : '#78b8b6';
    box(c, '#466e80', p.x + 3, p.y + 6, p.w, Math.max(p.h, 19));
    box(c, tone, p.x, p.y, p.w, p.h);
    box(c, '#fff0ca', p.x, p.y, p.w, 6);
    box(c, '#afdad0', p.x, p.y + 6, p.w, 3);
    for (let x = p.x + 12; x < p.x + p.w - 10; x += 32)
      box(c, 'rgba(28,76,85,.15)', x, p.y + 13, 16, 4);
    box(c, '#436e7b', p.x + 8, p.y + p.h, 10, 8);
    box(c, '#436e7b', p.x + p.w - 18, p.y + p.h, 10, 8);
    // Small neon landing lights make platform boundaries obvious at speed.
    box(c, '#f6ffcc', p.x + 2, p.y - 3, 5, 3);
    box(c, '#f6ffcc', p.x + p.w - 7, p.y - 3, 5, 3);
  }
  base(c, b) {
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
    text(c, `${Math.max(0, slots - score)} TO GO`, b.x + b.w / 2, b.y + b.h - 14, 10, '#fff3ce');
    const door = b.door || { x: b.x + b.w / 2 - 28, w: 56 };
    box(c, '#182d3f', door.x - 4, b.y + b.h - 5, door.w + 8, 8);
    box(c, '#edffb7', door.x, b.y + b.h - 5, door.w, 3);
    text(c, '↓ DELIVER HERE ↓', b.x + b.w / 2, b.y + b.h + 35, 10, t.dark);
    const flagX = b.team === 0 ? b.x - 25 : b.x + b.w + 24;
    box(c, '#335a67', flagX, b.y - 75, 4, b.h + 75);
    box(c, t.main, flagX + 4, b.y - 75, 53, 29);
    box(c, t.light, flagX + 8, b.y - 71, 45, 4);
    text(c, b.team === 0 ? '01' : '02', flagX + 30, b.y - 57, 14, t.ink);
    this.tag(c, `${score} / ${slots} · DATA VAULT`, b.x + b.w / 2, b.y - 28, '#fff4ce', t.ink);
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
    this.tag(
      c,
      count ? `${count} CHIPS` : 'EMPTY',
      x,
      y - 77,
      '#302445',
      count ? '#e0c4ff' : '#9e95a8',
    );
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
      if (nearby[0]?.id === pile.id) text(c, 'WALK IN · TAKE ONE', x, y + 34, 8, '#413754');
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
    text(c, speed ? 'ROBOFLOW · TURBO' : 'AI1 · FLIGHT LAB', cx, g.y - 38, 9, '#36344e');
    text(
      c,
      neutral ? 'NEUTRAL' : g.team === 0 ? 'PURPLE CONTROL' : 'SUNSET CONTROL',
      cx,
      g.y - 25,
      8,
      t.ink,
    );
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
    text(c, installing ? 'INSTALLING…' : '1 DATA', cx, g.y + g.h - 12, 7, '#fff1c3');
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
      const available = neutral || g.team === local.team;
      const hint =
        local.role === 'queen'
          ? 'TOUCH TO CLAIM'
          : local.role === 'warrior'
            ? 'PROTECT YOUR WORKERS'
            : !available
              ? 'YOUR QUEEN MUST CLAIM IT'
              : !local.carrying
                ? 'BRING 1 DATA CHIP'
                : speed && local.speedBoost
                  ? 'SPEED ALREADY EQUIPPED'
                  : installing
                    ? 'INSTALLING UPGRADE…'
                    : 'E  ENTER THE MACHINE';
      this.tag(c, hint, cx, g.y - 60, '#243c4b', available ? '#f8edc4' : '#ffb2a2');
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
    drawRaccoon(c, p, this.elapsed, { now });
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
        p.y - (p.role === 'queen' ? 48 : 39),
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
    const labelScale = this.map?.mode === 'normal' ? Math.max(1, 0.9 / this.cssScale) : 1;
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
  tag(c, s, x, y, bg, fg) {
    const labelScale =
      this.map?.mode === 'normal' && !this.followCamera ? Math.max(1, 0.85 / this.cssScale) : 1;
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
    if (g) indicators.push({ x: g.x, y: g.y, label: 'GATOR', color: '#d5edaa' });
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
          (this.w * this.cssScale) / 2 + (q.label === 'GATOR' ? 82 : -82),
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
      const yy = this.h - 90 + (q.label === 'GATOR' ? 27 : 0);
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
    const prev = this.map;
    this.map = { width: 3200, height: 1320 };
    this.camera = { x: this.elapsed * 7, y: 600 };
    this.background(c);
    const y = this.h - 65;
    this.palm(c, this.w * 0.13, y, 1.4);
    this.palm(c, this.w * 0.87, y, 1.65);
    this.beachUmbrella(c, this.w * 0.67, y);
    box(c, '#e5deaf', 0, y, this.w, 65);
    box(c, '#f7edc8', 0, y, this.w, 8);
    drawGator(c, { x: this.w * 0.55, y: y - 18, riderId: 1 }, this.elapsed, 1);
    drawRaccoon(
      c,
      {
        x: this.w * 0.55 - 12,
        y: y - 74,
        team: 1,
        role: 'worker',
        grounded: true,
        facing: -1,
        vx: 60,
        carrying: true,
      },
      this.elapsed,
    );
    drawRaccoon(
      c,
      { x: this.w * 0.34, y: y - 40, team: 0, role: 'queen', grounded: true, facing: 1, vx: 70 },
      this.elapsed,
      { scale: 2.2 },
    );
    for (let i = 0; i < 3; i++) drawData(c, this.w * 0.4 + i * 30, y - 20 - i * 15, this.elapsed);
    this.map = prev;
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
