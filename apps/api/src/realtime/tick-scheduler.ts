import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { MAX_TICK_INTERVAL_MS, MIN_TICK_INTERVAL_MS } from '@fleet/protocol';
import { FloorsService } from '../floors/floors.service.js';
import type { TickTimer, TickTimerHandle } from '../tick-timer.js';
import { PlaybackState } from './playback-state.js';
import type { Playback } from './playback-state.js';

/** Injection token for the TickTimer (AppOptions.timer, default `realTickTimer`). */
export const TICK_TIMER = Symbol('TICK_TIMER');

export function clampInterval(intervalMs: number): number {
  return Math.min(MAX_TICK_INTERVAL_MS, Math.max(MIN_TICK_INTERVAL_MS, Math.round(intervalMs)));
}

/**
 * The server is the only clock (DECISIONS 7.1): one interval per playing floor. Each firing is an
 * ordinary `FloorsService.step` (7.6). Callers must have checked that the floor exists.
 */
@Injectable()
export class TickScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(TickScheduler.name);
  private readonly timers = new Map<string, TickTimerHandle>();

  constructor(
    @Inject(FloorsService) private readonly floors: FloorsService,
    @Inject(PlaybackState) private readonly playback: PlaybackState,
    @Inject(TICK_TIMER) private readonly timer: TickTimer,
  ) {}

  /**
   * Idempotent. Same interval while playing: nothing happens. A different interval restarts
   * that floor's one timer. Without `intervalMs` the floor's current interval is kept.
   */
  play(floorId: string, intervalMs?: number): Playback {
    const current = this.playback.get(floorId);
    const interval = clampInterval(intervalMs ?? current.intervalMs);
    if (current.playing && current.intervalMs === interval && this.timers.has(floorId)) {
      return current;
    }
    this.stopTimer(floorId);
    this.timers.set(
      floorId,
      this.timer.setInterval(() => this.tick(floorId), interval),
    );
    this.playback.set(floorId, { playing: true, intervalMs: interval });
    return this.playback.get(floorId);
  }

  /** Idempotent. The interval is kept for the next Play (DECISIONS 7.5). */
  pause(floorId: string): Playback {
    this.stopTimer(floorId);
    this.playback.set(floorId, {
      playing: false,
      intervalMs: this.playback.get(floorId).intervalMs,
    });
    return this.playback.get(floorId);
  }

  onModuleDestroy(): void {
    for (const floorId of [...this.timers.keys()]) {
      this.stopTimer(floorId);
    }
  }

  private stopTimer(floorId: string): void {
    const handle = this.timers.get(floorId);
    if (handle !== undefined) {
      this.timer.clearInterval(handle);
      this.timers.delete(floorId);
    }
  }

  private tick(floorId: string): void {
    try {
      this.floors.step(floorId);
    } catch (error) {
      // A throwing timer callback would crash the process; stop this floor's loop instead.
      this.logger.error(`Tick failed for floor "${floorId}", pausing it`, String(error));
      this.pause(floorId);
    }
  }
}
