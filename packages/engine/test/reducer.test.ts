/**
 * Reducer tests: every action type, every RejectionReason, auto-ID rules (DECISIONS 5.2),
 * re-PLACE (4.4), atomic QUEUE_COMMANDS, immutability, and "state unchanged on rejection".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  apply,
  createFloorState,
  type Action,
  type Command,
  type FloorState,
  type RejectionReason,
} from '../src/index.js';
import { buildFloor, cmds, deepFreeze, ok, queue, rejected, robot, robotOf } from './helpers.js';

/** Asserts a rejection with a frozen input: proves the rejected action neither throws nor mutates. */
function expectRejection(state: FloorState, action: Action, reason: RejectionReason): void {
  const snapshot = structuredClone(state);
  const frozen = deepFreeze(structuredClone(state));
  const res = apply(frozen, deepFreeze(structuredClone(action)));
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.reason).toBe(reason);
    expect(typeof res.message).toBe('string');
    expect(res.message.length).toBeGreaterThan(0);
  }
  expect(frozen).toEqual(snapshot);
}

describe('createFloorState', () => {
  it('builds a blank floor', () => {
    expect(createFloorState(4, 3)).toEqual({
      width: 4,
      height: 3,
      obstacles: [],
      robots: [],
      nextRobotNum: 1,
      tick: 0,
    });
  });
});

describe('CREATE_FLOOR', () => {
  it.each([
    [1, 1],
    [20, 20],
    [10, 8],
    [5, 5],
    [1, 20],
    [20, 1],
  ])('accepts %i x %i and yields a blank floor', (width, height) => {
    const res = ok(createFloorState(3, 3), { type: 'CREATE_FLOOR', width, height });
    expect(res.state).toEqual(createFloorState(width, height));
    expect(res.events).toEqual([{ type: 'FLOOR_CREATED', width, height }]);
  });

  it('replaces the whole world: robots, obstacles, queues and tick count are cleared', () => {
    let s = buildFloor(4, 4, [robot('R1', 0, 0, 'EAST', 'MOVE')], [[3, 3]]);
    s = ok(s, { type: 'TICK' }).state;
    expect(s.tick).toBe(1);
    const fresh = ok(s, { type: 'CREATE_FLOOR', width: 6, height: 2 }).state;
    expect(fresh.robots).toEqual([]);
    expect(fresh.obstacles).toEqual([]);
    expect(fresh.tick).toBe(0);
    expect(fresh.width).toBe(6);
    expect(fresh.height).toBe(2);
  });

  it('resets the auto-ID high-water mark on a new floor', () => {
    // GAP: DECISIONS does not say whether CREATE_FLOOR resets nextRobotNum. A "blank floor" is read
    // literally: it is identical to createFloorState(w, h), so the next auto robot is R1 again.
    let s = buildFloor(4, 4);
    s = ok(s, { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' }).state;
    s = ok(s, { type: 'PLACE_ROBOT', x: 1, y: 0, facing: 'NORTH' }).state;
    expect(s.nextRobotNum).toBe(3);
    const fresh = ok(s, { type: 'CREATE_FLOOR', width: 4, height: 4 }).state;
    expect(fresh).toEqual(createFloorState(4, 4));
  });

  it.each([
    [0, 5],
    [5, 0],
    [21, 5],
    [5, 21],
    [-1, 5],
    [5, -3],
    [2.5, 5],
    [5, 2.5],
    [Number.NaN, 5],
    [5, Number.POSITIVE_INFINITY],
    [0, 0],
    [100, 100],
  ])('rejects %s x %s with INVALID_SIZE', (width, height) => {
    expectRejection(
      buildFloor(3, 3, [robot('R1', 0, 0, 'NORTH')]),
      { type: 'CREATE_FLOOR', width, height },
      'INVALID_SIZE',
    );
  });
});

describe('PLACE_ROBOT', () => {
  it('places an explicit-ID robot with an empty queue and zero GOTO counter', () => {
    const res = ok(buildFloor(5, 5), { type: 'PLACE_ROBOT', id: 'R7', x: 2, y: 3, facing: 'WEST' });
    expect(res.state.robots).toEqual([
      { id: 'R7', num: 7, x: 2, y: 3, facing: 'WEST', queue: [], gotoNoPathTicks: 0 },
    ]);
    expect(res.events).toEqual([
      { type: 'ROBOT_PLACED', id: 'R7', x: 2, y: 3, facing: 'WEST', replaced: false },
    ]);
  });

  it('does not touch the tick counter', () => {
    const s = ok(buildFloor(5, 5), {
      type: 'PLACE_ROBOT',
      id: 'R1',
      x: 0,
      y: 0,
      facing: 'NORTH',
    }).state;
    expect(s.tick).toBe(0);
  });

  it('accepts all four corners of the floor', () => {
    let s = buildFloor(4, 3);
    s = ok(s, { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'NORTH' }).state;
    s = ok(s, { type: 'PLACE_ROBOT', id: 'R2', x: 3, y: 0, facing: 'NORTH' }).state;
    s = ok(s, { type: 'PLACE_ROBOT', id: 'R3', x: 0, y: 2, facing: 'NORTH' }).state;
    s = ok(s, { type: 'PLACE_ROBOT', id: 'R4', x: 3, y: 2, facing: 'NORTH' }).state;
    expect(s.robots.map((r) => `${r.x},${r.y}`)).toEqual(['0,0', '3,0', '0,2', '3,2']);
  });

  it('keeps robots sorted by number whatever the placement order (R10 after R2)', () => {
    let s = buildFloor(5, 5);
    for (const [id, x] of [
      ['R10', 0],
      ['R2', 1],
      ['R1', 2],
      ['R33', 3],
      ['R3', 4],
    ] as const) {
      s = ok(s, { type: 'PLACE_ROBOT', id, x, y: 0, facing: 'NORTH' }).state;
    }
    expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R10', 'R33']);
    expect(s.robots.map((r) => r.num)).toEqual([1, 2, 3, 10, 33]);
  });

  describe('auto-assigned IDs (DECISIONS 5.2: max + 1, high-water mark)', () => {
    const auto = (s: FloorState, x: number, y = 0) =>
      ok(s, { type: 'PLACE_ROBOT', x, y, facing: 'NORTH' });

    it('first auto robot is R1, then R2, R3', () => {
      let s = buildFloor(5, 5);
      const ids: string[] = [];
      for (let x = 0; x < 3; x++) {
        const r = auto(s, x);
        s = r.state;
        const ev = r.events[0];
        if (ev?.type !== 'ROBOT_PLACED') throw new Error('expected ROBOT_PLACED');
        ids.push(ev.id);
      }
      expect(ids).toEqual(['R1', 'R2', 'R3']);
      expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R2', 'R3']);
    });

    it('with R1 and R3 on the floor the next auto robot is R4, not R2', () => {
      let s = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH'), robot('R3', 1, 0, 'NORTH')]);
      s = auto(s, 2).state;
      expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R3', 'R4']);
    });

    it('explicit placement raises the high-water mark: R10 then auto gives R11', () => {
      let s = buildFloor(5, 5, [robot('R10', 0, 0, 'NORTH')]);
      expect(s.nextRobotNum).toBe(11);
      s = auto(s, 1).state;
      expect(s.robots.map((r) => r.id)).toEqual(['R10', 'R11']);
    });

    it('placing a lower explicit ID later does not lower the mark', () => {
      let s = buildFloor(5, 5, [robot('R5', 0, 0, 'NORTH'), robot('R2', 1, 0, 'NORTH')]);
      expect(s.nextRobotNum).toBe(6);
      s = auto(s, 2).state;
      expect(s.robots.map((r) => r.id)).toEqual(['R2', 'R5', 'R6']);
    });

    it('removing the highest robot does not free its ID', () => {
      let s = buildFloor(5, 5);
      for (let x = 0; x < 3; x++) s = auto(s, x).state; // R1 R2 R3
      s = ok(s, { type: 'REMOVE_ROBOT', id: 'R3' }).state;
      s = auto(s, 3).state;
      expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R2', 'R4']);
    });

    it('removing every robot still never reuses IDs', () => {
      let s = buildFloor(5, 5);
      for (let x = 0; x < 2; x++) s = auto(s, x).state; // R1 R2
      s = ok(s, { type: 'REMOVE_ROBOT', id: 'R1' }).state;
      s = ok(s, { type: 'REMOVE_ROBOT', id: 'R2' }).state;
      expect(s.robots).toEqual([]);
      s = auto(s, 0).state;
      expect(s.robots.map((r) => r.id)).toEqual(['R3']);
    });

    it('a rejected auto placement does not consume an ID', () => {
      let s = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH')]);
      expect(rejected(s, { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'EAST' })).toBe(
        'CELL_OCCUPIED',
      );
      expect(rejected(s, { type: 'PLACE_ROBOT', x: 9, y: 0, facing: 'EAST' })).toBe(
        'OUT_OF_BOUNDS',
      );
      s = auto(s, 1).state;
      expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R2']);
    });

    it('re-placing an existing robot does not advance the mark', () => {
      let s = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH')]);
      s = ok(s, { type: 'PLACE_ROBOT', id: 'R1', x: 3, y: 3, facing: 'SOUTH' }).state;
      expect(s.nextRobotNum).toBe(2);
    });
  });

  describe('re-PLACE of an existing robot (DECISIONS 4.4)', () => {
    it('moves and re-faces the robot, keeps its queue, flags replaced', () => {
      let s = buildFloor(5, 5, [robot('R1', 0, 0, 'EAST', 'MOVE LEFT MOVE')]);
      const res = ok(s, { type: 'PLACE_ROBOT', id: 'R1', x: 3, y: 2, facing: 'SOUTH' });
      s = res.state;
      expect(s.robots).toHaveLength(1);
      expect(robotOf(s, 'R1')).toMatchObject({ x: 3, y: 2, facing: 'SOUTH', gotoNoPathTicks: 0 });
      expect(robotOf(s, 'R1').queue).toEqual(cmds('MOVE LEFT MOVE'));
      expect(res.events).toEqual([
        { type: 'ROBOT_PLACED', id: 'R1', x: 3, y: 2, facing: 'SOUTH', replaced: true },
      ]);
    });

    it('allows placing a robot onto its own cell to change facing', () => {
      let s = buildFloor(5, 5, [robot('R1', 2, 2, 'NORTH', 'MOVE')]);
      s = ok(s, { type: 'PLACE_ROBOT', id: 'R1', x: 2, y: 2, facing: 'WEST' }).state;
      expect(robotOf(s, 'R1')).toMatchObject({ x: 2, y: 2, facing: 'WEST' });
      expect(robotOf(s, 'R1').queue).toEqual(cmds('MOVE'));
    });

    it('rejects a re-PLACE onto another robot and leaves the robot where it was', () => {
      const s = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH'), robot('R2', 1, 0, 'NORTH')]);
      expectRejection(
        s,
        { type: 'PLACE_ROBOT', id: 'R1', x: 1, y: 0, facing: 'EAST' },
        'CELL_OCCUPIED',
      );
    });

    it('rejects a re-PLACE off the floor or onto an obstacle', () => {
      const s = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH')], [[4, 4]]);
      expectRejection(
        s,
        { type: 'PLACE_ROBOT', id: 'R1', x: 5, y: 0, facing: 'EAST' },
        'OUT_OF_BOUNDS',
      );
      expectRejection(
        s,
        { type: 'PLACE_ROBOT', id: 'R1', x: 4, y: 4, facing: 'EAST' },
        'CELL_IS_OBSTACLE',
      );
    });

    it('frees the old cell for another robot', () => {
      let s = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH')]);
      s = ok(s, { type: 'PLACE_ROBOT', id: 'R1', x: 1, y: 1, facing: 'NORTH' }).state;
      s = ok(s, { type: 'PLACE_ROBOT', id: 'R2', x: 0, y: 0, facing: 'NORTH' }).state;
      expect(s.robots.map((r) => `${r.id}@${r.x},${r.y}`)).toEqual(['R1@1,1', 'R2@0,0']);
    });
  });

  describe('rejections', () => {
    let base: FloorState;
    beforeEach(() => {
      base = buildFloor(4, 3, [robot('R1', 1, 1, 'NORTH')], [[2, 2]]);
    });

    it.each([
      [-1, 0],
      [0, -1],
      [4, 0],
      [0, 3],
      [4, 3],
      [100, 100],
    ])('OUT_OF_BOUNDS for (%i,%i) on a 4x3 floor', (x, y) => {
      expectRejection(
        base,
        { type: 'PLACE_ROBOT', id: 'R5', x, y, facing: 'NORTH' },
        'OUT_OF_BOUNDS',
      );
      expectRejection(base, { type: 'PLACE_ROBOT', x, y, facing: 'NORTH' }, 'OUT_OF_BOUNDS');
    });

    it('CELL_IS_OBSTACLE when the cell holds an obstacle', () => {
      expectRejection(
        base,
        { type: 'PLACE_ROBOT', id: 'R5', x: 2, y: 2, facing: 'NORTH' },
        'CELL_IS_OBSTACLE',
      );
      expectRejection(
        base,
        { type: 'PLACE_ROBOT', x: 2, y: 2, facing: 'NORTH' },
        'CELL_IS_OBSTACLE',
      );
    });

    it('CELL_OCCUPIED when another robot holds the cell', () => {
      expectRejection(
        base,
        { type: 'PLACE_ROBOT', id: 'R5', x: 1, y: 1, facing: 'EAST' },
        'CELL_OCCUPIED',
      );
      expectRejection(base, { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'EAST' }, 'CELL_OCCUPIED');
    });

    it.each(['R0', 'X1', 'R', '', '1', 'R-1', 'R1.5', 'RR1', 'R 1', 'R1x'])(
      'INVALID_ID for malformed id %j',
      (id) => {
        expectRejection(
          base,
          { type: 'PLACE_ROBOT', id, x: 0, y: 0, facing: 'NORTH' },
          'INVALID_ID',
        );
      },
    );

    it('rejects non-integer coordinates (some rejection; the reason is not specified)', () => {
      // GAP: DECISIONS does not say which reason a fractional coordinate gets.
      expect(
        rejected(base, { type: 'PLACE_ROBOT', id: 'R5', x: 0.5, y: 0, facing: 'NORTH' }),
      ).toBeTypeOf('string');
      expect(
        rejected(base, { type: 'PLACE_ROBOT', id: 'R5', x: Number.NaN, y: 0, facing: 'NORTH' }),
      ).toBeTypeOf('string');
    });
  });
});

describe('REMOVE_ROBOT', () => {
  let base: FloorState;
  beforeEach(() => {
    base = buildFloor(5, 5, [
      robot('R1', 0, 0, 'NORTH', 'MOVE'),
      robot('R2', 1, 0, 'NORTH'),
      robot('R3', 2, 0, 'NORTH'),
    ]);
  });

  it('removes only the named robot and emits ROBOT_REMOVED', () => {
    const res = ok(base, { type: 'REMOVE_ROBOT', id: 'R2' });
    expect(res.state.robots.map((r) => r.id)).toEqual(['R1', 'R3']);
    expect(robotOf(res.state, 'R1').queue).toEqual(cmds('MOVE'));
    expect(res.events).toEqual([{ type: 'ROBOT_REMOVED', id: 'R2' }]);
  });

  it('frees the cell and keeps the high-water mark', () => {
    let s = ok(base, { type: 'REMOVE_ROBOT', id: 'R3' }).state;
    expect(s.nextRobotNum).toBe(4);
    s = ok(s, { type: 'PLACE_ROBOT', id: 'R9', x: 2, y: 0, facing: 'EAST' }).state;
    expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R2', 'R9']);
  });

  it('UNKNOWN_ROBOT for a well-formed id that is not on the floor', () => {
    expectRejection(base, { type: 'REMOVE_ROBOT', id: 'R9' }, 'UNKNOWN_ROBOT');
  });

  it('UNKNOWN_ROBOT after the robot was already removed', () => {
    const s = ok(base, { type: 'REMOVE_ROBOT', id: 'R1' }).state;
    expectRejection(s, { type: 'REMOVE_ROBOT', id: 'R1' }, 'UNKNOWN_ROBOT');
  });

  it('INVALID_ID for a malformed id', () => {
    // GAP: a malformed id could also be reported as UNKNOWN_ROBOT; INVALID_ID is read as "malformed".
    expectRejection(base, { type: 'REMOVE_ROBOT', id: 'R0' }, 'INVALID_ID');
  });
});

describe('SET_OBSTACLE', () => {
  let base: FloorState;
  beforeEach(() => {
    base = buildFloor(4, 4, [robot('R1', 0, 0, 'NORTH')]);
  });

  it('adds an obstacle and emits OBSTACLE_SET', () => {
    const res = ok(base, { type: 'SET_OBSTACLE', x: 2, y: 1, present: true });
    expect(res.state.obstacles).toEqual([{ x: 2, y: 1 }]);
    expect(res.events).toContainEqual({ type: 'OBSTACLE_SET', x: 2, y: 1, present: true });
  });

  it('keeps obstacles sorted by x then y', () => {
    let s = base;
    for (const [x, y] of [
      [2, 1],
      [0, 3],
      [2, 0],
      [0, 1],
      [3, 3],
    ] as const) {
      s = ok(s, { type: 'SET_OBSTACLE', x, y, present: true }).state;
    }
    expect(s.obstacles).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 3 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 3 },
    ]);
  });

  it('setting an existing obstacle again is a successful no-op', () => {
    const once = ok(base, { type: 'SET_OBSTACLE', x: 2, y: 1, present: true }).state;
    const twice = ok(once, { type: 'SET_OBSTACLE', x: 2, y: 1, present: true }).state;
    expect(twice).toEqual(once);
    expect(twice.obstacles).toHaveLength(1);
  });

  it('present:false removes the obstacle', () => {
    const once = ok(base, { type: 'SET_OBSTACLE', x: 2, y: 1, present: true }).state;
    const res = ok(once, { type: 'SET_OBSTACLE', x: 2, y: 1, present: false });
    expect(res.state.obstacles).toEqual([]);
  });

  it('present:false where there is no obstacle is a successful no-op', () => {
    expect(ok(base, { type: 'SET_OBSTACLE', x: 3, y: 3, present: false }).state).toEqual(base);
  });

  it('present:false on a robot cell is a successful no-op', () => {
    expect(ok(base, { type: 'SET_OBSTACLE', x: 0, y: 0, present: false }).state).toEqual(base);
  });

  it('CELL_OCCUPIED when placing an obstacle on a robot', () => {
    expectRejection(base, { type: 'SET_OBSTACLE', x: 0, y: 0, present: true }, 'CELL_OCCUPIED');
  });

  it.each([
    [-1, 0],
    [0, -1],
    [4, 0],
    [0, 4],
  ])('OUT_OF_BOUNDS for (%i,%i)', (x, y) => {
    expectRejection(base, { type: 'SET_OBSTACLE', x, y, present: true }, 'OUT_OF_BOUNDS');
    expectRejection(base, { type: 'SET_OBSTACLE', x, y, present: false }, 'OUT_OF_BOUNDS');
  });

  it('does not change the tick counter or robots', () => {
    const s = ok(base, { type: 'SET_OBSTACLE', x: 1, y: 1, present: true }).state;
    expect(s.tick).toBe(0);
    expect(s.robots).toEqual(base.robots);
  });
});

describe('TOGGLE_OBSTACLE', () => {
  let base: FloorState;
  beforeEach(() => {
    base = buildFloor(3, 3, [robot('R1', 0, 0, 'NORTH')]);
  });

  it('toggles on, then off', () => {
    const on = ok(base, { type: 'TOGGLE_OBSTACLE', x: 1, y: 2 });
    expect(on.state.obstacles).toEqual([{ x: 1, y: 2 }]);
    // GAP: the event shape for a toggle is not spelled out; OBSTACLE_SET with the new value is the
    // only obstacle event in the contract.
    expect(on.events).toContainEqual({ type: 'OBSTACLE_SET', x: 1, y: 2, present: true });
    const off = ok(on.state, { type: 'TOGGLE_OBSTACLE', x: 1, y: 2 });
    expect(off.state).toEqual(base);
    expect(off.events).toContainEqual({ type: 'OBSTACLE_SET', x: 1, y: 2, present: false });
  });

  it('keeps the obstacle list sorted', () => {
    let s = base;
    for (const [x, y] of [
      [2, 2],
      [0, 1],
      [2, 0],
    ] as const) {
      s = ok(s, { type: 'TOGGLE_OBSTACLE', x, y }).state;
    }
    expect(s.obstacles).toEqual([
      { x: 0, y: 1 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it('CELL_OCCUPIED on a robot, OUT_OF_BOUNDS off the floor', () => {
    expectRejection(base, { type: 'TOGGLE_OBSTACLE', x: 0, y: 0 }, 'CELL_OCCUPIED');
    expectRejection(base, { type: 'TOGGLE_OBSTACLE', x: 3, y: 0 }, 'OUT_OF_BOUNDS');
    expectRejection(base, { type: 'TOGGLE_OBSTACLE', x: 0, y: -1 }, 'OUT_OF_BOUNDS');
  });
});

describe('QUEUE_COMMANDS', () => {
  let base: FloorState;
  beforeEach(() => {
    base = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH'), robot('R2', 1, 1, 'EAST')], [[4, 4]]);
  });

  it('appends to an empty queue and emits COMMANDS_QUEUED', () => {
    const commands = cmds('MOVE LEFT RIGHT');
    const res = ok(base, { type: 'QUEUE_COMMANDS', id: 'R1', commands });
    expect(robotOf(res.state, 'R1').queue).toEqual(commands);
    expect(robotOf(res.state, 'R2').queue).toEqual([]);
    expect(res.events).toEqual([{ type: 'COMMANDS_QUEUED', id: 'R1', commands }]);
  });

  it('appends after existing commands, preserving order', () => {
    let s = queue(base, 'R1', 'MOVE');
    s = queue(s, 'R1', 'LEFT MOVE');
    s = queue(s, 'R1', 'RIGHT');
    expect(robotOf(s, 'R1').queue).toEqual(cmds('MOVE LEFT MOVE RIGHT'));
  });

  it('does not move the robot or advance the tick', () => {
    const s = queue(base, 'R1', 'MOVE MOVE');
    expect(s.tick).toBe(0);
    expect(robotOf(s, 'R1')).toMatchObject({ x: 0, y: 0, facing: 'NORTH' });
  });

  describe('atomicity: if any command is invalid nothing is queued', () => {
    let prequeued: FloorState;
    beforeEach(() => {
      prequeued = queue(base, 'R1', 'MOVE');
    });

    it('a malformed command in the middle rejects the whole list', () => {
      const bad = [{ kind: 'MOVE' }, { kind: 'JUMP' }, { kind: 'LEFT' }] as unknown as Command[];
      expectRejection(
        prequeued,
        { type: 'QUEUE_COMMANDS', id: 'R1', commands: bad },
        'INVALID_COMMAND',
      );
    });

    it('a bad GOTO after valid commands rejects the whole list', () => {
      const commands = [...cmds('MOVE LEFT'), { kind: 'GOTO', x: 9, y: 9 } as const];
      expectRejection(
        prequeued,
        { type: 'QUEUE_COMMANDS', id: 'R1', commands },
        'INVALID_GOTO_TARGET',
      );
    });

    it('a bad GOTO before valid commands rejects the whole list', () => {
      const commands = [{ kind: 'GOTO', x: -1, y: 0 } as const, ...cmds('MOVE')];
      expectRejection(
        prequeued,
        { type: 'QUEUE_COMMANDS', id: 'R1', commands },
        'INVALID_GOTO_TARGET',
      );
    });

    it('after a rejected list the queue is exactly what it was', () => {
      const commands = [...cmds('RIGHT'), { kind: 'GOTO', x: 4, y: 4 } as const]; // (4,4) is an obstacle
      expect(rejected(prequeued, { type: 'QUEUE_COMMANDS', id: 'R1', commands })).toBe(
        'INVALID_GOTO_TARGET',
      );
      expect(robotOf(prequeued, 'R1').queue).toEqual(cmds('MOVE'));
    });
  });

  it('INVALID_COMMAND for an empty list', () => {
    expectRejection(base, { type: 'QUEUE_COMMANDS', id: 'R1', commands: [] }, 'INVALID_COMMAND');
  });

  it('INVALID_COMMAND for an unknown command kind', () => {
    const commands = [{ kind: 'JUMP' }] as unknown as Command[];
    expectRejection(base, { type: 'QUEUE_COMMANDS', id: 'R1', commands }, 'INVALID_COMMAND');
  });

  it('UNKNOWN_ROBOT for a robot that is not on the floor', () => {
    expectRejection(
      base,
      { type: 'QUEUE_COMMANDS', id: 'R7', commands: cmds('MOVE') },
      'UNKNOWN_ROBOT',
    );
  });

  it('INVALID_ID for a malformed robot id', () => {
    // GAP: see REMOVE_ROBOT; INVALID_ID is read as "malformed".
    expectRejection(
      base,
      { type: 'QUEUE_COMMANDS', id: 'R0', commands: cmds('MOVE') },
      'INVALID_ID',
    );
  });

  describe('GOTO target validation (queue time, DECISIONS 3.2)', () => {
    it.each([
      [0, 0],
      [3, 3],
      [4, 0],
      [0, 4],
    ])('accepts a valid target (%i,%i)', (x, y) => {
      const res = ok(base, {
        type: 'QUEUE_COMMANDS',
        id: 'R1',
        commands: [{ kind: 'GOTO', x, y }],
      });
      expect(robotOf(res.state, 'R1').queue).toEqual([{ kind: 'GOTO', x, y }]);
    });

    it('accepts a target that holds another robot (it may move away)', () => {
      const res = ok(base, {
        type: 'QUEUE_COMMANDS',
        id: 'R1',
        commands: [{ kind: 'GOTO', x: 1, y: 1 }],
      });
      expect(robotOf(res.state, 'R1').queue).toEqual([{ kind: 'GOTO', x: 1, y: 1 }]);
    });

    it("accepts a target equal to the robot's own cell", () => {
      const res = ok(base, {
        type: 'QUEUE_COMMANDS',
        id: 'R1',
        commands: [{ kind: 'GOTO', x: 0, y: 0 }],
      });
      expect(robotOf(res.state, 'R1').queue).toEqual([{ kind: 'GOTO', x: 0, y: 0 }]);
    });

    it('accepts GOTO mixed with other commands, order preserved', () => {
      const commands = [...cmds('MOVE'), { kind: 'GOTO', x: 2, y: 2 } as const, ...cmds('LEFT')];
      const res = ok(base, { type: 'QUEUE_COMMANDS', id: 'R1', commands });
      expect(robotOf(res.state, 'R1').queue).toEqual(commands);
    });

    it.each([
      [5, 0],
      [0, 5],
      [-1, 0],
      [0, -1],
      [99, 99],
    ])('rejects off-floor target (%i,%i)', (x, y) => {
      expectRejection(
        base,
        { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x, y }] },
        'INVALID_GOTO_TARGET',
      );
    });

    it('rejects an obstacle target', () => {
      expectRejection(
        base,
        { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x: 4, y: 4 }] },
        'INVALID_GOTO_TARGET',
      );
    });

    it.each([
      [1.5, 2],
      [2, 0.5],
      [Number.NaN, 1],
      [1, Number.POSITIVE_INFINITY],
    ])('rejects non-integer target (%s,%s)', (x, y) => {
      expectRejection(
        base,
        { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x, y }] },
        'INVALID_GOTO_TARGET',
      );
    });
  });
});

describe('CLEAR_QUEUE', () => {
  let base: FloorState;
  beforeEach(() => {
    base = buildFloor(5, 5, [
      robot('R1', 0, 0, 'NORTH', 'MOVE LEFT MOVE'),
      robot('R2', 1, 1, 'EAST', 'MOVE'),
    ]);
  });

  it('empties only that robot queue and emits QUEUE_CLEARED', () => {
    const res = ok(base, { type: 'CLEAR_QUEUE', id: 'R1' });
    expect(robotOf(res.state, 'R1').queue).toEqual([]);
    expect(robotOf(res.state, 'R2').queue).toEqual(cmds('MOVE'));
    expect(robotOf(res.state, 'R1')).toMatchObject({ x: 0, y: 0, facing: 'NORTH' });
    expect(res.events).toEqual([{ type: 'QUEUE_CLEARED', id: 'R1' }]);
  });

  it('clearing an empty queue succeeds', () => {
    const s = ok(base, { type: 'CLEAR_QUEUE', id: 'R1' }).state;
    expect(ok(s, { type: 'CLEAR_QUEUE', id: 'R1' }).state).toEqual(s);
  });

  it('the cleared robot is idle on the next tick', () => {
    const s = ok(base, { type: 'CLEAR_QUEUE', id: 'R1' }).state;
    const t = ok(s, { type: 'TICK' }).state;
    expect(robotOf(t, 'R1')).toMatchObject({ x: 0, y: 0, facing: 'NORTH' });
  });

  it('UNKNOWN_ROBOT for a missing robot, INVALID_ID for a malformed id', () => {
    expectRejection(base, { type: 'CLEAR_QUEUE', id: 'R8' }, 'UNKNOWN_ROBOT');
    // GAP: see REMOVE_ROBOT.
    expectRejection(base, { type: 'CLEAR_QUEUE', id: 'X1' }, 'INVALID_ID');
  });
});

describe('every RejectionReason is reachable', () => {
  it('covers the full contract vocabulary', () => {
    const s = buildFloor(3, 3, [robot('R1', 0, 0, 'NORTH')], [[2, 2]]);
    const seen = new Set<RejectionReason>([
      rejected(s, { type: 'CREATE_FLOOR', width: 0, height: 3 }),
      rejected(s, { type: 'PLACE_ROBOT', id: 'R0', x: 1, y: 1, facing: 'NORTH' }),
      rejected(s, { type: 'PLACE_ROBOT', id: 'R2', x: 3, y: 1, facing: 'NORTH' }),
      rejected(s, { type: 'PLACE_ROBOT', id: 'R2', x: 2, y: 2, facing: 'NORTH' }),
      rejected(s, { type: 'PLACE_ROBOT', id: 'R2', x: 0, y: 0, facing: 'NORTH' }),
      rejected(s, { type: 'REMOVE_ROBOT', id: 'R5' }),
      rejected(s, { type: 'QUEUE_COMMANDS', id: 'R1', commands: [] }),
      rejected(s, { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'GOTO', x: 2, y: 2 }] }),
    ]);
    const all: RejectionReason[] = [
      'INVALID_SIZE',
      'INVALID_ID',
      'OUT_OF_BOUNDS',
      'CELL_IS_OBSTACLE',
      'CELL_OCCUPIED',
      'UNKNOWN_ROBOT',
      'INVALID_COMMAND',
      'INVALID_GOTO_TARGET',
    ];
    expect([...seen].sort()).toEqual([...all].sort());
  });
});

describe('purity', () => {
  let rich: FloorState;
  beforeEach(() => {
    rich = buildFloor(
      5,
      5,
      [
        robot('R1', 0, 0, 'EAST', 'MOVE LEFT'),
        robot('R2', 3, 3, 'SOUTH', 'MOVE'),
        robot('R10', 1, 4, 'WEST'),
      ],
      [[4, 0]],
    );
  });
  const accepted: Action[] = [
    { type: 'CREATE_FLOOR', width: 7, height: 7 },
    { type: 'PLACE_ROBOT', x: 2, y: 2, facing: 'NORTH' },
    { type: 'PLACE_ROBOT', id: 'R3', x: 2, y: 3, facing: 'NORTH' },
    { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 1, facing: 'WEST' },
    { type: 'REMOVE_ROBOT', id: 'R2' },
    { type: 'SET_OBSTACLE', x: 2, y: 2, present: true },
    { type: 'SET_OBSTACLE', x: 4, y: 0, present: false },
    { type: 'TOGGLE_OBSTACLE', x: 1, y: 1 },
    { type: 'QUEUE_COMMANDS', id: 'R10', commands: cmds('MOVE RIGHT') },
    { type: 'CLEAR_QUEUE', id: 'R1' },
    { type: 'TICK' },
  ];

  it.each(accepted.map((a) => [a.type, a] as const))(
    '%s never mutates its (frozen) inputs',
    (_name, action) => {
      const snapshot = structuredClone(rich);
      const frozenState = deepFreeze(structuredClone(rich));
      const frozenAction = deepFreeze(structuredClone(action));
      const res = apply(frozenState, frozenAction);
      expect(res.ok).toBe(true);
      expect(frozenState).toEqual(snapshot);
    },
  );

  it('same input twice gives deep-equal output (determinism)', () => {
    for (const action of accepted) {
      expect(apply(rich, action)).toEqual(apply(structuredClone(rich), structuredClone(action)));
    }
  });

  it('works on a JSON round-tripped state (state is plain data)', () => {
    const viaJson = JSON.parse(JSON.stringify(rich)) as FloorState;
    expect(apply(viaJson, { type: 'TICK' })).toEqual(apply(rich, { type: 'TICK' }));
  });

  it('returned state is a different object than the input and also JSON-serializable', () => {
    const res = ok(rich, { type: 'TICK' });
    expect(res.state).not.toBe(rich);
    expect(JSON.parse(JSON.stringify(res.state))).toEqual(res.state);
  });
});
