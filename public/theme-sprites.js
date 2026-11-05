// Cosmetic layers only. All destinations share the same rider anchor, movement
// and collision boxes; tails, feathers and fins never change gameplay reach.
const R = (c, color, x, y, w, h) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
};
const INK = '#252c44';
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
  const color = team === 1 ? '#ff7d91' : '#a78bfa';
  R(c, INK, -21, -25, 39, 8);
  R(c, color, -18, -25, 33, 5);
  R(c, '#fff1c8', -16, -25, 29, 2);
  R(c, INK, 14, -35, 5, 17);
  R(c, color, 15, -34, 3, 10);
}

export function drawQueenAccessory(c, mapId = 'miami', t = 0) {
  // The gold three-point crown is the shared role signal. City details stay
  // behind/alongside it, above the face, and never recolor a team's shirt.
  if (mapId === 'san-francisco') {
    R(c, '#613747', -14, -60, 6, 14);
    R(c, '#ec7958', -13, -61, 4, 14);
    R(c, '#613747', 10, -60, 6, 14);
    R(c, '#ec7958', 11, -61, 4, 14);
    for (let x = -8; x < 11; x += 3)
      R(c, '#ec7958', x, -55 + Math.round((1 - Math.abs(x) / 11) * 3), 3, 2);
    R(c, '#ffe1aa', -13, -59, 4, 2);
    R(c, '#ffe1aa', 11, -59, 4, 2);
  } else if (mapId === 'new-york') {
    for (const [x, y, w, h] of [
      [-18, -52, 8, 3],
      [-14, -59, 4, 9],
      [-6, -63, 3, 12],
      [3, -64, 3, 13],
      [11, -59, 4, 9],
      [15, -52, 8, 3],
    ])
      R(c, '#68d7c1', x, y, w, h);
    R(c, '#227d80', -12, -50, 29, 5);
  } else if (mapId === 'brazil') {
    for (const [x, y, color] of [
      [-16, -61, '#42c395'],
      [-9, -66, '#57d6c7'],
      [-2, -69, '#ffb951'],
      [5, -65, '#ef83b9'],
      [12, -60, '#49c297'],
    ]) {
      const sway = Math.round(Math.sin(t * 4 + x) * 1);
      R(c, '#294752', x + sway, y, 6, 17);
      R(c, color, x + 1 + sway, y + 1, 4, 13);
      R(c, '#fff3b6', x + 2 + sway, y + 5, 1, 7);
    }
  } else if (mapId === 'singapore') {
    R(c, '#315b63', 13, -58, 3, 13);
    for (const [x, y] of [
      [9, -59],
      [15, -59],
      [12, -63],
      [12, -55],
    ])
      R(c, '#e577bb', x, y, 6, 5);
    R(c, '#fff2bc', 13, -58, 4, 4);
    R(c, '#7ed5b8', 9, -49, 8, 3);
  } else {
    R(c, '#e777a4', 10, -57, 7, 7);
    R(c, '#ef8db3', 7, -54, 13, 4);
    R(c, '#fff0ad', 12, -54, 3, 3);
    R(c, '#ffd57d', -13, -60, 3, 6);
    R(c, '#ffd57d', -18, -56, 5, 2);
  }
  R(c, INK, -10, -54, 24, 8);
  R(c, '#f9bf58', -9, -54, 22, 6);
  for (const x of [-9, 0, 9]) {
    R(c, INK, x - 1, -59, 5, 7);
    R(c, '#ffdf86', x, -58, 3, 8);
  }
  R(c, '#fff4c2', -8, -50, 20, 2);
  R(c, '#a56ee4', 1, -53, 3, 3);
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
    wheel(-37, 12, 10);
    wheel(37, 12, 10);
    R(c, INK, -62, -24, 124, 36);
    R(c, '#c17256', -59, -21, 118, 29);
    R(c, '#efd59b', -57, -20, 114, 17);
    R(c, '#8c493f', -55, -2, 110, 10);
    for (const x of [-48, -22, 16, 42]) {
      R(c, '#476574', x, -18, 19, 13);
      R(c, '#c9d4c4', x + 2, -16, 4, 9);
    }
    R(c, '#efd59b', -3, -20, 15, 28);
    R(c, '#8c493f', 1, -17, 7, 23);
    R(c, INK, -67, -29, 134, 6);
    R(c, '#d89b68', -64, -29, 128, 3);
    R(c, '#f5dfaf', -65, 4, 130, 3);
    R(c, INK, -69, 9, 138, 4);
    R(c, '#f6d57d', 59, -10, 7, 7);
    R(c, '#7c4c46', -63, -9, 5, 6);
    R(c, '#4b4d5c', -37, -39, 7, 10);
    R(c, '#e7c578', -39, -40, 11, 6);
    R(c, '#e1bf88', -46, -1, 18, 5);
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
  // The team pennant stays identical across rides, including passenger vehicles.
  const flag = team === 1 ? '#ff7d91' : '#a78bfa';
  R(c, INK, -11, -32, 26, 6);
  R(c, flag, -9, -31, 22, 3);
  c.restore();
}
