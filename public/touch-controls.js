// DOM input adapter. The pure TouchInput model owns each finger independently.
// Pointer capture is best effort: window listeners also track an uncaptured
// finger. Older mobile browsers use Touch Events, never both input streams.
export function bindTouchControls({
  input,
  stick,
  buttons,
  game,
  enabled,
  gestureEnabled = enabled,
  onChange = () => {},
  onEngage = () => {},
  onRadius = () => {},
  onTouchDetected = () => {},
  eventTarget = window,
  pointerEvents = typeof eventTarget.PointerEvent === 'function',
}) {
  const captures = new Map(),
    listeners = [];
  const listen = (target, type, fn, options = { passive: false }) => {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  const prevent = (event) => {
    if (event.cancelable) event.preventDefault();
  };
  const geometry = () => {
    const r = stick.getBoundingClientRect(),
      radius = Math.min(r.width, r.height) * 0.32;
    onRadius(radius);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius };
  };
  const press = (id, element, action, x, y, event) => {
    if (!enabled() || element.disabled) return;
    let accepted;
    if (action === 'stick') {
      const r = geometry();
      accepted = input.pressStick(id, x, y, r.x, r.y, r.radius);
    } else accepted = input.pressButton(id, action);
    // Extra fingers on an occupied joystick must not become browser gestures.
    prevent(event);
    if (!accepted) return;
    captures.set(id, element);
    if (pointerEvents) {
      try {
        element.setPointerCapture(id);
      } catch {}
    }
    onEngage();
    onChange();
  };
  const release = (id, event) => {
    const element = captures.get(id);
    captures.delete(id);
    const changed = input.release(id);
    if (changed) {
      prevent(event);
      onChange();
    }
    if (pointerEvents && element) {
      try {
        if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      } catch {}
    }
  };
  const targets = [
    [stick, 'stick'],
    ...Object.entries(buttons).map(([action, element]) => [element, action]),
  ];
  if (pointerEvents) {
    listen(
      eventTarget,
      'pointerdown',
      (event) => {
        if (event.pointerType === 'touch') onTouchDetected();
      },
      { capture: true, passive: true },
    );
    for (const [element, action] of targets)
      listen(element, 'pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        press(event.pointerId, element, action, event.clientX, event.clientY, event);
      });
    listen(eventTarget, 'pointermove', (event) => {
      if (input.move(event.pointerId, event.clientX, event.clientY)) {
        prevent(event);
        onChange();
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      listen(eventTarget, type, (event) => release(event.pointerId, event));
    }
  } else {
    listen(eventTarget, 'touchstart', onTouchDetected, { capture: true, passive: true });
    for (const [element, action] of targets)
      listen(element, 'touchstart', (event) => {
        for (const touch of event.changedTouches)
          press(touch.identifier, element, action, touch.clientX, touch.clientY, event);
      });
    listen(eventTarget, 'touchmove', (event) => {
      let changed = false;
      for (const touch of event.changedTouches)
        changed = input.move(touch.identifier, touch.clientX, touch.clientY) || changed;
      if (changed) {
        prevent(event);
        onChange();
      }
    });
    for (const type of ['touchend', 'touchcancel'])
      listen(eventTarget, type, (event) => {
        for (const touch of event.changedTouches) release(touch.identifier, event);
      });
  }
  // CSS touch-action:none on the game ancestor is the primary gesture guard.
  // Non-passive Touch/Gesture listeners cover older iOS/WebViews, including a
  // second finger beginning in an empty HUD area rather than on a control.
  // Do not cancel ordinary menu taps, dialogs, or scrolling crew/lobby panels.
  const canGuard = (event) =>
    gestureEnabled() &&
    !event.target?.closest?.(
      'dialog, input, textarea, select, .scoreboard, .waiting-banner, [data-touch-scroll]',
    );
  listen(
    game,
    'touchstart',
    (event) => {
      if (canGuard(event) && event.touches.length > 1) prevent(event);
    },
    { capture: true, passive: false },
  );
  listen(
    game,
    'touchmove',
    (event) => {
      if (canGuard(event)) prevent(event);
    },
    { capture: true, passive: false },
  );
  for (const type of ['gesturestart', 'gesturechange']) {
    listen(
      game,
      type,
      (event) => {
        if (canGuard(event)) prevent(event);
      },
      { capture: true, passive: false },
    );
  }
  // A finger that began in a menu can remain targeted there after the menu
  // closes. While the arena is active, guard that crossing gesture too. The
  // application disables gestureEnabled for menus, the lobby and the home page;
  // this never installs a permanent browser-wide zoom restriction.
  for (const type of ['touchstart', 'touchmove']) {
    listen(
      eventTarget,
      type,
      (event) => {
        if (gestureEnabled() && event.touches.length > 1) prevent(event);
      },
      { capture: true, passive: false },
    );
  }
  for (const type of ['gesturestart', 'gesturechange']) {
    listen(
      eventTarget,
      type,
      (event) => {
        if (gestureEnabled()) prevent(event);
      },
      { capture: true, passive: false },
    );
  }
  for (const [element] of targets) listen(element, 'contextmenu', prevent);

  const reset = ({ notify = true } = {}) => {
    input.reset();
    const held = [...captures];
    captures.clear();
    for (const [id, element] of held) {
      try {
        if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
      } catch {}
    }
    if (notify) onChange();
  };
  const rebase = () => {
    const r = geometry();
    input.rebaseStick(r.x, r.y, r.radius);
    onChange();
  };
  return {
    reset,
    rebase,
    destroy() {
      reset();
      for (const remove of listeners) remove();
    },
  };
}
