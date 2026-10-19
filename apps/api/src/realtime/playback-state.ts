import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { DEFAULT_TICK_INTERVAL_MS } from '@fleet/protocol';
import type { PlaybackPayload } from '@fleet/protocol';

export interface Playback {
  readonly playing: boolean;
  readonly intervalMs: number;
}

/**
 * In-memory play state per floor (DECISIONS 6.2, 7.5). Kept apart from the TickScheduler so both
 * FloorsService (fills FloorDto.playing/intervalMs) and the scheduler (which calls
 * FloorsService.step) can depend on it without a DI cycle. Not persisted: after a restart every
 * floor is paused at the default interval.
 */
@Injectable()
export class PlaybackState implements OnModuleDestroy {
  private readonly byFloor = new Map<string, Playback>();
  private readonly changesSubject = new Subject<PlaybackPayload>();

  /** Emits only when `playing` or `intervalMs` of a floor actually changed (DECISIONS 7.5). */
  readonly changes: Observable<PlaybackPayload> = this.changesSubject.asObservable();

  get(floorId: string): Playback {
    return this.byFloor.get(floorId) ?? { playing: false, intervalMs: DEFAULT_TICK_INTERVAL_MS };
  }

  /** Stores the new state; returns true (and emits) only if it differs from the current one. */
  set(floorId: string, next: Playback): boolean {
    const current = this.get(floorId);
    if (current.playing === next.playing && current.intervalMs === next.intervalMs) {
      return false;
    }
    this.byFloor.set(floorId, { playing: next.playing, intervalMs: next.intervalMs });
    this.changesSubject.next({
      floorId,
      playing: next.playing,
      intervalMs: next.intervalMs,
    });
    return true;
  }

  onModuleDestroy(): void {
    this.changesSubject.complete();
  }
}
