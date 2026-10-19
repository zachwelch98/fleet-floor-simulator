import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { formatReport } from '@fleet/engine';
import type { Action } from '@fleet/engine';
import type { CommandSuccess, SharedScenarioRun } from '@fleet/protocol';
import { MAX_LIVE_TICKS, SCENARIOS, buildScenario, type ScenarioDef } from '../core/scenarios';
import { FloorStore } from './floor.store';
import { UploadsStore } from './uploads.store';

/** `na`: not checked live (the run was refused for being too long). */
export type CheckpointStatus = 'pending' | 'pass' | 'fail' | 'na';

/** The run being tracked. `refused`: too many ticks to run live, so nothing was sent to the floor. */
export interface ActiveRun {
  readonly def: ScenarioDef;
  readonly refused: boolean;
}

/** Why a run stopped driving the floor. */
export type HaltReason = 'modified' | 'failed';

export interface CheckpointView {
  readonly index: number;
  readonly afterTicks: number;
  readonly expected: readonly string[];
  /** What `npm run scenario` prints for this REPORT. */
  readonly runner: readonly string[];
  /** The lines the live floor produced at that point; null until captured. */
  readonly live: readonly string[] | null;
  readonly status: CheckpointStatus;
  /** An `.expected` file was attached and the runner's lines differ from it. */
  readonly runnerDiffers: boolean;
}

export interface RunView {
  readonly active: ActiveRun;
  readonly checkpoints: readonly CheckpointView[];
  readonly passed: number;
  /** Every checkpoint has been checked (pass or fail). */
  readonly complete: boolean;
  /** Something else changed the floor after the load, or server Play started; the run stopped. */
  readonly modified: boolean;
  /** The server refused a command or the connection dropped; the run stopped. */
  readonly failed: boolean;
  /** Too many ticks to run live. */
  readonly refused: boolean;
  /** The whole script has been played. */
  readonly finished: boolean;
  /** Driven from another tab; this one only shows it (DECISIONS 5.10). */
  readonly remote: boolean;
}

/**
 * Scenario picker and script player (DECISIONS 5.7, 5.8). Load sends the script's setup to the shared
 * floor like any other command. Play and Step then walk the rest of the script from this tab: one
 * server Step per tick, later commands sent exactly between ticks, and each REPORT read from the
 * floor this tab holds right after the previous step's answer. The server's own Play is never used
 * during an unfinished run, so the pace and the order of commands are exact. A run is local to its
 * tab; if the floor changes under it (a version gap, or Play started elsewhere) it stops and is
 * marked modified. The driving tab shares the run's state, and every other tab shows the same
 * checkpoints from it (DECISIONS 5.10).
 */
@Injectable({ providedIn: 'root' })
export class ScenarioStore {
  private readonly floorStore = inject(FloorStore);
  private readonly uploadsStore = inject(UploadsStore);

  /** Bundled scenarios, then the uploaded ones. */
  readonly scenarios = computed<readonly ScenarioDef[]>(() => [
    ...SCENARIOS,
    ...this.uploadsStore.uploads(),
  ]);
  /** The picker's current choice (not necessarily the loaded one). */
  readonly selectedId = signal(SCENARIOS[0]?.id ?? '');
  readonly selected = computed(() => this.scenarios().find((s) => s.id === this.selectedId()));
  readonly loading = signal(false);
  readonly active = signal<ActiveRun | null>(null);
  /** The script player is running (Play pressed, between Pause and the end). */
  readonly stepping = signal(false);
  readonly uploadError = this.uploadsStore.error;

  // --- player state ---------------------------------------------------------
  private readonly cursor = signal(0);
  private readonly liveReports = signal<readonly (readonly string[] | null)[]>([]);
  private readonly halted = signal<HaltReason | null>(null);
  /** A script step is being sent: floor changes are our own. */
  private readonly busy = signal(false);
  /** Floor version after the last step we sent; the next answer must be this + 1. */
  private lastVersion = 0;
  private playToken = 0;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;
  private jobs: Promise<unknown> = Promise.resolve();

  /** Another tab's run, rebuilt from the script it shared (retraced only when the script changes). */
  private remoteDefCache: { readonly key: string; readonly def: ScenarioDef | null } | null = null;
  private readonly remoteDef = computed<ScenarioDef | null>(() => {
    const shared = this.floorStore.remoteScenario();
    return shared ? this.defOf(shared) : null;
  });

  /** Checkpoint results for the active run (this tab's, else another tab's), or null when there is none. */
  readonly run = computed<RunView | null>(() => {
    const active = this.active();
    if (active) {
      return toRunView(active, this.liveReports(), this.halted(), this.cursor(), false);
    }
    const shared = this.floorStore.remoteScenario();
    const def = this.remoteDef();
    if (!shared || !def) {
      return null;
    }
    return toRunView(
      { def, refused: shared.refused },
      shared.live,
      shared.halted,
      shared.cursor,
      true,
    );
  });

  /** While true, Play, Pause and Step drive the script; otherwise they are the server's. */
  private readonly driving = computed(() => {
    const active = this.active();
    return (
      active !== null &&
      !active.refused &&
      this.halted() === null &&
      this.cursor() < active.def.trace.steps.length
    );
  });

  constructor() {
    // Share this tab's run with the other tabs on the floor; null when it ends (DECISIONS 5.10).
    effect(() => {
      const active = this.active();
      const shared: SharedScenarioRun | null = active
        ? {
            id: active.def.id,
            title: active.def.title,
            group: active.def.group,
            fileName: active.def.fileName,
            text: active.def.text,
            ...(active.def.expectedText === undefined
              ? {}
              : { expectedText: active.def.expectedText }),
            refused: active.refused,
            live: this.liveReports(),
            halted: this.halted(),
            cursor: this.cursor(),
          }
        : null;
      untracked(() => this.floorStore.publishScenario(shared));
    });

    // Watch for the floor changing under the run (another tab, or an edit here): stop and flag it.
    // A floor created after the load ends the run altogether (its ticks no longer belong to it).
    effect(() => {
      const active = this.active();
      const floor = this.floorStore.floor();
      const history = this.floorStore.history();
      const busy = this.busy();
      const loading = this.loading();
      if (!active || active.refused || busy || loading) {
        return;
      }
      untracked(() => {
        const baseline = this.lastVersion;
        for (let i = history.length - 1; i >= 0; i--) {
          const entry = history[i];
          if (!entry || entry.version <= baseline) {
            break;
          }
          if (entry.event.type === 'FLOOR_CREATED') {
            this.endRun();
            return;
          }
        }
        if (this.halted() === null && this.cursor() < active.def.trace.steps.length) {
          if ((floor?.version ?? 0) > baseline || floor?.playing) {
            this.halt('modified');
          }
        }
      });
    });
  }

  select(id: string): void {
    this.selectedId.set(id);
  }

  /**
   * Reset the shared floor to the selected scenario's setup and play the script up to its first
   * tick (REPORTs before it are captured now). A script over MAX_LIVE_TICKS is refused: the floor
   * is left alone and only the runner's output is shown.
   */
  async load(def: ScenarioDef | undefined = this.selected()): Promise<void> {
    if (!def || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.stopPlayer();
    this.active.set(null);
    this.halted.set(null);
    try {
      if (def.totalTicks > MAX_LIVE_TICKS) {
        this.cursor.set(0);
        this.liveReports.set([]);
        this.active.set({ def, refused: true });
        return;
      }
      const steps = def.trace.steps;
      let prefix = 0;
      const setup: Action[] = [];
      while (prefix < steps.length) {
        const s = steps[prefix];
        if (s?.kind !== 'action') {
          break;
        }
        setup.push(s.action);
        prefix++;
      }
      const loaded = await this.floorStore.loadScenario(setup);
      if (!loaded.ok) {
        return;
      }
      this.lastVersion = loaded.version;
      this.cursor.set(prefix);
      this.liveReports.set(def.checkpoints.map(() => null));
      this.active.set({ def, refused: false });
      await this.enqueue(() => this.advance('toTick'));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Load the scenario that is currently running again (same as Load with it selected). A run shared
   * by another tab is reloaded from its script, so this works for an upload this browser never had.
   */
  async reload(): Promise<void> {
    const def = this.run()?.active.def;
    if (def && this.scenarios().some((s) => s.id === def.id)) {
      this.selectedId.set(def.id);
    }
    await this.load(def ?? this.selected());
  }

  // =========================================================================
  // Play / Pause / Step (the Controls outputs go through here)
  // =========================================================================

  /** Play the script from this tab, or the server's Play when no run is in progress. */
  async play(): Promise<void> {
    if (!this.driving()) {
      await this.floorStore.play();
      return;
    }
    if (this.stepping()) {
      return;
    }
    const token = ++this.playToken;
    this.stepping.set(true);
    try {
      while (token === this.playToken && this.driving()) {
        const ok = await this.enqueue(() => this.advance('throughTick'));
        if (!ok || token !== this.playToken || !this.driving()) {
          break;
        }
        await this.sleep(this.floorStore.intervalMs());
      }
    } finally {
      if (token === this.playToken) {
        this.stepping.set(false);
      }
    }
  }

  /** Stop the script player between steps, or the server's Pause when it is not running. */
  async pause(): Promise<void> {
    if (this.stepping()) {
      this.stopPlayer();
      return;
    }
    await this.floorStore.pause();
  }

  /** Advance the script through its next tick, or the server's Step when no run is in progress. */
  async step(): Promise<void> {
    if (!this.driving()) {
      await this.floorStore.step();
      return;
    }
    if (this.busy() || this.stepping()) {
      return;
    }
    await this.enqueue(() => this.advance('throughTick'));
  }

  // =========================================================================
  // Uploads
  // =========================================================================

  /** Read a scenario file the user picked and add it; it becomes the picker's choice. */
  async importFile(file: File): Promise<void> {
    const text = await this.readText(file);
    if (text === null) {
      this.uploadsStore.error.set(`Could not read ${file.name}.`);
      return;
    }
    const def = this.uploadsStore.add(file.name, text);
    if (def) {
      this.selectedId.set(def.id);
    }
  }

  /** Attach a `.expected` file to the selected upload. */
  async attachExpectedFile(file: File): Promise<void> {
    const id = this.selectedId();
    const text = await this.readText(file);
    if (text === null) {
      this.uploadsStore.error.set(`Could not read ${file.name}.`);
      return;
    }
    const def = this.uploadsStore.attachExpected(id, text);
    const active = this.active();
    if (def && active?.def.id === id) {
      this.active.set({ ...active, def });
    }
  }

  /** Delete the selected upload (and end its run, if it is the loaded one). */
  removeSelected(): void {
    const id = this.selectedId();
    if (this.selected()?.group !== 'uploaded') {
      return;
    }
    if (this.active()?.def.id === id) {
      this.endRun();
    }
    this.uploadsStore.remove(id);
    this.selectedId.set(SCENARIOS[0]?.id ?? '');
  }

  clearUploadError(): void {
    this.uploadsStore.clearError();
  }

  private async readText(file: File): Promise<string | null> {
    try {
      return await file.text();
    } catch {
      return null;
    }
  }

  // =========================================================================
  // Script player internals
  // =========================================================================

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.jobs.then(job);
    this.jobs = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Walk the script from the cursor. Actions are sent, REPORTs are read from the floor held right
   * after the previous answer. `toTick` stops in front of the next tick (used by Load);
   * `throughTick` sends the actions up to the next tick, the tick itself, and reads the REPORTs that
   * follow it. Actions after that tick wait for the next call, unless no tick remains: then the
   * rest of the script is flushed so the run can finish. Resolves false when the run stopped.
   */
  private async advance(mode: 'toTick' | 'throughTick'): Promise<boolean> {
    const active = this.active();
    if (!active || active.refused || this.halted() !== null) {
      return false;
    }
    const steps = active.def.trace.steps;
    const lastTick = steps.map((s) => s.kind).lastIndexOf('tick');
    this.busy.set(true);
    try {
      let ticked = false;
      while (this.cursor() < steps.length) {
        const step = steps[this.cursor()];
        if (!step) {
          break;
        }
        if (step.kind === 'tick') {
          if (mode === 'toTick' || ticked) {
            break;
          }
          if (!(await this.send(() => this.floorStore.stepOnce()))) {
            return false;
          }
          ticked = true;
        } else if (step.kind === 'action') {
          if (ticked && this.cursor() <= lastTick) {
            break;
          }
          if (!(await this.send(() => this.floorStore.sendActionOnce(step.action)))) {
            return false;
          }
        } else if (!this.capture(step.index)) {
          return false;
        }
        this.cursor.update((c) => c + 1);
      }
      return true;
    } finally {
      this.busy.set(false);
    }
  }

  /** Send one step and check the floor moved by exactly that step. */
  private async send(call: () => Promise<CommandSuccess | null>): Promise<boolean> {
    const body = await call();
    if (!body) {
      this.halt('failed');
      return false;
    }
    if (body.floor.version !== this.lastVersion + 1) {
      this.halt('modified');
      return false;
    }
    this.lastVersion = body.floor.version;
    return true;
  }

  /** Read a REPORT from the floor this tab holds. False if something else has changed it. */
  private capture(index: number): boolean {
    const floor = this.floorStore.floor();
    if (!floor || floor.version !== this.lastVersion || floor.playing) {
      this.halt('modified');
      return false;
    }
    const lines = formatReport(floor.state.robots);
    this.liveReports.update((all) => all.map((l, i) => (i === index ? lines : l)));
    return true;
  }

  private halt(reason: HaltReason): void {
    this.halted.set(reason);
    this.stopPlayer();
  }

  /** Stop the Play loop at the next step boundary and wake it if it is waiting. */
  private stopPlayer(): void {
    this.playToken++;
    this.stepping.set(false);
    if (this.sleepTimer !== null) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private endRun(): void {
    this.stopPlayer();
    this.active.set(null);
    this.halted.set(null);
  }

  /** The scenario another tab shared: the bundled one when the script matches, else rebuilt from it. */
  private defOf(shared: SharedScenarioRun): ScenarioDef | null {
    const key = JSON.stringify([
      shared.id,
      shared.title,
      shared.fileName,
      shared.text,
      shared.expectedText,
    ]);
    if (this.remoteDefCache?.key !== key) {
      const known = this.scenarios().find(
        (s) =>
          s.id === shared.id && s.text === shared.text && s.expectedText === shared.expectedText,
      );
      let def: ScenarioDef | null = known ?? null;
      if (!def) {
        try {
          def = buildScenario(
            shared.id,
            shared.title,
            shared.group,
            shared.text,
            shared.expectedText,
            shared.fileName,
          );
        } catch {
          def = null;
        }
      }
      this.remoteDefCache = { key, def };
    }
    return this.remoteDefCache.def;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        this.wake = null;
        resolve();
      }, ms);
    });
  }
}

function toRunView(
  active: ActiveRun,
  live: readonly (readonly string[] | null)[],
  halted: HaltReason | null,
  cursor: number,
  remote: boolean,
): RunView {
  const checkpoints = active.def.checkpoints.map((c): CheckpointView => {
    const lines = live[c.index] ?? null;
    const status: CheckpointStatus = active.refused
      ? 'na'
      : lines === null
        ? 'pending'
        : sameLines(lines, c.expected)
          ? 'pass'
          : 'fail';
    return {
      index: c.index,
      afterTicks: c.afterTicks,
      expected: c.expected,
      runner: c.runner,
      live: lines,
      status,
      runnerDiffers: active.def.expectedText !== undefined && !sameLines(c.runner, c.expected),
    };
  });
  return {
    active,
    checkpoints,
    passed: checkpoints.filter((c) => c.status === 'pass').length,
    complete: !active.refused && checkpoints.every((c) => c.status !== 'pending'),
    modified: halted === 'modified',
    failed: halted === 'failed',
    refused: active.refused,
    finished: active.refused || cursor >= active.def.trace.steps.length,
    remote,
  };
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
