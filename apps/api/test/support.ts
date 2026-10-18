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

/** The injected clock. Every HistoryEntry.at must equal FIXED_ISO. */
export const FIXED_NOW = new Date('2026-01-01T00:00:00Z');
export const FIXED_ISO = '2026-01-01T00:00:00.000Z';

export function makeApp(dbPath = ':memory:'): Promise<INestApplication> {
  return createApp({ dbPath, now: () => FIXED_NOW });
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
