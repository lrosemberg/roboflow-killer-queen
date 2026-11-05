const TYPES = new Set(['ko', 'pickup', 'deposit', 'upgrade', 'ride', 'gate']);
const RESOURCE_TYPES = new Set(['pickup', 'deposit']);

// Keep identities with each event: an XXL opponent may be outside the camera's
// streamed roster, or may have left the room before the next snapshot arrives.
const identity = (person) =>
  person && { id: person.id, name: person.name, team: person.team, bot: Boolean(person.bot) };

export class ActivityFeed {
  constructor({ limit = 5, ttl = 6500, mergeWindow = 2000 } = {}) {
    this.limit = limit;
    this.ttl = ttl;
    this.mergeWindow = mergeWindow;
    this.reset();
  }

  reset() {
    this.entries = [];
    this.seen = new Set();
    this.order = 0;
    this.lastAmbientAt = -Infinity;
  }

  consume(events = [], { localId, localPlayer, mode = 'normal', now = 0 } = {}) {
    this.entries = this.entries.filter((entry) => now - entry.updatedAt < this.ttl);
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value);
      if (event.type === 'start') {
        this.entries = [];
        this.lastAmbientAt = -Infinity;
        continue;
      }
      if (!TYPES.has(event.type) || !event.actor?.id || !event.actor?.name) continue;

      const local = event.actor.id === localId || event.target?.id === localId;
      const resource = RESOURCE_TYPES.has(event.type);
      const near =
        localPlayer && Math.hypot(event.x - localPlayer.x, event.y - localPlayer.y) <= 900;
      const priority = local
        ? 10
        : event.type === 'ko'
          ? 8
          : !event.actor.bot
            ? 6
            : event.type === 'deposit'
              ? 4
              : resource
                ? 2
                : 5;
      const amount = resource ? Math.max(1, Math.floor(Number(event.amount) || 1)) : 1;
      const match =
        resource &&
        this.entries.find(
          (entry) =>
            entry.type === event.type &&
            entry.actor.id === event.actor.id &&
            now - entry.updatedAt <= this.mergeWindow,
        );
      if (match) {
        match.count += amount;
        match.updatedAt = now;
        match.order = ++this.order;
        match.actor = identity(event.actor);
        continue;
      }

      // A 120-player room can produce many pickups in one frame. Keep ambient
      // CPU resource chatter at two new cards/second; local actions and combat
      // bypass this limit. Existing same-player cards can still accumulate.
      const ambient = mode === 'xxl' && resource && event.actor.bot && !local;
      if (ambient && now - this.lastAmbientAt < 500) continue;
      const entry = {
        id: event.id,
        type: event.type,
        actor: identity(event.actor),
        target: identity(event.target),
        count: amount,
        text: event.text,
        team: event.team,
        upgradeKind: event.upgradeKind,
        updatedAt: now,
        order: ++this.order,
        priority: priority + (near ? 0.5 : 0),
      };
      if (this.entries.length >= this.limit) {
        const lowest = [...this.entries].sort(
          (a, b) => a.priority - b.priority || a.updatedAt - b.updatedAt || a.order - b.order,
        )[0];
        if (lowest.priority > entry.priority) continue;
        this.entries = this.entries.filter((candidate) => candidate !== lowest);
      }
      this.entries.push(entry);
      if (ambient) this.lastAmbientAt = now;
    }
    this.entries.sort((a, b) => a.updatedAt - b.updatedAt || a.order - b.order);
    return this.entries;
  }
}
