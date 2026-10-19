/**
 * API persistence: a temp-file SQLite database survives close and reopen, and a run that is restarted
 * part-way ends up identical to an uninterrupted one (DECISIONS 6.1, 6.2).
 */
import type { INestApplication } from '@nestjs/common';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Action } from '@fleet/engine';
import { DEFAULT_TICK_INTERVAL_MS, type FloorDto, type HistoryEntry } from '@fleet/protocol';
import {
  MIXED_ACTIONS,
  MIXED_STAGES,
  getFloor,
  getHistory,
  makeApp,
  mustOk,
  mustOkAll,
  mustReject,
  mustStep,
  removeDb,
  snapshotOf,
  tempDbPath,
} from './support.js';

const openApps: INestApplication[] = [];
const dbPaths: string[] = [];

/** Opens an app on a database file; every app opened here is closed (and its file removed) afterwards. */
async function open(path: string): Promise<INestApplication> {
  const app = await makeApp(path);
  openApps.push(app);
  return app;
}

async function close(app: INestApplication): Promise<void> {
  const index = openApps.indexOf(app);
  if (index >= 0) openApps.splice(index, 1);
  await app.close();
}

function newDbPath(): string {
  const path = tempDbPath();
  dbPaths.push(path);
  return path;
}

afterEach(async () => {
  while (openApps.length > 0) await openApps.pop()?.close();
  for (const path of dbPaths.splice(0)) removeDb(path);
});

describe('persistence: restart keeps everything', () => {
  it('floor and history are identical after close and reopen', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOkAll(first, MIXED_STAGES.slice(0, 3).flat());
    const before = await snapshotOf(first);
    expect(before.history.length).toBeGreaterThan(20);
    await close(first);

    const second = await open(path);
    const after = await snapshotOf(second);
    expect(after.floor).toEqual(before.floor);
    expect(after.history).toEqual(before.history);
  });

  it('a reopened default floor is not recreated: no reset, no extra FLOOR_CREATED', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOk(first, { type: 'PLACE_ROBOT', x: 3, y: 3, facing: 'NORTH' });
    const before = await snapshotOf(first);
    await close(first);

    for (let i = 0; i < 3; i++) {
      const again = await open(path);
      expect(await snapshotOf(again)).toEqual(before);
      await close(again);
    }
  });

  it('version and seq continue after the restart', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOkAll(first, MIXED_STAGES.slice(0, 2).flat());
    const before = await snapshotOf(first);
    const lastSeq = before.history.at(-1)?.seq ?? 0;
    await close(first);

    const second = await open(path);
    const res = await mustOk(second, { type: 'PLACE_ROBOT', x: 9, y: 0, facing: 'WEST' });
    expect(res.floor.version).toBe(before.floor.version + 1);
    expect(res.history).toHaveLength(1);
    expect(res.history[0]?.seq).toBeGreaterThan(lastSeq);
    expect(res.history[0]?.version).toBe(before.floor.version + 1);

    const step = await mustStep(second);
    expect(step.floor.version).toBe(before.floor.version + 2);
    expect(step.history[0]?.seq).toBeGreaterThan(res.history[0]?.seq ?? 0);

    // The old history is intact and the new entries are appended after it.
    const all = await getHistory(second);
    expect(all.slice(0, before.history.length)).toEqual(before.history);
    const seqs = all.map((h) => h.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('rejected actions leave no trace after a restart', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOk(first, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    await mustReject(first, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'EAST' });
    await mustReject(first, { type: 'REMOVE_ROBOT', id: 'R7' });
    const before = await snapshotOf(first);
    await close(first);

    const second = await open(path);
    expect(await snapshotOf(second)).toEqual(before);
    const res = await mustOk(second, { type: 'PLACE_ROBOT', x: 2, y: 2, facing: 'NORTH' });
    expect(res.floor.version).toBe(before.floor.version + 1);
  });

  it('play state is not persisted: a reopened floor is paused at the default interval (DECISIONS 6.2)', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOk(first, { type: 'TICK' });
    await close(first);
    const second = await open(path);
    const dto = await getFloor(second);
    expect(dto.playing).toBe(false);
    expect(dto.intervalMs).toBe(DEFAULT_TICK_INTERVAL_MS);
  });

  it('apps on different database files do not leak into each other', async () => {
    const pathA = newDbPath();
    const pathB = newDbPath();
    const a = await open(pathA);
    const b = await open(pathB);
    await mustOk(a, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    expect((await getFloor(b)).state.robots).toEqual([]);
    await close(a);
    await close(b);
    expect((await getFloor(await open(pathA))).state.robots).toHaveLength(1);
    expect((await getFloor(await open(pathB))).state.robots).toEqual([]);
  });
});

describe('persistence: auto-ID high-water mark', () => {
  const autoPlace = (x: number): Action => ({ type: 'PLACE_ROBOT', x, y: 0, facing: 'NORTH' });

  it('removing the newest robot does not free its id, even without a restart', async () => {
    const app = await open(newDbPath());
    await mustOkAll(app, [autoPlace(0), autoPlace(1), autoPlace(2)]);
    await mustOk(app, { type: 'REMOVE_ROBOT', id: 'R3' });
    const res = await mustOk(app, autoPlace(3));
    expect(res.floor.state.robots.map((r) => r.id)).toEqual(['R1', 'R2', 'R4']);
  });

  it('survives a restart: remove R3, restart, the next auto-placed robot is R4', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOkAll(first, [autoPlace(0), autoPlace(1), autoPlace(2)]);
    await mustOk(first, { type: 'REMOVE_ROBOT', id: 'R3' });
    const before = await getFloor(first);
    expect(before.state.nextRobotNum).toBe(4);
    await close(first);

    const second = await open(path);
    expect((await getFloor(second)).state.nextRobotNum).toBe(4);
    const res = await mustOk(second, autoPlace(3));
    expect(res.floor.state.robots.map((r) => r.id)).toEqual(['R1', 'R2', 'R4']);
    expect(res.floor.state.nextRobotNum).toBe(5);
  });

  it('survives removing every robot: ids still never restart at R1', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOkAll(first, [
      autoPlace(0),
      autoPlace(1),
      { type: 'REMOVE_ROBOT', id: 'R1' },
      { type: 'REMOVE_ROBOT', id: 'R2' },
    ]);
    await close(first);
    const second = await open(path);
    const res = await mustOk(second, autoPlace(5));
    expect(res.floor.state.robots.map((r) => r.id)).toEqual(['R3']);
  });

  it('a gappy explicit id (R10) raises the mark across a restart', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOk(first, { type: 'PLACE_ROBOT', id: 'R10', x: 0, y: 0, facing: 'NORTH' });
    await close(first);
    const second = await open(path);
    const res = await mustOk(second, autoPlace(1));
    expect(res.floor.state.robots.map((r) => r.id)).toEqual(['R10', 'R11']);
  });

  it('CREATE_FLOOR resets the mark, and the reset also survives a restart', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOkAll(first, [
      autoPlace(0),
      autoPlace(1),
      { type: 'CREATE_FLOOR', width: 5, height: 5 },
    ]);
    await close(first);
    const second = await open(path);
    const res = await mustOk(second, autoPlace(0));
    expect(res.floor.state.robots.map((r) => r.id)).toEqual(['R1']);
  });
});

describe('persistence: robot internals survive a restart', () => {
  it('queues, facing and obstacles are restored exactly', async () => {
    const path = newDbPath();
    const first = await open(path);
    await mustOkAll(first, [
      { type: 'PLACE_ROBOT', id: 'R2', x: 1, y: 1, facing: 'SOUTH' },
      { type: 'SET_OBSTACLE', x: 5, y: 5, present: true },
      { type: 'SET_OBSTACLE', x: 2, y: 7, present: true },
      {
        type: 'QUEUE_COMMANDS',
        id: 'R2',
        commands: [
          { kind: 'LEFT' },
          { kind: 'GOTO', x: 8, y: 6 },
          { kind: 'MOVE' },
          { kind: 'RIGHT' },
        ],
      },
      { type: 'TICK' },
    ]);
    const before = await getFloor(first);
    expect(before.state.robots[0]?.queue.length).toBeGreaterThan(0);
    await close(first);

    const after = await getFloor(await open(path));
    expect(after).toEqual(before);
  });

  it('the GOTO no-path counter survives: UNREACHABLE still fires on the third consecutive tick', async () => {
    const path = newDbPath();
    const first = await open(path);
    // Target (4,4) on a 5x5 floor is walled in by obstacles: no path.
    await mustOkAll(first, [
      { type: 'CREATE_FLOOR', width: 5, height: 5 },
      { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' },
      { type: 'SET_OBSTACLE', x: 3, y: 4, present: true },
      { type: 'SET_OBSTACLE', x: 4, y: 3, present: true },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x: 4, y: 4 }] },
      { type: 'TICK' },
      { type: 'TICK' },
    ]);
    const mid = await getFloor(first);
    expect(mid.state.robots[0]?.gotoNoPathTicks).toBeGreaterThan(0);
    expect(mid.state.robots[0]?.queue).toHaveLength(1);
    await close(first);

    const second = await open(path);
    expect(await getFloor(second)).toEqual(mid);
    const third = await mustStep(second);
    const event = third.history[0]?.event;
    expect(event?.type).toBe('TICK_RESOLVED');
    if (event?.type === 'TICK_RESOLVED') {
      expect(event.results[0]?.outcome).toBe('UNREACHABLE');
    }
    expect(third.floor.state.robots[0]?.queue).toEqual([]);
  });
});

describe('persistence: a restarted run equals an uninterrupted one', () => {
  let reference: { floor: FloorDto; history: HistoryEntry[] };

  beforeAll(async () => {
    const app = await makeApp(':memory:');
    try {
      await mustOkAll(app, MIXED_ACTIONS);
      reference = await snapshotOf(app);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('the reference run is substantial', () => {
    expect(reference.floor.version).toBe(1 + MIXED_ACTIONS.length);
    expect(reference.history.length).toBeGreaterThan(MIXED_ACTIONS.length / 2);
  });

  it.each([1, 8, 17, 30, 45, MIXED_ACTIONS.length - 1])(
    'restarting after action %i changes nothing about the final floor or history',
    async (split) => {
      const path = newDbPath();
      const first = await open(path);
      await mustOkAll(first, MIXED_ACTIONS.slice(0, split));
      await close(first);

      const second = await open(path);
      await mustOkAll(second, MIXED_ACTIONS.slice(split));
      const result = await snapshotOf(second);
      expect(result.floor).toEqual(reference.floor);
      expect(result.history).toEqual(reference.history);
    },
  );

  it('restarting at every stage boundary changes nothing either', async () => {
    const path = newDbPath();
    let app = await open(path);
    for (const stage of MIXED_STAGES) {
      await mustOkAll(app, stage);
      await close(app);
      app = await open(path);
    }
    const result = await snapshotOf(app);
    expect(result.floor).toEqual(reference.floor);
    expect(result.history).toEqual(reference.history);
  });
});
