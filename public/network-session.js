const STORAGE_KEY = 'roboqueen-room-session';
const safeCounter = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

// sessionStorage is per tab. Credentials never enter invite URLs, room lists,
// logs or localStorage; a provisional welcome cannot overwrite a saved seat.
export class RoomSession {
  constructor(storage) {
    this.storage = storage;
    this.value = null;
    try {
      const value = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (
        value &&
        /^[A-F0-9]{6}$/.test(value.code) &&
        typeof value.token === 'string' &&
        value.token.length >= 32 &&
        value.token.length <= 256
      )
        this.value = value;
    } catch {}
  }

  resume(code) {
    if (!this.value?.token || this.value.code !== code) return null;
    return {
      type: 'resume',
      token: this.value.token,
      eventAck: safeCounter(this.value.eventAck),
      eventEpoch: code,
    };
  }

  joined(data, provisionalToken, currentSeq = 0) {
    const sameSession = data.resumed && this.value?.code === data.code;
    this.value = {
      code: data.code,
      id: data.id,
      token: data.resumeToken || provisionalToken,
      seq: Math.max(
        safeCounter(data.ack),
        sameSession ? safeCounter(currentSeq) : 0,
        sameSession ? safeCounter(this.value.seq) : 0,
      ),
      eventAck: Math.max(
        safeCounter(data.eventAck),
        sameSession ? safeCounter(this.value.eventAck) : 0,
      ),
    };
    this.persist();
    return this.value;
  }

  progress(seq, eventAck, persist = false) {
    if (!this.value) return;
    this.value.seq = Math.max(safeCounter(seq), safeCounter(this.value.seq));
    this.value.eventAck = Math.max(safeCounter(eventAck), safeCounter(this.value.eventAck));
    if (persist) this.persist();
  }

  persist() {
    try {
      if (this.value?.token) this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.value));
      else this.storage?.removeItem(STORAGE_KEY);
    } catch {}
  }

  clear() {
    this.value = null;
    this.persist();
  }
}

export class EventCursor {
  constructor() {
    this.reset('', 0);
  }

  reset(epoch, id = 0) {
    this.epoch = epoch;
    this.id = safeCounter(id);
  }

  filter(snapshot) {
    if (!snapshot.eventEpoch) return snapshot;
    const previous = snapshot.eventEpoch === this.epoch ? this.id : 0;
    const floor = Math.max(previous, safeCounter(snapshot.eventFloor) - 1);
    return {
      ...snapshot,
      events: (snapshot.events || []).filter((event) => safeCounter(event.id) > floor),
    };
  }

  commit(snapshot) {
    if (!snapshot.eventEpoch) return;
    if (snapshot.eventEpoch !== this.epoch) this.reset(snapshot.eventEpoch);
    this.id = Math.max(this.id, safeCounter(snapshot.eventFloor) - 1);
    for (const event of snapshot.events || []) this.id = Math.max(this.id, safeCounter(event.id));
  }

  fields() {
    return this.epoch ? { eventEpoch: this.epoch, eventAck: this.id } : {};
  }
}
