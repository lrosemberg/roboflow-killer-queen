// Optional browser capabilities must never be prerequisites for playing.
export function fullscreenElement(doc = document) {
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}

export async function toggleGameFullscreen(element, doc = document) {
  const active = fullscreenElement(doc);
  const method = active
    ? doc.exitFullscreen || doc.webkitExitFullscreen
    : element.requestFullscreen || element.webkitRequestFullscreen;
  if (typeof method !== 'function') return 'unsupported';
  try {
    await method.call(active ? doc : element);
    return active ? 'exited' : 'entered';
  } catch {
    return 'denied';
  }
}

export class ScreenAwake {
  constructor(wakeLock) {
    this.api = wakeLock;
    this.active = false;
    this.lock = null;
    this.pending = null;
  }
  setActive(active) {
    active = Boolean(active);
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      const lock = this.lock;
      this.lock = null;
      if (lock) Promise.resolve(lock.release()).catch(() => {});
    } else this.acquire();
  }
  async acquire() {
    if (!this.active || this.lock || this.pending || typeof this.api?.request !== 'function')
      return;
    // Hold the promise so snapshots cannot trigger simultaneous requests.
    this.pending = Promise.resolve().then(() => this.api.request('screen'));
    try {
      const lock = await this.pending;
      if (!this.active) {
        await lock.release();
        return;
      }
      this.lock = lock;
      lock.addEventListener(
        'release',
        () => {
          if (this.lock === lock) this.lock = null;
        },
        { once: true },
      );
    } catch {
      /* Unsupported policy, low battery or a denial: play normally. */
    } finally {
      this.pending = null;
    }
  }
}
