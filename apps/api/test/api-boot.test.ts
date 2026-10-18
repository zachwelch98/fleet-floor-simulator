/**
 * API boot: what a freshly created app serves before anybody has done anything.
 */
import type { INestApplication } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  DEFAULT_FLOOR_ID,
  DEFAULT_TICK_INTERVAL_MS,
  type FloorDto,
  type HistoryEntry,
} from '@fleet/protocol';
import { getFloor, getHistory, http, makeApp, mustOk } from './support.js';

let app: INestApplication;

beforeEach(async () => {
  app = await makeApp();
});

afterEach(async () => {
  await app.close();
});

describe('boot: the default floor', () => {
  it('serves floor "main" as an empty 10x8 floor at version 1, tick 0, paused', async () => {
    const res = await http(app).get(`${API_PREFIX}/floors/${DEFAULT_FLOOR_ID}`);
    expect(res.status).toBe(200);
    const dto = res.body as FloorDto;
    expect(dto.id).toBe('main');
    expect(dto.version).toBe(1);
    expect(dto.playing).toBe(false);
    expect(dto.intervalMs).toBe(DEFAULT_TICK_INTERVAL_MS);
    expect(dto.state).toMatchObject({ width: 10, height: 8, tick: 0, nextRobotNum: 1 });
    expect(dto.state.robots).toEqual([]);
    expect(dto.state.obstacles).toEqual([]);
  });

  it('answers JSON', async () => {
    const res = await http(app).get(`${API_PREFIX}/floors/main`);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('GET is repeatable and does not change anything (no hidden side effects)', async () => {
    const a = await getFloor(app);
    const b = await getFloor(app);
    expect(b).toEqual(a);
    expect(b.version).toBe(1);
  });

  it('serves the routes only under the /api prefix', async () => {
    const res = await http(app).get('/floors/main');
    expect(res.status).toBe(404);
  });

  it('starts with an empty or one-entry history, and the entry (if any) is the floor creation at version 1', async () => {
    // GAP: the contract does not say whether creating the default floor is logged as FLOOR_CREATED.
    // Both are accepted; if it is logged it must describe the 10x8 floor at version 1.
    const history = await getHistory(app);
    expect(history.length).toBeLessThanOrEqual(1);
    for (const entry of history) {
      expect(entry.version).toBe(1);
      expect(entry.tick).toBe(0);
      expect(entry.event).toEqual({ type: 'FLOOR_CREATED', width: 10, height: 8 });
    }
  });
});

describe('boot: unknown floors', () => {
  it('GET an unknown floor is 404', async () => {
    const res = await http(app).get(`${API_PREFIX}/floors/nope`);
    expect(res.status).toBe(404);
  });

  it.each([
    ['GET history', 'get', '/floors/nope/history'],
    ['POST commands', 'post', '/floors/nope/commands'],
    ['POST step', 'post', '/floors/nope/step'],
    ['POST play', 'post', '/floors/nope/play'],
    ['POST pause', 'post', '/floors/nope/pause'],
  ] as const)('%s on an unknown floor is 404', async (_name, method, path) => {
    const req = http(app)[method](`${API_PREFIX}${path}`);
    const res = await (method === 'post' ? req.send({ action: { type: 'TICK' } }) : req);
    expect(res.status).toBe(404);
  });
});

describe('boot: isolation and playback controls', () => {
  it('every app gets its own fresh in-memory database', async () => {
    await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    const other = await makeApp();
    try {
      const dto = await getFloor(other);
      expect(dto.version).toBe(1);
      expect(dto.state.robots).toEqual([]);
    } finally {
      await other.close();
    }
  });

  // Phase 3: play/pause endpoints are not built yet (TickScheduler). Un-skip when they land.
  it.skip('pause is idempotent and leaves the floor paused with unchanged contents', async () => {
    const before = await getFloor(app);
    for (let i = 0; i < 2; i++) {
      const res = await http(app).post(`${API_PREFIX}/floors/main/pause`).send();
      expect(res.status).toBe(200);
      const dto = res.body as FloorDto;
      expect(dto.playing).toBe(false);
      expect(dto.state).toEqual(before.state);
    }
  });

  it('history of a fresh app is an array (ascending seq)', async () => {
    const history: HistoryEntry[] = await getHistory(app);
    const seqs = history.map((h) => h.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
