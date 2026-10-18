/**
 * Basic tick behaviour: turning, idling, plain moves, queue consumption, the tick counter and the
 * shape of the per-robot results. No multi-robot interaction rules here (see the other tick-* files).
 */
import { describe, expect, it } from 'vitest';
import { type Facing } from '../src/index.js';
import {
  buildFloor,
  cells,
  cmds,
  ok,
  outcomes,
  queue,
  robot,
  robotOf,
  tick,
  ticks,
} from './helpers.js';

const LEFT_OF: Record<Facing, Facing> = {
  NORTH: 'WEST',
  WEST: 'SOUTH',
  SOUTH: 'EAST',
  EAST: 'NORTH',
};
const RIGHT_OF: Record<Facing, Facing> = {
  NORTH: 'EAST',
  EAST: 'SOUTH',
  SOUTH: 'WEST',
  WEST: 'NORTH',
};

describe('tick counter and events', () => {
  it('an empty floor still ticks: counter +1, one TICK_RESOLVED with no results', () => {
    const s = buildFloor(3, 3);
    const t = tick(s);
    expect(t.state.tick).toBe(1);
    expect(t.results).toEqual([]);
    expect(t.events).toHaveLength(1);
  });

  it('the counter advances by exactly one per TICK, with or without commands', () => {
    let s = buildFloor(5, 5, [robot('R1', 0, 0, 'EAST', 'MOVE')]);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = tick(s).state;
      seen.push(s.tick);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('TICK_RESOLVED carries the tick number', () => {
    // GAP: DECISIONS does not say whether the event's tick is the count before or after. The
    // contract says state.tick is "ticks resolved so far", so the first resolved tick is tick 1.
    const s = buildFloor(3, 3, [robot('R1', 0, 0, 'EAST')]);
    const first = ok(s, { type: 'TICK' });
    expect(first.events).toEqual([expect.objectContaining({ type: 'TICK_RESOLVED', tick: 1 })]);
    const second = ok(first.state, { type: 'TICK' });
    expect(second.events).toEqual([expect.objectContaining({ type: 'TICK_RESOLVED', tick: 2 })]);
  });

  it('leaves width, height, obstacles and nextRobotNum alone', () => {
    const s = buildFloor(6, 4, [robot('R3', 0, 0, 'EAST', 'MOVE')], [[5, 3]]);
    const after = tick(s).state;
    expect(after.width).toBe(6);
    expect(after.height).toBe(4);
    expect(after.obstacles).toEqual([{ x: 5, y: 3 }]);
    expect(after.nextRobotNum).toBe(s.nextRobotNum);
  });
});

describe('IDLE', () => {
  it('a robot with an empty queue stays put and reports IDLE', () => {
    const s = buildFloor(4, 4, [robot('R1', 2, 3, 'SOUTH')]);
    const t = tick(s);
    expect(robotOf(t.state, 'R1')).toMatchObject({ x: 2, y: 3, facing: 'SOUTH', queue: [] });
    expect(t.results).toEqual([
      {
        id: 'R1',
        command: null,
        outcome: 'IDLE',
        from: { x: 2, y: 3 },
        to: { x: 2, y: 3 },
        facing: 'SOUTH',
      },
    ]);
    expect(t.results[0]?.reason).toBeUndefined();
  });

  it('a robot becomes IDLE the tick after its queue runs out', () => {
    const s = buildFloor(4, 4, [robot('R1', 0, 0, 'EAST', 'MOVE')]);
    const { history } = ticks(s, 3);
    expect(history.map((r) => outcomes(r).R1)).toEqual(['MOVED', 'IDLE', 'IDLE']);
  });
});

describe('LEFT / RIGHT', () => {
  const FACINGS: Facing[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

  it.each(FACINGS)('LEFT from %s turns 90 degrees anticlockwise in place', (facing) => {
    const s = buildFloor(3, 3, [robot('R1', 1, 1, facing, 'LEFT')]);
    const t = tick(s);
    expect(cells(t.state)).toEqual({ R1: `1,1,${LEFT_OF[facing]}` });
    expect(t.results).toEqual([
      {
        id: 'R1',
        command: { kind: 'LEFT' },
        outcome: 'TURNED',
        from: { x: 1, y: 1 },
        to: { x: 1, y: 1 },
        facing: LEFT_OF[facing],
      },
    ]);
  });

  it.each(FACINGS)('RIGHT from %s turns 90 degrees clockwise in place', (facing) => {
    const s = buildFloor(3, 3, [robot('R1', 1, 1, facing, 'RIGHT')]);
    const t = tick(s);
    expect(cells(t.state)).toEqual({ R1: `1,1,${RIGHT_OF[facing]}` });
    expect(t.results[0]).toMatchObject({
      command: { kind: 'RIGHT' },
      outcome: 'TURNED',
      facing: RIGHT_OF[facing],
    });
  });

  it('turning always succeeds, even boxed in at a corner against walls and obstacles', () => {
    const s = buildFloor(
      2,
      2,
      [robot('R1', 0, 0, 'NORTH', 'LEFT RIGHT RIGHT')],
      [
        [0, 1],
        [1, 0],
      ],
    );
    const { state, history } = ticks(s, 3);
    expect(history.map((r) => outcomes(r).R1)).toEqual(['TURNED', 'TURNED', 'TURNED']);
    expect(cells(state)).toEqual({ R1: '0,0,EAST' }); // N -L-> W -R-> N -R-> E
  });

  it('four LEFTs (or four RIGHTs) return to the starting facing', () => {
    const s = buildFloor(3, 3, [
      robot('R1', 0, 0, 'EAST', 'LEFT LEFT LEFT LEFT'),
      robot('R2', 2, 2, 'WEST', 'RIGHT RIGHT RIGHT RIGHT'),
    ]);
    expect(cells(ticks(s, 4).state)).toEqual({ R1: '0,0,EAST', R2: '2,2,WEST' });
  });

  it('LEFT then RIGHT cancels', () => {
    const s = buildFloor(3, 3, [robot('R1', 1, 1, 'SOUTH', 'LEFT RIGHT')]);
    expect(cells(ticks(s, 2).state)).toEqual({ R1: '1,1,SOUTH' });
  });
});

describe('plain MOVE', () => {
  const cases: [Facing, number, number][] = [
    ['NORTH', 2, 3], // y + 1
    ['EAST', 3, 2], // x + 1
    ['SOUTH', 2, 1], // y - 1
    ['WEST', 1, 2], // x - 1
  ];

  it.each(cases)('MOVE facing %s from (2,2) lands on (%i,%i)', (facing, x, y) => {
    const s = buildFloor(5, 5, [robot('R1', 2, 2, facing, 'MOVE')]);
    const t = tick(s);
    expect(cells(t.state)).toEqual({ R1: `${x},${y},${facing}` });
    expect(t.results).toEqual([
      {
        id: 'R1',
        command: { kind: 'MOVE' },
        outcome: 'MOVED',
        from: { x: 2, y: 2 },
        to: { x, y },
        facing,
      },
    ]);
  });

  it('moves exactly one cell per tick, never more', () => {
    const s = buildFloor(10, 1, [robot('R1', 0, 0, 'EAST', 'MOVE MOVE MOVE')]);
    const xs: number[] = [];
    let cur = s;
    for (let i = 0; i < 3; i++) {
      cur = tick(cur).state;
      xs.push(robotOf(cur, 'R1').x);
    }
    expect(xs).toEqual([1, 2, 3]);
  });

  it('a path of MOVE, turn, MOVE walks an L (origin south-west, north is +y)', () => {
    const s = buildFloor(4, 4, [robot('R1', 0, 0, 'NORTH', 'MOVE MOVE RIGHT MOVE MOVE LEFT MOVE')]);
    const { state } = ticks(s, 7);
    // (0,0) N -> (0,1) -> (0,2) -> turn E -> (1,2) -> (2,2) -> turn N -> (2,3)
    expect(cells(state)).toEqual({ R1: '2,3,NORTH' });
  });

  it('can reach every corner of the floor', () => {
    const s = buildFloor(3, 2, [
      robot('R1', 0, 0, 'EAST', 'MOVE MOVE'),
      robot('R2', 2, 1, 'WEST', 'MOVE MOVE'),
    ]);
    expect(cells(ticks(s, 2).state)).toEqual({ R1: '2,0,EAST', R2: '0,1,WEST' });
  });
});

describe('queue consumption', () => {
  it('takes exactly one command off the front per tick', () => {
    let s = buildFloor(6, 6, [robot('R1', 0, 0, 'EAST', 'MOVE LEFT RIGHT MOVE')]);
    const lengths = [robotOf(s, 'R1').queue.length];
    const remaining: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      s = tick(s).state;
      lengths.push(robotOf(s, 'R1').queue.length);
      remaining.push(robotOf(s, 'R1').queue);
    }
    expect(lengths).toEqual([4, 3, 2, 1, 0]);
    expect(remaining).toEqual([cmds('LEFT RIGHT MOVE'), cmds('RIGHT MOVE'), cmds('MOVE'), []]);
  });

  it('the command that ran is reported in the result', () => {
    const s = buildFloor(6, 6, [robot('R1', 0, 0, 'EAST', 'MOVE LEFT RIGHT')]);
    const { history } = ticks(s, 3);
    expect(history.map((r) => r[0]?.command)).toEqual([
      { kind: 'MOVE' },
      { kind: 'LEFT' },
      { kind: 'RIGHT' },
    ]);
  });

  it('a blocked MOVE is still used up (the queue shrinks, the next command runs next tick)', () => {
    // R1 at the west edge facing west: MOVE is blocked by the wall, then RIGHT, then MOVE north.
    const s = buildFloor(3, 3, [robot('R1', 0, 0, 'WEST', 'MOVE RIGHT MOVE')]);
    const t1 = tick(s);
    expect(outcomes(t1.results).R1).toBe('BLOCKED(WALL)');
    expect(robotOf(t1.state, 'R1').queue).toEqual(cmds('RIGHT MOVE'));
    const t2 = tick(t1.state);
    expect(outcomes(t2.results).R1).toBe('TURNED');
    const t3 = tick(t2.state);
    expect(cells(t3.state)).toEqual({ R1: '0,1,NORTH' });
    expect(robotOf(t3.state, 'R1').queue).toEqual([]);
  });

  it('robots with different queue lengths run in lockstep and finish at different ticks', () => {
    const s = buildFloor(6, 6, [
      robot('R1', 0, 0, 'EAST', 'MOVE'),
      robot('R2', 0, 2, 'EAST', 'MOVE MOVE MOVE'),
      robot('R3', 0, 4, 'EAST'),
    ]);
    const { history } = ticks(s, 4);
    expect(history.map(outcomes)).toEqual([
      { R1: 'MOVED', R2: 'MOVED', R3: 'IDLE' },
      { R1: 'IDLE', R2: 'MOVED', R3: 'IDLE' },
      { R1: 'IDLE', R2: 'MOVED', R3: 'IDLE' },
      { R1: 'IDLE', R2: 'IDLE', R3: 'IDLE' },
    ]);
  });

  it('QUEUE_COMMANDS added mid-run is appended behind what is left', () => {
    let s = buildFloor(6, 6, [robot('R1', 0, 0, 'EAST', 'MOVE MOVE')]);
    s = tick(s).state; // one MOVE left
    s = queue(s, 'R1', 'LEFT MOVE');
    expect(robotOf(s, 'R1').queue).toEqual(cmds('MOVE LEFT MOVE'));
    expect(cells(ticks(s, 3).state)).toEqual({ R1: '2,1,NORTH' });
  });
});

describe('results: one per robot, sorted by robot number', () => {
  it('lists every robot, idle or not, ordered numerically (R2 before R10)', () => {
    const s = buildFloor(8, 3, [
      robot('R10', 0, 0, 'EAST', 'MOVE'),
      robot('R2', 0, 1, 'EAST'),
      robot('R1', 0, 2, 'EAST', 'LEFT'),
      robot('R33', 5, 0, 'EAST'),
      robot('R3', 5, 2, 'WEST', 'MOVE'),
    ]);
    const t = tick(s);
    expect(t.results.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R10', 'R33']);
    expect(outcomes(t.results)).toEqual({
      R1: 'TURNED',
      R2: 'IDLE',
      R3: 'MOVED',
      R10: 'MOVED',
      R33: 'IDLE',
    });
  });

  it('result order is independent of the order robots were placed in', () => {
    const specs = [
      robot('R4', 0, 0, 'EAST', 'MOVE'),
      robot('R9', 0, 1, 'EAST', 'MOVE'),
      robot('R1', 0, 2, 'EAST', 'MOVE'),
    ];
    const a = tick(buildFloor(4, 4, specs));
    const b = tick(buildFloor(4, 4, [...specs].reverse()));
    expect(a.results).toEqual(b.results);
    expect(a.results.map((r) => r.id)).toEqual(['R1', 'R4', 'R9']);
    expect(a.state).toEqual(b.state);
  });

  it('from, to and facing describe the tick (facing is the facing at the end)', () => {
    const s = buildFloor(5, 5, [
      robot('R1', 1, 1, 'NORTH', 'MOVE'),
      robot('R2', 3, 3, 'NORTH', 'LEFT'),
      robot('R3', 0, 4, 'NORTH', 'MOVE'), // wall
    ]);
    const { results } = tick(s);
    expect(results).toEqual([
      {
        id: 'R1',
        command: { kind: 'MOVE' },
        outcome: 'MOVED',
        from: { x: 1, y: 1 },
        to: { x: 1, y: 2 },
        facing: 'NORTH',
      },
      {
        id: 'R2',
        command: { kind: 'LEFT' },
        outcome: 'TURNED',
        from: { x: 3, y: 3 },
        to: { x: 3, y: 3 },
        facing: 'WEST',
      },
      {
        id: 'R3',
        command: { kind: 'MOVE' },
        outcome: 'BLOCKED',
        reason: 'WALL',
        from: { x: 0, y: 4 },
        to: { x: 0, y: 4 },
        facing: 'NORTH',
      },
    ]);
  });

  it('the reason field is present only on BLOCKED results', () => {
    const s = buildFloor(3, 1, [
      robot('R1', 0, 0, 'NORTH', 'MOVE'), // blocked: wall
      robot('R2', 1, 0, 'EAST', 'MOVE'), // moved
      robot('R3', 2, 0, 'EAST', 'LEFT'), // turned (R2 moves into it? no: R3 stays, R2 blocked)
    ]);
    const { results } = tick(s);
    for (const r of results) {
      if (r.outcome === 'BLOCKED') expect(r.reason).toBeTypeOf('string');
      else expect(r.reason).toBeUndefined();
    }
    expect(outcomes(results)).toEqual({
      R1: 'BLOCKED(WALL)',
      R2: 'BLOCKED(OCCUPIED)',
      R3: 'TURNED',
    });
  });

  it('a blocked robot reports from === to and keeps its facing', () => {
    const s = buildFloor(2, 2, [robot('R1', 1, 1, 'EAST', 'MOVE')]);
    const r = tick(s).results[0];
    expect(r).toMatchObject({
      outcome: 'BLOCKED',
      from: { x: 1, y: 1 },
      to: { x: 1, y: 1 },
      facing: 'EAST',
    });
  });
});

describe('the brief example e, as a unit test', () => {
  it('FLOOR 4,3: R2 and R1 with different queues, after 3 and then 13 ticks', () => {
    // R2: (0,0) N: MOVE (0,1); RIGHT -> E; MOVE (1,1)            => after 3 ticks R2 = 1,1,EAST
    // R1: (3,2) W: MOVE (2,2); LEFT -> S; then idle              => R1 = 2,2,SOUTH
    // 10 more ticks: R2's remaining MOVE x3 -> (2,1), (3,1), blocked by the east wall => 3,1,EAST
    const s = buildFloor(4, 3, [
      robot('R2', 0, 0, 'NORTH', 'MOVE RIGHT MOVE MOVE MOVE MOVE'),
      robot('R1', 3, 2, 'WEST', 'MOVE LEFT'),
    ]);
    const after3 = ticks(s, 3).state;
    expect(cells(after3)).toEqual({ R1: '2,2,SOUTH', R2: '1,1,EAST' });
    const after13 = ticks(after3, 10).state;
    expect(cells(after13)).toEqual({ R1: '2,2,SOUTH', R2: '3,1,EAST' });
    expect(after13.tick).toBe(13);
  });
});
