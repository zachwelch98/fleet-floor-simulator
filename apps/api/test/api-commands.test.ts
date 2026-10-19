/**
 * API commands: POST /api/floors/:id/commands and /step.
 *
 * Accepted actions return 200 with the new floor and the history they produced; engine rejections
 * return 409 with the reason and the authoritative floor and change nothing; malformed bodies return 400
 * (DECISIONS 6.1b: shape -> 400, meaning -> 409).
 */
import type { INestApplication } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Action, RejectionReason } from '@fleet/engine';
import {
  API_PREFIX,
  DEFAULT_FLOOR_ID,
  type CommandRejected,
  type CommandSuccess,
} from '@fleet/protocol';
import {
  getFloor,
  getHistory,
  http,
  listenOnLoopback,
  makeApp,
  mustOk,
  mustOkAll,
  mustReject,
  mustStep,
  post,
  postStep,
  snapshotOf,
} from './support.js';

let app: INestApplication;

beforeEach(async () => {
  app = await makeApp();
});

afterEach(async () => {
  await app.close();
});

const commandsUrl = `${API_PREFIX}/floors/${DEFAULT_FLOOR_ID}/commands`;

describe('commands: accepted actions', () => {
  it('auto-assigns R1, R2, ... to PLACE_ROBOT without an id', async () => {
    const first = await mustOk(app, { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' });
    const second = await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 0, facing: 'EAST' });
    const third = await mustOk(app, { type: 'PLACE_ROBOT', x: 2, y: 0, facing: 'SOUTH' });
    expect(first.floor.state.robots.map((r) => r.id)).toEqual(['R1']);
    expect(second.floor.state.robots.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(third.floor.state.robots.map((r) => r.id)).toEqual(['R1', 'R2', 'R3']);
    expect(third.floor.state.nextRobotNum).toBe(4);
    expect(first.history.map((h) => h.event)).toEqual([
      { type: 'ROBOT_PLACED', id: 'R1', x: 0, y: 0, facing: 'NORTH', replaced: false },
    ]);
  });

  it('accepts an explicit id and keeps an auto-id above the highest one used', async () => {
    await mustOk(app, { type: 'PLACE_ROBOT', id: 'R10', x: 0, y: 0, facing: 'NORTH' });
    const auto = await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 0, facing: 'NORTH' });
    expect(auto.floor.state.robots.map((r) => r.id)).toEqual(['R10', 'R11']);
  });

  it('QUEUE_COMMANDS then step moves the robot (y grows north, MOVE follows facing)', async () => {
    await mustOk(app, { type: 'PLACE_ROBOT', x: 2, y: 2, facing: 'NORTH' });
    const queued = await mustOk(app, {
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'MOVE' }, { kind: 'RIGHT' }, { kind: 'MOVE' }],
    });
    expect(queued.floor.state.robots[0]?.queue).toHaveLength(3);
    expect(queued.floor.state.robots[0]).toMatchObject({ x: 2, y: 2 });

    const afterOne = await mustStep(app);
    expect(afterOne.floor.state.robots[0]).toMatchObject({ x: 2, y: 3, facing: 'NORTH' });
    expect(afterOne.floor.state.robots[0]?.queue).toHaveLength(2);
    expect(afterOne.floor.state.tick).toBe(1);

    const afterTwo = await mustStep(app);
    expect(afterTwo.floor.state.robots[0]).toMatchObject({ x: 2, y: 3, facing: 'EAST' });

    const afterThree = await mustStep(app);
    expect(afterThree.floor.state.robots[0]).toMatchObject({ x: 3, y: 3, facing: 'EAST' });
    expect(afterThree.floor.state.robots[0]?.queue).toEqual([]);
    expect(await getFloor(app)).toEqual(afterThree.floor);
  });

  it('responds to an accepted action with the same floor that GET returns', async () => {
    const res = await mustOk(app, { type: 'PLACE_ROBOT', x: 4, y: 4, facing: 'WEST' });
    expect(res.ok).toBe(true);
    expect(res.floor).toEqual(await getFloor(app));
    expect(res.floor.id).toBe(DEFAULT_FLOOR_ID);
  });

  it('increments the version by exactly 1 per accepted action, steps included', async () => {
    const actions: Action[] = [
      { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' },
      { type: 'SET_OBSTACLE', x: 5, y: 5, present: true },
      { type: 'TOGGLE_OBSTACLE', x: 6, y: 6 },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }] },
      { type: 'CLEAR_QUEUE', id: 'R1' },
      { type: 'REMOVE_ROBOT', id: 'R1' },
      { type: 'CREATE_FLOOR', width: 4, height: 4 },
      { type: 'TICK' },
      { type: 'TICK' },
    ];
    let version = (await getFloor(app)).version;
    for (const action of actions) {
      const res = await mustOkAll(app, [action]);
      expect(res?.floor.version, JSON.stringify(action)).toBe(version + 1);
      version += 1;
      expect((await getFloor(app)).version).toBe(version);
    }
  });

  it('TICK is accepted through /commands as well as /step', async () => {
    const before = await getFloor(app);
    const res = await mustOk(app, { type: 'TICK' });
    expect(res.floor.version).toBe(before.version + 1);
    expect(res.floor.state.tick).toBe(before.state.tick + 1);
    const step = await mustStep(app);
    expect(step.floor.version).toBe(before.version + 2);
    expect(step.history.map((h) => h.event.type)).toEqual(['TICK_RESOLVED']);
  });

  it('a successful no-op still bumps the version and adds no history (DECISIONS 6.1c)', async () => {
    await mustOk(app, { type: 'SET_OBSTACLE', x: 2, y: 2, present: true });
    const before = await snapshotOf(app);
    const res = await mustOk(app, { type: 'SET_OBSTACLE', x: 2, y: 2, present: true });
    expect(res.floor.version).toBe(before.floor.version + 1);
    expect(res.floor.state).toEqual(before.floor.state);
    expect(res.history).toEqual([]);
    expect(await getHistory(app)).toEqual(before.history);
  });

  it('CREATE_FLOOR replaces the world with a blank floor (version keeps counting)', async () => {
    await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    await mustOk(app, { type: 'SET_OBSTACLE', x: 2, y: 2, present: true });
    const before = await getFloor(app);
    const res = await mustOk(app, { type: 'CREATE_FLOOR', width: 3, height: 7 });
    expect(res.floor.version).toBe(before.version + 1);
    expect(res.floor.state).toEqual({
      width: 3,
      height: 7,
      obstacles: [],
      robots: [],
      nextRobotNum: 1,
      tick: 0,
    });
  });

  it('drops unknown extra keys instead of failing or echoing them (DECISIONS 6.1b)', async () => {
    const res = await http(app)
      .post(commandsUrl)
      .send({
        action: { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH', colour: 'red' },
        extra: true,
      });
    expect(res.status).toBe(200);
    const body = res.body as CommandSuccess;
    expect(body.floor.state.robots[0]).not.toHaveProperty('colour');
    expect(body.history[0]?.event).not.toHaveProperty('colour');
  });
});

// ---------------------------------------------------------------------------
// Rejections (409). Typed as a Record so adding a RejectionReason to the engine breaks compilation here
// until a case is written for it. Every reason is reachable through the API.
// ---------------------------------------------------------------------------

interface RejectCase {
  readonly name: string;
  /** Accepted actions that build the starting position (default floor is 10x8). */
  readonly setup: readonly Action[];
  readonly action: Action;
}

const place = (x: number, y: number, id?: string): Action => ({
  type: 'PLACE_ROBOT',
  ...(id === undefined ? {} : { id }),
  x,
  y,
  facing: 'NORTH',
});
const queue = (id: string, ...commands: readonly unknown[]): Action =>
  ({ type: 'QUEUE_COMMANDS', id, commands }) as Action;
const unknownKind = { kind: 'JUMP' };

const REJECTION_CASES: Record<RejectionReason, readonly RejectCase[]> = {
  INVALID_SIZE: [
    { name: 'width 0', setup: [], action: { type: 'CREATE_FLOOR', width: 0, height: 5 } },
    { name: 'height 0', setup: [], action: { type: 'CREATE_FLOOR', width: 5, height: 0 } },
    { name: 'width 21', setup: [], action: { type: 'CREATE_FLOOR', width: 21, height: 5 } },
    { name: 'height 21', setup: [], action: { type: 'CREATE_FLOOR', width: 5, height: 21 } },
    { name: 'negative width', setup: [], action: { type: 'CREATE_FLOOR', width: -3, height: 5 } },
    {
      name: 'fractional width',
      setup: [],
      action: { type: 'CREATE_FLOOR', width: 2.5, height: 5 },
    },
    {
      name: 'with robots on the floor (nothing is wiped)',
      setup: [place(1, 1)],
      action: { type: 'CREATE_FLOOR', width: 0, height: 0 },
    },
  ],
  INVALID_ID: [
    { name: 'PLACE R0', setup: [], action: place(1, 1, 'R0') },
    { name: 'PLACE X1', setup: [], action: place(1, 1, 'X1') },
    { name: 'REMOVE R0', setup: [], action: { type: 'REMOVE_ROBOT', id: 'R0' } },
    {
      name: 'REMOVE gibberish',
      setup: [place(1, 1)],
      action: { type: 'REMOVE_ROBOT', id: 'robot' },
    },
    { name: 'QUEUE X1', setup: [place(1, 1)], action: queue('X1', { kind: 'MOVE' }) },
    { name: 'CLEAR R0', setup: [place(1, 1)], action: { type: 'CLEAR_QUEUE', id: 'R0' } },
  ],
  OUT_OF_BOUNDS: [
    { name: 'PLACE x = width', setup: [], action: place(10, 0) },
    { name: 'PLACE y = height', setup: [], action: place(0, 8) },
    { name: 'PLACE negative x', setup: [], action: place(-1, 0) },
    { name: 'PLACE negative y', setup: [], action: place(0, -1) },
    {
      name: 'SET_OBSTACLE present off the floor',
      setup: [],
      action: { type: 'SET_OBSTACLE', x: 10, y: 0, present: true },
    },
    {
      name: 'SET_OBSTACLE absent off the floor',
      setup: [],
      action: { type: 'SET_OBSTACLE', x: 0, y: 8, present: false },
    },
    { name: 'TOGGLE off the floor', setup: [], action: { type: 'TOGGLE_OBSTACLE', x: 99, y: 99 } },
    {
      name: 'moving an existing robot off the floor',
      setup: [place(1, 1)],
      action: place(10, 8, 'R1'),
    },
  ],
  CELL_IS_OBSTACLE: [
    {
      name: 'auto PLACE on an obstacle',
      setup: [{ type: 'SET_OBSTACLE', x: 2, y: 2, present: true }],
      action: place(2, 2),
    },
    {
      name: 'PLACE with id on an obstacle',
      setup: [{ type: 'TOGGLE_OBSTACLE', x: 0, y: 0 }],
      action: place(0, 0, 'R5'),
    },
    {
      name: 'moving an existing robot onto an obstacle',
      setup: [place(1, 1), { type: 'SET_OBSTACLE', x: 3, y: 3, present: true }],
      action: place(3, 3, 'R1'),
    },
  ],
  CELL_OCCUPIED: [
    { name: 'auto PLACE on a robot', setup: [place(1, 1)], action: place(1, 1) },
    { name: 'PLACE R2 on R1', setup: [place(1, 1)], action: place(1, 1, 'R2') },
    {
      name: 'moving a robot onto another robot',
      setup: [place(1, 1), place(2, 2)],
      action: place(2, 2, 'R1'),
    },
    {
      name: 'SET_OBSTACLE present on a robot',
      setup: [place(1, 1)],
      action: { type: 'SET_OBSTACLE', x: 1, y: 1, present: true },
    },
    {
      name: 'TOGGLE on a robot',
      setup: [place(4, 4)],
      action: { type: 'TOGGLE_OBSTACLE', x: 4, y: 4 },
    },
  ],
  UNKNOWN_ROBOT: [
    { name: 'REMOVE on an empty floor', setup: [], action: { type: 'REMOVE_ROBOT', id: 'R5' } },
    {
      name: 'QUEUE for a missing robot',
      setup: [place(1, 1)],
      action: queue('R2', { kind: 'MOVE' }),
    },
    { name: 'CLEAR for a missing robot', setup: [], action: { type: 'CLEAR_QUEUE', id: 'R1' } },
    {
      name: 'QUEUE for a removed robot',
      setup: [place(1, 1), { type: 'REMOVE_ROBOT', id: 'R1' }],
      action: queue('R1', { kind: 'MOVE' }),
    },
  ],
  INVALID_COMMAND: [
    { name: 'empty command list', setup: [place(1, 1)], action: queue('R1') },
    {
      name: 'unknown command kind (DECISIONS 6.1b: 409, not 400)',
      setup: [place(1, 1)],
      action: queue('R1', unknownKind),
    },
    {
      name: 'one unknown kind in a list queues none of the others',
      setup: [place(1, 1)],
      action: queue('R1', { kind: 'MOVE' }, { kind: 'LEFT' }, unknownKind),
    },
  ],
  INVALID_GOTO_TARGET: [
    {
      name: 'GOTO x off the floor',
      setup: [place(1, 1)],
      action: queue('R1', { kind: 'GOTO', x: 10, y: 0 }),
    },
    {
      name: 'GOTO negative y',
      setup: [place(1, 1)],
      action: queue('R1', { kind: 'GOTO', x: 0, y: -1 }),
    },
    {
      name: 'GOTO onto an obstacle',
      setup: [place(1, 1), { type: 'SET_OBSTACLE', x: 5, y: 5, present: true }],
      action: queue('R1', { kind: 'GOTO', x: 5, y: 5 }),
    },
    {
      name: 'a bad GOTO after good commands queues none of them',
      setup: [place(1, 1)],
      action: queue('R1', { kind: 'MOVE' }, { kind: 'RIGHT' }, { kind: 'GOTO', x: 50, y: 50 }),
    },
  ],
};

describe('commands: rejections (409)', () => {
  it('has at least one case for every rejection reason', () => {
    for (const [reason, cases] of Object.entries(REJECTION_CASES)) {
      expect(cases.length, reason).toBeGreaterThan(0);
    }
  });

  describe.each(Object.entries(REJECTION_CASES) as [RejectionReason, readonly RejectCase[]][])(
    '%s',
    (reason, cases) => {
      it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
        await mustOkAll(app, c.setup);
        const before = await snapshotOf(app);

        const res = await post(app, c.action);
        expect(res.status).toBe(409);
        const body = res.body as CommandRejected;
        expect(body.ok).toBe(false);
        expect(body.reason).toBe(reason);
        expect(typeof body.message).toBe('string');
        expect(body.message.length).toBeGreaterThan(0);
        expect(Object.keys(body).sort()).toEqual(['floor', 'message', 'ok', 'reason']);
        // The body carries the authoritative floor: exactly what a prior GET returned.
        expect(body.floor).toEqual(before.floor);

        // Nothing changed: not the floor, not the version, not the history.
        const after = await snapshotOf(app);
        expect(after.floor).toEqual(before.floor);
        expect(after.floor.version).toBe(before.floor.version);
        expect(after.history).toEqual(before.history);
      });
    },
  );

  it('a rejected action is not counted: the next accepted one is version + 1', async () => {
    const before = await getFloor(app);
    await mustReject(app, { type: 'REMOVE_ROBOT', id: 'R9' });
    await mustReject(app, { type: 'CREATE_FLOOR', width: 0, height: 0 });
    const ok = await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    expect(ok.floor.version).toBe(before.version + 1);
  });

  it('a rejected auto PLACE does not consume an id', async () => {
    await mustOk(app, { type: 'SET_OBSTACLE', x: 1, y: 1, present: true });
    await mustReject(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    const ok = await mustOk(app, { type: 'PLACE_ROBOT', x: 2, y: 2, facing: 'NORTH' });
    expect(ok.floor.state.robots.map((r) => r.id)).toEqual(['R1']);
  });
});

// ---------------------------------------------------------------------------
// Malformed bodies (400)
// ---------------------------------------------------------------------------

describe('commands: malformed bodies (400)', () => {
  const malformedActions: readonly (readonly [string, unknown])[] = [
    ['unknown action type', { type: 'TELEPORT', x: 1, y: 1 }],
    ['action without a type', { x: 1, y: 1 }],
    ['non-string type', { type: 7 }],
    ['CREATE_FLOOR with string width', { type: 'CREATE_FLOOR', width: '5', height: 5 }],
    ['CREATE_FLOOR missing height', { type: 'CREATE_FLOOR', width: 5 }],
    ['CREATE_FLOOR with null width', { type: 'CREATE_FLOOR', width: null, height: 5 }],
    ['PLACE_ROBOT with string x', { type: 'PLACE_ROBOT', x: '1', y: 1, facing: 'NORTH' }],
    ['PLACE_ROBOT missing y', { type: 'PLACE_ROBOT', x: 1, facing: 'NORTH' }],
    ['PLACE_ROBOT with a bad facing', { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'UP' }],
    ['PLACE_ROBOT with lower-case facing', { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'north' }],
    ['PLACE_ROBOT missing facing', { type: 'PLACE_ROBOT', x: 1, y: 1 }],
    ['PLACE_ROBOT with a numeric id', { type: 'PLACE_ROBOT', id: 1, x: 1, y: 1, facing: 'NORTH' }],
    ['REMOVE_ROBOT without id', { type: 'REMOVE_ROBOT' }],
    ['REMOVE_ROBOT with numeric id', { type: 'REMOVE_ROBOT', id: 1 }],
    ['SET_OBSTACLE with string present', { type: 'SET_OBSTACLE', x: 1, y: 1, present: 'yes' }],
    ['SET_OBSTACLE without present', { type: 'SET_OBSTACLE', x: 1, y: 1 }],
    ['TOGGLE_OBSTACLE with string y', { type: 'TOGGLE_OBSTACLE', x: 1, y: 'a' }],
    ['QUEUE_COMMANDS without commands', { type: 'QUEUE_COMMANDS', id: 'R1' }],
    ['QUEUE_COMMANDS with string commands', { type: 'QUEUE_COMMANDS', id: 'R1', commands: 'MOVE' }],
    [
      'QUEUE_COMMANDS with a bare-string command',
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: ['MOVE'] },
    ],
    [
      'QUEUE_COMMANDS with a command lacking kind',
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ x: 1 }] },
    ],
    [
      'QUEUE_COMMANDS with a numeric kind',
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 1 }] },
    ],
    [
      'QUEUE_COMMANDS with a GOTO missing y',
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x: 1 }] },
    ],
    [
      'QUEUE_COMMANDS with a GOTO with string x',
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x: '1', y: 1 }] },
    ],
    ['QUEUE_COMMANDS without id', { type: 'QUEUE_COMMANDS', commands: [{ kind: 'MOVE' }] }],
    ['CLEAR_QUEUE without id', { type: 'CLEAR_QUEUE' }],
  ];

  const malformedBodies: readonly (readonly [
    string,
    (url: string) => Promise<{ status: number }>,
  ])[] = [
    ['an empty body', (url) => http(app).post(url).send()],
    ['an empty object', (url) => http(app).post(url).send({})],
    ['{"action": null}', (url) => http(app).post(url).send({ action: null })],
    ['an action that is a string', (url) => http(app).post(url).send({ action: 'TICK' })],
    ['an action that is a number', (url) => http(app).post(url).send({ action: 5 })],
    [
      'an action that is an array',
      (url) =>
        http(app)
          .post(url)
          .send({ action: [{ type: 'TICK' }] }),
    ],
    ['a bare action without the wrapper', (url) => http(app).post(url).send({ type: 'TICK' })],
    [
      'a JSON array',
      (url) =>
        http(app)
          .post(url)
          .send([{ type: 'TICK' }]),
    ],
    [
      'a JSON null',
      (url) => http(app).post(url).set('Content-Type', 'application/json').send('null'),
    ],
    [
      'invalid JSON',
      (url) => http(app).post(url).set('Content-Type', 'application/json').send('{"action": {'),
    ],
    [
      'plain text',
      (url) => http(app).post(url).set('Content-Type', 'text/plain').send('PLACE R1 1 1 NORTH'),
    ],
    [
      'valid JSON sent as text/plain',
      (url) =>
        http(app).post(url).set('Content-Type', 'text/plain').send('{"action":{"type":"TICK"}}'),
    ],
  ];

  async function expectNothingChanged(send: () => Promise<{ status: number }>): Promise<void> {
    await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    const before = await snapshotOf(app);
    const res = await send();
    expect(res.status).toBe(400);
    const after = await snapshotOf(app);
    expect(after.floor).toEqual(before.floor);
    expect(after.history).toEqual(before.history);
  }

  it.each(malformedActions.map(([name, action]) => [name, action] as const))(
    'rejects %s with 400 and changes nothing',
    async (_name, action) => {
      await expectNothingChanged(() => http(app).post(commandsUrl).send({ action }));
    },
  );

  it.each(malformedBodies.map(([name, send]) => [name, send] as const))(
    'rejects %s with 400 and changes nothing',
    async (_name, send) => {
      await expectNothingChanged(() => send(commandsUrl));
    },
  );

  it('a 400 is not a 409: it has no rejection reason', async () => {
    const res = await http(app)
      .post(commandsUrl)
      .send({ action: { type: 'TELEPORT' } });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('reason');
    expect(res.body).not.toHaveProperty('floor');
  });

  it('a malformed request does not consume a version', async () => {
    const before = await getFloor(app);
    await http(app).post(commandsUrl).send({ action: null });
    const ok = await mustOk(app, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' });
    expect(ok.floor.version).toBe(before.version + 1);
  });

  it('POST /step has no body to get wrong: it ticks regardless of what is sent', async () => {
    const before = await getFloor(app);
    const res = await postStep(app);
    expect(res.status).toBe(200);
    expect((res.body as CommandSuccess).floor.version).toBe(before.version + 1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency (Module D): requests are applied one at a time, in arrival order.
// ---------------------------------------------------------------------------

describe('commands: concurrent requests', () => {
  beforeEach(async () => {
    await listenOnLoopback(app);
  });

  it('two simultaneous PLACEs on one cell: exactly one 200 and one 409 CELL_OCCUPIED', async () => {
    const start = await getFloor(app);
    const [a, b] = await Promise.all([
      post(app, { type: 'PLACE_ROBOT', x: 3, y: 3, facing: 'NORTH' }),
      post(app, { type: 'PLACE_ROBOT', x: 3, y: 3, facing: 'SOUTH' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = (a.status === 409 ? a : b).body as CommandRejected;
    const winner = (a.status === 200 ? a : b).body as CommandSuccess;
    expect(loser.reason).toBe('CELL_OCCUPIED');
    // The loser is told the authoritative floor: the one the winner produced.
    expect(loser.floor).toEqual(winner.floor);
    expect(loser.floor.version).toBe(start.version + 1);

    const end = await getFloor(app);
    expect(end).toEqual(winner.floor);
    expect(end.state.robots).toHaveLength(1);
    expect(end.state.robots[0]).toMatchObject({ id: 'R1', x: 3, y: 3 });
    expect((await getHistory(app)).filter((h) => h.event.type === 'ROBOT_PLACED')).toHaveLength(1);
  });

  it('ten simultaneous PLACEs on distinct cells: versions 2..11, ids R1..R10, no gaps or repeats', async () => {
    const start = await getFloor(app);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, x) =>
        post(app, { type: 'PLACE_ROBOT', x, y: 0, facing: 'NORTH' }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => 200));
    const bodies = responses.map((r) => r.body as CommandSuccess);

    const versions = bodies.map((b) => b.floor.version).sort((p, q) => p - q);
    expect(versions).toEqual(Array.from({ length: 10 }, (_, i) => start.version + 1 + i));

    // Each response's history holds exactly the one robot it placed, with that response's id.
    const ids = bodies
      .map((b) => {
        const event = b.history[0]?.event;
        return event?.type === 'ROBOT_PLACED' ? event.id : null;
      })
      .map((id) => Number(id?.slice(1)))
      .sort((p, q) => p - q);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const end = await getFloor(app);
    expect(end.version).toBe(start.version + 10);
    expect(end.state.robots.map((r) => r.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `R${i + 1}`),
    );
    expect(end.state.nextRobotNum).toBe(11);
    // Distinct cells, each robot where its own request put it.
    expect(new Set(end.state.robots.map((r) => `${r.x},${r.y}`)).size).toBe(10);

    const history = await getHistory(app);
    const placed = history.filter((h) => h.event.type === 'ROBOT_PLACED');
    expect(placed.map((h) => h.version)).toEqual(
      Array.from({ length: 10 }, (_, i) => start.version + 1 + i),
    );
  });

  it('steps and edits fired together are still applied one at a time', async () => {
    await mustOk(app, { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' });
    const start = await getFloor(app);
    const responses = await Promise.all([
      postStep(app),
      postStep(app),
      post(app, { type: 'SET_OBSTACLE', x: 5, y: 5, present: true }),
      postStep(app),
      post(app, { type: 'TOGGLE_OBSTACLE', x: 6, y: 6 }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const versions = responses
      .map((r) => (r.body as CommandSuccess).floor.version)
      .sort((p, q) => p - q);
    expect(versions).toEqual([1, 2, 3, 4, 5].map((n) => start.version + n));
    const end = await getFloor(app);
    expect(end.state.tick).toBe(start.state.tick + 3);
    expect(end.state.obstacles).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 6 },
    ]);
  });
});
