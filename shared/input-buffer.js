const KEYS = ['left', 'right', 'jump', 'action', 'dash', 'down'];

// State packets can deliver a complete tap between two simulation frames.
// Retain only its rising edge until the next frame, never a queue that could
// launch the player after landing, respawning or returning from a menu.
export function resetPlayerInput(player) {
  player.input = Object.fromEntries(KEYS.map(key => [key, false]));
  player.pendingJumpPress = false;
  player.pendingActionPress = false;
}

export function queuePlayerInput(player, input) {
  const next = Object.fromEntries(KEYS.map(key => [key, input?.[key] === true]));
  if (next.jump && !player.input?.jump) player.pendingJumpPress = true;
  if (next.action && !player.input?.action) player.pendingActionPress = true;
  player.input = next;
}

export function consumePlayerInput(player) {
  const input = { ...player.input };
  if (player.pendingJumpPress) { input.jump = true; input.jumpPressed = true; }
  if (player.pendingActionPress) input.action = true;
  player.pendingJumpPress = false;
  player.pendingActionPress = false;
  return input;
}
