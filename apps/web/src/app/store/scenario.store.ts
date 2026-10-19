import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SCENARIOS, findScenario, reportLines, type ScenarioDef } from '../core/scenarios';
import { FloorStore } from './floor.store';

export type CheckpointStatus = 'pending' | 'pass' | 'fail';

/** The run being tracked: which scenario, and the floor version and tick right after its setup. */
export interface ActiveRun {
  readonly def: ScenarioDef;
  readonly baseVersion: number;
  readonly baseTick: number;
}

export interface CheckpointView {
  readonly index: number;
  readonly afterTicks: number;
  readonly expected: readonly string[];
  readonly status: CheckpointStatus;
  /** The lines the server produced at that tick; null while pending. */
  readonly actual: readonly string[] | null;
}

export interface RunView {
  readonly active: ActiveRun;
  readonly checkpoints: readonly CheckpointView[];
  readonly passed: number;
  /** Every checkpoint has been reached (pass or fail). */
  readonly complete: boolean;
  /** Something other than a tick changed the floor after the load, so results may not match. */
  readonly modified: boolean;
}

/**
 * Scenario picker state. A run is local to this tab: the setup goes to the shared floor like any
 * other command, and the checkpoints are read back from the server's TICK_RESOLVED history, so the
 * result is the server's own, whoever pressed Play. No floor snapshot is kept.
 */
@Injectable({ providedIn: 'root' })
export class ScenarioStore {
  private readonly floorStore = inject(FloorStore);

  readonly scenarios = SCENARIOS;
  /** The picker's current choice (not necessarily the loaded one). */
  readonly selectedId = signal(SCENARIOS[0]?.id ?? '');
  readonly loading = signal(false);
  readonly active = signal<ActiveRun | null>(null);

  /**
   * Checkpoint results for the active run, or null when there is none. A floor created after the
   * load (someone else's New floor) ends the run: its ticks no longer belong to this scenario.
   */
  readonly run = computed<RunView | null>(() => {
    const active = this.active();
    if (!active) {
      return null;
    }
    const ticks = new Map<number, readonly string[]>();
    let modified = false;
    for (const entry of this.floorStore.history()) {
      if (entry.version <= active.baseVersion) {
        continue;
      }
      const ev = entry.event;
      if (ev.type === 'FLOOR_CREATED') {
        return null;
      }
      if (ev.type === 'TICK_RESOLVED') {
        ticks.set(ev.tick, reportLines(ev.results));
      } else {
        modified = true;
      }
    }
    const checkpoints = active.def.checkpoints.map((c, index): CheckpointView => {
      const actual = ticks.get(active.baseTick + c.afterTicks) ?? null;
      const pass = actual !== null && sameLines(actual, c.expected);
      const status: CheckpointStatus = actual === null ? 'pending' : pass ? 'pass' : 'fail';
      return { index, afterTicks: c.afterTicks, expected: c.expected, status, actual };
    });
    return {
      active,
      checkpoints,
      passed: checkpoints.filter((c) => c.status === 'pass').length,
      complete: checkpoints.every((c) => c.status !== 'pending'),
      modified,
    };
  });

  /** The run that was already auto-paused, so Play pressed afterwards is left alone. */
  private autoPaused: ActiveRun | null = null;

  constructor() {
    // Auto-pause once after the last checkpoint resolves. If the server ticks once more before the
    // pause lands that is harmless: results are matched by tick number.
    effect(() => {
      const run = this.run();
      if (!run || !run.complete || !this.floorStore.playing()) {
        return;
      }
      untracked(() => {
        if (this.autoPaused !== run.active) {
          this.autoPaused = run.active;
          void this.floorStore.pause();
        }
      });
    });
  }

  select(id: string): void {
    this.selectedId.set(id);
  }

  /** Reset the shared floor to the selected scenario's setup and start tracking from there. */
  async load(): Promise<void> {
    const def = findScenario(this.selectedId());
    if (!def || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.active.set(null);
    try {
      const loaded = await this.floorStore.loadScenario(def.setup);
      if (loaded.ok) {
        this.active.set({ def, baseVersion: loaded.version, baseTick: loaded.tick });
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Load the scenario that is currently running again (same as Load with it selected). */
  async reload(): Promise<void> {
    const active = this.active();
    if (active) {
      this.selectedId.set(active.def.id);
    }
    await this.load();
  }
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
