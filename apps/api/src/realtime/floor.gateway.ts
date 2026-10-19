import { Inject } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { MAX_SHARED_SCENARIO_CHARS, SocketEvents } from '@fleet/protocol';
import type { FloorDto, ScenarioRunPayload, SharedScenarioRun } from '@fleet/protocol';
import { DEV_UI_ORIGIN } from '../cors.js';
import { FloorsService } from '../floors/floors.service.js';
import { PlaybackState } from './playback-state.js';

const room = (floorId: string): string => `floor:${floorId}`;

function floorIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const floorId = (payload as Record<string, unknown>)['floorId'];
  return typeof floorId === 'string' ? floorId : null;
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** A loose shape check: the server relays the run, it does not interpret it (DECISIONS 5.10). */
function sharedRunOf(value: unknown): SharedScenarioRun | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  const run = value as Record<string, unknown>;
  const ok =
    isString(run['id']) &&
    isString(run['title']) &&
    ['brief', 'curated', 'uploaded'].includes(run['group'] as string) &&
    isString(run['fileName']) &&
    isString(run['text']) &&
    run['text'].length <= MAX_SHARED_SCENARIO_CHARS &&
    (run['expectedText'] === undefined ||
      (isString(run['expectedText']) && run['expectedText'].length <= MAX_SHARED_SCENARIO_CHARS)) &&
    typeof run['refused'] === 'boolean' &&
    Array.isArray(run['live']) &&
    run['live'].every((l) => l === null || (Array.isArray(l) && l.every(isString))) &&
    [null, 'modified', 'failed'].includes(run['halted'] as string | null) &&
    typeof run['cursor'] === 'number';
  return ok ? (value as SharedScenarioRun) : undefined;
}

interface SharedRun {
  readonly run: SharedScenarioRun;
  /** The socket driving it; only it can end it, and it ends when that socket leaves. */
  readonly publisher: string;
}

/** socket.io on the same HTTP server (namespace "/", path "/socket.io"); one room per floor. */
@WebSocketGateway({ cors: { origin: DEV_UI_ORIGIN } })
export class FloorGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private subscriptions: Subscription[] = [];
  private server: Server | null = null;
  /** The scenario run shared on each floor (DECISIONS 5.10). In memory only. */
  private readonly scenarios = new Map<string, SharedRun>();

  constructor(
    @Inject(FloorsService) private readonly floors: FloorsService,
    @Inject(PlaybackState) private readonly playback: PlaybackState,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    // Both go to everyone in the floor's room, the sender included (DECISIONS 7.7). Playback is
    // only emitted when it actually changed (PlaybackState.changes, DECISIONS 7.5).
    this.subscriptions = [
      this.floors.committed.subscribe((payload) => {
        server.to(room(payload.floor.id)).emit(SocketEvents.Updated, payload);
      }),
      this.playback.changes.subscribe((payload) => {
        server.to(room(payload.floorId)).emit(SocketEvents.Playback, payload);
      }),
    ];
  }

  /**
   * Plain socket.io handlers instead of @SubscribeMessage: Nest drops a null return value, but
   * joining an unknown floor must ack `null` (DECISIONS 7.7).
   */
  handleConnection(client: Socket): void {
    client.on(SocketEvents.Join, (payload: unknown, ack?: unknown) => {
      const floorId = floorIdOf(payload);
      const floor: FloorDto | null = floorId === null ? null : this.floors.findFloor(floorId);
      if (floorId !== null && floor !== null) {
        void client.join(room(floorId));
      }
      if (typeof ack === 'function') {
        (ack as (floor: FloorDto | null) => void)(floor);
      }
      const shared = floorId === null || floor === null ? undefined : this.scenarios.get(floorId);
      if (floorId !== null && shared && shared.publisher !== client.id) {
        client.emit(SocketEvents.Scenario, {
          floorId,
          run: shared.run,
        } satisfies ScenarioRunPayload);
      }
    });
    client.on(SocketEvents.ScenarioPublish, (payload: unknown) => {
      const floorId = floorIdOf(payload);
      const run = sharedRunOf((payload as Record<string, unknown> | null)?.['run']);
      if (floorId === null || run === undefined || !client.rooms.has(room(floorId))) {
        return;
      }
      if (run === null) {
        // Only the tab driving the run can end it; a stale "ended" from a tab another Load replaced is dropped.
        if (this.scenarios.get(floorId)?.publisher !== client.id) {
          return;
        }
        this.scenarios.delete(floorId);
      } else {
        this.scenarios.set(floorId, { run, publisher: client.id });
      }
      client
        .to(room(floorId))
        .emit(SocketEvents.Scenario, { floorId, run } satisfies ScenarioRunPayload);
    });
    client.on('disconnect', () => {
      for (const [floorId, shared] of this.scenarios) {
        if (shared.publisher === client.id) {
          this.scenarios.delete(floorId);
          this.server
            ?.to(room(floorId))
            .emit(SocketEvents.Scenario, { floorId, run: null } satisfies ScenarioRunPayload);
        }
      }
    });
    client.on(SocketEvents.Leave, (payload: unknown) => {
      const floorId = floorIdOf(payload);
      if (floorId !== null) {
        void client.leave(room(floorId));
      }
    });
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }
}
