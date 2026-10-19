import { Inject } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { SocketEvents } from '@fleet/protocol';
import type { FloorDto } from '@fleet/protocol';
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

/** socket.io on the same HTTP server (namespace "/", path "/socket.io"); one room per floor. */
@WebSocketGateway({ cors: { origin: DEV_UI_ORIGIN } })
export class FloorGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(FloorsService) private readonly floors: FloorsService,
    @Inject(PlaybackState) private readonly playback: PlaybackState,
  ) {}

  afterInit(server: Server): void {
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
