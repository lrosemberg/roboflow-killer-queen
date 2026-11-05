// This tuple order is the compact-v1 wire contract. Changes require a new
// protocol version; clients import the schema rather than receiving it per frame.
export const COMPACT_PROTOCOL = 'compact-v1';
export const PLAYER_FIELDS = Object.freeze([
  'id',
  'name',
  'team',
  'role',
  'x',
  'y',
  'vx',
  'vy',
  'facing',
  'grounded',
  'alive',
  'respawnAt',
  'carrying',
  'upgradeUntil',
  'upgradeGateId',
  'upgradeKind',
  'queenLives',
  'eliminated',
  'speedBoost',
  'dive',
  'bot',
  'invulnerableUntil',
  'attackUntil',
  'emote',
  'emoteUntil',
  'score',
  'kills',
  'ack',
  'jumps',
  'jumpHeld',
  'dashHeld',
  'nextFlap',
  'nextDash',
  'dashUntil',
]);

export function encodePlayer(player) {
  return PLAYER_FIELDS.map((field) => player[field]);
}

export function decodeSnapshot(snapshot) {
  if (snapshot?.type !== 'state' || snapshot.encoding !== COMPACT_PROTOCOL) return snapshot;
  const players = snapshot.players.map((tuple) => {
    if (!Array.isArray(tuple) || tuple.length !== PLAYER_FIELDS.length) {
      throw new TypeError('Invalid compact-v1 player tuple');
    }
    const player = {};
    for (let i = 0; i < PLAYER_FIELDS.length; i++) player[PLAYER_FIELDS[i]] = tuple[i];
    return player;
  });
  return { ...snapshot, players };
}
