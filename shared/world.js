export const PLAYER_W = 28;
export const PLAYER_H = 36;
export const SPEED = 270;
export const GRAVITY = 1450;
export const JUMP_SPEED = 760;
export const TICK_RATE = 60;
export const SCORE_TARGETS = Object.freeze({ normal: 12, xxl: 144 });
export const BOT_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);

export function economyForPlayers(total) {
  const economyPlayerCount = Math.max(0, Math.min(120, Math.floor(Number.isFinite(total) ? total : 0)));
  return { economyPlayerCount, scoreTarget: Math.max(1, Math.ceil(12 * economyPlayerCount / 10)), resourceCount: Math.max(6, 6 * economyPlayerCount) };
}

export function configureMapEconomy(map, total) {
  Object.assign(map, economyForPlayers(total));
  const perPile = Math.floor(map.resourceCount / map.berryPiles.length);
  const extra = map.resourceCount % map.berryPiles.length;
  map.berrySpawns = map.berryPiles.flatMap((pile, pileIndex) => Array.from({ length: perPile + Number(pileIndex < extra) }, (_, index) => ({
    x: pile.x + ((index % 5) - 2) * 7,
    y: pile.y - (Math.floor(index / 5) % 3) * 5,
    pileId: pile.id,
  })));
  return map;
}

export function createMap(mode = 'normal', totalPlayers) {
  mode = mode === 'xxl' ? 'xxl' : 'normal';
  const width = mode === 'xxl' ? 12000 : 1440;
  const height = mode === 'xxl' ? 2000 : 820;
  const floor = height - 80;
  const platforms = [{ x: 0, y: floor, w: width, h: 80, kind: 'ground' }];
  if (mode === 'normal') {
    // Alternating outer/inner ledges make collection a visible delivery route.
    // Each 108px climb is reachable with the ordinary worker jump; skipping
    // a tier would require 216px, above that jump's apex. Both teams mirror.
    for (const [x, y, w] of [[20, 632, 220], [1200, 632, 220], [330, 524, 220], [890, 524, 220], [20, 416, 220], [1200, 416, 220], [330, 308, 220], [890, 308, 220], [90, 200, 290], [590, 200, 260], [1060, 200, 290], [630, 632, 180]]) {
      platforms.push({ x, y, w, h: 22, kind: y === 200 ? 'roof' : 'neon' });
    }
  } else {
    for (let row = 0; row < 7; row++) {
      const y = floor - 180 * (row + 1);
      for (let x = 70 + (row % 2) * 215; x < width - 250; x += 470) {
        platforms.push({ x, y, w: Math.min(width - x, 275 + (row % 3) * 20), h: 22, kind: row % 2 ? 'roof' : 'neon' });
      }
    }
    platforms.push({ x: 90, y: floor - 540, w: 290, h: 22, kind: 'roof' }, { x: width - 380, y: floor - 540, w: 290, h: 22, kind: 'roof' });
  }
  const hiveFloor = floor - 540;
  const bases = [
    { x: 140, y: hiveFloor - 130, w: 180, h: 130, team: 0 },
    { x: width - 320, y: hiveFloor - 130, w: 180, h: 130, team: 1 },
  ];
  for (const base of bases) base.door = { x: base.x + base.w / 2 - 28, y: hiveFloor - 64, w: 56, h: 64 };
  const gates = mode === 'normal' ? [
    { id: 0, kind: 'warrior', x: 400, y: 218, w: 70, h: 90, team: null },
    { id: 1, kind: 'warrior', x: 970, y: 218, w: 70, h: 90, team: null },
    { id: 2, kind: 'warrior', x: 685, y: 110, w: 70, h: 90, team: null },
    { id: 3, kind: 'speed', x: 100, y: 542, w: 70, h: 90, team: null },
    { id: 4, kind: 'speed', x: 1270, y: 542, w: 70, h: 90, team: null },
  ] : [
    { id: 0, kind: 'warrior', x: Math.round(width * .28), y: floor - 90, w: 70, h: 90, team: null },
    { id: 1, kind: 'warrior', x: Math.round(width * .72) - 70, y: floor - 90, w: 70, h: 90, team: null },
    { id: 2, kind: 'warrior', x: Math.round(width * .5) - 35, y: floor - 90, w: 70, h: 90, team: null },
    { id: 3, kind: 'speed', x: Math.round(width * .18), y: floor - 90, w: 70, h: 90, team: null },
    { id: 4, kind: 'speed', x: Math.round(width * .82) - 70, y: floor - 90, w: 70, h: 90, team: null },
  ];
  // Finite grouped stockpiles at defined, reachable pickup spots.
  const berryPiles = [];
  const addPile = (x, y) => berryPiles.push({ id: berryPiles.length, x, y });
  const groundFractions = mode === 'xxl' ? [.22, .32, .44, .56, .68, .78] : [560 / width, 660 / width, 780 / width, 880 / width];
  for (const fraction of groundFractions) addPile(Math.round(width * fraction), floor - 24);
  // XXL keeps twelve separate collection points across the central districts,
  // rather than a safe resource loop immediately beside each home base.
  const raisedFractions = mode === 'xxl' ? [.2, .3, .42, .58, .7, .8] : [670 / width, 770 / width];
  for (const [index, fraction] of raisedFractions.entries()) {
    const levelY = mode === 'normal' ? 632 : floor - 180;
    const ledge = platforms.filter(p => p.y === levelY).sort((a,b) => Math.abs(a.x + a.w / 2 - width * fraction) - Math.abs(b.x + b.w / 2 - width * fraction))[0];
    addPile(mode === 'normal' ? Math.round(width * fraction) : Math.round(ledge.x + ledge.w / 2), ledge.y - 22);
  }
  return configureMapEconomy({ width, height, mode, platforms, bases, gates, berryPiles, berryPile: berryPiles[0],
    gatorTrack: { x1: mode === 'normal' ? 110 : 350, x2: width - (mode === 'normal' ? 110 : 350), y: floor - 18 } }, totalPlayers ?? (mode === 'xxl' ? 120 : 10));
}

export function movePlayer(p, input, map, dt, now) {
  if (!p.alive) return p;
  if ((p.upgradeUntil || 0) > now) { p.vx = 0; p.vy = 0; return p; }
  dt = Math.min(Math.max(dt, 0), .05);
  const dir = Number(Boolean(input.right)) - Number(Boolean(input.left));
  if (dir) p.facing = dir;
  const jumpPressed = input.jumpPressed === true || (Boolean(input.jump) && !p.jumpHeld);
  if (p.grounded) p.jumps = 0;
  p.dive = p.role === 'queen' && !p.grounded && Boolean(input.down || input.dash);
  if (p.role === 'queen' || p.role === 'warrior') {
    if (!p.dive && input.jump && now >= (p.nextFlap || 0)) {
      p.vy = p.role === 'queen' ? -430 : -390; p.grounded = false; p.nextFlap = now + (p.role === 'queen' ? 190 : 220);
    }
  } else if (jumpPressed && p.grounded) {
    p.vy = -JUMP_SPEED; p.grounded = false; p.jumps = (p.jumps || 0) + 1;
  }
  // The arcade has no universal dash. Speed comes from spending a chip at a gate.
  p.dashUntil = 0; p.nextDash = 0;
  p.vx = dir * SPEED * (p.speedBoost && p.role !== 'queen' ? 1.35 : 1);
  const beforeBottom = p.y + PLAYER_H;
  p.vy = p.dive ? 1150 : Math.min((p.vy || 0) + GRAVITY * dt, 900);
  p.x = Math.max(0, Math.min(map.width - PLAYER_W, p.x + p.vx * dt));
  p.y += p.vy * dt;
  p.grounded = false;
  if (p.vy >= 0) {
    for (const platform of map.platforms) {
      if (input.down && platform.kind !== 'ground') continue;
      if (p.x + PLAYER_W > platform.x && p.x < platform.x + platform.w &&
          beforeBottom <= platform.y + 2 && p.y + PLAYER_H >= platform.y) {
        p.y = platform.y - PLAYER_H; p.vy = 0; p.grounded = true; p.jumps = 0; p.dive = false;
      }
    }
  }
  if (p.y < 0) { p.y = 0; p.vy = Math.max(0, p.vy); }
  if (p.y > map.height) { p.y = map.height - 80 - PLAYER_H; p.vy = 0; p.grounded = true; }
  p.jumpHeld = Boolean(input.jump); p.dashHeld = Boolean(input.dash);
  return p;
}
