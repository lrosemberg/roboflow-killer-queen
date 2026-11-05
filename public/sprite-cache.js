import { drawRaccoon, isSpriteAtlasReady } from './sprites.js';

const WIDTH = 128;
const HEIGHT = 96;
const ANCHOR_X = 64;
const ANCHOR_Y = 84;
const PHASES = 16;

function createBrowserCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Each instance belongs to one renderer. Frames are allocated on demand, never
// per player; a hard cap limits RGBA backing storage to at most 12 MiB.
export class RaccoonSpriteCache {
  constructor({
    createCanvas = createBrowserCanvas,
    drawSprite = drawRaccoon,
    isSourceReady = isSpriteAtlasReady,
    capacity = 192,
    enabled = true,
  } = {}) {
    this.createCanvas = createCanvas;
    this.drawSprite = drawSprite;
    this.isSourceReady = isSourceReady;
    this.capacity = Math.max(1, Math.min(256, Math.floor(Number(capacity) || 192)));
    this.enabled = enabled;
    this.frames = new Map();
    this.mapId = null;
    this.sourceReady = null;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.bypasses = 0;
  }

  clear() {
    for (const canvas of this.frames.values()) {
      // Release the backing store immediately, including OffscreenCanvas.
      canvas.width = 0;
      canvas.height = 0;
    }
    this.frames.clear();
  }

  stats() {
    return {
      entries: this.frames.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      bypasses: this.bypasses,
      capacity: this.capacity,
      estimatedBytes: this.frames.size * WIDTH * HEIGHT * 4,
    };
  }

  draw(ctx, player, time, options = {}) {
    const mapId = options.mapId || 'miami';
    const ready = Boolean(this.isSourceReady());
    if (mapId !== this.mapId || ready !== this.sourceReady) {
      this.clear();
      this.mapId = mapId;
      this.sourceReady = ready;
    }
    const now = options.now ?? Date.now();
    // Never retain the procedural placeholder face while the atlas loads.
    // Attack poses use the exact short-lived swing instead of another key axis.
    if (!this.enabled || !ready || (player.attackUntil || 0) > now) {
      this.bypasses++;
      this.drawSprite(ctx, player, time, options);
      return;
    }
    const moving = Math.abs(player.vx || 0) > 15;
    const grounded = Boolean(player.grounded);
    const role = player.role || 'worker';
    const speedBoost = Boolean(player.speedBoost && role !== 'queen');
    const motion = grounded ? (moving ? 'walk' : 'idle') : moving ? 'air-move' : 'air-idle';
    // Walking retains all eight planted-foot poses, sampled twice each.
    // Air/idle cycles also retain sixteen phases without caching elapsed time.
    const fps = grounded ? (moving ? 28 * (speedBoost ? 1.35 : 1) : 8) : 24;
    const phase =
      ((Math.floor((Number.isFinite(time) ? time : 0) * fps) % PHASES) + PHASES) % PHASES;
    const team = player.team === 1 ? 1 : 0;
    const key = `${mapId}|${role}|${team}|${motion}|${Number(Boolean(player.carrying))}|${Number(speedBoost)}|${phase}`;
    let canvas = this.frames.get(key);
    if (canvas) {
      this.hits++;
      // Moving a used entry to the end implements an LRU without extra nodes.
      this.frames.delete(key);
      this.frames.set(key, canvas);
    } else {
      this.misses++;
      canvas = this.createCanvas(WIDTH, HEIGHT);
      const frameCtx = canvas?.getContext('2d', { alpha: true });
      if (!frameCtx) {
        this.bypasses++;
        this.drawSprite(ctx, player, time, options);
        return;
      }
      frameCtx.imageSmoothingEnabled = false;
      this.drawSprite(
        frameCtx,
        {
          id: 'shared-lenny',
          x: ANCHOR_X - 14,
          y: ANCHOR_Y - 36,
          facing: 1,
          team,
          role,
          grounded,
          vx: moving ? 270 * (speedBoost ? 1.35 : 1) : 0,
          vy: 0,
          speedBoost,
          carrying: Boolean(player.carrying),
          attackUntil: 0,
          alive: true,
        },
        phase / fps,
        { mapId, now: 0, scale: 1.75 },
      );
      if (this.frames.size >= this.capacity) {
        const oldestKey = this.frames.keys().next().value;
        const oldest = this.frames.get(oldestKey);
        this.frames.delete(oldestKey);
        oldest.width = 0;
        oldest.height = 0;
        this.evictions++;
      }
      this.frames.set(key, canvas);
    }
    const scale = (options.scale || 1.75) / 1.75;
    ctx.save();
    ctx.translate(Math.round(player.x + 14), Math.round(player.y + 36));
    ctx.scale((player.facing || 1) * scale, scale);
    ctx.drawImage(canvas, -ANCHOR_X, -ANCHOR_Y);
    ctx.restore();
  }
}
