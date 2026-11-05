export const GATOR_CENTER_TO_GOAL_SECONDS = 70;

// Keep the route's time commitment comparable across differently sized maps.
// A stolen ride still retains its position, and earned speed keeps its 1.5× bonus.
export function getGatorSpeed(track, speedBoost = false) {
  const halfTrack = Math.max(0, track.x2 - track.x1) / 2;
  return halfTrack / GATOR_CENTER_TO_GOAL_SECONDS * (speedBoost ? 1.5 : 1);
}
