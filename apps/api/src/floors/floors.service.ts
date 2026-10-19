import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { UI_DEFAULT_FLOOR, apply, createFloorState } from '@fleet/engine';
import type { Action } from '@fleet/engine';
import { DEFAULT_FLOOR_ID } from '@fleet/protocol';
import type { CommandResponse, FloorDto, FloorUpdatedPayload, HistoryEntry } from '@fleet/protocol';
import { FloorRepository } from './floor.repository.js';
import type { HistoryQuery, LoadedFloor } from './floor.repository.js';
import { PlaybackState } from '../realtime/playback-state.js';

/** Injection token for the clock that stamps HistoryEntry.at. */
export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;

/** Same shape the socket gateway broadcasts (`floor:updated`). */
export type FloorCommitted = FloorUpdatedPayload;

export class FloorNotFoundError extends NotFoundException {
  constructor(floorId: string) {
    super(`Floor "${floorId}" not found`);
  }
}

@Injectable()
export class FloorsService implements OnModuleInit, OnModuleDestroy {
  private readonly committedSubject = new Subject<FloorCommitted>();

  /**
   * Emits once per committed action, synchronously after the transaction commits, with the new
   * FloorDto and the history entries that commit created. Phase 3 hook: the socket gateway
   * subscribes here and broadcasts `floor:updated` to the floor's room. Rejected actions never
   * emit.
   */
  readonly committed: Observable<FloorCommitted> = this.committedSubject.asObservable();

  constructor(
    @Inject(FloorRepository) private readonly repository: FloorRepository,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(PlaybackState) private readonly playback: PlaybackState,
  ) {}

  onModuleInit(): void {
    this.ensureDefaultFloor();
  }

  onModuleDestroy(): void {
    this.committedSubject.complete();
  }

  /**
   * Makes sure the default floor exists. It is created by a real CREATE_FLOOR action applied to
   * an empty placeholder, so the action log alone can rebuild it (DECISIONS 6.1).
   */
  ensureDefaultFloor(): void {
    if (this.repository.exists(DEFAULT_FLOOR_ID)) {
      return;
    }
    const action: Action = { type: 'CREATE_FLOOR', ...UI_DEFAULT_FLOOR };
    const result = apply(createFloorState(1, 1), action);
    if (!result.ok) {
      throw new Error(`Cannot create default floor: ${result.message}`);
    }
    const history = this.repository.commit(
      DEFAULT_FLOOR_ID,
      0,
      action,
      result.state,
      result.events,
      this.now(),
    );
    this.publish(DEFAULT_FLOOR_ID, { state: result.state, version: 1 }, history);
  }

  /** The current floor, or null if the id is unknown. */
  findFloor(floorId: string): FloorDto | null {
    const loaded = this.repository.loadState(floorId);
    return loaded === null ? null : this.toDto(floorId, loaded);
  }

  /** The current floor; throws FloorNotFoundError (HTTP 404) if unknown. */
  getFloor(floorId: string): FloorDto {
    const floor = this.findFloor(floorId);
    if (floor === null) {
      throw new FloorNotFoundError(floorId);
    }
    return floor;
  }

  history(floorId: string, query: HistoryQuery): HistoryEntry[] {
    if (!this.repository.exists(floorId)) {
      throw new FloorNotFoundError(floorId);
    }
    return this.repository.history(floorId, query);
  }

  /**
   * Apply one action to a floor. Fully synchronous on purpose: no await between load and
   * commit, so concurrent requests are serialized by the event loop (DECISIONS 7.2).
   * A rejected action stores nothing and returns the authoritative floor.
   */
  execute(floorId: string, action: Action): CommandResponse {
    const loaded = this.repository.loadState(floorId);
    if (loaded === null) {
      throw new FloorNotFoundError(floorId);
    }
    const result = apply(loaded.state, action);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message: result.message,
        floor: this.toDto(floorId, loaded),
      };
    }
    const history = this.repository.commit(
      floorId,
      loaded.version,
      action,
      result.state,
      result.events,
      this.now(),
    );
    const floor = this.publish(
      floorId,
      { state: result.state, version: loaded.version + 1 },
      history,
    );
    return { ok: true, floor, history };
  }

  /** One simulation tick (the Step button; Phase 3's TickScheduler calls this too). */
  step(floorId: string): CommandResponse {
    return this.execute(floorId, { type: 'TICK' });
  }

  private publish(
    floorId: string,
    committed: LoadedFloor,
    history: readonly HistoryEntry[],
  ): FloorDto {
    const floor = this.toDto(floorId, committed);
    this.committedSubject.next({ floor, history });
    return floor;
  }

  /** Playback is session state (DECISIONS 6.2), read from PlaybackState, never stored. */
  private toDto(floorId: string, loaded: LoadedFloor): FloorDto {
    const { playing, intervalMs } = this.playback.get(floorId);
    return {
      id: floorId,
      version: loaded.version,
      state: loaded.state,
      playing,
      intervalMs,
    };
  }
}
