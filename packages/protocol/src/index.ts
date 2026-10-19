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
  /** client → server: the tab driving a scenario run shares its state (`ScenarioRunPayload`, DECISIONS 5.10). */
  ScenarioPublish: 'scenario:publish',
  /** server → room (the publisher excluded), and to a socket right after it joins: the shared run. */
  Scenario: 'floor:scenario',
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

/** Largest scenario `text` the server relays (the upload limit, DECISIONS 5.8). */
export const MAX_SHARED_SCENARIO_CHARS = 64 * 1024;

/**
 * A scenario run as the driving tab holds it (DECISIONS 5.10). Inputs only: a watching tab rebuilds
 * the scenario from `text` and works out the checkpoint results itself. The server relays it as is.
 */
export interface SharedScenarioRun {
  readonly id: string;
  readonly title: string;
  readonly group: 'brief' | 'curated' | 'uploaded';
  readonly fileName: string;
  readonly text: string;
  readonly expectedText?: string;
  /** Too many ticks to run live; nothing was sent to the floor. */
  readonly refused: boolean;
  /** One entry per REPORT: the live lines captured so far, or null. */
  readonly live: readonly (readonly string[] | null)[];
  readonly halted: 'modified' | 'failed' | null;
  /** Script steps played so far. */
  readonly cursor: number;
}

export interface ScenarioRunPayload {
  readonly floorId: string;
  /** null: no run (it ended, or the tab driving it left). */
  readonly run: SharedScenarioRun | null;
}
