/**
 * Shared helpers for the API integration tests (not a test file itself).
 *
 * Every test builds its own app against `:memory:` (or a unique temp file for persistence tests) with a
 * fixed clock, talks to it over HTTP with supertest, and closes it afterwards.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Action } from '@fleet/engine';
import {
  API_PREFIX,
  DEFAULT_FLOOR_ID,
  type CommandRejected,
  type CommandSuccess,
  type FloorDto,
  type HistoryEntry,
} from '@fleet/protocol';
import { createApp } from '../src/app.factory.js';
import type { TickTimer } from '../src/tick-timer.js';

/** The injected clock. Every HistoryEntry.at must equal FIXED_ISO. */
export const FIXED_NOW = new Date('2026-01-01T00:00:00Z');
export const FIXED_ISO = '2026-01-01T00:00:00.000Z';

/** `timer` replaces the Play timer (tests pass a `ManualTickTimer`); omitted, the app uses the real one. */
export function makeApp(dbPath = ':memory:', timer?: TickTimer): Promise<INestApplication> {
  return createApp({ dbPath, now: () => FIXED_NOW, ...(timer === undefined ? {} : { timer }) });
}

/** A unique database path under os.tmpdir(); remove it with `removeDb` (in afterEach). */
export function tempDbPath(): string {
  return join(tmpdir(), `fleet-api-test-${process.pid}-${randomUUID()}.db`);
}

export function removeDb(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

/**
 * supertest starts a listener on first use; two requests fired at the same moment could both try. Listening
 * up front (ephemeral port, loopback) makes concurrent requests safe. The app's close() stops it.
 */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}

const floorPath = (id: string) => `${API_PREFIX}/floors/${id}`;

export function http(app: INestApplication) {
  return request(app.getHttpServer());
}

export async function getFloor(app: INestApplication, id = DEFAULT_FLOOR_ID): Promise<FloorDto> {
  const res = await http(app).get(floorPath(id));
  if (res.status !== 200) throw new Error(`GET floor ${id} -> ${res.status}`);
  return res.body as FloorDto;
}

export async function getHistory(
  app: INestApplication,
  query = '',
  id = DEFAULT_FLOOR_ID,
): Promise<HistoryEntry[]> {
  const res = await http(app).get(`${floorPath(id)}/history${query}`);
  if (res.status !== 200) throw new Error(`GET history${query} -> ${res.status}`);
  return res.body as HistoryEntry[];
}

/** POST an action; returns the raw supertest response. */
export function post(app: INestApplication, action: Action, id = DEFAULT_FLOOR_ID) {
  return http(app)
    .post(`${floorPath(id)}/commands`)
    .send({ action });
}

export function postStep(app: INestApplication, id = DEFAULT_FLOOR_ID) {
  return http(app)
    .post(`${floorPath(id)}/step`)
    .send();
}

/**
 * POST /step `count` times over one pooled keep-alive connection (global fetch). supertest opens a new
 * socket per request, and a few thousand of those in a row leave enough TIME_WAIT sockets to exhaust the
 * ephemeral port range when the suite is rerun quickly (EADDRNOTAVAIL). Starts a loopback listener.
 */
export async function stepManyPooled(
  app: INestApplication,
  count: number,
  id = DEFAULT_FLOOR_ID,
): Promise<void> {
  await listenOnLoopback(app);
  const url = `${await app.getUrl()}${floorPath(id)}/step`;
  for (let i = 0; i < count; i++) {
    const res = await fetch(url, { method: 'POST' });
    await res.arrayBuffer();
    if (res.status !== 200) throw new Error(`step ${i} -> ${res.status}`);
  }
}

/** POST an action that must be accepted (200, ok: true). */
export async function mustOk(
  app: INestApplication,
  action: Action,
  id = DEFAULT_FLOOR_ID,
): Promise<CommandSuccess> {
  const res = await post(app, action, id);
  if (res.status !== 200) {
    throw new Error(
      `expected ${JSON.stringify(action)} to be accepted, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as CommandSuccess;
}

/** POST an action that must be rejected with 409. */
export async function mustReject(
  app: INestApplication,
  action: Action,
  id = DEFAULT_FLOOR_ID,
): Promise<CommandRejected> {
  const res = await post(app, action, id);
  if (res.status !== 409) {
    throw new Error(
      `expected ${JSON.stringify(action)} to be rejected with 409, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body as CommandRejected;
}

/** POST /step that must succeed. */
export async function mustStep(
  app: INestApplication,
  id = DEFAULT_FLOOR_ID,
): Promise<CommandSuccess> {
  const res = await postStep(app, id);
  if (res.status !== 200) throw new Error(`step -> ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as CommandSuccess;
}

export async function stepMany(
  app: INestApplication,
  n: number,
  id = DEFAULT_FLOOR_ID,
): Promise<void> {
  for (let i = 0; i < n; i++) await mustStep(app, id);
}

/** The floor and its full history, read in one go (for "nothing changed" comparisons). */
export async function snapshotOf(
  app: INestApplication,
  id = DEFAULT_FLOOR_ID,
): Promise<{ floor: FloorDto; history: HistoryEntry[] }> {
  return { floor: await getFloor(app, id), history: await getHistory(app, '', id) };
}

/** Sends an action the way the UI would: TICK through /step, everything else through /commands. */
export function send(app: INestApplication, action: Action, id = DEFAULT_FLOOR_ID) {
  return action.type === 'TICK' ? postStep(app, id) : post(app, action, id);
}

/** Sends every action, requiring each to be accepted; returns the last response body. */
export async function mustOkAll(
  app: INestApplication,
  actions: readonly Action[],
  id = DEFAULT_FLOOR_ID,
): Promise<CommandSuccess | undefined> {
  let last: CommandSuccess | undefined;
  for (const action of actions) {
    const res = await send(app, action, id);
    if (res.status !== 200) {
      throw new Error(
        `expected ${JSON.stringify(action)} to be accepted, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    last = res.body as CommandSuccess;
  }
  return last;
}

const TICKS = (n: number): Action[] => Array.from({ length: n }, () => ({ type: 'TICK' }));

/**
 * A long, deterministic, mixed sequence on floor "main" for the persistence and consistency tests. Stages
 * are sent in order; each is a natural checkpoint. Every action is accepted. Covers: gappy IDs (R2, R10),
 * auto-ID, obstacle set/toggle (including a successful no-op), queues of every command kind, a GOTO that
 * gives up (UNREACHABLE), head-on and contested moves, CLEAR_QUEUE, REMOVE_ROBOT, re-PLACE of an existing
 * robot, and a CREATE_FLOOR in the middle.
 */
export const MIXED_STAGES: readonly (readonly Action[])[] = [
  // 1. Gappy IDs and an auto-assigned one (R11), obstacles.
  [
    { type: 'PLACE_ROBOT', id: 'R2', x: 1, y: 1, facing: 'NORTH' },
    { type: 'PLACE_ROBOT', id: 'R10', x: 5, y: 5, facing: 'WEST' },
    { type: 'PLACE_ROBOT', x: 8, y: 2, facing: 'EAST' },
    { type: 'SET_OBSTACLE', x: 3, y: 3, present: true },
    { type: 'TOGGLE_OBSTACLE', x: 4, y: 4 },
    { type: 'TOGGLE_OBSTACLE', x: 4, y: 4 },
    { type: 'SET_OBSTACLE', x: 3, y: 3, present: true },
    { type: 'TOGGLE_OBSTACLE', x: 6, y: 6 },
  ],
  // 2. Queues of every kind, then a burst of ticks.
  [
    {
      type: 'QUEUE_COMMANDS',
      id: 'R2',
      commands: [
        { kind: 'MOVE' },
        { kind: 'RIGHT' },
        { kind: 'MOVE' },
        { kind: 'GOTO', x: 7, y: 1 },
      ],
    },
    {
      type: 'QUEUE_COMMANDS',
      id: 'R10',
      commands: [{ kind: 'MOVE' }, { kind: 'MOVE' }, { kind: 'LEFT' }],
    },
    { type: 'QUEUE_COMMANDS', id: 'R11', commands: [{ kind: 'GOTO', x: 2, y: 6 }] },
    ...TICKS(6),
  ],
  // 3. Clear, remove, re-place, more ticks.
  [
    { type: 'CLEAR_QUEUE', id: 'R10' },
    { type: 'REMOVE_ROBOT', id: 'R11' },
    { type: 'QUEUE_COMMANDS', id: 'R2', commands: [{ kind: 'GOTO', x: 9, y: 7 }] },
    ...TICKS(5),
    { type: 'PLACE_ROBOT', id: 'R2', x: 0, y: 0, facing: 'EAST' },
    ...TICKS(3),
  ],
  // 4. New floor mid-way (nextRobotNum starts over), a head-on pair, a contested cell, an unreachable GOTO.
  [
    { type: 'CREATE_FLOOR', width: 8, height: 6 },
    { type: 'PLACE_ROBOT', id: 'R3', x: 0, y: 0, facing: 'NORTH' },
    { type: 'PLACE_ROBOT', x: 4, y: 2, facing: 'EAST' },
    { type: 'PLACE_ROBOT', x: 5, y: 2, facing: 'WEST' },
    { type: 'PLACE_ROBOT', x: 2, y: 4, facing: 'EAST' },
    { type: 'PLACE_ROBOT', x: 4, y: 4, facing: 'WEST' },
    { type: 'QUEUE_COMMANDS', id: 'R4', commands: [{ kind: 'MOVE' }, { kind: 'MOVE' }] },
    { type: 'QUEUE_COMMANDS', id: 'R5', commands: [{ kind: 'MOVE' }, { kind: 'MOVE' }] },
    { type: 'QUEUE_COMMANDS', id: 'R6', commands: [{ kind: 'MOVE' }, { kind: 'MOVE' }] },
    { type: 'QUEUE_COMMANDS', id: 'R7', commands: [{ kind: 'MOVE' }, { kind: 'MOVE' }] },
    { type: 'SET_OBSTACLE', x: 6, y: 5, present: true },
    { type: 'SET_OBSTACLE', x: 7, y: 4, present: true },
    { type: 'QUEUE_COMMANDS', id: 'R3', commands: [{ kind: 'GOTO', x: 7, y: 5 }] },
    ...TICKS(4),
  ],
  // 5. Tail: edits during activity, more ticks.
  [
    { type: 'REMOVE_ROBOT', id: 'R5' },
    { type: 'TOGGLE_OBSTACLE', x: 7, y: 4 },
    { type: 'QUEUE_COMMANDS', id: 'R3', commands: [{ kind: 'GOTO', x: 7, y: 5 }] },
    { type: 'PLACE_ROBOT', x: 0, y: 5, facing: 'SOUTH' },
    ...TICKS(5),
  ],
];

export const MIXED_ACTIONS: readonly Action[] = MIXED_STAGES.flat();
