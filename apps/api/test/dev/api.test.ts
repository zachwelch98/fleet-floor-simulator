import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Action } from '@fleet/engine';
import type { CommandRejected, CommandSuccess, FloorDto, HistoryEntry } from '@fleet/protocol';
import { HISTORY_MAX_LIMIT } from '@fleet/protocol';
import { createApp } from '../../src/app.factory.js';
import { FloorsService } from '../../src/floors/floors.service.js';
import type { FloorCommitted } from '../../src/floors/floors.service.js';
import { inspectFloor } from '../../src/testing.js';

const FIXED = new Date('2026-01-02T03:04:05.000Z');
const now = (): Date => FIXED;

const apps: INestApplication[] = [];
const dbFiles: string[] = [];

async function newApp(dbPath = ':memory:'): Promise<INestApplication> {
  const app = await createApp({ dbPath, now });
  apps.push(app);
  return app;
}

afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
  for (const file of dbFiles.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(file + suffix, { force: true });
    }
  }
});

async function send(app: INestApplication, action: Action) {
  return request(app.getHttpServer()).post('/api/floors/main/commands').send({ action });
}

async function getFloor(app: INestApplication): Promise<FloorDto> {
  const res = await request(app.getHttpServer()).get('/api/floors/main').expect(200);
  return res.body as FloorDto;
}

describe('floors REST', () => {
  it('creates the default 10x8 floor as version 1', async () => {
    const app = await newApp();
    const floor = await getFloor(app);
    expect(floor).toMatchObject({ id: 'main', version: 1, playing: false, intervalMs: 500 });
    expect(floor.state).toMatchObject({ width: 10, height: 8, tick: 0, nextRobotNum: 1 });
    const history = await request(app.getHttpServer()).get('/api/floors/main/history');
    expect((history.body as HistoryEntry[]).map((e) => e.event.type)).toEqual(['FLOOR_CREATED']);
    expect((history.body as HistoryEntry[])[0]?.at).toBe(FIXED.toISOString());
  });

  it('place -> queue -> step round trip', async () => {
    const app = await newApp();
    const placed = await send(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    expect(placed.status).toBe(200);
    const placedBody = placed.body as CommandSuccess;
    expect(placedBody.floor.version).toBe(2);
    expect(placedBody.history.map((h) => h.event.type)).toEqual(['ROBOT_PLACED']);

    const queued = await send(app, {
      type: 'QUEUE_COMMANDS',
      id: 'r1',
      commands: [{ kind: 'MOVE' }, { kind: 'RIGHT' }, { kind: 'GOTO', x: 4, y: 2 }],
    });
    expect(queued.status).toBe(200);
    expect((queued.body as CommandSuccess).floor.state.robots[0]?.queue).toHaveLength(3);

    const stepped = await request(app.getHttpServer()).post('/api/floors/main/step');
    expect(stepped.status).toBe(200);
    const body = stepped.body as CommandSuccess;
    expect(body.ok).toBe(true);
    expect(body.floor.version).toBe(4);
    expect(body.floor.state.tick).toBe(1);
    expect(body.floor.state.robots[0]).toMatchObject({ id: 'R1', x: 1, y: 2 });
    expect(body.history.map((h) => h.event.type)).toEqual(['TICK_RESOLVED']);
    expect(body.history[0]?.tick).toBe(1);

    expect(await getFloor(app)).toEqual(body.floor);
  });

  it('answers a rejected action with 409, the reason and the authoritative floor, storing nothing', async () => {
    const app = await newApp();
    await send(app, { type: 'PLACE_ROBOT', x: 2, y: 2, facing: 'EAST' }).then((r) =>
      expect(r.status).toBe(200),
    );
    const before = await getFloor(app);
    const res = await send(app, { type: 'PLACE_ROBOT', x: 2, y: 2, facing: 'WEST' });
    expect(res.status).toBe(409);
    const body = res.body as CommandRejected;
    expect(body).toMatchObject({ ok: false, reason: 'CELL_OCCUPIED' });
    expect(body.message).toContain('R1');
    expect(body.floor).toEqual(before);
    expect(await getFloor(app)).toEqual(before);

    const history = await request(app.getHttpServer()).get('/api/floors/main/history');
    expect(history.body as HistoryEntry[]).toHaveLength(2);
  });

  it('returns engine rejections for semantic problems rather than 400', async () => {
    const app = await newApp();
    const cases: [Action, string][] = [
      [{ type: 'CREATE_FLOOR', width: 21, height: 3 }, 'INVALID_SIZE'],
      [{ type: 'PLACE_ROBOT', id: 'X1', x: 0, y: 0, facing: 'NORTH' }, 'INVALID_ID'],
      [{ type: 'PLACE_ROBOT', x: 99, y: 0, facing: 'NORTH' }, 'OUT_OF_BOUNDS'],
      [{ type: 'REMOVE_ROBOT', id: 'R9' }, 'UNKNOWN_ROBOT'],
      [{ type: 'QUEUE_COMMANDS', id: 'R1', commands: [] }, 'UNKNOWN_ROBOT'],
    ];
    for (const [action, reason] of cases) {
      const res = await send(app, action);
      expect(res.status, JSON.stringify(action)).toBe(409);
      expect((res.body as CommandRejected).reason).toBe(reason);
    }
  });

  it('answers 404 for an unknown floor and 400 for malformed bodies', async () => {
    const app = await newApp();
    const http = request(app.getHttpServer());
    const missing = await http.get('/api/floors/nope');
    expect(missing.status).toBe(404);
    expect(typeof (missing.body as { message: unknown }).message).toBe('string');
    expect((await http.get('/api/floors/nope/history')).status).toBe(404);
    expect((await http.post('/api/floors/nope/step')).status).toBe(404);
    expect((await send(app, { type: 'TICK' })).status).toBe(200);
    expect(
      (await http.post('/api/floors/nope/commands').send({ action: { type: 'TICK' } })).status,
    ).toBe(404);

    const bad: unknown[] = [
      {},
      { action: null },
      { action: 'TICK' },
      { action: { type: 'NOPE' } },
      { action: { type: 'CREATE_FLOOR', width: '5', height: 5 } },
      { action: { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'UP' } },
      { action: { type: 'PLACE_ROBOT', id: 5, x: 1, y: 1, facing: 'NORTH' } },
      { action: { type: 'SET_OBSTACLE', x: 1, y: 1 } },
      { action: { type: 'QUEUE_COMMANDS', id: 'R1', commands: 'MOVE' } },
      { action: { type: 'QUEUE_COMMANDS', id: 'R1', commands: [null] } },
      { action: { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x: 1 }] } },
      { action: { type: 'REMOVE_ROBOT' } },
    ];
    for (const body of bad) {
      const res = await http.post('/api/floors/main/commands').send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof (res.body as { message: unknown }).message).toBe('string');
    }
    const garbage = await http
      .post('/api/floors/main/commands')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(garbage.status).toBe(400);
    expect((await getFloor(app)).version).toBe(2); // only the valid TICK committed
  });

  it('treats an unknown command kind as an engine rejection', async () => {
    const app = await newApp();
    await send(app, { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' });
    const res = await request(app.getHttpServer())
      .post('/api/floors/main/commands')
      .send({ action: { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'JUMP' }] } });
    expect(res.status).toBe(409);
    expect((res.body as CommandRejected).reason).toBe('INVALID_COMMAND');
  });

  describe('history', () => {
    async function seeded(): Promise<INestApplication> {
      const app = await newApp();
      for (let i = 0; i < 6; i++) {
        await request(app.getHttpServer()).post('/api/floors/main/step').expect(200);
      }
      return app; // seq 1 = FLOOR_CREATED, seq 2..7 = TICK_RESOLVED
    }
    const seqs = (body: unknown): number[] => (body as HistoryEntry[]).map((e) => e.seq);

    it('without after returns the newest `limit`, ascending', async () => {
      const app = await seeded();
      const http = request(app.getHttpServer());
      expect(seqs((await http.get('/api/floors/main/history')).body)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(seqs((await http.get('/api/floors/main/history?limit=3')).body)).toEqual([5, 6, 7]);
    });

    it('with after returns the oldest entries past it, limited', async () => {
      const app = await seeded();
      const http = request(app.getHttpServer());
      expect(seqs((await http.get('/api/floors/main/history?after=2&limit=2')).body)).toEqual([
        3, 4,
      ]);
      expect(seqs((await http.get('/api/floors/main/history?after=7')).body)).toEqual([]);
      expect(seqs((await http.get('/api/floors/main/history?after=0')).body)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
    });

    it('clamps limit and rejects garbage', async () => {
      const app = await seeded();
      const http = request(app.getHttpServer());
      expect(seqs((await http.get('/api/floors/main/history?limit=0')).body)).toEqual([7]);
      expect(
        (await http.get(`/api/floors/main/history?limit=${HISTORY_MAX_LIMIT * 10}`)).status,
      ).toBe(200);
      for (const query of ['limit=-1', 'limit=abc', 'limit=1.5', 'after=-1', 'after=x', 'after=']) {
        const res = await http.get(`/api/floors/main/history?${query}`);
        expect(res.status, query).toBe(400);
      }
    });
  });
});

describe('persistence', () => {
  it('survives a restart with a file database and keeps versions and seqs going', async () => {
    const file = join(tmpdir(), `fleet-dev2-${randomUUID()}`, 'nested', 'fleet.db');
    dbFiles.push(file);

    const first = await newApp(file);
    await send(first, { type: 'PLACE_ROBOT', x: 3, y: 3, facing: 'EAST' });
    await send(first, { type: 'SET_OBSTACLE', x: 5, y: 3, present: true });
    await send(first, {
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [
        { kind: 'MOVE' },
        { kind: 'RIGHT' },
        { kind: 'MOVE' },
        { kind: 'GOTO', x: 8, y: 7 },
      ],
    });
    await request(first.getHttpServer()).post('/api/floors/main/step').expect(200);
    const before = await getFloor(first);
    const historyBefore = (await request(first.getHttpServer()).get('/api/floors/main/history'))
      .body as HistoryEntry[];
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const second = await newApp(file);
    expect(await getFloor(second)).toEqual(before);
    const historyAfter = (await request(second.getHttpServer()).get('/api/floors/main/history'))
      .body as HistoryEntry[];
    expect(historyAfter).toEqual(historyBefore); // default floor was not re-created
    expect(inspectFloor(second, 'main').version).toBe(before.version);

    const next = await request(second.getHttpServer()).post('/api/floors/main/step').expect(200);
    const nextBody = next.body as CommandSuccess;
    expect(nextBody.floor.version).toBe(before.version + 1);
    expect(nextBody.history[0]?.seq).toBe((historyBefore.at(-1)?.seq ?? 0) + 1);
  });
});

describe('inspectFloor', () => {
  it('tables, snapshot and replay agree after a mixed sequence (incl. rejections)', async () => {
    const app = await newApp();
    const actions: Action[] = [
      { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' },
      { type: 'PLACE_ROBOT', x: 4, y: 0, facing: 'WEST' },
      { type: 'PLACE_ROBOT', id: 'r7', x: 2, y: 2, facing: 'SOUTH' },
      { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'EAST' }, // rejected (occupied)
      { type: 'TOGGLE_OBSTACLE', x: 1, y: 0 },
      { type: 'SET_OBSTACLE', x: 1, y: 0, present: true }, // no-op, still a commit
      { type: 'TOGGLE_OBSTACLE', x: 6, y: 6 },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }, { kind: 'RIGHT' }] },
      { type: 'QUEUE_COMMANDS', id: 'R7', commands: [{ kind: 'LEFT' }, { kind: 'MOVE' }] },
      { type: 'TICK' },
      { type: 'TICK' },
      { type: 'REMOVE_ROBOT', id: 'R7' },
      { type: 'CLEAR_QUEUE', id: 'R1' },
      { type: 'TICK' },
      { type: 'TOGGLE_OBSTACLE', x: 6, y: 6 },
      // Queued last: the GOTO executor lands in a parallel change; persistence only needs the rows.
      {
        type: 'QUEUE_COMMANDS',
        id: 'R2',
        commands: [{ kind: 'MOVE' }, { kind: 'GOTO', x: 9, y: 7 }],
      },
    ];
    const statuses: number[] = [];
    for (const action of actions) {
      statuses.push((await send(app, action)).status);
    }
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    const inspection = inspectFloor(app, 'main');
    expect(inspection.version).toBeGreaterThan(10);
    expect(inspection.fromTables).toEqual(inspection.fromSnapshot);
    expect(inspection.fromTables).toEqual(inspection.fromReplay);
    expect(inspection.fromTables).toEqual((await getFloor(app)).state);
    expect(inspection.fromTables.robots.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(inspection.fromTables.nextRobotNum).toBe(8);
  });

  it('stays consistent after CREATE_FLOOR replaces the world', async () => {
    const app = await newApp();
    await send(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    await send(app, { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }] });
    await send(app, { type: 'CREATE_FLOOR', width: 3, height: 4 });
    const inspection = inspectFloor(app, 'main');
    expect(inspection.fromTables).toEqual(inspection.fromSnapshot);
    expect(inspection.fromTables).toEqual(inspection.fromReplay);
    expect(inspection.fromTables).toMatchObject({ width: 3, height: 4, robots: [] });
  });
});

describe('concurrency and hooks', () => {
  it('serializes simultaneous placements: exactly one wins, the other gets 409', async () => {
    const app = await newApp();
    const action: Action = { type: 'PLACE_ROBOT', x: 5, y: 5, facing: 'NORTH' };
    const results = await Promise.all([send(app, action), send(app, action)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await getFloor(app)).state.robots).toHaveLength(1);
  });

  it('notifies committed subscribers once per commit and never for rejections', async () => {
    const app = await newApp();
    const seen: FloorCommitted[] = [];
    const subscription = app.get(FloorsService).committed.subscribe((c) => seen.push(c));
    await send(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    await send(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'SOUTH' }); // rejected
    await request(app.getHttpServer()).post('/api/floors/main/step');
    subscription.unsubscribe();
    expect(seen.map((c) => c.floor.version)).toEqual([2, 3]);
    expect(seen[1]?.history[0]?.event.type).toBe('TICK_RESOLVED');
  });

  it('allows CORS for the dev UI origin', async () => {
    const app = await newApp();
    const res = await request(app.getHttpServer())
      .get('/api/floors/main')
      .set('Origin', 'http://localhost:4200');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
  });
});
