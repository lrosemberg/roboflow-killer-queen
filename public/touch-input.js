const BUTTON_ACTIONS = new Set(['jump', 'action', 'down']);
// PointerEvent.pointerId is a signed long; do not assume browser IDs are positive.
const validPointer = (id) => Number.isSafeInteger(id);

// Each finger owns one source until pointerup, pointercancel or lost capture.
// The DOM adapter handles pointer capture; this model only produces the same
// booleans as a keyboard, without altering movement speed or physics.
export class TouchInput {
  #stick = null;
  #buttons = new Map();
  #deadzone;

  constructor({ deadzone = 0.22 } = {}) {
    this.#deadzone = Number.isFinite(deadzone) && deadzone >= 0 && deadzone < 1 ? deadzone : 0.22;
  }

  pressStick(pointerId, x, y, centerX, centerY, radius) {
    if (
      !validPointer(pointerId) ||
      this.#stick ||
      this.#buttons.has(pointerId) ||
      ![x, y, centerX, centerY, radius].every(Number.isFinite) ||
      radius <= 0
    )
      return false;
    this.#stick = { pointerId, centerX, centerY, radius, x: 0, y: 0 };
    this.move(pointerId, x, y);
    return true;
  }

  move(pointerId, x, y) {
    const stick = this.#stick;
    if (!stick || stick.pointerId !== pointerId || !Number.isFinite(x) || !Number.isFinite(y))
      return false;
    const dx = (x - stick.centerX) / stick.radius;
    const dy = (y - stick.centerY) / stick.radius;
    const length = Math.max(1, Math.hypot(dx, dy));
    stick.x = dx / length;
    stick.y = dy / length;
    return true;
  }

  rebaseStick(centerX, centerY, radius) {
    if (!this.#stick || ![centerX, centerY, radius].every(Number.isFinite) || radius <= 0)
      return false;
    Object.assign(this.#stick, { centerX, centerY, radius });
    return true;
  }

  pressButton(pointerId, action) {
    if (
      !validPointer(pointerId) ||
      !BUTTON_ACTIONS.has(action) ||
      this.#buttons.has(pointerId) ||
      this.#stick?.pointerId === pointerId
    )
      return false;
    this.#buttons.set(pointerId, action);
    return true;
  }

  release(pointerId) {
    if (this.#stick?.pointerId === pointerId) {
      this.#stick = null;
      return true;
    }
    return this.#buttons.delete(pointerId);
  }

  reset() {
    this.#stick = null;
    this.#buttons.clear();
  }

  get stick() {
    const stick = this.#stick;
    return stick
      ? { active: true, pointerId: stick.pointerId, x: stick.x, y: stick.y }
      : { active: false, pointerId: null, x: 0, y: 0 };
  }

  snapshot() {
    const stick = this.#stick;
    const input = {
      left: Boolean(stick && stick.x < -this.#deadzone),
      right: Boolean(stick && stick.x > this.#deadzone),
      jump: false,
      action: false,
      // A small downward thumb drift while moving must not drop through the
      // platform just before a jump. Require a deliberate mostly-down pull.
      down: Boolean(stick && stick.y > 0.55 && stick.y > Math.abs(stick.x) * 1.1),
      dash: false,
    };
    for (const action of this.#buttons.values()) input[action] = true;
    return input;
  }
}
