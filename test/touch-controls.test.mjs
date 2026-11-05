import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchInput } from '../public/touch-input.js';
import { bindTouchControls } from '../public/touch-controls.js';

class Surface {
  listeners = new Map();
  rect = { left: 100, top: 100, width: 100, height: 100 };
  captured = new Set();
  addEventListener(type, fn, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ fn, options });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, fn) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((e) => e.fn !== fn),
    );
  }
  getBoundingClientRect() {
    return this.rect;
  }
  setPointerCapture(id) {
    if (this.failCapture) throw new Error('capture unavailable');
    this.captured.add(id);
  }
  hasPointerCapture(id) {
    return this.captured.has(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
  }
  closest() {
    return this.scrollable ? this : null;
  }
  emit(type, values = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      cancelable: true,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...values,
    };
    for (const { fn } of this.listeners.get(type) || []) fn(event);
    return event;
  }
}
function setup(pointerEvents = true) {
  const input = new TouchInput(),
    game = new Surface(),
    eventTarget = new Surface(),
    stick = new Surface();
  const buttons = { jump: new Surface(), action: new Surface(), down: new Surface() };
  let enabled = true,
    gestureEnabled = true,
    changed = 0,
    detected = 0;
  const adapter = bindTouchControls({
    input,
    game,
    stick,
    buttons,
    eventTarget,
    pointerEvents,
    enabled: () => enabled,
    gestureEnabled: () => gestureEnabled,
    onChange: () => changed++,
    onTouchDetected: () => detected++,
  });
  return {
    input,
    game,
    eventTarget,
    stick,
    buttons,
    adapter,
    disable: () => {
      enabled = false;
      gestureEnabled = false;
    },
    changes: () => changed,
    detections: () => detected,
  };
}
const finger = (pointerId, x = 150, y = 150) => ({
  pointerId,
  pointerType: 'touch',
  clientX: x,
  clientY: y,
});
const touch = (identifier, x = 150, y = 150) => ({ identifier, clientX: x, clientY: y });

test('signed browser IDs and two fingers work even when pointer capture fails', () => {
  const h = setup();
  h.stick.failCapture = true;
  h.stick.emit('pointerdown', finger(-42, 180));
  h.buttons.jump.emit('pointerdown', finger(-7));
  assert.equal(h.input.snapshot().right, true);
  assert.equal(h.input.snapshot().jump, true);
  h.eventTarget.emit('pointermove', finger(-42, 110));
  assert.equal(
    h.input.snapshot().left,
    true,
    'Window move tracks a finger after it leaves the uncaptured joystick',
  );
  h.eventTarget.emit('pointerup', finger(-7));
  assert.equal(h.input.snapshot().jump, false);
  assert.equal(
    h.input.snapshot().left,
    true,
    'Releasing the action finger must not release movement',
  );
  h.eventTarget.emit('pointercancel', finger(-42));
  assert.equal(h.input.snapshot().left, false);
});

test('lost capture releases just its own action; reset clears all pointers and reused IDs work', () => {
  const h = setup();
  h.buttons.jump.emit('pointerdown', finger(1));
  h.buttons.action.emit('pointerdown', finger(2));
  h.eventTarget.emit('lostpointercapture', finger(2));
  assert.equal(h.input.snapshot().jump, true);
  assert.equal(h.input.snapshot().action, false);
  h.adapter.reset({ notify: false });
  assert.equal(h.buttons.jump.captured.size, 0);
  assert.equal(h.input.snapshot().jump, false);
  h.buttons.jump.emit('pointerdown', finger(1));
  assert.equal(h.input.snapshot().jump, true);
  h.adapter.destroy();
  assert.equal(h.input.snapshot().jump, false);
  h.buttons.jump.emit('pointerdown', finger(1));
  assert.equal(h.input.snapshot().jump, false);
});

test('browser toolbar resize rebases the stick without cancelling held flight or movement', () => {
  const h = setup();
  h.stick.emit('pointerdown', finger(1, 180));
  h.buttons.jump.emit('pointerdown', finger(2));
  const before = h.input.snapshot();
  h.stick.rect = { left: 200, top: 140, width: 120, height: 120 };
  h.adapter.rebase();
  assert.deepEqual(h.input.snapshot(), before);
  h.eventTarget.emit('pointermove', finger(1, 220, 200));
  assert.equal(
    h.input.snapshot().left,
    true,
    'Future movement uses the relocated control geometry',
  );
  assert.equal(h.input.snapshot().jump, true);
});

test('Touch Events fallback preserves simultaneous joystick and jump with independent cancellation', () => {
  const h = setup(false);
  h.eventTarget.emit('touchstart', { touches: [touch(-3)] });
  assert.equal(h.detections(), 1);
  const start = h.stick.emit('touchstart', { changedTouches: [touch(-3, 180)] });
  h.buttons.jump.emit('touchstart', { changedTouches: [touch(9)] });
  assert.equal(
    start.defaultPrevented,
    true,
    'Fallback prevents duplicate compatibility mouse actions',
  );
  assert.equal(h.input.snapshot().right, true);
  assert.equal(h.input.snapshot().jump, true);
  h.eventTarget.emit('touchmove', {
    changedTouches: [touch(-3, 110), touch(9, 110)],
    touches: [touch(-3, 110), touch(9, 110)],
  });
  assert.equal(h.input.snapshot().left, true);
  assert.equal(h.input.snapshot().jump, true);
  h.eventTarget.emit('touchcancel', { changedTouches: [touch(9)] });
  assert.equal(h.input.snapshot().jump, false);
  assert.equal(h.input.snapshot().left, true);
  h.eventTarget.emit('touchend', { changedTouches: [touch(-3)] });
  assert.equal(h.input.snapshot().left, false);
  assert.equal(h.buttons.jump.listeners.has('pointerdown'), false, 'Never bind both input streams');
});

test('multi-finger zoom is cancelled across the game but menu taps and scroll panels remain usable', () => {
  const h = setup();
  assert.equal(h.game.emit('touchstart', { touches: [touch(1), touch(2)] }).defaultPrevented, true);
  assert.equal(h.game.emit('touchmove', { touches: [touch(1)] }).defaultPrevented, true);
  assert.equal(h.game.emit('gesturestart').defaultPrevented, true);
  assert.equal(h.game.emit('gesturechange').defaultPrevented, true);
  assert.equal(
    h.game.emit('touchstart', { touches: [touch(1)] }).defaultPrevented,
    false,
    'Single menu tap still becomes a click',
  );
  const panel = new Surface();
  panel.scrollable = true;
  assert.equal(h.game.emit('touchmove', { target: panel }).defaultPrevented, false);
  for (const type of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange']) {
    assert.equal(
      h.game.listeners.get(type)[0].options.passive,
      false,
      'Cancellation must not be ignored by mobile browsers',
    );
  }
  h.disable();
  assert.equal(h.game.emit('gesturestart').defaultPrevented, false);
  assert.equal(
    h.eventTarget.emit('gesturestart').defaultPrevented,
    false,
    'No zoom lock outside active gameplay',
  );
});

test('disabled controls do not consume fingers, and duplicate joystick fingers cannot take over', () => {
  const h = setup();
  h.buttons.action.disabled = true;
  h.buttons.action.emit('pointerdown', finger(3));
  assert.equal(h.input.snapshot().action, false);
  h.stick.emit('pointerdown', finger(1, 180));
  assert.equal(h.stick.emit('pointerdown', finger(2, 110)).defaultPrevented, true);
  h.eventTarget.emit('pointerup', finger(2));
  assert.equal(h.input.snapshot().right, true);
  h.adapter.reset();
  h.disable();
  h.buttons.jump.emit('pointerdown', finger(3));
  assert.equal(h.input.snapshot().jump, false);
});

test('paired Touch Events guard a two-finger gesture without acquiring or cancelling Pointer Event controls', () => {
  const h = setup();
  h.stick.emit('pointerdown', finger(1, 180));
  h.buttons.jump.emit('pointerdown', finger(2));
  const held = h.input.snapshot(),
    changes = h.changes();
  const hudGap = new Surface();
  const start = h.game.emit('touchstart', { target: hudGap, touches: [touch(1), touch(2)] });
  const move = h.game.emit('touchmove', {
    target: hudGap,
    changedTouches: [touch(1, 110), touch(2)],
    touches: [touch(1), touch(2)],
  });
  assert.equal(
    start.defaultPrevented,
    true,
    'A second finger over a non-control HUD gap is guarded',
  );
  assert.equal(move.defaultPrevented, true);
  assert.deepEqual(
    h.input.snapshot(),
    held,
    'Touch guards cannot mutate the independent Pointer Event model',
  );
  assert.equal(h.changes(), changes, 'There is no duplicate Touch Event gameplay adapter');
  h.eventTarget.emit('pointermove', finger(1, 110));
  assert.equal(h.input.snapshot().left, true);
  assert.equal(h.input.snapshot().jump, true);
  h.eventTarget.emit('pointerup', finger(2));
  assert.equal(h.input.snapshot().jump, false);
  assert.equal(h.input.snapshot().left, true);
});

test('a gesture originating outside the arena is guarded only during active gameplay', () => {
  const h = setup(),
    oldMenuTarget = new Surface();
  oldMenuTarget.scrollable = true;
  const pair = { target: oldMenuTarget, touches: [touch(1), touch(2)] };
  assert.equal(h.eventTarget.emit('touchstart', pair).defaultPrevented, true);
  assert.equal(h.eventTarget.emit('touchmove', pair).defaultPrevented, true);
  assert.equal(
    h.eventTarget.emit('gesturestart', { target: oldMenuTarget }).defaultPrevented,
    true,
  );
  assert.equal(
    h.eventTarget.emit('gesturechange', { target: oldMenuTarget }).defaultPrevented,
    true,
  );
  assert.equal(
    h.eventTarget.emit('touchstart', { touches: [touch(1)] }).defaultPrevented,
    false,
    'Single-finger button clicks remain native',
  );
  assert.equal(
    h.eventTarget.emit('touchmove', { touches: [touch(1)] }).defaultPrevented,
    false,
    'Only the arena handles one-finger movement',
  );
  h.disable();
  for (const type of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange']) {
    assert.equal(
      h.eventTarget.emit(type, pair).defaultPrevented,
      false,
      'Menus, lobby and home retain zoom and scroll',
    );
  }
});
