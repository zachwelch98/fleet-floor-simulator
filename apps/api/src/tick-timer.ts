/**
 * Timer contract for the TickScheduler (DECISIONS 7.1: the server is the only clock).
 * Contract between Dev 2 (TickScheduler uses it) and the Tester (injects ManualTickTimer).
 * Changes go through the PM.
 */

/** Opaque handle returned by `setInterval`. */
export type TickTimerHandle = unknown;

export interface TickTimer {
  setInterval(callback: () => void, intervalMs: number): TickTimerHandle;
  clearInterval(handle: TickTimerHandle): void;
}

/** Production timer: Node's global setInterval/clearInterval. */
export const realTickTimer: TickTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Deterministic timer for tests: nothing fires on its own. `fire()` runs every active interval
 * callback once (one tick per playing floor); `active` lists the live intervals so a test can
 * assert "exactly one loop per floor" and the interval it was started with.
 */
export class ManualTickTimer implements TickTimer {
  private nextId = 1;
  private readonly intervals = new Map<number, { callback: () => void; intervalMs: number }>();

  setInterval(callback: () => void, intervalMs: number): TickTimerHandle {
    const id = this.nextId++;
    this.intervals.set(id, { callback, intervalMs });
    return id;
  }

  clearInterval(handle: TickTimerHandle): void {
    this.intervals.delete(handle as number);
  }

  /** Live intervals, oldest first. */
  get active(): readonly { readonly intervalMs: number }[] {
    return [...this.intervals.values()].map(({ intervalMs }) => ({ intervalMs }));
  }

  /** Runs each live interval's callback once, oldest first. Repeat `times` times. */
  fire(times = 1): void {
    for (let i = 0; i < times; i++) {
      for (const { callback } of [...this.intervals.values()]) callback();
    }
  }
}
