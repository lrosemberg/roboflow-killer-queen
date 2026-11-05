const DEFENSE = Object.freeze({
  easy: { economic: .92, gator: .8, cap: 2, retreat: 240, guard: 260 },
  normal: { economic: .8, gator: .55, cap: 4, retreat: 330, guard: 360 },
  hard: { economic: .65, gator: .35, cap: 6, retreat: 410, guard: 440 },
});
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Called once per room's planning interval, not once per bot or physics frame.
// These assignments only select targets; ordinary flight and contact combat
// still have to reach them. Workers keep their existing navigable jobs.
export function createBotStrategy({ players, map, scores, gator, botDifficulty = 'normal' }, now) {
  const roster = players instanceof Map ? [...players.values()] : [...players];
  const teams = [roster.filter(p => p.team === 0), roster.filter(p => p.team === 1)];
  const settings = DEFENSE[botDifficulty] || DEFENSE.normal;
  const jobs = new Map(), defense = new Map();
  const jobNames = ['runner', 'fighter', 'gator', botDifficulty === 'easy' ? 'runner' : 'fighter'];
  for (const crew of teams) {
    const workers = crew.filter(p => p.bot && p.role !== 'queen').sort((a, b) => a.botSeed - b.botSeed);
    workers.forEach((p, index) => jobs.set(p.id, jobNames[index % jobNames.length]));
  }
  const rider = roster.find(p => p.id === gator.riderId && p.alive && p.role === 'worker');
  const track = map.gatorTrack, halfTrack = (track.x2 - track.x1) / 2;
  const progress = halfTrack > 0 ? (gator.x - (track.x1 + track.x2) / 2) / halfTrack : 0;
  for (const team of [0, 1]) {
    const crew = teams[team], rivals = teams[1 - team];
    const available = crew.filter(p => p.bot && p.alive && p.role !== 'worker' && !(p.role === 'queen' && p.queenLives <= 1));
    const budget = Math.min(available.length, settings.cap, Math.max(1, Math.ceil(crew.length / 10)));
    if (!budget) continue;
    const objectives = [];
    const riderProgress = rider && progress * (rider.team === 0 ? -1 : 1);
    if (rider && rider.team !== team && riderProgress >= settings.gator && now >= (rider.invulnerableUntil || 0)) {
      objectives.push({ kind: 'gator', target: rider, urgency: 1 + riderProgress });
    }
    const economicProgress = scores[1 - team] / map.scoreTarget;
    const finalChip = scores[1 - team] > 0 && map.scoreTarget - scores[1 - team] <= 1;
    if (economicProgress >= settings.economic || finalChip) {
      const base = map.bases[1 - team], door = { x: base.x + base.w / 2, y: base.y + base.h - 36 };
      // Watch the final approach to the opposing vault. Distant collectors are
      // not pursued just because their team has a high score.
      for (const carrier of rivals) {
        if (!carrier.alive || carrier.role !== 'worker' || !carrier.carrying || now < (carrier.invulnerableUntil || 0)) continue;
        const approach = distance(carrier, door);
        if (approach <= 480) objectives.push({ kind: 'carrier', target: carrier, urgency: 1 + economicProgress + .25 * (1 - approach / 480) });
      }
    }
    for (const queen of crew) {
      if (!queen.alive || queen.role !== 'queen') continue;
      let attacker = null, nearest = settings.guard;
      for (const enemy of rivals) {
        if (!enemy.alive || enemy.role === 'worker' || now < (enemy.invulnerableUntil || 0)) continue;
        const proximity = distance(queen, enemy);
        if (proximity < nearest) { attacker = enemy; nearest = proximity; }
      }
      if (!attacker) continue;
      const urgency = 2.6 + (3 - queen.queenLives) * .4 + (1 - nearest / settings.guard) * .3;
      const existing = objectives.find(objective => objective.kind === 'bodyguard' && objective.target.id === attacker.id);
      if (existing && existing.urgency >= urgency) continue;
      if (existing) objectives.splice(objectives.indexOf(existing), 1);
      objectives.push({ kind: 'bodyguard', target: attacker, protectedId: queen.id, urgency });
    }
    objectives.sort((a, b) => b.urgency - a.urgency || String(a.target.id).localeCompare(String(b.target.id)));
    // Cover at most two imminent routes, then reinforce them with the closest
    // remaining fighters. The cap prevents an XXL crew from all dogpiling.
    const routes = objectives.slice(0, Math.min(2, budget));
    for (let index = 0; index < budget && routes.length; index++) {
      const objective = routes[index % routes.length];
      let nearest = -1, best = Infinity;
      for (let candidate = 0; candidate < available.length; candidate++) {
        const defender = available[candidate];
        if (defender.id === objective.protectedId || objective.kind === 'bodyguard' && defender.role === 'queen' && defender.queenLives <= 2) continue;
        // Spend a warrior's renewable life before exposing a Queen. A distant
        // warrior can still lose the assignment to a nearby healthy Queen.
        const cost = distance(defender, objective.target) + (defender.role === 'queen' ? 900 : 0);
        if (cost < best) { nearest = candidate; best = cost; }
      }
      if (nearest < 0) continue;
      const [defender] = available.splice(nearest, 1);
      defense.set(defender.id, { kind: objective.kind, targetId: objective.target.id, ...(objective.protectedId ? { protectedId: objective.protectedId } : {}) });
    }
  }
  return { teams, jobs, defense };
}

export function queenRetreatTarget(player, enemies, map, difficulty = 'normal') {
  if (player.role !== 'queen') return null;
  const settings = DEFENSE[difficulty] || DEFENSE.normal;
  const radius = settings.retreat * (player.queenLives === 1 ? 1 : player.queenLives === 2 ? .85 : .55);
  const threats = enemies.filter(enemy => enemy.alive && enemy.role !== 'worker' && distance(player, enemy) < radius + (enemy.role === 'queen' ? 55 : 0) && (player.queenLives <= 2 || enemy.y < player.y + 12));
  if (!threats.length) return null;
  const base = map.bases[player.team], homeX = base.x + base.w / 2;
  const candidates = [-1, 1].map(direction => ({ x: clamp(player.x + direction * 260, 30, map.width - 60), y: Math.max(20, player.y - 200) }));
  const safety = target => {
    const firstStep = { x: player.x + clamp(target.x - player.x, -70, 70), y: player.y + clamp(target.y - player.y, -70, 70) };
    return Math.min(...threats.map(enemy => distance(firstStep, enemy))) * 3 + Math.min(...threats.map(enemy => distance(target, enemy))) * .2 - Math.abs(target.x - homeX) * .05;
  };
  return safety(candidates[0]) >= safety(candidates[1]) ? candidates[0] : candidates[1];
}

export function isQueenGateSafe(player, gate, enemies) {
  const arrival = { x: gate.x + gate.w / 2, y: gate.y + 25 };
  return !enemies.some(enemy => enemy.alive && enemy.role !== 'worker' && distance(enemy, arrival) < 210 && (player.queenLives <= 2 || enemy.y < arrival.y + 24));
}
