// Small, deterministic pixel sprites. Kept as source so their silhouettes stay
// crisp at every camera scale and animation never requires a texture upload.
import { drawQueenAccessory, drawThemedRide } from './theme-sprites.js';
export const TEAM = [
  { main: '#a78bfa', light: '#ede3ff', dark: '#6540b2', ink: '#322552', name: 'PURPLE PIXELS' },
  { main: '#ff7d91', light: '#ffd6c9', dark: '#ad375f', ink: '#532d50', name: 'SUNSET SYNDICATE' },
];

const atlas = new Image();
atlas.src = new URL('./assets/lenny-sprites-purple.png', import.meta.url).href;
const frames = {
  aquaIdle: [24, 202, 256, 316],
  aquaRun: [324, 202, 275, 307],
  aquaQueen: [628, 172, 281, 345],
  aquaWarrior: [970, 202, 260, 315],
  coralIdle: [24, 798, 257, 316],
  coralRun: [315, 797, 277, 307],
  coralQueen: [613, 764, 280, 350],
  gator: [903, 887, 350, 180],
};
// Only heads come from the generated atlas. Limbs are independent pixel-art
// layers: every role can run, jump, fly and attack without baked-in static feet.
const heads = {
  worker: [70, 203, 210, 166],
  warrior: [1016, 202, 234, 170],
  queen: [680, 172, 229, 202],
};
function atlasFrame(ctx, frame, x, y, h) {
  const [sx, sy, sw, sh] = frame;
  const w = (h * sw) / sh;
  ctx.drawImage(
    atlas,
    sx,
    sy,
    sw,
    sh,
    Math.round(x - w / 2),
    Math.round(y - h),
    Math.round(w),
    Math.round(h),
  );
}

function rect(ctx, c, x, y, w, h) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

const WALK_X = [-7, -3, 2, 7, 7, 3, -2, -7];
const WALK_Y = [0, -4, -7, -4, 0, 0, 0, 0];
function pixelLine(ctx, color, x1, y1, x2, y2, width) {
  const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  ctx.fillStyle = color;
  for (let i = 0; i <= n; i++) {
    const q = i / n;
    ctx.fillRect(
      Math.round(x1 + (x2 - x1) * q - width / 2),
      Math.round(y1 + (y2 - y1) * q - width / 2),
      width,
      width,
    );
  }
}
function limb(ctx, hx, hy, footX, footY, front) {
  const kneeX = (hx + footX) / 2 - 1,
    kneeY = (hy + footY) / 2 - 1;
  const fur = front ? '#68728c' : '#4d5671';
  pixelLine(ctx, '#242b47', hx, hy, kneeX, kneeY, 6);
  pixelLine(ctx, '#242b47', kneeX, kneeY, footX, footY - 2, 6);
  pixelLine(ctx, fur, hx, hy, kneeX, kneeY, 3);
  pixelLine(ctx, fur, kneeX, kneeY, footX, footY - 2, 3);
  rect(ctx, '#22283f', Math.round(footX - 3), Math.round(footY - 3), 9, 4);
  rect(ctx, front ? '#f7ebd9' : '#a3b1be', Math.round(footX - 2), Math.round(footY), 9, 2);
}
function arm(ctx, x, y, swing, team, front) {
  const handX = x + swing,
    handY = y + 8 - Math.abs(swing) * 0.2;
  pixelLine(ctx, '#262c45', x, y, handX, handY, 6);
  pixelLine(ctx, front ? '#aab2c4' : '#727c98', x, y, handX, handY, 4);
  rect(ctx, team.main, x - 3, y - 3, 6, 5);
  rect(ctx, '#262c45', Math.round(handX - 3), Math.round(handY - 1), 6, 4);
  return { x: handX, y: handY };
}
function shirt(ctx, team) {
  rect(ctx, '#262b43', -10, -25, 21, 16);
  rect(ctx, team.main, -8, -24, 17, 13);
  rect(ctx, team.light, -7, -23, 3, 7);
  rect(ctx, team.dark, 6, -20, 3, 9);
  rect(ctx, '#454d65', -8, -11, 17, 4);
  // Roboflow's pixel R monogram, visible even in the tiny gameplay sprite.
  rect(ctx, '#fffaf4', -3, -21, 2, 8);
  rect(ctx, '#fffaf4', -1, -21, 5, 2);
  rect(ctx, '#fffaf4', 2, -20, 2, 3);
  rect(ctx, '#fffaf4', -1, -17, 4, 2);
  rect(ctx, '#fffaf4', 1, -15, 2, 2);
  rect(ctx, '#fffaf4', 3, -13, 2, 2);
}
function tail(ctx, phase, moving, airborne, team) {
  const wag = Math.round(Math.sin(phase) * 3),
    lift = airborne ? -4 : 0;
  // Five striped segments articulate independently, rather than rotating a
  // rectangular baked sprite. The silhouette bends from hip to tail tip.
  for (let i = 4; i >= 0; i--) {
    const x = -10 - i * 4,
      y = -11 + lift + Math.round(Math.sin(phase - i * 0.48) * (moving ? 2 : 1)) - i * 0.75;
    const size = i === 4 ? 6 : 8;
    rect(ctx, '#242b43', x, y, size, size);
    rect(ctx, i % 2 ? '#58627c' : '#a8b0c4', x + 1, y + 1, size - 2, size - 2);
    if (i % 2 === 0) rect(ctx, '#d0d5dc', x + 1, y + 1, size - 2, 2);
  }
}
function ai1Backpack(ctx, x, y, t, flying) {
  // Roboflow AI1: black industrial enclosure, silver front, eight LEDs,
  // central camera lens, purple side stripe, fins and two bottom connectors.
  rect(ctx, '#141923', x, y, 16, 26);
  rect(ctx, '#39414c', x + 1, y + 1, 12, 24);
  rect(ctx, '#8b5cf6', x + 13, y + 2, 3, 23);
  rect(ctx, '#e0cfff', x + 14, y + 4, 1, 3);
  rect(ctx, '#a4a9ac', x + 1, y + 2, 12, 12);
  rect(ctx, '#4b535c', x + 2, y + 3, 10, 10);
  rect(ctx, '#171e2b', x + 4, y + 5, 6, 6);
  rect(ctx, '#171e2b', x + 3, y + 6, 8, 4);
  rect(ctx, '#66718c', x + 5, y + 6, 4, 4);
  rect(ctx, Math.sin(t * 7) > 0 ? '#72ecec' : '#a68cff', x + 6, y + 7, 2, 2);
  for (const [lx, ly] of [
    [3, 4],
    [6, 3],
    [10, 4],
    [11, 7],
    [10, 11],
    [6, 12],
    [3, 11],
    [2, 7],
  ])
    rect(ctx, '#f1f3e9', x + lx, y + ly, 1, 1);
  for (let i = 0; i < 4; i++) {
    rect(ctx, '#151c28', x + 2, y + 16 + i * 2, 10, 1);
    rect(ctx, '#6a7481', x + 3 + (i % 2), y + 15 + i * 2, 6, 1);
  }
  rect(ctx, '#8994a0', x + 3, y + 26, 3, 3);
  rect(ctx, '#8994a0', x + 9, y + 26, 3, 3);
  if (flying) {
    const flame = 3 + (Math.floor(t * 24) % 5);
    rect(ctx, '#a78bfa', x + 3, y + 29, 3, flame);
    rect(ctx, '#a78bfa', x + 9, y + 29, 3, flame + 2);
    rect(ctx, '#e8edff', x + 4, y + 29, 1, 3);
    rect(ctx, '#e8edff', x + 10, y + 29, 1, 4);
  }
}
function articulatedRaccoon(ctx, p, t, options, team) {
  const speed = Math.abs(p.vx || 0),
    moving = speed > 15,
    airborne = !p.grounded;
  const seed = String(p.id || p.name || 'lenny').length * 0.53;
  const phase =
    Math.floor(t * (moving ? 14 : 6) * Math.max(0.8, Math.min(1.5, speed / 270)) + seed) % 8;
  const wave = (phase * Math.PI) / 4;
  const frame = ((phase % 8) + 8) % 8,
    other = (frame + 4) % 8;
  const bob =
    moving && !airborne
      ? -[0, 1, 2, 1, 0, 1, 2, 1][frame]
      : Math.round(Math.sin(t * 2.7 + seed) * 0.65);
  const now = options.now ?? Date.now(),
    attack = (p.attackUntil || 0) > now;
  const attackPhase = attack ? Math.max(0, Math.min(1, 1 - (p.attackUntil - now) / 180)) : 0;
  const size = (options.scale || 1.75) / 1.75;
  ctx.save();
  ctx.translate(Math.round(p.x + 14), Math.round(p.y + 36));
  ctx.scale((p.facing || 1) * size, size);
  tail(ctx, moving ? wave : t * 2 + seed, moving, airborne, team);
  if (p.role === 'queen') {
    // A cape has its own trailing wave in every captain walking/flight frame.
    const flutter = Math.round(Math.sin(t * (airborne ? 17 : 11)) * 3);
    rect(ctx, team.dark, -20, -24, 13, 8);
    rect(ctx, team.main, -22 + flutter, -20, 15, 9);
    rect(ctx, team.main, -25 + flutter, -12, 12, 7);
    rect(ctx, team.light, -20 + flutter, -19, 3, 9);
    if (airborne) {
      const flap = Math.round(Math.sin(t * 18) * 5);
      pixelLine(ctx, team.dark, -9, -25, -26, -26 + flap, 7);
      pixelLine(ctx, team.light, -10, -26, -26, -28 + flap, 4);
    }
  }
  // The planting foot remains level while the other foot lifts and passes.
  let fx1 = moving ? WALK_X[frame] : -5,
    fy1 = moving ? WALK_Y[frame] : 0;
  let fx2 = moving ? WALK_X[other] + 3 : 5,
    fy2 = moving ? WALK_Y[other] : 0;
  if (airborne) {
    fx1 = -8;
    fx2 = 8;
    fy1 = -5 + (frame % 2);
    fy2 = -3;
  }
  limb(ctx, -4, -10 + bob, fx1, fy1, false);
  const backSwing = airborne ? -5 : moving ? -Math.round(Math.sin(wave) * 7) : -1;
  arm(ctx, -8, -21 + bob, backSwing, team, false);
  if (p.role === 'queen' || p.role === 'warrior') ai1Backpack(ctx, -25, -30 + bob, t, airborne);
  ctx.save();
  ctx.translate(0, bob);
  shirt(ctx, team);
  if (atlas.complete && atlas.naturalWidth) {
    const f = p.role === 'queen' ? heads.worker : heads[p.role] || heads.worker;
    atlasFrame(ctx, f, 3, -22, 27);
    // Purple/coral neckline covers the original source shirt, which never
    // needs to be recolored or modified on disk.
    rect(ctx, team.main, -5, -24, 13, 3);
  } else {
    rect(ctx, '#272c43', -13, -46, 30, 23);
    rect(ctx, '#c2c8d4', -11, -44, 26, 18);
    rect(ctx, '#f2eee7', -10, -32, 26, 9);
    rect(ctx, '#262c45', -9, -38, 25, 6);
    rect(ctx, '#fff9e9', -5, -38, 3, 3);
    rect(ctx, '#fff9e9', 10, -38, 3, 3);
    rect(ctx, '#262c45', 7, -30, 4, 3);
    rect(ctx, '#262c45', -12, -49, 7, 8);
    rect(ctx, '#262c45', 8, -49, 7, 8);
    if (p.role === 'warrior') rect(ctx, '#182138', -11, -39, 28, 6);
  }
  if (p.role === 'queen') drawQueenAccessory(ctx, options.mapId || 'miami', t);
  ctx.restore();
  limb(ctx, 4, -10 + bob, fx2, fy2, true);
  const swing = attack ? 11 : airborne ? 7 : moving ? Math.round(Math.sin(wave) * 7) : 1;
  const hand = arm(ctx, 8, -20 + bob, swing, team, true);
  if (p.role === 'warrior') {
    // Sword swings around the hand; it is not glued upright to the body.
    const angle = attack ? -1.4 + attackPhase * 2.8 : moving ? Math.sin(wave) * 0.32 : -0.15;
    const tipX = hand.x + Math.sin(angle) * 25,
      tipY = hand.y - Math.cos(angle) * 25;
    pixelLine(ctx, '#26354d', hand.x, hand.y, tipX, tipY, 5);
    pixelLine(ctx, '#fff4cb', hand.x, hand.y - 1, tipX, tipY, 3);
    pixelLine(ctx, '#eebd63', hand.x - 4, hand.y - 3, hand.x + 4, hand.y - 3, 3);
  } else if (attack) {
    const fistX = hand.x + 6 + Math.round(Math.sin(attackPhase * Math.PI) * 7);
    pixelLine(ctx, '#232b43', hand.x, hand.y, fistX, hand.y - 4, 6);
    rect(ctx, '#acb6cb', fistX - 2, hand.y - 7, 6, 6);
  }
  if (p.carrying) drawData(ctx, hand.x + 5, hand.y - 2, t, 0.7);
  ctx.restore();
}

export function drawRaccoon(ctx, p, t, options = {}) {
  articulatedRaccoon(ctx, p, t, options, TEAM[p.team || 0]);
}

export function drawRide(ctx, ride, t, team = null, mapId = 'miami') {
  if (mapId === 'miami' || !['san-francisco', 'new-york', 'brazil', 'singapore'].includes(mapId)) {
    drawGator(ctx, ride, t, team);
  } else {
    drawThemedRide(ctx, ride, t, team, mapId);
  }
}

export function drawGator(ctx, gator, t, team = null) {
  if (atlas.complete && atlas.naturalWidth) {
    ctx.save();
    ctx.translate(Math.round(gator.x), Math.round(gator.y));
    ctx.scale(team === 0 ? -1 : 1, 1);
    const walking = Boolean(gator.riderId),
      phase = Math.floor(t * 12) % 8,
      bob = walking ? -[0, 1, 2, 1, 0, 1, 2, 1][phase] : 0;
    // Each of four feet lifts and strides in diagonal pairs. Clip the atlas
    // at the belly so none of its baked-in feet remain underneath.
    for (let i = 0; i < 4; i++) {
      const k = (phase + (i % 2) * 4) % 8,
        hipX = -30 + i * 20;
      const footX = hipX + (walking ? WALK_X[k] * 0.7 : 0),
        footY = 20 + (walking ? WALK_Y[k] * 0.65 : 0);
      pixelLine(ctx, '#1d6638', hipX, 5 + bob, footX, footY - 3, 9);
      pixelLine(ctx, i % 2 ? '#90c52b' : '#71ad27', hipX, 7 + bob, footX, footY - 3, 6);
      rect(ctx, '#224c32', Math.round(footX - 4), Math.round(footY - 3), 12, 5);
      rect(ctx, '#d1df8e', Math.round(footX + 3), Math.round(footY), 3, 2);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(-100, -50, 200, 58 + bob);
    ctx.rect(-100, 8 + bob, 58, 25);
    ctx.rect(48, 8 + bob, 52, 25);
    ctx.clip();
    atlasFrame(ctx, frames.gator, 0, 20 + bob, 58);
    ctx.restore();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(Math.round(gator.x), Math.round(gator.y));
  const direction = team === 1 ? 1 : -1;
  ctx.scale(direction, 1);
  const bounce = gator.riderId ? Math.sin(t * 13) * 1.5 : Math.sin(t * 2) * 0.5;
  ctx.translate(0, bounce);
  const dark = '#146356',
    green = '#4abd79',
    light = '#9be18c';
  rect(ctx, dark, -47, -6, 80, 22);
  rect(ctx, green, -43, -9, 72, 22);
  rect(ctx, dark, 27, -3, 22, 13);
  rect(ctx, green, 27, -3, 17, 9);
  rect(ctx, green, 42, 0, 12, 6);
  rect(ctx, dark, 49, 3, 10, 3);
  rect(ctx, light, -38, 3, 67, 7);
  rect(ctx, dark, -57, -5, 19, 15);
  rect(ctx, green, -63, -7, 24, 13);
  rect(ctx, green, -69, -4, 9, 7);
  rect(ctx, light, -68, 2, 30, 4);
  rect(ctx, dark, -67, -1, 6, 3);
  rect(ctx, '#fff3ca', -60, 6, 5, 5);
  rect(ctx, '#fff3ca', -48, 6, 5, 4);
  rect(ctx, dark, -48, -17, 15, 12);
  rect(ctx, green, -46, -19, 13, 15);
  // The sunglasses are non-negotiable. This gator is on vacation.
  rect(ctx, '#26374a', -49, -15, 20, 6);
  rect(ctx, '#a4f5e1', -46, -14, 5, 2);
  for (let i = 0; i < 5; i++) rect(ctx, dark, -29 + i * 13, -13, 6, 6);
  for (let i = 0; i < 3; i++) {
    const dx = -29 + i * 23;
    const stride = gator.riderId ? Math.sin(t * 12 + i) * 2 : 0;
    rect(ctx, dark, dx + stride, 11, 12, 6);
    rect(ctx, green, dx + stride, 11, 8, 3);
  }
  // Saddle, an upcycled beach chair.
  rect(ctx, '#9e5b62', -16, -14, 32, 5);
  rect(ctx, '#fff0bd', -14, -14, 28, 3);
  rect(ctx, '#9e5b62', 13, -29, 4, 18);
  rect(ctx, '#fff0bd', 14, -27, 2, 10);
  ctx.restore();
}

export function drawData(ctx, x, y, t, scale = 1, options = {}) {
  // A purple Roboflow data cartridge: the same collectible in piles, hands,
  // and completed dataset slots. Pixel geometry stays crisp at every scale.
  const bob = options.bob === false ? 0 : Math.sin(t * 3 + x) * 2;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y + bob));
  ctx.scale(scale, scale);
  rect(ctx, '#302243', -8, -9, 16, 19);
  rect(ctx, '#6f43be', -7, -8, 14, 16);
  rect(ctx, '#a477f5', -6, -8, 12, 13);
  rect(ctx, '#d9c0ff', -6, -8, 12, 2);
  rect(ctx, '#c7a8ff', -6, -6, 2, 9);
  rect(ctx, '#59338c', 5, -5, 2, 12);
  rect(ctx, '#ffdf86', -5, 8, 2, 2);
  rect(ctx, '#ffdf86', -1, 8, 2, 2);
  rect(ctx, '#ffdf86', 3, 8, 2, 2);
  rect(ctx, '#fff9f2', -2, -5, 2, 9);
  rect(ctx, '#fff9f2', 0, -5, 4, 2);
  rect(ctx, '#fff9f2', 3, -4, 2, 3);
  rect(ctx, '#fff9f2', 0, -1, 4, 2);
  rect(ctx, '#fff9f2', 1, 1, 2, 2);
  rect(ctx, '#fff9f2', 3, 3, 2, 2);
  ctx.restore();
}
