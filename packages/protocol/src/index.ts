/**
 * Wire contract between the API (apps/api) and the UI (apps/web): REST DTOs and
 * socket.io event names/payloads. Types only, no runtime logic beyond constants.
 * Changes go through the PM; see docs/PLAN.md.
 */
import type { Action, FloorState, RejectionReason, WorldEvent } from '@fleet/engine';

/** The UI works against a single floor; the API is floor-id aware for tests and future use. */
export const DEFAULT_FLOOR_ID = 'main';

export const MIN_TICK_INTERVAL_MS = 100;
export const MAX_TICK_INTERVAL_MS = 5_000;
export const DEFAULT_TICK_INTERVAL_MS = 500;

export const HISTORY_DEFAULT_LIMIT = 500;
export const HISTORY_MAX_LIMIT = 2_000;

export interface FloorDto {
  readonly id: string;
  /** Increments by exactly 1 per committed action (including each tick). */
  readonly version: number;
  readonly state: FloorState;
  readonly playing: boolean;
  readonly intervalMs: number;
}

export interface HistoryEntry {
  /** Global, strictly increasing sequence number. */
  readonly seq: number;
  readonly floorId: string;
  /** Floor version produced by the action that emitted this event. */
  readonly version: number;
  /** Floor tick count after the action. */
  readonly tick: number;
  readonly event: WorldEvent;
  /** ISO-8601 timestamp (server clock). Display only; never used for ordering. */
  readonly at: string;
}

// ---------------------------------------------------------------------------
// REST
//   GET  /api/floors/:id                    → FloorDto
//   GET  /api/floors/:id/history?after=SEQ&limit=N → HistoryEntry[], ascending seq.
//        With `after`: entries with seq > after, oldest first, at most `limit`.
//        Without `after`: the NEWEST `limit` entries (still returned in ascending order).
//        `limit` defaults to HISTORY_DEFAULT_LIMIT and is clamped to [1, HISTORY_MAX_LIMIT].
//   POST /api/floors/:id/commands  CommandRequest → 200 CommandSuccess | 409 CommandRejected | 400 malformed body
//   POST /api/floors/:id/step                → 200 CommandSuccess (one TICK)
//   POST /api/floors/:id/play  PlayRequest   → 200 FloorDto (idempotent)
//   POST /api/floors/:id/pause               → 200 FloorDto (idempotent)
// ---------------------------------------------------------------------------

export const API_PREFIX = '/api';

export interface CommandRequest {
  readonly action: Action;
}

export interface CommandSuccess {
  readonly ok: true;
  readonly floor: FloorDto;
  readonly history: readonly HistoryEntry[];
}

/** The rejected client gets the reason plus the authoritative floor so it can catch up. */
export interface CommandRejected {
  readonly ok: false;
  readonly reason: RejectionReason;
  readonly message: string;
  readonly floor: FloorDto;
}

export type CommandResponse = CommandSuccess | CommandRejected;

export interface PlayRequest {
  /** Clamped to [MIN_TICK_INTERVAL_MS, MAX_TICK_INTERVAL_MS]; defaults to the current interval. */
  readonly intervalMs?: number;
}

// ---------------------------------------------------------------------------
// Socket.io (namespace "/", path "/socket.io")
// ---------------------------------------------------------------------------

export const SocketEvents = {
  /** client → server: subscribe to a floor's room. Ack: FloorDto, or null for an unknown floor (DECISIONS 7.7). */
  Join: 'floor:join',
  /** client → server */
  Leave: 'floor:leave',
  /** server → room: after every committed action or tick. */
  Updated: 'floor:updated',
  /** server → room: play/pause/interval changed. */
  Playback: 'floor:playback',
} as const;

export interface JoinPayload {
  readonly floorId: string;
}

export interface FloorUpdatedPayload {
  readonly floor: FloorDto;
  /** The history entries produced by this change, ascending seq. */
  readonly history: readonly HistoryEntry[];
}

export interface PlaybackPayload {
  readonly floorId: string;
  readonly playing: boolean;
  readonly intervalMs: number;
}
