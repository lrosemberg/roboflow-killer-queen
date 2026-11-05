import { PLAYER_W, PLAYER_H, SPEED, JUMP_SPEED, GRAVITY } from './world.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const margin = PLAYER_W / 2 + 25;
const interval = platform => [platform.x + margin, platform.x + platform.w - margin];
const gap = (a, b) => Math.max(0, a[0] - b[1], b[0] - a[1]);

// Navigation chooses inputs; every step, jump and landing still goes through
// the same movement/collision code as a human player. No position correction.
export function createNavigator(map) {
  const platforms = map.platforms;
  const edges = platforms.map(() => []);
  for (let from = 0; from < platforms.length; from++) {
    for (let to = 0; to < platforms.length; to++) {
      if (from === to) continue;
      const rise = platforms[from].y - platforms[to].y;
      const discriminant = JUMP_SPEED ** 2 - 2 * GRAVITY * rise;
      if (discriminant < 15000) continue;
      const airtime = (JUMP_SPEED + Math.sqrt(discriminant)) / GRAVITY;
      const range = Math.max(0, (airtime - .06) * SPEED * .82);
      const separation = gap(interval(platforms[from]), interval(platforms[to]));
      if (separation > range) continue;
      const dropRange = rise < 0 ? Math.sqrt(-2 * rise / GRAVITY) * SPEED * .8 : 0;
      const connectedFloor = rise === 0 && platforms[from].x <= platforms[to].x + platforms[to].w && platforms[to].x <= platforms[from].x + platforms[from].w;
      edges[from].push({ from, to, range, kind: connectedFloor ? 'walk' : rise > 0 || separation > dropRange ? 'jump' : 'drop' });
    }
  }
  const distances = new Map();
  function distancesTo(goal) {
    if (distances.has(goal)) return distances.get(goal);
    const steps = platforms.map(() => Infinity); steps[goal] = 0;
    const queue = [goal];
    for (let i = 0; i < queue.length; i++) {
      const to = queue[i];
      for (let from = 0; from < edges.length; from++) {
        if (steps[from] !== Infinity || !edges[from].some(edge => edge.to === to)) continue;
        steps[from] = steps[to] + 1; queue.push(from);
      }
    }
    distances.set(goal, steps); return steps;
  }
  function support(x, feet) {
    let best = 0, height = Infinity;
    for (let i = 0; i < platforms.length; i++) {
      const platform = platforms[i];
      if (x < platform.x || x > platform.x + platform.w || platform.y < feet - 8) continue;
      if (platform.y < height) { best = i; height = platform.y; }
    }
    return best;
  }
  const goalFor = target => support(target.x + PLAYER_W / 2, target.y + PLAYER_H);
  const currentFor = player => support(player.x + PLAYER_W / 2, player.y + PLAYER_H);
  function routeDistance(player, target) {
    const steps = distancesTo(goalFor(target))[currentFor(player)];
    return Number.isFinite(steps) ? Math.abs(player.x - target.x) + steps * 240 : Infinity;
  }
  function steer(player, target) {
    const x = player.x + PLAYER_W / 2;
    const move = (destination, extra = {}) => ({ left: destination < x - 8, right: destination > x + 8, jump: false, down: false, ...extra });
    if (!player.grounded && player.navigationEdge) {
      const edge = player.navigationEdge;
      return move(edge.landing, { down: edge.kind === 'drop' && player.y + PLAYER_H <= platforms[edge.from].y + 8 });
    }
    if (!player.grounded) return move(target.x + PLAYER_W / 2);
    player.navigationEdge = null;
    const from = currentFor(player), goal = goalFor(target);
    if (from === goal) return move(target.x + PLAYER_W / 2);
    const steps = distancesTo(goal);
    const candidates = edges[from].filter(edge => steps[edge.to] < steps[from]);
    candidates.sort((a, b) => steps[a.to] - steps[b.to] || Math.abs(clamp(x, ...interval(platforms[a.to])) - x) - Math.abs(clamp(x, ...interval(platforms[b.to])) - x));
    const edge = candidates[0];
    if (!edge) return move(target.x + PLAYER_W / 2);
    const [fromLeft, fromRight] = interval(platforms[from]);
    const [toLeft, toRight] = interval(platforms[edge.to]);
    if (edge.kind === 'walk') return move(clamp(target.x + PLAYER_W / 2, toLeft, toRight));
    if (edge.kind === 'drop') {
      const landing = clamp(x, toLeft, toRight);
      player.navigationEdge = { ...edge, landing };
      return move(landing, { down: x >= toLeft - 8 && x <= toRight + 8 });
    }
    const startLeft = Math.max(fromLeft, toLeft - edge.range);
    const startRight = Math.min(fromRight, toRight + edge.range);
    const takeoff = clamp(x, startLeft, startRight);
    if (Math.abs(takeoff - x) > 8) return move(takeoff);
    const landing = clamp(x, toLeft, toRight);
    player.navigationEdge = { ...edge, landing };
    return move(landing, { jump: !player.jumpHeld });
  }
  return { steer, distance: routeDistance, goalFor, currentFor, edges };
}
