import { describe, expect, it } from 'vitest';
import {
  apply,
  createFloorState,
  parseRobotNum,
  stepForward,
  turnLeft,
  turnRight,
} from '../../src/index.js';
import type { Action, BlockReason, Facing, FloorState, RobotTickResult } from '../../src/index.js';

/** Applies actions in order and fails the test if any is rejected. */
function run(state: FloorState, ...actions: Action[]): FloorState {
  let current = state;
  for (const action of actions) {
    const result = apply(current, action);
    if (!result.ok) {
      throw new Error(`${action.type} rejected: ${result.reason} (${result.message})`);
    }
    current = result.state;
  }
  return current;
}

function place(id: string, x: number, y: number, facing: Facing): Action {
  return { type: 'PLACE_ROBOT', id, x, y, facing };
}

function queue(id: string, ...kinds: Array<'MOVE' | 'LEFT' | 'RIGHT'>): Action {
  return { type: 'QUEUE_COMMANDS', id, commands: kinds.map((kind) => ({ kind })) };
}

function ticks(count: number): Action[] {
  return Array.from({ length: count }, () => ({ type: 'TICK' }) as const);
}

function report(state: FloorState): string[] {
  return state.robots.map((r) => `${r.id} ${r.x},${r.y},${r.facing}`);
}

/** Runs one tick and returns each robot's block reason (or outcome when not blocked). */
function tickOutcomes(state: FloorState): Record<string, string> {
  const result = apply(state, { type: 'TICK' });
  if (!result.ok) throw new Error('tick rejected');
  const event = result.events[0];
  if (event?.type !== 'TICK_RESOLVED') throw new Error('no tick event');
  return Object.fromEntries(
    event.results.map((r: RobotTickResult) => [
      r.id,
      r.outcome === 'BLOCKED' ? (r.reason as BlockReason) : r.outcome,
    ]),
  );
}

const floor5 = createFloorState(5, 5);

describe('geometry', () => {
  it('parses robot ids', () => {
    expect(parseRobotNum('R01')).toBe(1);
    expect(parseRobotNum('r7')).toBe(7);
    for (const bad of [
      'R0',
      'R00',
      'R',
      'X1',
      'R1a',
      'R-1',
      ' R1',
      'R1 ',
      'R1\n',
      'R9007199254740993',
    ]) {
      expect(parseRobotNum(bad)).toBeNull();
    }
    expect(parseRobotNum('R9007199254740991')).toBe(9007199254740991);
  });

  it('turns and steps', () => {
    expect(turnLeft('NORTH')).toBe('WEST');
    expect(turnRight('WEST')).toBe('NORTH');
    expect(stepForward({ x: 2, y: 2 }, 'NORTH')).toEqual({ x: 2, y: 3 });
    expect(stepForward({ x: 2, y: 2 }, 'EAST')).toEqual({ x: 3, y: 2 });
  });
});

describe('brief examples', () => {
  it('a) a chain moves together', () => {
    const s = run(
      floor5,
      place('R1', 0, 0, 'EAST'),
      place('R2', 1, 0, 'EAST'),
      place('R3', 2, 0, 'EAST'),
      queue('R1', 'MOVE'),
      queue('R2', 'MOVE'),
      queue('R3', 'MOVE'),
      ...ticks(1),
    );
    expect(report(s)).toEqual(['R1 1,0,EAST', 'R2 2,0,EAST', 'R3 3,0,EAST']);
  });

  it('b) head-on swap is blocked', () => {
    const s = run(
      floor5,
      place('R1', 0, 0, 'EAST'),
      place('R2', 1, 0, 'WEST'),
      queue('R1', 'MOVE'),
      queue('R2', 'MOVE'),
    );
    expect(tickOutcomes(s)).toEqual({ R1: 'HEAD_ON', R2: 'HEAD_ON' });
    expect(report(run(s, ...ticks(1)))).toEqual(['R1 0,0,EAST', 'R2 1,0,WEST']);
  });

  it('c) contested cell, robot stuck behind the loser', () => {
    const s = run(
      floor5,
      place('R1', 0, 1, 'EAST'),
      place('R2', 2, 1, 'WEST'),
      place('R3', 3, 1, 'WEST'),
      queue('R1', 'MOVE'),
      queue('R2', 'MOVE'),
      queue('R3', 'MOVE'),
    );
    expect(tickOutcomes(s)).toEqual({ R1: 'MOVED', R2: 'CONTESTED', R3: 'BEHIND_BLOCKED' });
    expect(report(run(s, ...ticks(1)))).toEqual(['R1 1,1,EAST', 'R2 2,1,WEST', 'R3 3,1,WEST']);
  });

  it('d) rotation of four robots', () => {
    const s = run(
      floor5,
      place('R1', 0, 0, 'NORTH'),
      place('R2', 0, 1, 'EAST'),
      place('R3', 1, 1, 'SOUTH'),
      place('R4', 1, 0, 'WEST'),
      queue('R1', 'MOVE'),
      queue('R2', 'MOVE'),
      queue('R3', 'MOVE'),
      queue('R4', 'MOVE'),
      ...ticks(1),
    );
    expect(report(s)).toEqual(['R1 0,1,NORTH', 'R2 1,1,EAST', 'R3 1,0,SOUTH', 'R4 0,0,WEST']);
  });

  it('e) queues of different lengths', () => {
    const start = run(
      floor5,
      { type: 'CREATE_FLOOR', width: 4, height: 3 },
      place('R2', 0, 0, 'NORTH'),
      place('R1', 3, 2, 'WEST'),
      queue('R2', 'MOVE', 'RIGHT', 'MOVE', 'MOVE', 'MOVE', 'MOVE'),
      queue('R1', 'MOVE', 'LEFT'),
    );
    const after3 = run(start, ...ticks(3));
    expect(report(after3)).toEqual(['R1 2,2,SOUTH', 'R2 1,1,EAST']);
    const after13 = run(after3, ...ticks(10));
    expect(report(after13)).toEqual(['R1 2,2,SOUTH', 'R2 3,1,EAST']);
    expect(after13.tick).toBe(13);
  });
});

describe('move resolution edge cases', () => {
  it('rotation of six robots around a ring succeeds', () => {
    // Grid cells cannot form a 3-cycle, so use a 2x3 ring: every robot moves one step around it.
    const s = run(
      floor5,
      place('R1', 0, 0, 'EAST'),
      place('R2', 1, 0, 'EAST'),
      place('R3', 2, 0, 'NORTH'),
      place('R4', 2, 1, 'WEST'),
      place('R5', 1, 1, 'WEST'),
      place('R6', 0, 1, 'SOUTH'),
      ...[1, 2, 3, 4, 5, 6].map((n) => queue(`R${n}`, 'MOVE')),
    );
    expect(tickOutcomes(s)).toEqual({
      R1: 'MOVED',
      R2: 'MOVED',
      R3: 'MOVED',
      R4: 'MOVED',
      R5: 'MOVED',
      R6: 'MOVED',
    });
    expect(report(run(s, ...ticks(1)))).toEqual([
      'R1 1,0,EAST',
      'R2 2,0,EAST',
      'R3 2,1,NORTH',
      'R4 1,1,WEST',
      'R5 0,1,WEST',
      'R6 0,0,SOUTH',
    ]);
  });

  it('contest: R2 beats R10 (numeric priority)', () => {
    const s = run(
      floor5,
      place('R10', 0, 1, 'EAST'),
      place('R2', 2, 1, 'WEST'),
      queue('R10', 'MOVE'),
      queue('R2', 'MOVE'),
    );
    expect(tickOutcomes(s)).toEqual({ R2: 'MOVED', R10: 'CONTESTED' });
    expect(report(run(s, ...ticks(1)))).toEqual(['R2 1,1,WEST', 'R10 0,1,EAST']);
  });

  it('contest winner that breaks a rotation: everyone is blocked (DECISIONS 2.2)', () => {
    // 2x2 rotation R2,R3,R4,R5 around (0,0),(0,1),(1,1),(1,0). R1 at (2,1) also wants (1,1),
    // which R3 is entering. R1 wins the contest, R3 loses, and the rotation is broken.
    const s = run(
      floor5,
      place('R1', 2, 1, 'WEST'),
      place('R2', 0, 0, 'NORTH'),
      place('R3', 0, 1, 'EAST'),
      place('R4', 1, 1, 'SOUTH'),
      place('R5', 1, 0, 'WEST'),
      ...[1, 2, 3, 4, 5].map((n) => queue(`R${n}`, 'MOVE')),
    );
    expect(tickOutcomes(s)).toEqual({
      R1: 'BEHIND_BLOCKED',
      R2: 'BEHIND_BLOCKED',
      R3: 'CONTESTED',
      R4: 'BEHIND_BLOCKED',
      R5: 'BEHIND_BLOCKED',
    });
    expect(report(run(s, ...ticks(1)))).toEqual(report(s));
  });

  it('chain behind a head-on pair is blocked', () => {
    // R1 and R2 swap. R3 and R4 queue up behind R1: R3 aims at R1's cell, which R2 also
    // aims at, so R2 (lower number) wins and R3 is CONTESTED; R4 is stuck behind R3.
    const s = run(
      floor5,
      place('R1', 1, 0, 'EAST'),
      place('R2', 2, 0, 'WEST'),
      place('R3', 0, 0, 'EAST'),
      place('R4', 0, 1, 'SOUTH'),
      ...[1, 2, 3, 4].map((n) => queue(`R${n}`, 'MOVE')),
    );
    expect(tickOutcomes(s)).toEqual({
      R1: 'HEAD_ON',
      R2: 'HEAD_ON',
      R3: 'CONTESTED',
      R4: 'BEHIND_BLOCKED',
    });
    expect(report(run(s, ...ticks(1)))).toEqual(report(s));
  });

  it('walls, obstacles, turning and idle robots', () => {
    const s = run(
      floor5,
      { type: 'SET_OBSTACLE', x: 1, y: 3, present: true },
      place('R1', 0, 0, 'WEST'),
      place('R2', 1, 2, 'NORTH'),
      place('R3', 3, 3, 'EAST'),
      place('R4', 4, 3, 'NORTH'),
      place('R5', 0, 4, 'EAST'),
      place('R6', 0, 3, 'NORTH'),
      queue('R1', 'MOVE'),
      queue('R2', 'MOVE'),
      queue('R3', 'MOVE'),
      queue('R4', 'LEFT'),
      queue('R6', 'MOVE'),
    );
    expect(tickOutcomes(s)).toEqual({
      R1: 'WALL',
      R2: 'OBSTACLE',
      R3: 'OCCUPIED',
      R4: 'TURNED',
      R5: 'IDLE',
      R6: 'OCCUPIED',
    });
  });

  it('blocked MOVE is consumed', () => {
    const s = run(floor5, place('R1', 0, 0, 'WEST'), queue('R1', 'MOVE', 'RIGHT'), ...ticks(2));
    expect(report(s)).toEqual(['R1 0,0,NORTH']);
    expect(s.robots[0]?.queue).toEqual([]);
  });

  it('tick advances on an empty floor and emits one result per robot', () => {
    const result = apply(floor5, { type: 'TICK' });
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: 'TICK_RESOLVED', tick: 1, results: [] }],
    });
  });
});

describe('reducer actions', () => {
  it('CREATE_FLOOR validates size', () => {
    for (const [width, height] of [
      [0, 5],
      [5, 21],
      [2.5, 5],
      [Number.NaN, 5],
    ] as const) {
      expect(apply(floor5, { type: 'CREATE_FLOOR', width, height })).toMatchObject({
        ok: false,
        reason: 'INVALID_SIZE',
      });
    }
    expect(apply(floor5, { type: 'CREATE_FLOOR', width: 20, height: 1 })).toMatchObject({
      ok: true,
      state: { width: 20, height: 1, robots: [], obstacles: [], nextRobotNum: 1, tick: 0 },
    });
  });

  it('PLACE_ROBOT auto ids, high-water mark, canonical order', () => {
    let s = run(
      floor5,
      { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'NORTH' },
      place('r07', 1, 0, 'EAST'),
    );
    expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R7']);
    expect(s.nextRobotNum).toBe(8);
    s = run(s, { type: 'REMOVE_ROBOT', id: 'R7' });
    expect(s.nextRobotNum).toBe(8);
    s = run(s, { type: 'PLACE_ROBOT', x: 2, y: 0, facing: 'NORTH' });
    expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R8']);
    s = run(s, place('R3', 3, 0, 'NORTH'));
    expect(s.robots.map((r) => r.id)).toEqual(['R1', 'R3', 'R8']);
    expect(s.nextRobotNum).toBe(9);
  });

  it('PLACE_ROBOT rejections, in order', () => {
    const s = run(
      floor5,
      { type: 'SET_OBSTACLE', x: 4, y: 4, present: true },
      place('R1', 0, 0, 'NORTH'),
    );
    const reasonOf = (a: Action) => {
      const r = apply(s, a);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reasonOf(place('R0', 0, 1, 'NORTH'))).toBe('INVALID_ID');
    expect(reasonOf(place('R2', 5, 0, 'NORTH'))).toBe('OUT_OF_BOUNDS');
    expect(reasonOf(place('R2', 0.5, 0, 'NORTH'))).toBe('OUT_OF_BOUNDS');
    expect(reasonOf(place('R2', 4, 4, 'NORTH'))).toBe('CELL_IS_OBSTACLE');
    expect(reasonOf(place('R2', 0, 0, 'NORTH'))).toBe('CELL_OCCUPIED');
    expect(reasonOf(place('R1', 0, 0, 'SOUTH'))).toBe('ok');
  });

  it('re-placing keeps the queue and resets the goto counter', () => {
    const base = run(floor5, place('R1', 0, 0, 'NORTH'), queue('R1', 'MOVE', 'LEFT'));
    const withCounter: FloorState = {
      ...base,
      robots: base.robots.map((r) => ({ ...r, gotoNoPathTicks: 2 })),
    };
    const result = apply(withCounter, place('R1', 3, 3, 'WEST'));
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: 'ROBOT_PLACED', id: 'R1', replaced: true }],
      state: {
        robots: [
          {
            x: 3,
            y: 3,
            facing: 'WEST',
            queue: [{ kind: 'MOVE' }, { kind: 'LEFT' }],
            gotoNoPathTicks: 0,
          },
        ],
      },
    });
  });

  it('obstacles: set, toggle, no-op, conflicts, canonical order', () => {
    let s = run(
      floor5,
      { type: 'SET_OBSTACLE', x: 3, y: 1, present: true },
      { type: 'SET_OBSTACLE', x: 1, y: 2, present: true },
      { type: 'TOGGLE_OBSTACLE', x: 1, y: 1 },
    );
    expect(s.obstacles).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 3, y: 1 },
    ]);
    const noop = apply(s, { type: 'SET_OBSTACLE', x: 1, y: 1, present: true });
    expect(noop).toMatchObject({ ok: true, events: [] });
    expect(noop.ok && noop.state).toBe(s);
    s = run(s, { type: 'TOGGLE_OBSTACLE', x: 1, y: 1 });
    expect(s.obstacles).toHaveLength(2);
    s = run(s, place('R1', 0, 0, 'NORTH'));
    expect(apply(s, { type: 'TOGGLE_OBSTACLE', x: 0, y: 0 })).toMatchObject({
      ok: false,
      reason: 'CELL_OCCUPIED',
    });
    expect(apply(s, { type: 'SET_OBSTACLE', x: 9, y: 0, present: false })).toMatchObject({
      ok: false,
      reason: 'OUT_OF_BOUNDS',
    });
  });

  it('QUEUE_COMMANDS validation is atomic', () => {
    const s = run(
      floor5,
      { type: 'SET_OBSTACLE', x: 2, y: 2, present: true },
      place('R1', 0, 0, 'NORTH'),
    );
    const reasonOf = (a: Action) => {
      const r = apply(s, a);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reasonOf({ type: 'QUEUE_COMMANDS', id: 'X1', commands: [{ kind: 'MOVE' }] })).toBe(
      'INVALID_ID',
    );
    expect(reasonOf({ type: 'QUEUE_COMMANDS', id: 'R9', commands: [{ kind: 'MOVE' }] })).toBe(
      'UNKNOWN_ROBOT',
    );
    expect(reasonOf({ type: 'QUEUE_COMMANDS', id: 'R1', commands: [] })).toBe('INVALID_COMMAND');
    expect(
      reasonOf({
        type: 'QUEUE_COMMANDS',
        id: 'R1',
        commands: [{ kind: 'JUMP' } as unknown as { kind: 'MOVE' }],
      }),
    ).toBe('INVALID_COMMAND');
    for (const [x, y] of [
      [5, 0],
      [2, 2],
      [1.5, 0],
    ] as const) {
      expect(
        reasonOf({
          type: 'QUEUE_COMMANDS',
          id: 'R1',
          commands: [{ kind: 'MOVE' }, { kind: 'GOTO', x, y }],
        }),
      ).toBe('INVALID_GOTO_TARGET');
    }
    expect(
      reasonOf({ type: 'QUEUE_COMMANDS', id: 'r01', commands: [{ kind: 'GOTO', x: 4, y: 4 }] }),
    ).toBe('ok');
  });

  it('CLEAR_QUEUE works on empty queues', () => {
    const s = run(floor5, place('R1', 0, 0, 'NORTH'), queue('R1', 'MOVE'));
    const cleared = run(s, { type: 'CLEAR_QUEUE', id: 'R1' });
    expect(cleared.robots[0]?.queue).toEqual([]);
    expect(apply(cleared, { type: 'CLEAR_QUEUE', id: 'r1' })).toMatchObject({
      ok: true,
      events: [{ type: 'QUEUE_CLEARED', id: 'R1' }],
    });
    expect(apply(cleared, { type: 'CLEAR_QUEUE', id: 'R2' })).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_ROBOT',
    });
  });

  it('never mutates its input', () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
      }
      return value;
    };
    const s = run(
      floor5,
      { type: 'SET_OBSTACLE', x: 4, y: 4, present: true },
      place('R2', 0, 0, 'EAST'),
      place('R1', 1, 0, 'EAST'),
      queue('R1', 'MOVE', 'LEFT'),
      queue('R2', 'MOVE'),
    );
    deepFreeze(s);
    const actions: Action[] = [
      { type: 'TICK' },
      place('R2', 3, 3, 'SOUTH'),
      { type: 'REMOVE_ROBOT', id: 'R1' },
      { type: 'TOGGLE_OBSTACLE', x: 0, y: 3 },
      queue('R1', 'RIGHT'),
      { type: 'CLEAR_QUEUE', id: 'R1' },
    ];
    for (const action of actions) {
      expect(apply(s, action).ok).toBe(true);
    }
  });

  it('TICK throws for GOTO until Phase 2', () => {
    const s = run(floor5, place('R1', 0, 0, 'NORTH'), {
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'GOTO', x: 3, y: 3 }],
    });
    expect(() => apply(s, { type: 'TICK' })).toThrow('GOTO execution not implemented yet');
  });
});
