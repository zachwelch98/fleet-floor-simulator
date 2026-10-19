/**
 * Transport seam. The store talks to these two interfaces only, so tests can swap in mocks.
 * Real implementations: fetch for REST (HttpFloorApi) and socket.io-client (SocketIoFloorSocket).
 */
import { InjectionToken } from '@angular/core';
import type { Action } from '@fleet/engine';
import {
  API_PREFIX,
  DEFAULT_FLOOR_ID,
  SocketEvents,
  type CommandRejected,
  type CommandSuccess,
  type FloorDto,
  type FloorUpdatedPayload,
  type HistoryEntry,
  type PlaybackPayload,
  type ScenarioRunPayload,
  type SharedScenarioRun,
} from '@fleet/protocol';
import { io, type Socket } from 'socket.io-client';

export type CommandOutcome =
  | { readonly kind: 'success'; readonly body: CommandSuccess }
  | { readonly kind: 'rejected'; readonly body: CommandRejected }
  | { readonly kind: 'NETWORK_ERROR' | 'SERVER_ERROR' };

export class ApiError extends Error {
  constructor(readonly kind: 'NETWORK_ERROR' | 'SERVER_ERROR') {
    super(kind);
  }
}

export interface HistoryQuery {
  readonly after?: number;
  readonly limit?: number;
}

export interface FloorApi {
  /** Rejects with ApiError. */
  getFloor(): Promise<FloorDto>;
  /** Rejects with ApiError. */
  getHistory(query: HistoryQuery): Promise<HistoryEntry[]>;
  sendAction(action: Action): Promise<CommandOutcome>;
  step(): Promise<CommandOutcome>;
  /** Rejects with ApiError. */
  play(intervalMs?: number): Promise<FloorDto>;
  /** Rejects with ApiError. */
  pause(): Promise<FloorDto>;
}

export interface SocketHandlers {
  onConnect(): void;
  /** `permanent`: the server (or this client) closed the socket, so socket.io will not retry. */
  onDisconnect(permanent: boolean): void;
  /** Retries exhausted. */
  onGiveUp(): void;
  onUpdated(payload: FloorUpdatedPayload): void;
  onPlayback(payload: PlaybackPayload): void;
  /** Another tab's scenario run, or null when it ended (DECISIONS 5.10). */
  onScenario(payload: ScenarioRunPayload): void;
}

export interface FloorSocket {
  connect(handlers: SocketHandlers): void;
  /** Resolves with the floor, or null for an unknown floor. Rejects on timeout. */
  join(floorId: string): Promise<FloorDto | null>;
  /** Share the scenario run this tab drives with the other tabs on the floor (null: it ended). */
  publishScenario(floorId: string, run: SharedScenarioRun | null): void;
  /** Manual reconnect (after `disconnected`). */
  reconnect(): void;
  close(): void;
}

export const FLOOR_API = new InjectionToken<FloorApi>('FLOOR_API', {
  providedIn: 'root',
  factory: () => new HttpFloorApi(),
});

export const FLOOR_SOCKET = new InjectionToken<FloorSocket>('FLOOR_SOCKET', {
  providedIn: 'root',
  factory: () => new SocketIoFloorSocket(),
});

const REQUEST_TIMEOUT_MS = 10_000;
const BASE = `${API_PREFIX}/floors/${DEFAULT_FLOOR_ID}`;

export class HttpFloorApi implements FloorApi {
  getFloor(): Promise<FloorDto> {
    return this.read<FloorDto>(BASE);
  }

  getHistory(query: HistoryQuery): Promise<HistoryEntry[]> {
    const params = new URLSearchParams();
    if (query.after !== undefined) {
      params.set('after', String(query.after));
    }
    if (query.limit !== undefined) {
      params.set('limit', String(query.limit));
    }
    const qs = params.toString();
    return this.read<HistoryEntry[]>(`${BASE}/history${qs ? `?${qs}` : ''}`);
  }

  sendAction(action: Action): Promise<CommandOutcome> {
    return this.command(`${BASE}/commands`, { action });
  }

  step(): Promise<CommandOutcome> {
    return this.command(`${BASE}/step`, undefined);
  }

  play(intervalMs?: number): Promise<FloorDto> {
    return this.write<FloorDto>(`${BASE}/play`, intervalMs === undefined ? {} : { intervalMs });
  }

  pause(): Promise<FloorDto> {
    return this.write<FloorDto>(`${BASE}/pause`, undefined);
  }

  private async read<T>(url: string): Promise<T> {
    const res = await this.fetchOrThrow(url, { method: 'GET' });
    if (!res.ok) {
      throw new ApiError('SERVER_ERROR');
    }
    return (await res.json()) as T;
  }

  private async write<T>(url: string, body: unknown): Promise<T> {
    const res = await this.fetchOrThrow(url, this.postInit(body));
    if (!res.ok) {
      throw new ApiError('SERVER_ERROR');
    }
    return (await res.json()) as T;
  }

  private async command(url: string, body: unknown): Promise<CommandOutcome> {
    let res: Response;
    try {
      res = await this.fetchOrThrow(url, this.postInit(body));
    } catch (e) {
      return { kind: e instanceof ApiError ? e.kind : 'NETWORK_ERROR' };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { kind: 'SERVER_ERROR' };
    }
    const shaped = json as { ok?: unknown; floor?: unknown } | null;
    if (res.ok && shaped?.ok === true) {
      return { kind: 'success', body: json as CommandSuccess };
    }
    if (res.status === 409 && shaped?.ok === false && shaped.floor) {
      return { kind: 'rejected', body: json as CommandRejected };
    }
    return { kind: 'SERVER_ERROR' };
  }

  private postInit(body: unknown): RequestInit {
    return body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
  }

  private async fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new ApiError('NETWORK_ERROR');
    }
  }
}

const JOIN_TIMEOUT_MS = 5_000;

export class SocketIoFloorSocket implements FloorSocket {
  private socket: Socket | null = null;
  private handlers: SocketHandlers | null = null;

  connect(handlers: SocketHandlers): void {
    this.handlers = handlers;
    const socket = io({
      path: '/socket.io',
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
    });
    this.socket = socket;
    socket.on('connect', () => handlers.onConnect());
    socket.on('disconnect', (reason) =>
      handlers.onDisconnect(reason === 'io server disconnect' || reason === 'io client disconnect'),
    );
    socket.io.on('reconnect_failed', () => handlers.onGiveUp());
    socket.on(SocketEvents.Updated, (payload: FloorUpdatedPayload) => handlers.onUpdated(payload));
    socket.on(SocketEvents.Playback, (payload: PlaybackPayload) => handlers.onPlayback(payload));
    socket.on(SocketEvents.Scenario, (payload: ScenarioRunPayload) => handlers.onScenario(payload));
    socket.connect();
  }

  async join(floorId: string): Promise<FloorDto | null> {
    if (!this.socket) {
      return null;
    }
    return (await this.socket
      .timeout(JOIN_TIMEOUT_MS)
      .emitWithAck(SocketEvents.Join, { floorId })) as FloorDto | null;
  }

  publishScenario(floorId: string, run: SharedScenarioRun | null): void {
    this.socket?.emit(SocketEvents.ScenarioPublish, { floorId, run } satisfies ScenarioRunPayload);
  }

  reconnect(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    if (socket.connected) {
      // Already connected (the catch-up failed): run the connect path again.
      this.handlers?.onConnect();
    } else {
      socket.connect();
    }
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
