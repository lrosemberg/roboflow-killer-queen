// Strategic AI caches whether it wants to ascend. Translate that desire into
// actual press/release input at physics rate, using the same cooldown as a
// human. Never set velocity or bypass movePlayer's rising-edge check.
export function pulseBotFlight(player, input, now) {
  if (player.role !== 'queen' && player.role !== 'warrior') return input;
  const diving = player.role === 'queen' && (input.down || input.dash);
  return {
    ...input,
    jump: Boolean(input.jump && !diving && !player.jumpHeld && now >= (player.nextFlap || 0)),
  };
}
