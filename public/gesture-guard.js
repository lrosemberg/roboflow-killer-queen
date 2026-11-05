// Keep native single-finger scrolling, but never hand multi-finger gestures or
// rapid double taps to page zoom. Runs on every screen, before entering a room.
export function bindPageGestureGuard(target = document) {
  let candidate = null,
    previous = null;
  const options = { capture: true, passive: false };
  const cancel = () => {
    candidate = null;
    previous = null;
  };
  const prevent = (event) => {
    if (event.cancelable) event.preventDefault();
  };
  const start = (event) => {
    if (event.touches.length !== 1) {
      if (event.touches.length > 1) prevent(event);
      cancel();
      return;
    }
    const touch = event.touches[0];
    candidate = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
  };
  const move = (event) => {
    if (event.touches.length > 1) {
      prevent(event);
      cancel();
      return;
    }
    if (!candidate || event.touches.length !== 1) {
      cancel();
      return;
    }
    const touch = event.touches[0];
    if (
      touch.identifier !== candidate.id ||
      Math.hypot(touch.clientX - candidate.x, touch.clientY - candidate.y) > 10
    )
      cancel();
  };
  const end = (event) => {
    const tap = candidate;
    candidate = null;
    if (!tap || event.touches.length || event.timeStamp - tap.time > 350) {
      previous = null;
      return;
    }
    const touch = [...event.changedTouches].find((t) => t.identifier === tap.id);
    if (!touch || Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > 10) {
      previous = null;
      return;
    }
    const elapsed = previous ? event.timeStamp - previous.time : Infinity;
    if (
      elapsed >= 0 &&
      elapsed <= 350 &&
      Math.hypot(touch.clientX - previous.x, touch.clientY - previous.y) <= 24
    ) {
      if (event.cancelable) event.preventDefault();
      previous = null;
    } else previous = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
  };
  const gesture = (event) => {
    prevent(event);
    cancel();
  };
  const wheel = (event) => {
    if (event.ctrlKey) prevent(event);
  };
  const listeners = [
    ['touchstart', start],
    ['touchmove', move],
    ['touchend', end],
    ['touchcancel', cancel],
    ['dblclick', prevent],
    ['gesturestart', gesture],
    ['gesturechange', gesture],
    ['gestureend', gesture],
    ['wheel', wheel],
  ];
  for (const [type, handler] of listeners) target.addEventListener(type, handler, options);
  return () => {
    for (const [type, handler] of listeners) target.removeEventListener(type, handler, options);
    cancel();
  };
}
