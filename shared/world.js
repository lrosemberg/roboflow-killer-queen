import { DEFAULT_MAP_ID, getMapDefinition } from './maps.js';

export const PLAYER_W = 28;
export const PLAYER_H = 36;
export const SPEED = 270;
export const GRAVITY = 1450;
export const JUMP_SPEED = 760;
export const TICK_RATE = 60;
export const SCORE_TARGETS = Object.freeze({ normal: 12, xxl: 144 });
export const BOT_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);

export function economyForPlayers(total) {
  const economyPlayerCount = Math.max(
    0,
    Math.min(120, Math.floor(Number.isFinite(total) ? total : 0)),
  );
  return {
    economyPlayerCount,
    scoreTarget: Math.max(1, Math.ceil((12 * economyPlayerCount) / 10)),
    resourceCount: Math.max(6, 6 * economyPlayerCount),
  };
}

export function configureMapEconomy(map, total) {
  Object.assign(map, economyForPlayers(total));
  const perPile = Math.floor(map.resourceCount / map.berryPiles.length);
  const extra = map.resourceCount % map.berryPiles.length;
  map.berrySpawns = map.berryPiles.flatMap((pile, pileIndex) =>
    Array.from({ length: perPile + Number(pileIndex < extra) }, (_, index) => ({
      x: pile.x + ((index % 5) - 2) * 7,
      y: pile.y - (Math.floor(index / 5) % 3) * 5,
      pileId: pile.id,
    })),
  );
  return map;
}

// Deterministic, mirrored Classic recipes. Coordinates are gameplay geometry;
// the renderer supplies each city's scenery without affecting collisions.
const LAYOUTS = {
  miami: {
    steps: [
      [20, 632, 220],
      [330, 524, 220],
      [20, 416, 220],
      [330, 308, 220],
    ],
    home: 140,
    roof: [90, 290],
    center: [590, 260],
    bridge: [630, 180],
    ground: [560, 660, 780, 880],
    raised: [670, 770],
    xxl: { spacing: 470, stagger: 215, widths: [275, 295, 315], offset: 70 },
  },
  'san-francisco': {
    steps: [
      [30, 632, 230],
      [320, 524, 260],
      [70, 416, 180],
      [310, 308, 270],
    ],
    home: 120,
    roof: [70, 280],
    center: [570, 300],
    bridge: [610, 220],
    ground: [540, 660, 780, 900],
    raised: [665, 775],
    xxl: { spacing: 450, stagger: 190, widths: [260, 290, 320], offset: 60 },
  },
  'new-york': {
    steps: [
      [0, 630, 200],
      [290, 521, 200],
      [60, 414, 170],
      [320, 307, 190],
    ],
    home: 140,
    roof: [90, 290],
    center: [600, 240],
    bridge: [630, 180],
    ground: [560, 665, 775, 880],
    raised: [670, 770],
    xxl: { spacing: 430, stagger: 200, widths: [235, 255, 275], offset: 85 },
  },
  brazil: {
    steps: [
      [40, 632, 220],
      [310, 524, 210],
      [0, 416, 250],
      [330, 308, 240],
    ],
    home: 160,
    roof: [110, 290],
    center: [590, 260],
    bridge: [630, 180],
    ground: [570, 670, 770, 870],
    raised: [670, 770],
    xxl: { spacing: 500, stagger: 235, widths: [315, 335, 355], offset: 45 },
  },
  singapore: {
    steps: [
      [20, 628, 220],
      [340, 520, 220],
      [40, 412, 220],
      [350, 306, 220],
    ],
    home: 130,
    roof: [80, 280],
    center: [580, 280],
    bridge: [640, 160],
    ground: [550, 660, 780, 890],
    raised: [670, 770],
    xxl: { spacing: 460, stagger: 210, widths: [275, 295, 315], offset: 65 },
  },
};

export function createMap(mode = 'normal', totalPlayers, mapId = DEFAULT_MAP_ID) {
  mode = mode === 'xxl' ? 'xxl' : 'normal';
  const definition = getMapDefinition(mapId),
    layout = LAYOUTS[definition.id];
  const width = mode === 'xxl' ? 12000 : 1440;
  const height = mode === 'xxl' ? 2000 : 820;
  const floor = height - 80;
  const platforms = [{ x: 0, y: floor, w: width, h: 80, kind: 'ground' }];
  const ledge = (x, y, w, kind = 'neon') => platforms.push({ x, y, w, h: 22, kind });
  const mirrored = (x, y, w, kind) => {
    ledge(x, y, w, kind);
    ledge(width - x - w, y, w, kind);
  };
  if (mode === 'normal') {
    // Consecutive rises are 106–112px. Skipping a tier exceeds the worker's
    // jump apex, so every city's return route retains its alternating climb.
    for (const [x, y, w] of layout.steps) mirrored(x, y, w);
    mirrored(layout.roof[0], 200, layout.roof[1], 'roof');
    ledge(layout.center[0], 200, layout.center[1], 'roof');
    ledge(layout.bridge[0], layout.steps[0][1], layout.bridge[1]);
  } else {
    const { spacing, stagger, widths, offset } = layout.xxl;
    for (let row = 0; row < 7; row++) {
      const y = floor - 180 * (row + 1),
        w = widths[row % widths.length],
        kind = row % 2 ? 'roof' : 'neon';
      if (definition.id === DEFAULT_MAP_ID) {
        // Preserve the existing Miami XXL arena for old rooms and links.
        for (let x = offset + (row % 2) * stagger; x < width - 250; x += spacing)
          ledge(x, y, Math.min(width - x, w), kind);
      } else {
        // Other districts mirror their entire skyline, including the center.
        for (let x = offset + (row % 2) * stagger; x + w <= width / 2 - 50; x += spacing)
          mirrored(x, y, w, kind);
        ledge(width / 2 - 120, y, 240, kind);
      }
    }
    mirrored(90, floor - 540, 290, 'roof');
  }
  const hiveFloor = floor - 540,
    homeX = mode === 'normal' ? layout.home : 140;
  const bases = [
    { x: homeX, y: hiveFloor - 130, w: 180, h: 130, team: 0 },
    { x: width - homeX - 180, y: hiveFloor - 130, w: 180, h: 130, team: 1 },
  ];
  for (const base of bases)
    base.door = { x: base.x + base.w / 2 - 28, y: hiveFloor - 64, w: 56, h: 64 };
  const gates = [];
  const gate = (kind, x, y) =>
    gates.push({ id: gates.length, kind, x, y, w: 70, h: 90, team: null });
  if (mode === 'normal') {
    const wings = layout.steps[3],
      speed = layout.steps[0];
    // Miami retains its original station coordinates; others center machines
    // on their own ledges and mirror them exactly across the arena.
    const wingX = definition.id === DEFAULT_MAP_ID ? 400 : Math.round(wings[0] + wings[2] / 2 - 35);
    const speedX =
      definition.id === DEFAULT_MAP_ID ? 100 : Math.round(speed[0] + speed[2] / 2 - 35);
    gate('warrior', wingX, wings[1] - 90);
    gate('warrior', width - wingX - 70, wings[1] - 90);
    gate('warrior', width / 2 - 35, 110);
    gate('speed', speedX, speed[1] - 90);
    gate('speed', width - speedX - 70, speed[1] - 90);
  } else {
    const offset = PLAYGROUND_OFFSETS[definition.id];
    gate('warrior', Math.round(width * offset.wings), floor - 90);
    gate('warrior', Math.round(width * (1 - offset.wings)) - 70, floor - 90);
    gate('warrior', width / 2 - 35, floor - 90);
    gate('speed', Math.round(width * offset.speed), floor - 90);
    gate('speed', Math.round(width * (1 - offset.speed)) - 70, floor - 90);
  }
  const berryPiles = [];
  const addPile = (x, y) => berryPiles.push({ id: berryPiles.length, x, y });
  if (mode === 'normal') {
    for (const x of layout.ground) addPile(x, floor - 24);
    for (const x of layout.raised) addPile(x, layout.steps[0][1] - 22);
  } else {
    for (const fraction of [0.22, 0.32, 0.44, 0.56, 0.68, 0.78])
      addPile(Math.round(width * fraction), floor - 24);
    for (const fraction of [0.2, 0.3, 0.42, 0.58, 0.7, 0.8]) {
      const target = width * fraction;
      const support = platforms
        .filter((p) => p.y === floor - 180)
        .sort((a, b) => Math.abs(a.x + a.w / 2 - target) - Math.abs(b.x + b.w / 2 - target))[0];
      addPile(Math.round(support.x + support.w / 2), support.y - 22);
    }
  }
  return configureMapEconomy(
    {
      width,
      height,
      mode,
      mapId: definition.id,
      name: definition.name,
      subtitle: definition.subtitle,
      ride: definition.ride,
      queen: definition.queen,
      platforms,
      bases,
      gates,
      berryPiles,
      berryPile: berryPiles[0],
      gatorTrack: {
        x1: mode === 'normal' ? 110 : 350,
        x2: width - (mode === 'normal' ? 110 : 350),
        y: floor - 18,
      },
    },
    totalPlayers ?? (mode === 'xxl' ? 120 : 10),
  );
}
const PLAYGROUND_OFFSETS = {
  miami: { wings: 0.28, speed: 0.18 },
  'san-francisco': { wings: 0.3, speed: 0.19 },
  'new-york': { wings: 0.26, speed: 0.17 },
  brazil: { wings: 0.32, speed: 0.2 },
  singapore: { wings: 0.29, speed: 0.18 },
};

export function movePlayer(p, input, map, dt, now) {
  if (!p.alive) return p;
  if ((p.upgradeUntil || 0) > now) {
    p.vx = 0;
    p.vy = 0;
    return p;
  }
  dt = Math.min(Math.max(dt, 0), 0.05);
  const dir = Number(Boolean(input.right)) - Number(Boolean(input.left));
  if (dir) p.facing = dir;
  const jumpPressed = input.jumpPressed === true || (Boolean(input.jump) && !p.jumpHeld);
  if (p.grounded) p.jumps = 0;
  p.dive = p.role === 'queen' && !p.grounded && Boolean(input.down || input.dash);
  if (p.role === 'queen' || p.role === 'warrior') {
    if (!p.dive && input.jump && now >= (p.nextFlap || 0)) {
      p.vy = p.role === 'queen' ? -430 : -390;
      p.grounded = false;
      p.nextFlap = now + (p.role === 'queen' ? 190 : 220);
    }
  } else if (jumpPressed && p.grounded) {
    p.vy = -JUMP_SPEED;
    p.grounded = false;
    p.jumps = (p.jumps || 0) + 1;
  }
  // The arcade has no universal dash. Speed comes from spending a chip at a gate.
  p.dashUntil = 0;
  p.nextDash = 0;
  p.vx = dir * SPEED * (p.speedBoost && p.role !== 'queen' ? 1.35 : 1);
  const beforeBottom = p.y + PLAYER_H;
  p.vy = p.dive ? 1150 : Math.min((p.vy || 0) + GRAVITY * dt, 900);
  p.x = Math.max(0, Math.min(map.width - PLAYER_W, p.x + p.vx * dt));
  p.y += p.vy * dt;
  p.grounded = false;
  if (p.vy >= 0) {
    for (const platform of map.platforms) {
      if (input.down && platform.kind !== 'ground') continue;
      if (
        p.x + PLAYER_W > platform.x &&
        p.x < platform.x + platform.w &&
        beforeBottom <= platform.y + 2 &&
        p.y + PLAYER_H >= platform.y
      ) {
        p.y = platform.y - PLAYER_H;
        p.vy = 0;
        p.grounded = true;
        p.jumps = 0;
        p.dive = false;
      }
    }
  }
  if (p.y < 0) {
    p.y = 0;
    p.vy = Math.max(0, p.vy);
  }
  if (p.y > map.height) {
    p.y = map.height - 80 - PLAYER_H;
    p.vy = 0;
    p.grounded = true;
  }
  p.jumpHeld = Boolean(input.jump);
  p.dashHeld = Boolean(input.dash);
  return p;
}
