// Cosmetic layers only. All destinations share the same rider anchor, movement
// and collision boxes; tails, feathers and fins never change gameplay reach.
const R = (c, color, x, y, w, h) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
};
const INK = '#252c44';
export const TEAM_COLORS = Object.freeze([
  Object.freeze({ main: '#8b4ef3', light: '#f1e6ff', dark: '#5522a3', ink: '#2b1749' }),
  Object.freeze({ main: '#ff8b45', light: '#fff0c2', dark: '#b9451f', ink: '#51231f' }),
]);
const rideColors = (team) =>
  TEAM_COLORS[team] || { main: '#d9be80', light: '#fff0cf', dark: '#6b6258', ink: INK };
function pixelEllipse(c, color, x, y, rx, ry) {
  for (let yy = -ry; yy <= ry; yy += 3) {
    const span = Math.sqrt(Math.max(0, 1 - (yy / ry) ** 2)) * rx;
    R(c, color, x - span, y + yy, span * 2, 4);
  }
}
function eye(c, x, y) {
  R(c, '#fff6d9', x, y, 8, 7);
  R(c, INK, x + 4, y + 1, 4, 6);
  R(c, '#ffffff', x + 5, y + 1, 2, 2);
}
function saddle(c, team) {
  const color = rideColors(team).main;
  R(c, INK, -21, -25, 39, 8);
  R(c, color, -18, -25, 33, 5);
  R(c, '#fff1c8', -16, -25, 29, 2);
  R(c, INK, 14, -35, 5, 17);
  R(c, color, 15, -34, 3, 10);
}

export function drawQueenAccessory(c, mapId = 'miami', t = 0) {
  // A low, fitted tiara sits between Lenny's ears. City details are jewelry,
  // never another helmet layered over the face or a towering skyline hat.
  if (mapId === 'san-francisco') {
    // A tiny International Orange cable drapes beside the gold crown.
    R(c, '#a24435', -10, -51, 3, 6);
    R(c, '#ed8057', -10, -51, 2, 4);
    R(c, '#a24435', 12, -51, 3, 6);
    R(c, '#ed8057', 13, -51, 2, 4);
    R(c, '#ed8057', -8, -48, 4, 2);
    R(c, '#ed8057', 9, -48, 4, 2);
  } else if (mapId === 'new-york') {
    for (const [x, y, w, h] of [
      [-13, -49, 6, 2],
      [-10, -54, 3, 6],
      [-3, -58, 2, 8],
      [5, -58, 2, 8],
      [12, -54, 3, 6],
      [14, -49, 6, 2],
    ])
      R(c, '#68d7c1', x, y, w, h);
    R(c, '#227d80', -9, -47, 24, 3);
  } else if (mapId === 'brazil') {
    for (const [x, y, color] of [
      [-9, -54, '#42c395'],
      [-4, -58, '#57d6c7'],
      [1, -60, '#ffb951'],
      [6, -57, '#ef83b9'],
      [11, -53, '#49c297'],
    ]) {
      const sway = Math.round(Math.sin(t * 4 + x) * 1);
      R(c, '#294752', x + sway, y, 4, 10);
      R(c, color, x + 1 + sway, y + 1, 2, 8);
      R(c, '#fff3b6', x + 1 + sway, y + 3, 1, 4);
    }
  } else if (mapId === 'singapore') {
    R(c, '#315b63', 12, -51, 2, 7);
    for (const [x, y] of [
      [8, -52],
      [13, -52],
      [11, -55],
      [11, -49],
    ])
      R(c, '#e577bb', x, y, 4, 3);
    R(c, '#fff2bc', 12, -51, 2, 2);
    R(c, '#7ed5b8', 11, -46, 6, 2);
  } else {
    R(c, '#e777a4', 10, -53, 5, 5);
    R(c, '#ef8db3', 8, -51, 9, 3);
    R(c, '#fff0ad', 11, -51, 2, 2);
    R(c, '#ffd57d', -10, -54, 2, 4);
    R(c, '#ffd57d', -13, -51, 4, 2);
  }
  R(c, INK, -8, -48, 21, 4);
  R(c, '#d99135', -7, -47, 19, 2);
  for (const [x, y] of [
    [-6, -52],
    [1, -54],
    [8, -52],
  ]) {
    // Taper the points into the band; square uprights read as a helmet.
    R(c, INK, x, y - 1, 3, 3);
    R(c, INK, x - 1, y + 1, 5, 3);
    R(c, INK, x - 2, y + 3, 7, -45 - y - 3);
    R(c, '#ffdf86', x + 1, y, 1, 3);
    R(c, '#ffdf86', x, y + 2, 3, 3);
    R(c, '#ffdf86', x - 1, y + 4, 5, -46 - y - 4);
  }
  R(c, '#fff4c2', -6, -46, 17, 1);
  R(c, '#d5546e', 2, -48, 2, 2);
}

export function drawThemedRide(c, ride, t, team = null, mapId = 'miami') {
  c.save();
  c.translate(Math.round(ride.x), Math.round(ride.y));
  c.scale(team === 0 ? -1 : 1, 1);
  const moving = Boolean(ride.riderId),
    phase = t * (moving ? 12 : 2);
  const bob = moving ? Math.round(Math.sin(phase) * 1) : 0;
  const wheel = (x, y = 11, r = 10) => {
    pixelEllipse(c, INK, x, y, r, r);
    pixelEllipse(c, '#8997a6', x, y, r - 3, r - 3);
    pixelEllipse(c, INK, x, y, 3, 3);
    const dx = moving ? Math.round(Math.cos(phase) * 5) : 5;
    const dy = moving ? Math.round(Math.sin(phase) * 5) : 0;
    R(c, '#e9e8d7', x + dx - 1, y + dy - 1, 3, 3);
  };
  c.translate(0, bob);
  if (mapId === 'san-francisco') {
    // Powell-style cable car: enclosed saloon at the rear, open grip section
    // ahead, brass poles, wooden benches and an outboard running board.
    wheel(-35, 13, 8);
    wheel(35, 13, 8);
    R(c, INK, -58, 1, 116, 11);
    R(c, '#7b3030', -56, -2, 112, 11);
    R(c, '#b74538', -54, -1, 108, 7);
    R(c, '#edc585', -56, 6, 112, 3);
    // The front half is open: do not fill it with dark bus windows.
    R(c, INK, -57, -26, 54, 28);
    R(c, '#f1dbab', -54, -24, 48, 26);
    for (const x of [-49, -29]) {
      R(c, '#6f463c', x, -22, 17, 17);
      R(c, '#476d77', x + 2, -20, 13, 13);
      R(c, '#b6d3ca', x + 3, -19, 4, 10);
      R(c, '#d8b574', x - 1, -4, 19, 3);
    }
    for (const x of [3, 21, 40]) {
      R(c, '#5a3f35', x, -10, 17, 10);
      R(c, '#a87243', x + 1, -9, 15, 3);
      R(c, '#d6a35f', x - 1, -3, 18, 3);
      R(c, '#613c32', x + 2, 0, 3, 5);
    }
    for (const x of [-60, -5, 25, 56]) {
      R(c, '#654732', x, -26, 4, 30);
      R(c, '#efd090', x + 1, -25, 2, 28);
    }
    // Two-tier overhanging roof and cream route fascia.
    R(c, INK, -66, -31, 132, 7);
    R(c, '#31534f', -63, -33, 126, 6);
    R(c, '#638079', -54, -36, 108, 4);
    R(c, '#1d3f3d', -45, -39, 90, 4);
    R(c, '#f5deb1', -60, -27, 120, 3);
    // Narrow steps and handrails read as a cable car, rather than a city bus.
    R(c, INK, -65, 10, 130, 5);
    R(c, '#c09456', -62, 10, 124, 2);
    R(c, '#fff0c8', -60, 8, 120, 2);
    R(c, '#f0d095', 59, -12, 3, 20);
    R(c, '#f0d095', 53, -12, 8, 3);
    R(c, '#825f37', 42, -26, 3, 8);
    R(c, '#f1c66c', 39, -21, 9, 4);
    R(c, '#fff0b5', 61, -6, 6, 6);
    R(c, '#b13d36', -64, -2, 4, 5);
    // Decorative route lettering remains upright when travelling left.
    c.save();
    c.translate(-29, 2);
    if (team === 0) c.scale(-1, 1);
    c.fillStyle = '#fff1c8';
    c.font = 'bold 5px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('POWELL', 0, 0);
    c.restore();
  } else if (mapId === 'new-york') {
    wheel(-45, 13, 8);
    wheel(-18, 13, 8);
    wheel(28, 13, 8);
    wheel(52, 13, 8);
    R(c, INK, -73, -25, 146, 38);
    R(c, '#c5cbd0', -70, -23, 140, 33);
    R(c, '#e5e7dd', -66, -27, 129, 5);
    R(c, '#8b99a9', -68, 3, 137, 6);
    R(c, '#d4b75c', -69, -3, 140, 5);
    for (const x of [-60, -36, 11, 35]) {
      R(c, '#3a5367', x, -18, 18, 13);
      R(c, '#87b5bd', x + 2, -16, 14, 3);
    }
    R(c, '#647989', -11, -19, 17, 26);
    R(c, '#bbced1', -9, -17, 6, 14);
    R(c, '#bbced1', -1, -17, 5, 14);
    R(c, '#647989', 59, -21, 11, 27);
    R(c, '#b7d2cf', 60, -18, 8, 11);
    R(c, '#fff0a9', 65, 0, 5, 5);
    R(c, '#b7a880', -70, 1, 4, 5);
    pixelEllipse(c, '#f0cf66', 47, -32, 8, 8);
    R(c, INK, 44, -36, 2, 8);
    R(c, INK, 46, -36, 5, 2);
    R(c, INK, 49, -34, 2, 3);
    R(c, INK, 46, -32, 4, 2);
    R(c, INK, 48, -30, 3, 2);
  } else if (mapId === 'brazil') {
    wheel(-42, 9, 14);
    wheel(42, 9, 14);
    R(c, '#35445a', -45, 4, 87, 5);
    R(c, '#e6645b', -33, -11, 57, 11);
    R(c, '#b53d49', -24, -7, 40, 16);
    R(c, '#f98d6b', -30, -12, 47, 5);
    R(c, '#657885', 29, -24, 5, 31);
    R(c, '#657885', 35, -13, 5, 22);
    R(c, INK, 24, -27, 21, 5);
    R(c, '#e8d8ae', 38, -19, 10, 8);
    R(c, '#dd5851', 26, -9, 25, 5);
    R(c, '#dd5851', -54, -8, 27, 5);
    R(c, INK, -23, -25, 42, 8);
    R(c, '#ebd2a4', -18, -24, 32, 3);
    // A recognisable red delivery backpack, with the requested iFood wordmark.
    R(c, INK, -60, -55, 34, 43);
    R(c, '#d94651', -58, -53, 30, 39);
    R(c, '#ef6870', -55, -52, 24, 5);
    R(c, '#a53040', -57, -19, 28, 4);
    c.fillStyle = '#fff6ed';
    c.font = 'bold 8px Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.save();
    c.translate(-43, -34);
    if (team === 0) c.scale(-1, 1);
    c.fillText('iFood', 0, 0);
    c.restore();
    R(c, '#fff5e9', -48, -27, 11, 2);
    R(c, '#fff5e9', -37, -29, 3, 2);
    R(c, '#212c42', -30, -47, 8, 4);
    R(c, '#212c42', -30, -23, 7, 4);
  } else if (mapId === 'singapore') {
    const wave = moving ? Math.round(Math.sin(phase) * 2) : 0;
    R(c, '#a7ddda', -79, 17 + wave, 154, 3);
    R(c, '#d4eddd', -71, 21 + wave, 139, 2);
    R(c, INK, -73, -7, 145, 20);
    R(c, '#895a43', -68, -5, 133, 22);
    R(c, '#b98355', -60, -4, 117, 18);
    R(c, '#d9b078', -68, -7, 133, 6);
    R(c, '#4e8e84', -47, -21, 88, 16);
    R(c, '#b1d2bd', -41, -20, 76, 13);
    for (const x of [-37, -11, 15]) {
      R(c, '#345867', x, -19, 19, 11);
      R(c, '#8db8b5', x + 2, -18, 15, 3);
    }
    R(c, INK, -54, -27, 103, 7);
    R(c, '#438579', -51, -27, 97, 4);
    R(c, '#e5b76a', -49, -22, 5, 17);
    R(c, '#e5b76a', 38, -22, 5, 17);
    R(c, '#dfba85', -60, 7, 118, 3);
    R(c, '#42515a', 58, -13, 5, 21);
    R(c, '#f5d898', 54, -17, 12, 9);
    R(c, '#725147', -34, 17, 72, 3);
  } else {
    const foot = (x, index) => {
      const step = moving ? Math.round(Math.sin(phase + index * Math.PI) * 5) : 0;
      R(c, INK, x + step, 11, 17, 9);
      R(c, '#7bc882', x + 2 + step, 11, 12, 5);
    };
    foot(-39, 0);
    foot(22, 1);
    R(c, INK, -65, -4, 31, 17);
    R(c, '#4aab79', -63, -4, 32, 12);
    pixelEllipse(c, INK, -5, -5, 47, 22);
    pixelEllipse(c, '#55b77d', -5, -8, 44, 19);
    R(c, '#a6d78d', -38, 2, 80, 8);
    R(c, INK, 28, -19, 43, 25);
    R(c, '#62bc7b', 30, -17, 39, 20);
    R(c, '#a7de90', 41, -2, 28, 6);
    R(c, '#274334', 58, -10, 6, 3);
    R(c, '#4eaa75', 30, -29, 22, 14);
    R(c, INK, 28, -25, 28, 7);
    R(c, '#a7e6d4', 32, -24, 8, 2);
    for (let i = 0; i < 5; i++) R(c, '#338666', -34 + i * 13, -25, 7, 8);
    for (const x of [42, 55]) R(c, '#fff0c9', x, 5, 5, 5);
  }
  if (mapId === 'miami' || mapId === 'brazil') saddle(c, team);
  drawRideTeamMark(c, team);
  c.restore();
}

export function drawRideTeamMark(c, team) {
  // A broad team plaque and a shape mark survive small camera scales. Purple
  // uses a vertical stripe; Sunset uses two horizontal bars in addition to hue.
  const colors = rideColors(team);
  R(c, colors.ink, -13, -7, 29, 14);
  R(c, colors.main, -11, -5, 25, 10);
  if (team === 0) R(c, colors.light, 0, -4, 3, 8);
  else if (team === 1) {
    R(c, colors.light, -2, -3, 9, 2);
    R(c, colors.light, -2, 1, 9, 2);
  } else R(c, colors.light, 0, -2, 4, 4);
}
