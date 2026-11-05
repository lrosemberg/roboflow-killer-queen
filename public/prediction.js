import { movePlayer } from '../shared/world.js';

const INPUT_KEYS = ['left', 'right', 'jump', 'action', 'dash', 'down'];
const HISTORY_MS = 2000;
const REPLAY_MS = 250;
const MAX_COMMANDS = 300;
const STEP_SECONDS = 1 / 60;

/**
 * Best-effort prediction for the existing state-input protocol.
 *
 * An ack identifies the latest input packet received, not a simulated frame.
 * We therefore replay only the time between unacknowledged input transitions;
 * this is not deterministic rollback or a measurement of network latency.
 * The shared movement function keeps collisions, jump edges and queen dives
 * consistent. Server snapshots always remain authoritative.
 */
export class InputPrediction {
  constructor() { this.reset(); }

  reset() {
    this.commands = [];
    this.lastSeq = 0;
    this.lastAck = 0;
    this.context = null;
    this.lastReplayMs = 0;
  }

  /** Record only packets actually sent. Input is copied before callers mutate it. */
  record({ seq, input, time }) {
    if (!Number.isSafeInteger(seq) || seq <= this.lastSeq || !Number.isFinite(time)) return;
    const previousTime = this.commands.at(-1)?.time ?? time;
    const reset = input?.reset === true;
    // Rotation, canceled touches and menus invalidate earlier unacknowledged
    // presses immediately, without waiting for the reset packet's server ack.
    if (reset) this.commands = [];
    const command = { seq, time: Math.max(time, previousTime), input: {} };
    for (const key of INPUT_KEYS) command.input[key] = !reset && input?.[key] === true;
    this.lastSeq = seq;
    this.commands.push(command);
    this.commands = this.commands.filter(item => item.time >= command.time - HISTORY_MS).slice(-MAX_COMMANDS);
  }

  /**
   * resetKey identifies the room/round. active is false outside live gameplay.
   * receivedAt uses the same monotonic clock as record(). serverTime is the
   * snapshot's clock, which movement uses for flap/cooldown timestamps.
   */
  reconcile(authoritative, { ack = authoritative.ack, map, receivedAt, serverTime, active = true, riding = false, resetKey = '' }) {
    const player = { ...authoritative };
    const upgrading = (player.upgradeUntil || 0) > serverTime;
    const nextContext = JSON.stringify([
      resetKey, player.id, player.role, Boolean(player.alive),
      Boolean(player.speedBoost), Boolean(riding), Boolean(active),
      player.invulnerableUntil || 0,
      player.upgradeUntil || 0, player.upgradeGateId ?? null, upgrading,
    ]);
    const validAck = Number.isSafeInteger(ack) && ack >= 0 ? ack : this.lastAck;
    const changed = this.context !== nextContext || validAck < this.lastAck;
    this.context = nextContext;
    this.lastAck = validAck;
    this.lastReplayMs = 0;
    if (changed || !active || riding || upgrading || !player.alive || !map || !Number.isFinite(receivedAt) || !Number.isFinite(serverTime)) {
      this.commands = [];
      return player;
    }

    this.commands = this.commands.filter(command => command.seq > validAck && command.time >= receivedAt - HISTORY_MS);
    const pending = this.commands.filter(command => command.time <= receivedAt);
    if (!pending.length) return player;

    // Never run a delayed connection seconds into the future. When trimming a
    // long interval, retain the input state at its start, not old key edges.
    const start = Math.max(pending[0].time, receivedAt - REPLAY_MS);
    if (start >= receivedAt) return player;
    let cursor = start;
    let input = pending[0].input;
    for (const command of pending) {
      if (command.time > start) break;
      input = command.input;
    }
    if (start > pending[0].time) {
      // A press before the bounded replay window is a held key, not a new
      // jump/dash edge. Later release/press transitions still replay normally.
      player.jumpHeld = input.jump;
      player.dashHeld = input.dash;
    }
    let simulatedMs = 0;
    const advance = end => {
      let remaining = (end - cursor) / 1000;
      while (remaining > 1e-8) {
        const dt = Math.min(STEP_SECONDS, remaining);
        movePlayer(player, input, map, dt, serverTime + simulatedMs);
        simulatedMs += dt * 1000;
        remaining -= dt;
      }
      cursor = end;
    };
    for (const command of pending) {
      if (command.time > cursor) advance(command.time);
      input = command.input;
    }
    advance(receivedAt);
    this.lastReplayMs = simulatedMs;
    return player;
  }
}
