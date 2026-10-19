/**
 * Storage consistency (DECISIONS 6.1): the state rebuilt from the normalized tables, the latest snapshot
 * and a replay of the stored actions must be deep-equal to each other and to what GET returns, with the
 * version matching, after every committed action and after a restart.
 */
import type { INestApplication } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '@fleet/engine';
import { DEFAULT_FLOOR_ID, type FloorDto } from '@fleet/protocol';
import { inspectFloor } from '../src/testing.js';
import {
  MIXED_ACTIONS,
  MIXED_STAGES,
  getFloor,
  makeApp,
  mustOk,
  mustReject,
  removeDb,
  send,
  tempDbPath,
} from './support.js';

const openApps: INestApplication[] = [];
const dbPaths: string[] = [];

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

afterEach(async () => {
  while (openApps.length > 0) await openApps.pop()?.close();
  for (const path of dbPaths.splice(0)) removeDb(path);
});

/** Asserts the three-way consistency and that all of it matches the API. Returns the GET floor. */
async function expectConsistent(app: INestApplication, label: string): Promise<FloorDto> {
  const dto = await getFloor(app);
  const inspected = inspectFloor(app, DEFAULT_FLOOR_ID);
  expect(inspected.fromSnapshot, `${label}: snapshot vs tables`).toEqual(inspected.fromTables);
  expect(inspected.fromReplay, `${label}: replay vs tables`).toEqual(inspected.fromTables);
  expect(inspected.fromTables, `${label}: tables vs GET`).toEqual(dto.state);
  expect(inspected.version, `${label}: version vs GET`).toBe(dto.version);
  return dto;
}

/** Tracks which interesting shapes of state the sequence actually passed through. */
interface Coverage {
  gotoCounter: boolean;
  queuedCommands: boolean;
  obstacles: boolean;
  gappyIds: boolean;
  removedRobotHighWater: boolean;
  resizedFloor: boolean;
}

function noteCoverage(c: Coverage, dto: FloorDto): void {
  const { robots, obstacles, nextRobotNum, tick } = dto.state;
  if (robots.some((r) => r.gotoNoPathTicks > 0)) c.gotoCounter = true;
  if (robots.some((r) => r.queue.length > 0)) c.queuedCommands = true;
  if (obstacles.length > 0) c.obstacles = true;
  if (robots.some((r) => r.num === 10) && robots.some((r) => r.num === 2)) c.gappyIds = true;
  if (nextRobotNum > (robots.at(-1)?.num ?? 0) + 1) c.removedRobotHighWater = true;
  if (dto.state.width === 8 && dto.state.height === 6 && tick > 0) c.resizedFloor = true;
}

describe('consistency: tables, snapshot and replay agree', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await makeApp();
    openApps.push(app);
  });

  it('agree on a freshly created app (the default floor)', async () => {
    const dto = await expectConsistent(app, 'fresh');
    expect(dto.version).toBe(1);
  });

  it('agree after every one of a long deterministic mixed sequence', async () => {
    const coverage: Coverage = {
      gotoCounter: false,
      queuedCommands: false,
      obstacles: false,
      gappyIds: false,
      removedRobotHighWater: false,
      resizedFloor: false,
    };
    let version = 1;
    for (const [index, action] of MIXED_ACTIONS.entries()) {
      const res = await send(app, action);
      expect(res.status, JSON.stringify(action)).toBe(200);
      version += 1;
      const dto = await expectConsistent(app, `#${index + 1} ${action.type}`);
      expect(dto.version).toBe(version);
      noteCoverage(coverage, dto);
    }
    expect(version).toBe(1 + MIXED_ACTIONS.length);
    // The check only means something if the sequence really exercised these shapes.
    expect(coverage.queuedCommands).toBe(true);
    expect(coverage.obstacles).toBe(true);
    expect(coverage.gappyIds).toBe(true);
    expect(coverage.removedRobotHighWater).toBe(true);
    expect(coverage.gotoCounter).toBe(true);
    expect(coverage.resizedFloor).toBe(true);
  });

  it('the sequence passes through a state with a non-zero GOTO no-path counter', async () => {
    // Guards the previous test's coverage claim by looking at the stage that produces it.
    for (const stage of MIXED_STAGES.slice(0, 3)) {
      for (const action of stage) await send(app, action);
    }
    let sawCounter = false;
    for (const action of MIXED_STAGES[3] ?? []) {
      await send(app, action);
      const dto = await getFloor(app);
      if (dto.state.robots.some((r) => r.gotoNoPathTicks > 0)) sawCounter = true;
    }
    expect(sawCounter).toBe(true);
  });

  it('rejected actions do not disturb the three representations', async () => {
    await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    const before = await expectConsistent(app, 'before rejections');
    const rejected: Action[] = [
      { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'EAST' },
      { type: 'REMOVE_ROBOT', id: 'R9' },
      { type: 'CREATE_FLOOR', width: 0, height: 0 },
      {
        type: 'QUEUE_COMMANDS',
        id: 'R1',
        commands: [{ kind: 'MOVE' }, { kind: 'GOTO', x: 99, y: 0 }],
      },
      { type: 'SET_OBSTACLE', x: 1, y: 1, present: true },
    ];
    for (const action of rejected) {
      await mustReject(app, action);
      const dto = await expectConsistent(app, `after rejected ${action.type}`);
      expect(dto).toEqual(before);
    }
  });

  it('a successful no-op (SET_OBSTACLE already in that state) keeps all three in step with the version', async () => {
    await mustOk(app, { type: 'SET_OBSTACLE', x: 2, y: 2, present: true });
    const one = await expectConsistent(app, 'after set');
    await mustOk(app, { type: 'SET_OBSTACLE', x: 2, y: 2, present: true });
    const two = await expectConsistent(app, 'after no-op');
    expect(two.version).toBe(one.version + 1);
    expect(two.state).toEqual(one.state);
  });

  it('the replay really goes through the stored actions: ticks are part of it', async () => {
    await mustOk(app, { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' });
    await mustOk(app, {
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'MOVE' }, { kind: 'MOVE' }],
    });
    await send(app, { type: 'TICK' });
    await send(app, { type: 'TICK' });
    const inspected = inspectFloor(app, DEFAULT_FLOOR_ID);
    expect(inspected.fromReplay.tick).toBe(2);
    expect(inspected.fromReplay.robots[0]).toMatchObject({ x: 0, y: 2, queue: [] });
    expect(inspected.fromReplay).toEqual(inspected.fromTables);
  });
});

describe('consistency: after a restart', () => {
  it('agree after reopening a temp-file database, and keep agreeing as the sequence continues', async () => {
    const path = tempDbPath();
    dbPaths.push(path);
    const split = 30;

    const first = await open(path);
    for (const action of MIXED_ACTIONS.slice(0, split)) {
      expect((await send(first, action)).status).toBe(200);
    }
    const beforeRestart = await expectConsistent(first, 'before restart');
    await close(first);

    const second = await open(path);
    const afterRestart = await expectConsistent(second, 'right after restart');
    expect(afterRestart).toEqual(beforeRestart);

    let version = afterRestart.version;
    for (const [index, action] of MIXED_ACTIONS.slice(split).entries()) {
      expect((await send(second, action)).status).toBe(200);
      version += 1;
      const dto = await expectConsistent(second, `after restart, #${split + index + 1}`);
      expect(dto.version).toBe(version);
    }
    expect(version).toBe(1 + MIXED_ACTIONS.length);
  });

  it('agree after a restart at every stage boundary', async () => {
    const path = tempDbPath();
    dbPaths.push(path);
    let app = await open(path);
    let expectedVersion = 1;
    for (const [index, stage] of MIXED_STAGES.entries()) {
      for (const action of stage) {
        expect((await send(app, action)).status).toBe(200);
        expectedVersion += 1;
      }
      const before = await expectConsistent(app, `stage ${index + 1}`);
      expect(before.version).toBe(expectedVersion);
      await close(app);
      app = await open(path);
      const after = await expectConsistent(app, `stage ${index + 1}, reopened`);
      expect(after).toEqual(before);
    }
  });

  it('agree on a reopened database that only ever held the default floor', async () => {
    const path = tempDbPath();
    dbPaths.push(path);
    const first = await open(path);
    await close(first);
    const second = await open(path);
    const dto = await expectConsistent(second, 'untouched, reopened');
    expect(dto.version).toBe(1);
  });
});
