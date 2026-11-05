import { drawThemedRide, TEAM_COLORS } from './theme-sprites.js';
import { drawRaccoon } from './sprites.js';

// Posters use the exact in-game Lenny atlas face, articulated limbs, striped
// tail, team shirt and AI1 backpack rather than a separate placeholder mascot.
function drawPosterRaccoon(c, x, y, scale = 1, team = 0, mapId = 'miami', queen = false) {
  c.save();
  c.translate(x, y);
  drawRaccoon(
    c,
    {
      id: 'poster-lenny',
      x: -14,
      y: -36,
      team,
      role: queen ? 'queen' : 'worker',
      facing: 1,
      grounded: true,
      vx: 0,
      vy: 0,
      carrying: false,
      alive: true,
    },
    0.35,
    { mapId, scale: scale * 1.75, now: 0 },
  );
  c.restore();
}

// Deliberately separate scenery from collision geometry. Pale silhouettes sit
// behind solid cream-edged platforms; the same palette supports Classic/XXL.
export const ART_THEMES = Object.freeze({
  miami: {
    sky: ['#edaaa8', '#ffddaf', '#fff0ce'],
    haze: '#efd1c4',
    far: '#c5adb8',
    city: '#a2b8bd',
    water: '#91d4cc',
    light: '#fff1c4',
    accent: '#ed91a8',
    ground: '#a3c6aa',
    groundDark: '#78a894',
    platform: '#75b8b5',
    edge: '#fff3cd',
    ink: '#345365',
    label: 'FLORIDA MAN’S UBER',
  },
  'san-francisco': {
    sky: ['#b7bacd', '#e6d4cc', '#f4e9d5'],
    haze: '#d8d9db',
    far: '#a9b0c5',
    city: '#899eaf',
    water: '#93b7c3',
    light: '#fff2cf',
    accent: '#d87960',
    ground: '#9ba9a8',
    groundDark: '#778a91',
    platform: '#869eae',
    edge: '#fff0cb',
    ink: '#35465e',
    label: 'DING DING · DATA LINE',
  },
  'new-york': {
    sky: ['#2c3156', '#6e618b', '#d69a9d'],
    haze: '#aaa0b8',
    far: '#79788e',
    city: '#515f78',
    water: '#68748f',
    light: '#f6d59a',
    accent: '#e8b55a',
    ground: '#718080',
    groundDark: '#4d626c',
    platform: '#647f95',
    edge: '#fff0c2',
    ink: '#25384c',
    label: 'NEXT STOP · YOUR HQ',
  },
  brazil: {
    sky: ['#a8d5c4', '#e3e7ba', '#fff0c4'],
    haze: '#c5d5b8',
    far: '#86b3a0',
    city: '#60998d',
    water: '#87c9bd',
    light: '#fff2b5',
    accent: '#e7ae60',
    ground: '#97ba85',
    groundDark: '#65957a',
    platform: '#68a58c',
    edge: '#fff0be',
    ink: '#31564f',
    label: 'RIO EXPRESS DELIVERY',
  },
  singapore: {
    sky: ['#797ca7', '#c0a4bd', '#f1ccc4'],
    haze: '#b3afc5',
    far: '#959ab6',
    city: '#738da5',
    water: '#83b8bd',
    light: '#fce7bb',
    accent: '#c581b8',
    ground: '#9bb8af',
    groundDark: '#6e9795',
    platform: '#8b9ab7',
    edge: '#fff0d5',
    ink: '#3e4868',
    label: 'RIVER TAXI · ROYAL SERVICE',
  },
});
export const getArtTheme = (id) => ART_THEMES[id] || ART_THEMES.miami;
const R = (c, color, x, y, w, h) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
};
const random = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const P = (c, color, points) => {
  c.fillStyle = color;
  c.beginPath();
  points.forEach(([x, y], i) =>
    i ? c.lineTo(Math.round(x), Math.round(y)) : c.moveTo(Math.round(x), Math.round(y)),
  );
  c.closePath();
  c.fill();
};
function pixelDisc(c, color, x, y, r) {
  for (let yy = -r; yy <= r; yy += 4) {
    const half = Math.sqrt(Math.max(0, r * r - yy * yy));
    R(c, color, x - half, y + yy, half * 2, 4);
  }
}
function label(c, s, x, y, size, color) {
  c.fillStyle = color;
  c.font = `bold ${size}px "Courier New", monospace`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(s, x, y);
}
function windows(c, x, y, w, h, color, step = 17) {
  for (let yy = y + 13; yy < y + h - 6; yy += step)
    for (let xx = x + 9; xx < x + w - 5; xx += 15) R(c, color, xx, yy, 5, 4);
}

function skyline(c, width, bottom, camera, color, seed, maxHeight, windowsColor) {
  const gap = 117,
    offset = camera * 0.13,
    start = Math.floor(offset / gap) - 1;
  for (let i = start; i < start + Math.ceil(width / gap) + 3; i++) {
    const x = i * gap - offset,
      w = 48 + random(i + seed) * 58,
      h = 24 + random(i + seed + 8) * maxHeight;
    R(c, color, x, bottom - h, w, h);
    R(c, color, x + 7, bottom - h - 8, w - 14, 10);
    if (random(i + 34) > 0.65) R(c, color, x + w / 2, bottom - h - 25, 3, 20);
    c.globalAlpha = 0.36;
    windows(c, x, bottom - h, w, h, windowsColor, 20);
    c.globalAlpha = 1;
  }
}
function bridge(c, x, y, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  const red = '#c77869',
    shade = '#a7666a';
  R(c, shade, -310, -32, 620, 13);
  R(c, red, -310, -35, 620, 7);
  for (const tower of [-160, 160]) {
    R(c, shade, tower - 14, -179, 28, 180);
    R(c, red, tower - 10, -184, 20, 184);
    for (const yy of [-155, -107, -58]) R(c, '#d7c4c3', tower - 5, yy, 10, 35);
    R(c, red, tower - 24, -161, 48, 9);
    R(c, red, tower - 24, -111, 48, 9);
    R(c, red, tower - 24, -61, 48, 9);
  }
  for (let xx = -300; xx <= 300; xx += 8) {
    const h =
      xx < -160
        ? -180 + (xx + 160) * -0.53
        : xx > 160
          ? -180 + (xx - 160) * 0.53
          : -76 - 104 * (xx / 160) ** 2;
    R(c, red, xx, h, 9, 4);
    if (xx % 32 === 0) R(c, red, xx, h, 2, -33 - h);
  }
  c.restore();
}
function empire(c, x, y, scale = 1) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  // Limestone setbacks, long vertical window bays, the illuminated Art Deco
  // crown and its separate antenna make this unmistakably the Empire State.
  const stone = '#a49ca4',
    shade = '#76788f',
    edge = '#c2b3ae';
  for (const [w, top] of [
    [104, -80],
    [88, -130],
    [70, -218],
    [56, -241],
    [40, -260],
  ]) {
    R(c, shade, -w / 2 - 2, top - 3, w + 4, -top + 3);
    R(c, stone, -w / 2, top, w, -top);
    R(c, edge, -w / 2, top, w, 3);
    R(c, '#c0aeaa', -w / 2 + 3, top + 4, 3, -top - 4);
    R(c, '#858298', w / 2 - 7, top + 4, 5, -top - 4);
  }
  for (const xx of [-26, -15, -4, 7, 18]) {
    R(c, '#74788e', xx, -212, 6, 203);
    for (let yy = -208; yy < -8; yy += 12) R(c, '#e2c58f', xx + 1, yy, 3, 5);
  }
  for (const xx of [-44, 36]) for (let yy = -121; yy < -7; yy += 13) R(c, '#e2c58f', xx, yy, 6, 5);
  // The 86th-floor terrace and tapered mooring mast form two clear shoulders.
  R(c, '#d9c09b', -31, -240, 62, 4);
  R(c, '#b78e73', -17, -276, 34, 18);
  R(c, '#f5d59a', -13, -276, 26, 17);
  R(c, '#957e7b', -9, -290, 18, 14);
  R(c, '#ffe4ae', -6, -290, 12, 14);
  R(c, '#b9b5b3', -3, -315, 6, 25);
  R(c, '#e9d4b7', -1, -336, 2, 24);
  R(c, '#ffe8be', -4, -296, 8, 4);
  c.restore();
}
function chrysler(c, x, y, scale = 1) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  R(c, '#66728c', -34, -145, 68, 145);
  R(c, '#8e9ca9', -29, -152, 58, 152);
  R(c, '#bac1c1', -25, -161, 50, 11);
  for (const xx of [-20, -7, 6, 19])
    for (let yy = -142; yy < -7; yy += 15) R(c, '#dfca98', xx, yy, 4, 6);
  // Receding stainless-steel arches and triangular windows, then the needle.
  for (const [w, top] of [
    [54, -165],
    [44, -179],
    [34, -193],
    [24, -207],
    [14, -221],
  ]) {
    P(c, '#c6d1cf', [
      [-w / 2, top + 15],
      [-w / 2, top + 5],
      [0, top - 6],
      [w / 2, top + 5],
      [w / 2, top + 15],
    ]);
    R(c, '#7e91a2', -w / 2, top + 13, w, 3);
    if (w > 20) {
      P(c, '#56687f', [
        [-w / 2 + 7, top + 10],
        [-w / 2 + 10, top + 1],
        [-w / 2 + 13, top + 10],
      ]);
      P(c, '#56687f', [
        [w / 2 - 13, top + 10],
        [w / 2 - 10, top + 1],
        [w / 2 - 7, top + 10],
      ]);
    }
  }
  R(c, '#d4dfd8', -2, -252, 4, 29);
  R(c, '#f3e0b6', -1, -264, 2, 14);
  // The famous eagle shoulders extend beyond the shaft.
  R(c, '#c5cecb', -43, -150, 16, 5);
  R(c, '#c5cecb', 27, -150, 16, 5);
  c.restore();
}
function mountain(c, x, y, w, h, color) {
  P(c, color, [
    [x - w / 2, y],
    [x - w * 0.43, y - h * 0.3],
    [x - w * 0.32, y - h * 0.34],
    [x - w * 0.24, y - h * 0.72],
    [x - w * 0.12, y - h * 0.9],
    [x + w * 0.03, y - h],
    [x + w * 0.17, y - h * 0.95],
    [x + w * 0.29, y - h * 0.63],
    [x + w * 0.4, y - h * 0.25],
    [x + w / 2, y],
  ]);
}
function sugarloaf(c, x, y, scale = 1) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  // Pão de Açúcar is a rounded granite monolith rising straight from the bay,
  // distinct from Corcovado's forested ridge and the smaller Morro da Urca.
  P(c, '#879f98', [
    [-100, 0],
    [-74, -48],
    [-59, -113],
    [-45, -166],
    [-30, -189],
    [-12, -198],
    [8, -199],
    [28, -188],
    [43, -166],
    [51, -111],
    [69, -49],
    [92, 0],
  ]);
  P(c, '#a8b4a3', [
    [-42, -164],
    [-27, -186],
    [-9, -193],
    [7, -193],
    [23, -182],
    [34, -151],
    [34, -94],
    [49, -34],
    [22, -12],
    [4, -81],
    [-7, -146],
  ]);
  P(c, '#769586', [
    [-91, 0],
    [-70, -35],
    [-41, -48],
    [-7, -31],
    [27, -37],
    [78, -18],
    [92, 0],
  ]);
  // The Urca cableway and tiny suspended cabin make the familiar bay view clear.
  P(c, '#7a9b8a', [
    [-209, 0],
    [-187, -68],
    [-164, -91],
    [-140, -97],
    [-119, -76],
    [-104, -29],
    [-83, 0],
  ]);
  R(c, '#d8d3b5', -148, -100, 21, 6);
  R(c, '#d8d3b5', -12, -201, 24, 5);
  for (let i = 0; i <= 24; i++) {
    const q = i / 24;
    R(c, '#627e7c', -138 + 138 * q, -102 - 98 * q + Math.sin(q * Math.PI) * 10, 7, 1);
  }
  R(c, '#6e8382', -77, -151, 2, 11);
  R(c, '#e0bd7f', -84, -140, 17, 11);
  R(c, '#cee4d6', -81, -138, 11, 5);
  R(c, '#708980', -83, -129, 15, 2);
  c.restore();
}
function corcovado(c, x, y, scale = 1) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  P(c, '#70988b', [
    [-161, 0],
    [-133, -42],
    [-101, -58],
    [-72, -108],
    [-48, -140],
    [-26, -190],
    [-10, -198],
    [11, -194],
    [30, -158],
    [50, -100],
    [96, -48],
    [125, 0],
  ]);
  P(c, '#88a697', [
    [-113, -55],
    [-70, -108],
    [-46, -144],
    [-24, -187],
    [-11, -191],
    [-22, -154],
    [-52, -104],
    [-73, -65],
  ]);
  // Christ the Redeemer on its own peak: visible head, outstretched arms,
  // draped robe and plinth. The silhouette never sits on Sugarloaf itself.
  R(c, '#537c7b', -8, -244, 12, 13);
  R(c, '#d3d7bd', -6, -242, 8, 11);
  R(c, '#587d7a', -34, -231, 64, 8);
  R(c, '#d7dcc1', -32, -230, 60, 5);
  R(c, '#b6c8b6', -34, -228, 7, 5);
  R(c, '#b6c8b6', 24, -228, 7, 5);
  P(c, '#587d7a', [
    [-9, -231],
    [5, -231],
    [10, -204],
    [14, -198],
    [-17, -198],
    [-12, -207],
  ]);
  P(c, '#c8d4bd', [
    [-7, -230],
    [3, -230],
    [7, -205],
    [10, -200],
    [-13, -200],
    [-9, -208],
  ]);
  R(c, '#ecedd0', -5, -224, 3, 23);
  R(c, '#78948b', -18, -198, 33, 5);
  R(c, '#bdc8af', -14, -199, 25, 3);
  c.restore();
}
function marina(c, x, y) {
  for (const dx of [-91, -5, 81]) {
    R(c, '#7a95ab', x + dx, y - 175, 45, 175);
    R(c, '#a6b5be', x + dx + 6, y - 168, 7, 164);
    for (let yy = y - 154; yy < y; yy += 15) R(c, '#d5d6d0', x + dx + 18, yy, 21, 3);
  }
  P(c, '#758a9e', [
    [x - 111, y - 191],
    [x + 148, y - 191],
    [x + 134, y - 174],
    [x - 91, y - 174],
  ]);
  R(c, '#b4c6be', x - 100, y - 197, 232, 7);
  R(c, '#d5d8bd', x - 82, y - 200, 195, 4);
  R(c, '#7bbcc2', x - 65, y - 201, 145, 3);
  for (const dx of [-79, -39, 70, 106]) {
    R(c, '#738f85', x + dx, y - 207, 2, 9);
    R(c, '#86ac91', x + dx - 5, y - 209, 12, 3);
    R(c, '#a9c6a3', x + dx - 3, y - 212, 8, 3);
  }
}
function supertree(c, x, y, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  R(c, '#8a829d', -8, -124, 16, 124);
  R(c, '#bca3ba', -3, -121, 5, 121);
  for (let i = 0; i < 5; i++) {
    R(c, '#b899b5', -57 + i * 4, -133 + i * 5, 114 - i * 8, 5);
  }
  R(c, '#947994', -48, -139, 96, 6);
  R(c, '#d9b3c8', -28, -143, 56, 5);
  R(c, '#7fa99e', -35, -136, 70, 5);
  R(c, '#dec2da', -36, -140, 72, 2);
  for (const xx of [-30, -15, 0, 15, 30]) R(c, '#ecd9d4', xx, -134, 3, 3);
  for (const dx of [-41, -20, 20, 41])
    P(c, '#8f829c', [
      [dx, -126],
      [dx + 4, -126],
      [3, -53],
      [-3, -53],
    ]);
  c.restore();
}
function artDeco(c, x, y, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  R(c, '#c99ea8', -76, -124, 152, 124);
  R(c, '#e3b9b5', -70, -119, 140, 119);
  R(c, '#e6c3bc', -38, -153, 76, 153);
  R(c, '#f1d2c5', -29, -164, 58, 10);
  for (let yy = -107; yy < -20; yy += 27) {
    R(c, '#9ab7ba', -62, yy, 124, 15);
    R(c, '#e1c3bd', -12, yy, 24, 15);
  }
  R(c, '#f4ddc6', -80, -126, 160, 5);
  R(c, '#a5bab6', -17, -146, 34, 15);
  R(c, '#a5bab6', -15, -28, 30, 28);
  // Ocean Drive's pastel facades, narrow neon ribs and symmetrical roof fins.
  R(c, '#dfa0b9', -24, -154, 3, 36);
  R(c, '#dfa0b9', 21, -154, 3, 36);
  R(c, '#f7e2c9', -9, -170, 18, 7);
  R(c, '#b2d5c5', -5, -174, 10, 5);
  c.restore();
}

export function drawThemeBackground(
  c,
  { mapId = 'miami', width, height, camera = { x: 0, y: 0 }, mapHeight = 820 },
) {
  const p = getArtTheme(mapId),
    gradient = c.createLinearGradient(0, 0, 0, height);
  p.sky.forEach((color, i) => gradient.addColorStop(i / 2, color));
  c.fillStyle = gradient;
  c.fillRect(0, 0, width, height);
  const night = mapId === 'new-york' || mapId === 'singapore';
  if (night)
    for (let i = 0; i < 35; i++) {
      const x = random(i + 330) * width,
        y = random(i + 340) * height * 0.48;
      R(c, p.light, x, y, i % 3 ? 2 : 3, 2);
    }
  const sunX = width * 0.77 - camera.x * 0.015,
    sunY = height * 0.24 - camera.y * 0.02;
  pixelDisc(c, p.light, sunX, sunY, night ? 35 : 62);
  if (mapId === 'new-york') pixelDisc(c, p.sky[0], sunX + 15, sunY - 9, 31);
  if (mapId === 'miami')
    for (let i = 0; i < 4; i++) R(c, p.sky[1], sunX - 66, sunY + 18 + i * 12, 132, 3 + i);
  const horizon = Math.max(
    height * 0.48,
    Math.min(height * 0.87, height * 0.73 + (mapHeight - camera.y - height) * 0.08),
  );
  for (let i = -1; i < Math.ceil(width / 280) + 1; i++) {
    const x = i * 280 - ((camera.x * 0.05) % 280),
      y = 70 + random(i + 4) * height * 0.23;
    c.globalAlpha = night ? 0.15 : 0.45;
    R(c, p.light, x, y, 110, 7);
    R(c, p.light, x + 18, y - 8, 67, 10);
    R(c, p.light, x - 18, y + 7, 158, 4);
    c.globalAlpha = 1;
  }
  if (mapId === 'brazil') {
    for (let i = -1; i < Math.ceil(width / 470) + 1; i++)
      mountain(c, i * 470 - camera.x * 0.08, horizon, 610, 65 + random(i + 11) * 55, p.far);
  }
  skyline(c, width, horizon, camera.x, p.far, 1, mapId === 'new-york' ? 170 : 100, p.light);
  const anchor = width * 0.54 - ((camera.x * 0.07) % 1400);
  for (const x of [anchor - 1400, anchor, anchor + 1400]) {
    if (x < -440 || x > width + 440) continue;
    if (mapId === 'san-francisco') bridge(c, x, horizon - 5, 0.9);
    else if (mapId === 'new-york') {
      // Keep the entire spire in view even in compact map cards. Different
      // landmarks replace the former pair of identical generic towers.
      const landmarkScale = Math.min(1.15, Math.max(0.55, (horizon - 30) / 336));
      empire(c, x - 34, horizon, landmarkScale);
      chrysler(c, x + 235, horizon + 8, landmarkScale * 0.91);
    } else if (mapId === 'brazil') {
      const landmarkScale = Math.min(1.2, Math.max(0.65, (horizon - 20) / 244));
      corcovado(c, x - 175, horizon + 3, landmarkScale);
      sugarloaf(c, x + 171, horizon + 4, landmarkScale);
    } else if (mapId === 'singapore') {
      marina(c, x, horizon);
      supertree(c, x + 266, horizon, 0.8);
      supertree(c, x - 245, horizon, 0.62);
    } else {
      artDeco(c, x - 210, horizon, 1.15);
      artDeco(c, x + 185, horizon, 0.85);
    }
  }
  R(c, p.water, 0, horizon, width, height - horizon);
  R(c, p.light, 0, horizon + 5, width, 3);
  c.globalAlpha = 0.24;
  for (let i = 0; i < 9; i++)
    R(
      c,
      i % 2 ? p.light : p.city,
      ((((i * 211 - camera.x * 0.1) % (width + 300)) + width + 300) % (width + 300)) - 100,
      horizon + 20 + i * 19,
      90 + i * 11,
      3,
    );
  c.globalAlpha = 1;
  if (mapId === 'san-francisco') {
    c.globalAlpha = 0.3;
    for (let i = 0; i < 4; i++) R(c, '#f4eade', 0, horizon - 30 + i * 9, width, 4);
    c.globalAlpha = 1;
  }
}

function palm(c, x, y, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  R(c, '#a38b7f', -5, -111, 10, 111);
  R(c, '#c7ab8b', -1, -108, 4, 108);
  for (let i = 0; i < 6; i++) R(c, '#8f7d77', -5, -100 + i * 16, 10, 3);
  for (const sign of [-1, 1]) {
    R(c, '#689e88', sign < 0 ? -54 : 0, -128, 54, 12);
    R(c, '#8abc96', sign < 0 ? -43 : 0, -133, 43, 7);
    R(c, '#689e88', sign < 0 ? -68 : 44, -117, 25, 12);
    R(c, '#689e88', sign < 0 ? -73 : 62, -106, 12, 16);
    R(c, '#7dad8e', sign < 0 ? -30 : 0, -148, 30, 13);
    R(c, '#7dad8e', sign < 0 ? -43 : 23, -155, 20, 10);
  }
  c.restore();
}
function townhouse(c, x, y, color, roof) {
  R(c, color, x, y - 146, 92, 146);
  P(c, roof, [
    [x - 7, y - 146],
    [x + 46, y - 184],
    [x + 99, y - 146],
  ]);
  R(c, '#e9dcc7', x + 8, y - 143, 76, 4);
  for (const yy of [-120, -75])
    for (const xx of [16, 57]) {
      R(c, '#d9d9cd', x + xx - 3, y + yy - 3, 25, 30);
      R(c, '#8aacae', x + xx, y + yy, 19, 24);
      R(c, '#e3e0cc', x + xx + 8, y + yy, 3, 24);
    }
  R(c, roof, x + 36, y - 33, 25, 33);
  R(c, '#dfd1b9', x + 31, y - 3, 35, 4);
}
function waterTower(c, x, y) {
  R(c, '#7b8293', x - 25, y - 91, 50, 49);
  P(c, '#89909e', [
    [x - 30, y - 91],
    [x, y - 107],
    [x + 30, y - 91],
  ]);
  R(c, '#aeb1b5', x - 23, y - 79, 46, 4);
  R(c, '#676f85', x - 21, y - 42, 5, 42);
  R(c, '#676f85', x + 16, y - 42, 5, 42);
  R(c, '#676f85', x - 21, y - 19, 42, 4);
}
function lamp(c, x, y, color) {
  R(c, color, x, y - 112, 4, 112);
  R(c, color, x - 10, y - 114, 26, 5);
  R(c, '#f9e1a6', x - 7, y - 109, 20, 13);
  R(c, color, x - 9, y - 96, 24, 3);
  R(c, color, x - 5, y - 5, 14, 5);
}

export function drawThemeScenery(c, map, camera, viewWidth) {
  const id = map.mapId || 'miami',
    p = getArtTheme(id),
    floor = map.height - 80;
  const first = Math.floor((camera.x - 220) / 620);
  c.save();
  c.globalAlpha = 0.72;
  for (let i = first; i < first + Math.ceil(viewWidth / 620) + 3; i++) {
    const x = i * 620 + 110;
    if (x < -150 || x > map.width + 80) continue;
    if (id === 'miami') {
      palm(c, x, floor, 1 + (i % 3) * 0.12);
      if (i % 2 === 0) artDeco(c, x + 260, floor, 0.8);
    } else if (id === 'san-francisco') {
      for (let j = 0; j < 3; j++)
        townhouse(c, x + j * 95, floor, ['#b3c3b2', '#d3b0a5', '#bec0cd'][j], '#9c919b');
      lamp(c, x + 360, floor, '#7a8b9b');
    } else if (id === 'new-york') {
      R(c, '#9b8c9a', x, floor - 170, 175, 170);
      R(c, '#baa4a7', x + 5, floor - 166, 165, 166);
      windows(c, x + 5, floor - 166, 165, 160, '#d7c3a4', 30);
      waterTower(c, x + 102, floor - 170);
      lamp(c, x + 235, floor, '#69788b');
      for (let yy = floor - 140; yy < floor - 20; yy += 35) {
        R(c, '#8c818f', x + 60, yy, 62, 4);
        R(c, '#8c818f', x + 61, yy, 3, 27);
        R(c, '#8c818f', x + 116, yy, 3, 27);
      }
    } else if (id === 'brazil') {
      palm(c, x, floor, 1.25);
      R(c, '#d9b67d', x + 160, floor - 81, 130, 81);
      R(c, '#ead1a0', x + 153, floor - 86, 144, 8);
      R(c, '#729f8e', x + 178, floor - 61, 94, 24);
      R(c, '#c88b79', x + 170, floor - 15, 113, 7);
      for (let j = 0; j < 4; j++) {
        R(c, '#77a487', x + 350 + j * 15, floor - 35 - (j % 2) * 10, 25, 35 + (j % 2) * 10);
      }
    } else {
      supertree(c, x, floor, 0.9);
      supertree(c, x + 210, floor, 0.6);
      R(c, '#8ca4b1', x + 330, floor - 85, 108, 85);
      R(c, '#b1c3c0', x + 325, floor - 91, 119, 8);
      R(c, '#e4c9bd', x + 342, floor - 69, 83, 9);
      windows(c, x + 330, floor - 60, 108, 60, '#e4d6c1', 20);
    }
  }
  c.restore();
  const track = map.gatorTrack;
  if (track) {
    const y = track.y + 27;
    R(c, p.accent, track.x1, y, track.x2 - track.x1, 9);
    const lo = Math.max(track.x1, Math.floor(camera.x / 65) * 65);
    for (let x = lo; x < Math.min(track.x2, camera.x + viewWidth + 65); x += 65)
      R(c, p.light, x, y + 2, 30, 3);
    drawFinishGates(c, map, camera, viewWidth);
  }
}

export function drawFinishGates(c, map, camera = { x: 0 }, viewWidth = map.width) {
  const track = map.gatorTrack;
  if (!track) return;
  const floor = map.height - 80;
  // The checkered center stripe is the actual authoritative ride-center goal:
  // x1 for Purple and x2 for Sunset. Arch posts are cosmetic, not colliders.
  for (const [team, x] of [
    [0, track.x1],
    [1, track.x2],
  ]) {
    if (x < camera.x - 90 || x > camera.x + viewWidth + 90) continue;
    const { main, light: pale, dark } = TEAM_COLORS[team];
    c.save();
    for (const dx of [-49, 45]) {
      R(c, '#30374b', x + dx - 2, floor - 99, 8, 99);
      R(c, main, x + dx, floor - 96, 4, 95);
      R(c, pale, x + dx, floor - 94, 2, 35);
    }
    R(c, '#30374b', x - 58, floor - 120, 116, 27);
    R(c, dark, x - 55, floor - 117, 110, 21);
    R(c, main, x - 55, floor - 117, 110, 4);
    label(c, team ? 'SUNSET FINISH' : 'PURPLE FINISH', x, floor - 104, 9, pale);
    for (let i = 0; i < 12; i++) R(c, i % 2 ? '#fff4d3' : dark, x - 48 + i * 8, floor - 93, 8, 5);
    // A translucent exact-x beam makes the line readable even while its ride
    // is inside the arch. It does not hide players or their team colors.
    c.globalAlpha = 0.32;
    R(c, main, x - 2, floor - 88, 4, 86);
    c.globalAlpha = 1;
    for (let i = 0; i < 4; i++) R(c, i % 2 ? dark : '#fff4d3', x - 4, floor - 33 + i * 8, 8, 8);
    R(c, main, x - 13, floor - 2, 26, 3);
    P(c, main, [
      [x - 32, floor - 13],
      [x - 20, floor - 7],
      [x - 32, floor - 1],
    ]);
    P(c, main, [
      [x + 32, floor - 13],
      [x + 20, floor - 7],
      [x + 32, floor - 1],
    ]);
    R(c, dark, x + (team ? 48 : -52), floor - 148, 4, 29);
    const flagX = team ? x + 52 : x - 78;
    R(c, main, flagX, floor - 148, 27, 17);
    R(c, pale, flagX + 3, floor - 145, 19, 3);
    c.restore();
  }
}

export function drawThemePlatform(c, p, map, camera, viewWidth) {
  const t = getArtTheme(map.mapId),
    floor = p.y >= map.height - 90;
  if (floor) {
    R(c, t.ground, p.x, p.y, p.w, p.h);
    R(c, t.edge, p.x, p.y, p.w, 7);
    R(c, t.groundDark, p.x, p.y + 22, p.w, 4);
    for (
      let x = Math.max(p.x, Math.floor(camera.x / 70) * 70);
      x < Math.min(p.x + p.w, camera.x + viewWidth + 80);
      x += 70
    ) {
      R(c, t.groundDark, x, p.y + 40, 28, 4);
      R(c, t.haze, x + 30, p.y + 58, 15, 4);
    }
    if (map.mapId === 'brazil')
      for (let x = Math.floor(camera.x / 48) * 48; x < camera.x + viewWidth + 48; x += 48) {
        R(c, t.ink, x, p.y + 10, 24, 4);
        R(c, t.edge, x + 24, p.y + 14, 24, 4);
      }
    return;
  }
  R(c, t.ink, p.x + 3, p.y + 6, p.w, Math.max(p.h, 19));
  R(c, p.kind === 'center' ? t.accent : t.platform, p.x, p.y, p.w, p.h);
  R(c, t.edge, p.x, p.y, p.w, 6);
  R(c, t.haze, p.x, p.y + 6, p.w, 3);
  for (let x = p.x + 12; x < p.x + p.w - 10; x += 32) R(c, t.ink, x, p.y + 14, 16, 3);
  R(c, t.ink, p.x + 8, p.y + p.h, 10, 7);
  R(c, t.ink, p.x + p.w - 18, p.y + p.h, 10, 7);
  R(c, '#fff7bf', p.x + 2, p.y - 3, 5, 3);
  R(c, '#fff7bf', p.x + p.w - 7, p.y - 3, 5, 3);
}

export function drawFinishLabels(c, map, camera = { x: 0 }, viewWidth = map.width, cssScale = 1) {
  if (!map.gatorTrack) return;
  const floor = map.height - 80;
  for (const [team, x] of [
    [0, map.gatorTrack.x1],
    [1, map.gatorTrack.x2],
  ]) {
    if (x < camera.x - 75 || x > camera.x + viewWidth + 75) continue;
    const { main, dark } = TEAM_COLORS[team];
    c.save();
    c.translate(x, floor + 40);
    const size = Math.max(1, 1.2 / cssScale);
    c.scale(size, size);
    R(c, dark, -62, -12, 124, 22);
    R(c, main, -62, -12, 124, 3);
    label(c, team ? 'SUNSET FINISH' : 'PURPLE FINISH', 0, 0, 10, '#fff2d9');
    c.restore();
  }
}

export function drawDestinationPoster(c, mapId, width = 640, height = 360) {
  c.save();
  c.scale(width / 640, height / 360);
  if (mapId === 'next-onsite') {
    R(c, '#252940', 0, 0, 640, 360);
    for (let i = 0; i < 32; i++)
      R(c, '#4f4a70', random(i + 120) * 640, random(i + 210) * 360, 3, 3);
    pixelDisc(c, '#51456c', 320, 163, 115);
    R(c, '#b69ad9', 284, 156, 72, 61);
    R(c, '#e3c8f1', 294, 164, 52, 5);
    R(c, '#827098', 295, 128, 12, 29);
    R(c, '#827098', 334, 128, 12, 29);
    R(c, '#827098', 306, 117, 29, 12);
    R(c, '#ffe1a0', 315, 180, 11, 18);
    R(c, '#403e5a', 0, 295, 640, 65);
    for (let x = 0; x < 640; x += 50) R(c, '#8a739e', x, 306, 30, 3);
    c.restore();
    return;
  }
  const p = getArtTheme(mapId);
  drawThemeBackground(c, {
    mapId,
    width: 640,
    height: 360,
    camera: { x: 0, y: 0 },
    mapHeight: 360,
  });
  drawThemeScenery(
    c,
    { mapId, width: 640, height: 375, gatorTrack: { x1: 85, x2: 555, y: 277 } },
    { x: 0, y: 0 },
    640,
  );
  drawThemePlatform(
    c,
    { x: 0, y: 295, w: 640, h: 65 },
    { mapId, height: 375 },
    { x: 0, y: 0 },
    640,
  );
  drawThemePlatform(
    c,
    { x: 30, y: 214, w: 170, h: 20 },
    { mapId, height: 375 },
    { x: 0, y: 0 },
    640,
  );
  drawThemePlatform(
    c,
    { x: 450, y: 174, w: 160, h: 20 },
    { mapId, height: 375 },
    { x: 0, y: 0 },
    640,
  );
  drawFinishLabels(c, { width: 640, height: 375, gatorTrack: { x1: 85, x2: 555 } });
  drawThemedRide(c, { x: 342, y: 274, riderId: 'poster' }, 0.35, 1, mapId);
  drawPosterRaccoon(c, 342, 249, 1.15, 1, mapId, false);
  drawPosterRaccoon(c, 106, 211, 1.5, 0, mapId, true);
  R(c, '#34334c', 503, 117, 34, 57);
  R(c, '#9563ca', 530, 124, 5, 41);
  R(c, '#bec3c6', 508, 122, 20, 22);
  R(c, '#34334c', 511, 125, 14, 16);
  R(c, '#9d7bd5', 515, 129, 6, 7);
  for (const [x, y] of [
    [220, 271],
    [244, 271],
    [233, 250],
  ]) {
    R(c, '#40304f', x, y, 14, 17);
    R(c, '#a475ea', x + 2, y + 1, 10, 13);
    R(c, '#f9ecc8', x + 5, y + 4, 3, 7);
  }
  c.restore();
}

export function drawGlobalHero(c, width = 960, height = 640) {
  c.save();
  c.scale(width / 960, height / 640);
  const gradient = c.createLinearGradient(0, 0, 960, 640);
  gradient.addColorStop(0, '#262e4d');
  gradient.addColorStop(1, '#57426c');
  c.fillStyle = gradient;
  c.fillRect(0, 0, 960, 640);
  for (let i = 0; i < 68; i++) {
    R(
      c,
      i % 3 ? '#8b79a3' : '#e4cb9f',
      random(i + 8) * 960,
      random(i + 78) * 570,
      i % 4 ? 3 : 5,
      3,
    );
  }
  pixelDisc(c, '#66517c', 480, 272, 232);
  pixelDisc(c, '#7a638e', 480, 272, 217);
  for (let yy = 103; yy < 460; yy += 45) R(c, '#9a7fa2', 285, yy, 390, 3);
  for (const xx of [363, 480, 597]) R(c, '#9a7fa2', xx, 67, 3, 405);
  c.save();
  c.globalAlpha = 0.8;
  bridge(c, 184, 307, 0.48);
  empire(c, 805, 316);
  mountain(c, 115, 505, 250, 170, '#6f9c99');
  marina(c, 780, 504);
  c.restore();
  R(c, '#37354f', 0, 539, 960, 101);
  R(c, '#b696bb', 0, 535, 960, 8);
  R(c, '#d7c7bd', 0, 543, 960, 4);
  for (let x = 0; x < 960; x += 65) R(c, '#695777', x, 577, 36, 4);
  // AI1 camera portal anchors the image in Roboflow, rather than any city.
  R(c, '#1d2336', 377, 254, 195, 258);
  R(c, '#444b60', 386, 263, 177, 241);
  R(c, '#9b64d4', 538, 276, 18, 208);
  R(c, '#b7bec5', 403, 275, 123, 113);
  R(c, '#48536b', 410, 282, 109, 99);
  pixelDisc(c, '#20273b', 465, 333, 44);
  pixelDisc(c, '#62658c', 465, 333, 32);
  pixelDisc(c, '#242a44', 465, 333, 23);
  pixelDisc(c, '#a08bd0', 458, 324, 9);
  for (const [x, y] of [
    [415, 287],
    [503, 287],
    [415, 365],
    [503, 365],
  ])
    R(c, '#f8edc9', x, y, 10, 9);
  for (let i = 0; i < 7; i++) {
    R(c, '#252d42', 402, 403 + i * 12, 125, 5);
    R(c, '#798092', 402, 402 + i * 12, 119, 2);
  }
  label(c, 'AI1', 547, 319, 14, '#f4dcff');
  drawPosterRaccoon(c, 310, 526, 3.5, 0, 'new-york', true);
  drawPosterRaccoon(c, 647, 532, 3.45, 1, 'brazil', true);
  drawPosterRaccoon(c, 476, 536, 2.3, 0, 'miami', false);
  drawThemedRide(c, { x: 147, y: 532, riderId: 'hero' }, 0.2, 0, 'brazil');
  drawThemedRide(c, { x: 816, y: 532, riderId: 'hero' }, 0.1, 1, 'new-york');
  // Pixel focus brackets tie the global crew together without baked-in UI copy.
  for (const [x, y, sx, sy] of [
    [238, 282, 1, 1],
    [708, 282, -1, 1],
    [238, 526, 1, -1],
    [708, 526, -1, -1],
  ]) {
    R(c, '#d6b1fa', x + (sx < 0 ? -32 : 0), y, 32, 5);
    R(c, '#d6b1fa', x, y + (sy < 0 ? -32 : 0), 5, 32);
  }
  c.restore();
}
