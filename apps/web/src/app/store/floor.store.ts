import { Injectable, computed, inject, signal } from '@angular/core';
import type { Action, RobotId, RobotTickResult } from '@fleet/engine';
import {
  DEFAULT_FLOOR_ID,
  DEFAULT_TICK_INTERVAL_MS,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  type CommandRejected,
  type CommandSuccess,
  type FloorDto,
  type FloorUpdatedPayload,
  type HistoryEntry,
  type PlaybackPayload,
} from '@fleet/protocol';
import {
  CLIENT_MESSAGES,
  STALE_DETAIL,
  announceTick,
  eventLine,
  floorResetMessage,
  rejectionMessage,
  robotRemovedRemoteMessage,
  type ClientReason,
} from '../core/copy';
import { deriveLastResults, lastSeq, mergeHistory } from '../core/history';
import {
  ApiError,
  FLOOR_API,
  FLOOR_SOCKET,
  type CommandOutcome,
  type FloorApi,
  type FloorSocket,
} from '../core/transport';
import { ToastService } from './toast.service';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';
export type LoadState = 'loading' | 'ready' | 'error';

/** Debounce for re-sending /play while the slider moves during Play (UI_SPEC 3.2). */
export const INTERVAL_DEBOUNCE_MS = 300;

interface IngestOptions {
  /** What to do when the floor version jumps by more than 1. */
  readonly gap: 'resync' | 'apply';
  /** The history entries answer this client's own request (no "remote change" toasts). */
  readonly own?: boolean;
  /** Adopt playing/intervalMs from the DTO. */
  readonly playback?: boolean;
  /** Toasts and live-region text for new entries. */
  readonly notify?: boolean;
}

interface IngestResult {
  /** The floor signal was replaced. */
  readonly applied: boolean;
  readonly gap: boolean;
}

export interface CellActivation {
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
}

/**
 * Single source of truth for the UI (UI_SPEC section 2): server state arrives from REST and the
 * socket, UI preferences live here as signals. No optimistic updates: nothing changes until the
 * server answers or a broadcast arrives.
 */
@Injectable({ providedIn: 'root' })
export class FloorStore {
  private readonly api: FloorApi = inject(FLOOR_API);
  private readonly socket: FloorSocket = inject(FLOOR_SOCKET);
  private readonly toastService = inject(ToastService);

  // --- server state ---------------------------------------------------------
  readonly floor = signal<FloorDto | null>(null);
  readonly history = signal<readonly HistoryEntry[]>([]);
  readonly connection = signal<ConnectionState>('reconnecting');
  readonly loadState = signal<LoadState>('loading');

  // --- UI state -------------------------------------------------------------
  readonly selectedId = signal<RobotId | null>(null);
  readonly editMode = signal(false);
  private readonly gotoRaw = signal(false);
  readonly showIdle = signal(false);
  readonly intervalMs = signal(DEFAULT_TICK_INTERVAL_MS);
  /** Text for the visually hidden live region. */
  readonly announcement = signal('');

  // --- derived --------------------------------------------------------------
  readonly state = computed(() => this.floor()?.state ?? null);
  readonly playing = computed(() => this.floor()?.playing ?? false);
  readonly connected = computed(() => this.connection() === 'connected');
  readonly selectedRobot = computed(() => {
    const id = this.selectedId();
    return id ? (this.state()?.robots.find((r) => r.id === id) ?? null) : null;
  });
  /** GOTO can only be armed while a robot is selected and edit mode is off. */
  readonly gotoArmed = computed(
    () => this.gotoRaw() && this.selectedId() !== null && !this.editMode(),
  );
  readonly lastResults = computed<Map<RobotId, RobotTickResult>>(() => {
    const state = this.state();
    return state ? deriveLastResults(this.history(), state) : new Map();
  });

  // --- internals ------------------------------------------------------------
  private chain: Promise<unknown> = Promise.resolve();
  private inflight: Action | null = null;
  /** Own PLACE_ROBOT requests queued or in flight (UI_SPEC 5.2: command keys are dropped meanwhile). */
  private placing = 0;
  private socketStarted = false;
  private resyncing = false;
  private resyncAgain = false;
  private intervalTimer: ReturnType<typeof setTimeout> | null = null;

  // =========================================================================
  // Loading, socket, catch-up
  // =========================================================================

  async init(): Promise<void> {
    this.loadState.set('loading');
    try {
      const floor = await this.api.getFloor();
      const history = await this.api.getHistory({ limit: HISTORY_DEFAULT_LIMIT });
      this.ingest(floor, history, { gap: 'apply', playback: true });
      this.loadState.set('ready');
    } catch {
      this.loadState.set('error');
      return;
    }
    this.startSocket();
  }

  private startSocket(): void {
    if (this.socketStarted) {
      return;
    }
    this.socketStarted = true;
    this.socket.connect({
      onConnect: () => void this.onSocketConnect(),
      onDisconnect: (permanent) => this.connection.set(permanent ? 'disconnected' : 'reconnecting'),
      onGiveUp: () => this.connection.set('disconnected'),
      onUpdated: (payload: FloorUpdatedPayload) => this.onUpdated(payload),
      onPlayback: (payload: PlaybackPayload) => this.onPlayback(payload),
    });
  }

  private async onSocketConnect(): Promise<void> {
    try {
      await this.socket.join(DEFAULT_FLOOR_ID);
    } catch {
      // A missing ack is covered by the catch-up below; broadcasts simply may not flow yet.
    }
    const ok = await this.resync();
    this.connection.set(ok ? 'connected' : 'disconnected');
  }

  /** Manual Reconnect button. */
  reconnect(): void {
    this.connection.set('reconnecting');
    this.socket.reconnect();
  }

  /** Refetch the floor, then the history after the last seq we hold (floor first, so history is never behind it). */
  async resync(): Promise<boolean> {
    if (this.resyncing) {
      this.resyncAgain = true;
      return true;
    }
    this.resyncing = true;
    try {
      do {
        this.resyncAgain = false;
        const floor = await this.api.getFloor();
        const history = await this.fetchHistorySince();
        const silent = this.history().length === 0;
        this.ingest(floor, history, { gap: 'apply', playback: true, notify: !silent });
      } while (this.resyncAgain);
      return true;
    } catch {
      return false;
    } finally {
      this.resyncing = false;
    }
  }

  private async fetchHistorySince(): Promise<HistoryEntry[]> {
    const held = lastSeq(this.history());
    if (held === 0) {
      return this.api.getHistory({ limit: HISTORY_DEFAULT_LIMIT });
    }
    return this.fetchAfter(held);
  }

  private async fetchAfter(after: number): Promise<HistoryEntry[]> {
    const out: HistoryEntry[] = [];
    let cursor = after;
    for (;;) {
      const page = await this.api.getHistory({ after: cursor, limit: HISTORY_MAX_LIMIT });
      out.push(...page);
      const last = page[page.length - 1];
      if (page.length < HISTORY_MAX_LIMIT || !last) {
        return out;
      }
      cursor = last.seq;
    }
  }

  /** History-only catch-up after an HTTP answer that skipped versions or carried no history. */
  private async backfill(after: number): Promise<void> {
    try {
      const entries = await this.fetchAfter(after);
      this.mergeAndNotify(entries, { gap: 'apply', notify: true });
    } catch {
      // The next broadcast or reconnect will catch up.
    }
  }

  private onUpdated(payload: FloorUpdatedPayload): void {
    this.ingest(payload.floor, payload.history, { gap: 'resync', playback: true, notify: true });
  }

  private onPlayback(payload: PlaybackPayload): void {
    this.applyPlayback(payload.playing, payload.intervalMs, true);
  }

  // =========================================================================
  // Applying server data
  // =========================================================================

  /**
   * Rule 0.2: apply a floor only if its version is greater than the one held; history is merged by
   * seq either way (this dedupes the HTTP answer against the socket echo).
   */
  private ingest(
    floor: FloorDto,
    history: readonly HistoryEntry[],
    options: IngestOptions,
  ): IngestResult {
    const held = this.floor();
    const gap = held !== null && floor.version > held.version + 1;
    if (gap && options.gap === 'resync') {
      void this.resync();
      return { applied: false, gap: true };
    }
    this.mergeAndNotify(history, options);
    const newer = held === null || floor.version > held.version;
    if (newer) {
      const keepPlayback = held !== null && !options.playback;
      this.floor.set(
        keepPlayback ? { ...floor, playing: held.playing, intervalMs: held.intervalMs } : floor,
      );
      if (held === null) {
        this.intervalMs.set(floor.intervalMs);
      }
    }
    if (options.playback) {
      this.applyPlayback(floor.playing, floor.intervalMs, options.notify === true);
    }
    this.pruneSelection();
    return { applied: newer, gap };
  }

  private mergeAndNotify(history: readonly HistoryEntry[], options: IngestOptions): void {
    const { merged, added } = mergeHistory(this.history(), history);
    if (added.length === 0) {
      return;
    }
    this.history.set(merged);
    const sentences: string[] = [];
    for (const entry of added) {
      const ev = entry.event;
      if (ev.type === 'TICK_RESOLVED') {
        continue;
      }
      sentences.push(eventLine(ev).text);
      if (ev.type === 'FLOOR_CREATED') {
        const own = options.own === true || this.inflight?.type === 'CREATE_FLOOR';
        if (options.notify && !own) {
          this.toast('FLOOR_RESET', 'info', floorResetMessage(ev.width, ev.height));
        }
        this.select(null);
      } else if (ev.type === 'ROBOT_REMOVED' && ev.id === this.selectedId()) {
        const inflight = this.inflight;
        const own =
          options.own === true || (inflight?.type === 'REMOVE_ROBOT' && inflight.id === ev.id);
        if (options.notify && !own) {
          this.toast('ROBOT_REMOVED_REMOTE', 'info', robotRemovedRemoteMessage(ev.id));
        }
        this.select(null);
      }
    }
    if (options.notify && sentences.length > 0) {
      this.announcement.set(sentences.join(' '));
    }
  }

  private applyPlayback(playing: boolean, intervalMs: number, announce: boolean): void {
    const held = this.floor();
    if (!held) {
      return;
    }
    const playingChanged = held.playing !== playing;
    if (playingChanged || held.intervalMs !== intervalMs) {
      this.floor.set({ ...held, playing, intervalMs });
    }
    // The slider follows the server only when the server's value changed, and never mid-debounce.
    if (held.intervalMs !== intervalMs && this.intervalTimer === null) {
      this.intervalMs.set(intervalMs);
    }
    if (playingChanged && announce) {
      this.announcement.set(playing ? 'Playing' : `Paused at tick ${held.state.tick}`);
    }
  }

  private pruneSelection(): void {
    const id = this.selectedId();
    const state = this.floor()?.state;
    if (id && state && !state.robots.some((r) => r.id === id)) {
      this.select(null);
    }
  }

  // =========================================================================
  // UI state
  // =========================================================================

  /** Any explicit selection change disarms GOTO. */
  select(id: RobotId | null): void {
    this.selectedId.set(id);
    this.gotoRaw.set(false);
  }

  toggleSelect(id: RobotId): void {
    this.select(this.selectedId() === id ? null : id);
  }

  setEditMode(on: boolean): void {
    this.editMode.set(on);
    if (on) {
      this.gotoRaw.set(false);
    }
  }

  setShowIdle(on: boolean): void {
    this.showIdle.set(on);
  }

  /** Pad GOTO. In edit mode it turns edit off and arms (the two modes are exclusive, UI_SPEC 5.1). */
  toggleGoto(): void {
    if (this.selectedId() === null) {
      return;
    }
    if (this.editMode()) {
      this.editMode.set(false);
      this.gotoRaw.set(true);
      return;
    }
    this.gotoRaw.set(!this.gotoRaw());
  }

  disarmGoto(): void {
    this.gotoRaw.set(false);
  }

  // =========================================================================
  // Commands (all serialized through one FIFO)
  // =========================================================================

  /** UI_SPEC 5.1 pointer matrix. */
  async activateCell(cell: CellActivation): Promise<void> {
    const state = this.state();
    if (!state) {
      return;
    }
    if (!this.connected()) {
      this.toastClient('OFFLINE');
      return;
    }
    const { x, y } = cell;
    const robotHere = state.robots.find((r) => r.x === x && r.y === y);

    if (this.editMode()) {
      await this.submit({ type: 'TOGGLE_OBSTACLE', x, y });
      return;
    }

    const selected = this.selectedId();
    const armed = this.gotoArmed();
    // Armed GOTO: clicking some *other* robot selects it instead (5.1 "disarm first").
    if (armed && !cell.shift && robotHere && robotHere.id !== selected) {
      this.select(robotHere.id);
      return;
    }
    if (cell.shift || armed) {
      if (!selected) {
        this.toastClient('NO_ROBOT_SELECTED');
        return;
      }
      this.gotoRaw.set(false);
      await this.submit({
        type: 'QUEUE_COMMANDS',
        id: selected,
        commands: [{ kind: 'GOTO', x, y }],
      });
      return;
    }
    if (robotHere) {
      this.toggleSelect(robotHere.id);
      return;
    }
    this.placing++;
    try {
      const result = await this.submit({ type: 'PLACE_ROBOT', x, y, facing: 'NORTH' });
      const placed = result?.history.find((e) => e.event.type === 'ROBOT_PLACED');
      if (placed && placed.event.type === 'ROBOT_PLACED') {
        this.select(placed.event.id);
      }
    } finally {
      this.placing--;
    }
  }

  async queueCommand(kind: 'MOVE' | 'LEFT' | 'RIGHT'): Promise<void> {
    const id = this.selectedId();
    // While our own PLACE is pending the new robot is not selected yet, and the old selection is
    // being left behind: drop the command silently (UI_SPEC 5.2).
    if (!id || this.placing > 0) {
      return;
    }
    await this.submit({ type: 'QUEUE_COMMANDS', id, commands: [{ kind }] });
  }

  async clearQueue(id: RobotId): Promise<void> {
    await this.submit({ type: 'CLEAR_QUEUE', id });
  }

  /** Resolves true when the robot was removed. */
  async removeRobot(id: RobotId): Promise<boolean> {
    return (await this.submit({ type: 'REMOVE_ROBOT', id })) !== null;
  }

  /** Resolves true when the floor was created. */
  async createFloor(width: number, height: number): Promise<boolean> {
    return (await this.submit({ type: 'CREATE_FLOOR', width, height })) !== null;
  }

  /**
   * Scenario picker (DECISIONS 5.7): pause, then send the setup actions one by one through the same
   * FIFO as every other command. Stops at the first refusal (a remote edit mid-load, offline, a
   * network error), so `ok` is true only when the whole setup was accepted. `version` and `tick`
   * are the floor held afterwards: the baseline the run is tracked from.
   */
  async loadScenario(
    setup: readonly Action[],
  ): Promise<{ ok: boolean; version: number; tick: number }> {
    let ok = this.connected();
    if (!ok) {
      this.toastClient('OFFLINE');
    }
    if (ok && this.playing()) {
      await this.pause();
      ok = !this.playing(); // the pause failed (it toasts): do not reset a floor that is still ticking
    }
    for (const action of setup) {
      if (!ok) {
        break;
      }
      ok = (await this.submit(action)) !== null;
    }
    const floor = this.floor();
    return { ok, version: floor?.version ?? 0, tick: floor?.state.tick ?? 0 };
  }

  async step(): Promise<void> {
    await this.stepOnce();
  }

  /**
   * One server Step, resolving with the success body (null when refused). The scenario script
   * player uses it to check the floor version each answer carries.
   */
  async stepOnce(): Promise<CommandSuccess | null> {
    const result = await this.submit(null);
    const tick = result?.history.find((e) => e.event.type === 'TICK_RESOLVED');
    if (tick && tick.event.type === 'TICK_RESOLVED') {
      this.announcement.set(announceTick(tick.event.tick, tick.event.results));
    }
    return result;
  }

  /** Send one action through the FIFO, resolving with the success body (null when refused). */
  sendActionOnce(action: Action): Promise<CommandSuccess | null> {
    return this.submit(action);
  }

  async togglePlay(): Promise<void> {
    if (this.playing()) {
      await this.pause();
    } else {
      await this.play();
    }
  }

  async play(): Promise<void> {
    await this.playback(() => this.api.play(this.intervalMs()));
  }

  async pause(): Promise<void> {
    await this.playback(() => this.api.pause());
  }

  /** Slider moved: always local; while playing also re-send /play after 300 ms (UI_SPEC 3.2). */
  changeInterval(ms: number): void {
    this.intervalMs.set(ms);
    if (this.intervalTimer !== null) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (!this.playing()) {
      return;
    }
    this.intervalTimer = setTimeout(() => {
      this.intervalTimer = null;
      if (this.playing()) {
        void this.play();
      }
    }, INTERVAL_DEBOUNCE_MS);
  }

  private async playback(call: () => Promise<FloorDto>): Promise<void> {
    if (!this.connected()) {
      this.toastClient('OFFLINE');
      return;
    }
    await this.enqueue(async () => {
      try {
        const dto = await call();
        this.applyPlayback(dto.playing, dto.intervalMs, true);
      } catch (e) {
        this.toastClient(e instanceof ApiError ? e.kind : 'NETWORK_ERROR');
      }
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Send one action (or a Step when null). Resolves with the success body, or null if refused. */
  private submit(action: Action | null): Promise<CommandSuccess | null> {
    if (!this.connected()) {
      this.toastClient('OFFLINE');
      return Promise.resolve(null);
    }
    return this.enqueue(async () => {
      if (!this.connected()) {
        this.toastClient('OFFLINE');
        return null;
      }
      const versionAtSend = this.floor()?.version ?? 0;
      this.inflight = action;
      try {
        const outcome = action ? await this.api.sendAction(action) : await this.api.step();
        return this.handleOutcome(outcome, action, versionAtSend);
      } finally {
        this.inflight = null;
      }
    });
  }

  private handleOutcome(
    outcome: CommandOutcome,
    action: Action | null,
    versionAtSend: number,
  ): CommandSuccess | null {
    const seqBefore = lastSeq(this.history());
    if (outcome.kind === 'success') {
      const { floor, history } = outcome.body;
      const result = this.ingest(floor, history, { gap: 'apply', own: true, notify: true });
      if (result.gap) {
        void this.backfill(seqBefore);
      }
      return outcome.body;
    }
    if (outcome.kind === 'rejected') {
      this.handleRejection(outcome.body, action, versionAtSend, seqBefore);
      return null;
    }
    this.toastClient(outcome.kind);
    return null;
  }

  /** Module D: show why, mark the toast stale when the view was behind, and catch up. */
  private handleRejection(
    body: CommandRejected,
    action: Action | null,
    versionAtSend: number,
    seqBefore: number,
  ): void {
    const result = this.ingest(body.floor, [], { gap: 'apply', own: true, notify: true });
    const stale = body.floor.version > versionAtSend;
    this.toastService.show({
      reason: body.reason,
      kind: 'error',
      message: rejectionMessage(body.reason, action, body.message),
      title: body.message,
      stale,
      ...(stale ? { detail: STALE_DETAIL } : {}),
    });
    if (result.applied) {
      void this.backfill(seqBefore);
    }
  }

  // =========================================================================
  // Toasts
  // =========================================================================

  private toast(reason: ClientReason, kind: 'error' | 'info', message: string): void {
    this.toastService.show({ reason, kind, message });
  }

  toastClient(reason: 'NO_ROBOT_SELECTED' | 'OFFLINE' | 'NETWORK_ERROR' | 'SERVER_ERROR'): void {
    this.toast(reason, 'error', CLIENT_MESSAGES[reason]);
  }
}
