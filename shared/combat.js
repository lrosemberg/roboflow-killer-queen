import { PLAYER_W, PLAYER_H } from './world.js';

// Arcade-style jousting: an armed player needs the higher position and must
// face the victim. A Queen's downward dive can hit directly beneath her.
export function canContactStrike(attacker, victim, now) {
  if (!attacker.alive || attacker.role === 'worker' || now < (attacker.invulnerableUntil || 0))
    return false;
  if (attacker.role === 'queen' && attacker.dive && attacker.y < victim.y) return true;
  const facing = (victim.x - attacker.x) * attacker.facing >= -4;
  return attacker.y < victim.y - 6 && facing;
}

// Nonlethal opposing bodies bounce, but never become solid walls. One bounded
// impulse per short contact window cannot overpower ordinary walking speed,
// accumulate with a crowd, or keep a player pinned against the arena edge.
export function bumpOpponents(a, b, now) {
  if (
    a.team === b.team ||
    !a.alive ||
    !b.alive ||
    now < (a.invulnerableUntil || 0) ||
    now < (b.invulnerableUntil || 0) ||
    now < (a.nextBumpAt || 0) ||
    now < (b.nextBumpAt || 0) ||
    Math.abs(a.x - b.x) >= PLAYER_W ||
    Math.abs(a.y - b.y) >= PLAYER_H
  )
    return false;
  const direction = a.x === b.x ? (String(a.id) < String(b.id) ? -1 : 1) : Math.sign(a.x - b.x);
  a.bumpVx = direction * 180;
  b.bumpVx = -direction * 180;
  a.nextBumpAt = b.nextBumpAt = now + 180;
  return true;
}
