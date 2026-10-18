/**
 * Module A: GOTO X,Y (DECISIONS section 3, brief Module A).
 *
 * Written black-box from the spec. All maps are drawn with north up (top row = highest y); see
 * helpers.ts. Every expectation was worked out by hand; non-obvious ones are explained inline.
 *
 * Reminders of the rules under test:
 *  - Each tick a GOTO robot finds a shortest 4-direction path to its target. Obstacles, the floor edge
 *    and every OTHER robot's current cell are walls (the target cell too, if a robot stands on it).
 *  - It faces the first step (free) and makes a normal MOVE, so rules 1.3 still apply to it.
 *  - Ties between equally short first steps: NORTH, EAST, SOUTH, WEST.
 *  - No path: WAITING. Three no-path ticks in a row: UNREACHABLE and the GOTO is dropped.
 *  - GOTO stays at the front of the queue until it arrives or gives up.
 */
import { describe, expect, it } from 'vitest';
import type { Command, FloorState } from '../src/index.js';
import {
  blocked,
  buildFloor,
  cells,
  deepFreeze,
  fromMap,
  ok,
  outcomes,
  queue,
  reached,
  resultOf,
  robot,
  robotOf,
  tick,
  ticks,
  trail,
} from './helpers.js';

const goto = (x: number, y: number): Command => ({ kind: 'GOTO', x, y });

// ---------------------------------------------------------------------------
// Straight lines, turning for free, arrival
// ---------------------------------------------------------------------------

describe('GOTO: basic travel', () => {
  it('walks a straight corridor one cell per tick and arrives on the tick it reaches the target', () => {
    const s = fromMap('R1> . . . .', { R1: 'GOTO 4,0' });
    const t = trail(s, 'R1', 5);
    expect(t.at).toEqual(['1,0', '2,0', '3,0', '4,0', '4,0']);
    // The last step is MOVED with reachedGoto; the tick after that the queue is empty.
    expect(t.out).toEqual(['MOVED', 'MOVED', 'MOVED', 'MOVED', 'IDLE']);
    t.results.slice(0, 3).forEach((res) => expect(reached(resultOf(res, 'R1'))).toBe(false));
    expect(reached(resultOf(t.results[3] ?? [], 'R1'))).toBe(true);
  });

  it('stays at the front of the queue while travelling and leaves it on arrival', () => {
    let s = fromMap('R1> . . .', { R1: 'GOTO 3,0' });
    for (let i = 0; i < 2; i++) {
      s = tick(s).state;
      expect(robotOf(s, 'R1').queue).toEqual([goto(3, 0)]);
    }
    s = tick(s).state; // arrives at (3,0)
    expect(robotOf(s, 'R1')).toMatchObject({ x: 3, y: 0, queue: [], gotoNoPathTicks: 0 });
  });

  it('the result of a GOTO tick reports the GOTO command and the one-cell move', () => {
    const s = fromMap('R1> . .', { R1: 'GOTO 2,0' });
    const r = resultOf(tick(s).results, 'R1');
    expect(r).toMatchObject({
      id: 'R1',
      command: goto(2, 0),
      outcome: 'MOVED',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      facing: 'EAST',
    });
    expect(r.reason).toBeUndefined();
  });

  it('turning to face the first step is free: a robot facing away still moves on the first tick', () => {
    // R1 faces SOUTH (the wall) but the target is to the east.
    const s = fromMap('R1v . . . .', { R1: 'GOTO 4,0' });
    const t = trail(s, 'R1', 1);
    expect(t.pose).toEqual(['1,0,EAST']);
    expect(t.out).toEqual(['MOVED']);
  });

  it('the facing follows the direction of travel, vertical as well as horizontal', () => {
    // 1 wide, 4 tall; top row is y = 3.
    const s = fromMap(
      `
      .
      .
      .
      R1>
      `,
      { R1: 'GOTO 0,3' },
    );
    const t = trail(s, 'R1', 3);
    expect(t.pose).toEqual(['0,1,NORTH', '0,2,NORTH', '0,3,NORTH']);
    const south = trail(
      fromMap(
        `
        R1<
        .
        .
        .
        `,
        { R1: 'GOTO 0,0' },
      ),
      'R1',
      3,
    );
    expect(south.pose).toEqual(['0,2,SOUTH', '0,1,SOUTH', '0,0,SOUTH']);
  });

  it('a robot never needs its own cell to be free: it is not a wall to itself', () => {
    // 2x1 floor: the only route starts on the robot's own cell.
    const s = fromMap('R1> .', { R1: 'GOTO 1,0' });
    const t = trail(s, 'R1', 1);
    expect(t.out).toEqual(['MOVED']);
    expect(reached(resultOf(t.results[0] ?? [], 'R1'))).toBe(true);
  });

  it('works on a 1x1 floor: the only valid target is the robot itself, so it ARRIVES', () => {
    const s = buildFloor(1, 1, [robot('R1', 0, 0, 'NORTH', 'GOTO 0,0')]);
    const t = trail(s, 'R1', 2);
    expect(t.out).toEqual(['ARRIVED', 'IDLE']);
    expect(t.at).toEqual(['0,0', '0,0']);
  });

  it('commands queued behind a running GOTO wait for it', () => {
    let s = fromMap('R1> . . .', { R1: 'GOTO 3,0' });
    s = tick(s).state;
    s = queue(s, 'R1', 'MOVE');
    expect(robotOf(s, 'R1').queue).toEqual([goto(3, 0), { kind: 'MOVE' }]);
    const t = trail(s, 'R1', 3);
    // 2 more GOTO steps, then the queued MOVE runs into the east wall.
    expect(t.out).toEqual(['MOVED', 'MOVED', 'BLOCKED(WALL)']);
  });
});

// ---------------------------------------------------------------------------
// Tie-break: NORTH, EAST, SOUTH, WEST among equally short first steps
// ---------------------------------------------------------------------------

describe('GOTO: tie-break order NORTH, EAST, SOUTH, WEST', () => {
  // On an open grid a diagonal target gives two equally short first steps. Each case lists the
  // whole route because the preference applies again at every tick.
  const open: readonly (readonly [string, [number, number], [number, number], string[]])[] = [
    // NE: first step candidates N and E -> NORTH. From (0,1): N (0,2) and E (1,1) both leave distance 2 -> NORTH.
    [
      'target diagonal to the north-east: NORTH before EAST',
      [0, 0],
      [2, 2],
      ['0,1,NORTH', '0,2,NORTH', '1,2,EAST', '2,2,EAST'],
    ],
    // SE: candidates E and S -> EAST. From (1,2): E (2,2) and S (1,1) both distance 2 -> EAST.
    [
      'target diagonal to the south-east: EAST before SOUTH',
      [0, 2],
      [2, 0],
      ['1,2,EAST', '2,2,EAST', '2,1,SOUTH', '2,0,SOUTH'],
    ],
    // SW: candidates S and W -> SOUTH. From (2,1): S (2,0) and W (1,1) both distance 2 -> SOUTH.
    [
      'target diagonal to the south-west: SOUTH before WEST',
      [2, 2],
      [0, 0],
      ['2,1,SOUTH', '2,0,SOUTH', '1,0,WEST', '0,0,WEST'],
    ],
    // NW: candidates N and W -> NORTH. From (2,1): N (2,2) and W (1,1) both distance 2 -> NORTH.
    [
      'target diagonal to the north-west: NORTH before WEST',
      [2, 0],
      [0, 2],
      ['2,1,NORTH', '2,2,NORTH', '1,2,WEST', '0,2,WEST'],
    ],
  ];

  it.each(open)('%s', (_name, [sx, sy], [tx, ty], expected) => {
    // Start facing the "wrong" way on purpose: the turn is free and the tie-break decides.
    const s = buildFloor(3, 3, [robot('R1', sx, sy, 'WEST', `GOTO ${tx},${ty}`)]);
    expect(trail(s, 'R1', 4).pose).toEqual(expected);
  });

  // A centre obstacle at (1,1) makes the two routes around it equal in length, so the first
  // step is chosen by the tie-break alone. Each route is 4 steps long.
  const around: readonly (readonly [string, [number, number], [number, number], string[]])[] = [
    // (1,0) -> (1,2): west route via (0,0)... and east route via (2,0)... are both 4; EAST beats WEST.
    [
      'EAST before WEST when going north around a centre obstacle',
      [1, 0],
      [1, 2],
      ['2,0,EAST', '2,1,NORTH', '2,2,NORTH', '1,2,WEST'],
    ],
    // (1,2) -> (1,0): same, mirrored; EAST first.
    [
      'EAST before WEST when going south around a centre obstacle',
      [1, 2],
      [1, 0],
      ['2,2,EAST', '2,1,SOUTH', '2,0,SOUTH', '1,0,WEST'],
    ],
    // (0,1) -> (2,1): north route and south route both 4; NORTH beats SOUTH.
    [
      'NORTH before SOUTH when going east around a centre obstacle',
      [0, 1],
      [2, 1],
      ['0,2,NORTH', '1,2,EAST', '2,2,EAST', '2,1,SOUTH'],
    ],
    // (2,1) -> (0,1): same, mirrored; NORTH first.
    [
      'NORTH before SOUTH when going west around a centre obstacle',
      [2, 1],
      [0, 1],
      ['2,2,NORTH', '1,2,WEST', '0,2,WEST', '0,1,SOUTH'],
    ],
  ];

  it.each(around)('%s', (_name, [sx, sy], [tx, ty], expected) => {
    const s = buildFloor(3, 3, [robot('R1', sx, sy, 'SOUTH', `GOTO ${tx},${ty}`)], [[1, 1]]);
    expect(trail(s, 'R1', 4).pose).toEqual(expected);
  });

  it('a strictly shorter route beats the preferred direction', () => {
    // Target is due west on a 4x2 floor. NORTH is preferred in a tie, but going north is a longer way round.
    const f = buildFloor(4, 2, [robot('R1', 3, 0, 'NORTH', 'GOTO 0,0')]);
    expect(trail(f, 'R1', 3).pose).toEqual(['2,0,WEST', '1,0,WEST', '0,0,WEST']);
  });
});

// ---------------------------------------------------------------------------
// Routes around obstacles and robots
// ---------------------------------------------------------------------------

describe('GOTO: routing around obstacles', () => {
  it('goes through the only gap in a wall', () => {
    // Row y = 1 is a wall with a gap at x = 2. R1 starts at (0,0) and wants (0,2), straight "through" the wall.
    // Route: east to (2,0), north through the gap to (2,2), west to (0,2): 6 steps, no alternatives.
    const s = fromMap(
      `
      . . . . .
      # # . # #
      R1> . . . .
      `,
      { R1: 'GOTO 0,2' },
    );
    const t = trail(s, 'R1', 6);
    expect(t.at).toEqual(['1,0', '2,0', '2,1', '2,2', '1,2', '0,2']);
    expect(t.out).toEqual(['MOVED', 'MOVED', 'MOVED', 'MOVED', 'MOVED', 'MOVED']);
    expect(reached(resultOf(t.results[5] ?? [], 'R1'))).toBe(true);
    expect(robotOf(t.state, 'R1').queue).toEqual([]);
  });

  it('re-plans every tick: an obstacle added mid-route sends the robot around it', () => {
    // Open 5x2 floor, R1 heads east along y = 0 to (4,0).
    let s = buildFloor(5, 2, [robot('R1', 0, 0, 'EAST', 'GOTO 4,0')]);
    s = ticks(s, 2).state; // now at (2,0)
    expect(cells(s)['R1']).toBe('2,0,EAST');
    s = ok(s, { type: 'SET_OBSTACLE', x: 3, y: 0, present: true }).state;
    // From (2,0) the east step is blocked, so go up: (2,1), (3,1), (4,1), then down to (4,0).
    // At (3,1) the choice is E (4,1) only because S (3,0) is now an obstacle.
    const t = trail(s, 'R1', 4);
    expect(t.pose).toEqual(['2,1,NORTH', '3,1,EAST', '4,1,EAST', '4,0,SOUTH']);
    expect(reached(resultOf(t.results[3] ?? [], 'R1'))).toBe(true);
  });

  it('an obstacle never gets entered, even when it would be the shortest straight line', () => {
    const s = fromMap(
      `
      . . .
      R1> # .
      . . .
      `,
      { R1: 'GOTO 2,1' },
    );
    const t = trail(s, 'R1', 4);
    // Tie between the north and south detours (each 4 long): NORTH wins.
    expect(t.at).toEqual(['0,2', '1,2', '2,2', '2,1']);
    expect(t.out.every((o) => o === 'MOVED')).toBe(true);
  });
});

describe('GOTO: other robots are walls', () => {
  it('detours around a parked robot', () => {
    // R2 parks on (2,0). Going along y = 0 is impossible; every route goes over the top row.
    // Distances to (4,0) with R2 as a wall: (0,1) = 5 and (1,0) = 5, so the first step is a tie -> NORTH.
    // Then E, E, E along y = 1. At (3,1): E (4,1) and S (3,0) both leave distance 1 -> EAST (before SOUTH).
    // Finally S into the target.
    const s = fromMap(
      `
      . . . . .
      R1> . R2^ . .
      `,
      { R1: 'GOTO 4,0' },
    );
    const t = trail(s, 'R1', 6);
    expect(t.at).toEqual(['0,1', '1,1', '2,1', '3,1', '4,1', '4,0']);
    expect(t.pose[0]).toBe('0,1,NORTH');
    expect(t.pose[3]).toBe('3,1,EAST');
    expect(t.pose[5]).toBe('4,0,SOUTH');
    expect(t.out).toEqual(['MOVED', 'MOVED', 'MOVED', 'MOVED', 'MOVED', 'MOVED']);
  });

  it('a robot about to move away is still a wall when the path is planned', () => {
    // R2 stands on (1,1) and will move north to (1,2). R1 wants (2,1). If R2 were ignored, R1 would
    // face EAST and follow into (1,1). But R2's current cell is a wall at planning time, so R1 takes the
    // detour: the shortest ways round are via (0,2) or via (0,0), both length 4 -> NORTH.
    const s = fromMap(
      `
      . . .
      R1> R2^ .
      . . .
      `,
      { R1: 'GOTO 2,1', R2: 'MOVE' },
    );
    const t = tick(s);
    expect(cells(t.state)['R1']).toBe('0,2,NORTH');
    expect(cells(t.state)['R2']).toBe('1,2,NORTH');
    expect(outcomes(t.results)).toEqual({ R1: 'MOVED', R2: 'MOVED' });
  });

  it('with no other way round, a robot about to move away still makes the GOTO wait', () => {
    // 1-wide corridor. R2 is in the way and moves on to (2,0) this tick, but at planning time (1,0) is a wall.
    const s = fromMap('R1v R2> . .', { R1: 'GOTO 3,0', R2: 'MOVE' });
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'WAITING', R2: 'MOVED' });
    expect(cells(t.state)).toEqual({ R1: '0,0,SOUTH', R2: '2,0,EAST' });
    expect(robotOf(t.state, 'R1')).toMatchObject({ gotoNoPathTicks: 1, queue: [goto(3, 0)] });
  });

  it('the target cell itself counts as a wall while a robot stands on it', () => {
    const s = fromMap('R1> . R2>', { R1: 'GOTO 2,0' });
    expect(outcomes(tick(s).results)['R1']).toBe('WAITING');
  });

  it('a target is a wall while a robot stands on it, even if that robot is about to leave', () => {
    // 3x1. R1 steps off (0,0) this tick, but R2's target IS (0,0), so at planning time R2 has no path.
    const s = fromMap('R1> . R2>', { R1: 'GOTO 1,0', R2: 'GOTO 0,0' });
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'MOVED', R2: 'WAITING' });
  });
});

// ---------------------------------------------------------------------------
// No path: WAITING, UNREACHABLE, and the counter
// ---------------------------------------------------------------------------

describe('GOTO: no path, waiting and giving up', () => {
  it('a target held by another robot waits twice, gives up on the third tick, then the next command runs', () => {
    // R2 sits on the target (2,0) forever.
    let s = fromMap('R1> . R2>', { R1: 'GOTO 2,0 MOVE' });
    const seen: string[] = [];
    const counters: number[] = [];
    const queues: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = tick(s);
      s = t.state;
      seen.push(outcomes(t.results)['R1'] ?? '?');
      counters.push(robotOf(s, 'R1').gotoNoPathTicks);
      queues.push(robotOf(s, 'R1').queue.length);
    }
    // t1 WAITING (1), t2 WAITING (2), t3 UNREACHABLE (counter back to 0, GOTO dropped),
    // t4 the MOVE runs (the tick after UNREACHABLE, not the same tick), t5 idle.
    expect(seen).toEqual(['WAITING', 'WAITING', 'UNREACHABLE', 'MOVED', 'IDLE']);
    expect(counters).toEqual([1, 2, 0, 0, 0]);
    expect(queues).toEqual([2, 2, 1, 0, 0]);
    expect(cells(s)['R1']).toBe('1,0,EAST');
  });

  it('WAITING and UNREACHABLE results: command is the GOTO, nobody moves, facing is unchanged', () => {
    const s = fromMap('R1^ . R2>', { R1: 'GOTO 2,0' });
    const t = trail(s, 'R1', 3);
    expect(t.pose).toEqual(['0,0,NORTH', '0,0,NORTH', '0,0,NORTH']);
    for (const [i, res] of t.results.entries()) {
      const r = resultOf(res, 'R1');
      expect(r.command).toEqual(goto(2, 0));
      expect(r.from).toEqual({ x: 0, y: 0 });
      expect(r.to).toEqual({ x: 0, y: 0 });
      expect(r.reason).toBeUndefined();
      expect(r.outcome).toBe(i < 2 ? 'WAITING' : 'UNREACHABLE');
    }
  });

  it('UNREACHABLE drops the GOTO and the robot stays where it is, with an empty queue', () => {
    const s = fromMap('R1> . R2>', { R1: 'GOTO 2,0' });
    const end = ticks(s, 3).state;
    expect(robotOf(end, 'R1')).toMatchObject({ x: 0, y: 0, queue: [], gotoNoPathTicks: 0 });
    expect(outcomes(tick(end).results)['R1']).toBe('IDLE');
  });

  it('a target that becomes an obstacle after queuing is unreachable (validated at queue time only)', () => {
    let s = buildFloor(3, 3, [robot('R1', 0, 0, 'EAST', 'GOTO 2,2')]);
    s = ok(s, { type: 'SET_OBSTACLE', x: 2, y: 2, present: true }).state;
    expect(trail(s, 'R1', 3).out).toEqual(['WAITING', 'WAITING', 'UNREACHABLE']);
  });

  it('a target walled in by obstacles is unreachable', () => {
    // (2,2) is only reachable through (1,2) or (2,1); both are obstacles.
    const s = buildFloor(
      3,
      3,
      [robot('R1', 0, 0, 'EAST', 'GOTO 2,2')],
      [
        [1, 2],
        [2, 1],
      ],
    );
    const t = trail(s, 'R1', 3);
    expect(t.out).toEqual(['WAITING', 'WAITING', 'UNREACHABLE']);
    expect(t.at).toEqual(['0,0', '0,0', '0,0']);
  });

  it('a robot boxed in by obstacles and robots waits too', () => {
    const s = fromMap(
      `
      . . .
      # . .
      R1> R2> .
      `,
      { R1: 'GOTO 2,2' },
    );
    // R1 at (0,0): north is an obstacle (0,1), east is R2. No way out -> no path.
    expect(trail(s, 'R1', 3).out).toEqual(['WAITING', 'WAITING', 'UNREACHABLE']);
  });

  it('the counter restarts after a path reappears (2 waits, a path, then a full 3 new waits)', () => {
    // R1 wants (2,0), where R2 stands facing WEST. R2 turns (RIGHT -> NORTH) on tick 1 and
    // leaves on tick 2, to (2,1). R1 plans from the cells at the START of a tick, so:
    //   t1 R2 on target -> WAITING (1)   t2 R2 still on target -> WAITING (2)
    //   t3 R2 gone, path found -> MOVED to (1,0), counter reset to 0
    let s = fromMap(
      `
      . . .
      . . .
      R1> . R2<
      `,
      { R1: 'GOTO 2,0', R2: 'RIGHT MOVE' },
    );
    const first = trail(s, 'R1', 3);
    expect(first.out).toEqual(['WAITING', 'WAITING', 'MOVED']);
    s = first.state;
    expect(robotOf(s, 'R1')).toMatchObject({ x: 1, y: 0, gotoNoPathTicks: 0 });
    // R3 now parks on the target. If the counter had NOT been reset it would be 2 and R1 would give up
    // on the very next tick. With the reset it needs three full no-path ticks again.
    s = ok(s, { type: 'PLACE_ROBOT', id: 'R3', x: 2, y: 0, facing: 'NORTH' }).state;
    const second = trail(s, 'R1', 3);
    expect(second.out).toEqual(['WAITING', 'WAITING', 'UNREACHABLE']);
    expect(robotOf(second.state, 'R1').queue).toEqual([]);
  });

  it('a second GOTO behind one that gave up gets its own fresh 3-tick budget', () => {
    const s = fromMap('R1> . R2>', { R1: 'GOTO 2,0 GOTO 2,0' });
    const t = trail(s, 'R1', 6);
    expect(t.out).toEqual([
      'WAITING',
      'WAITING',
      'UNREACHABLE',
      'WAITING',
      'WAITING',
      'UNREACHABLE',
    ]);
    expect(robotOf(t.state, 'R1').queue).toEqual([]);
  });

  it('a robot that is waiting does not block the queue of other robots', () => {
    const s = fromMap('R1> . R2> . R3>', { R1: 'GOTO 2,0', R3: 'LEFT' });
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'WAITING', R2: 'IDLE', R3: 'TURNED' });
  });
});

describe('GOTO: counter resets', () => {
  it('re-PLACE resets the counter and keeps the queue', () => {
    let s = fromMap('R1^ . R2>', { R1: 'GOTO 2,0 RIGHT' });
    s = ticks(s, 2).state;
    expect(robotOf(s, 'R1').gotoNoPathTicks).toBe(2);
    // Placing a robot on its own cell is allowed (DECISIONS 4.4) and starts the count again.
    s = ok(s, { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'NORTH' }).state;
    expect(robotOf(s, 'R1')).toMatchObject({
      gotoNoPathTicks: 0,
      queue: [goto(2, 0), { kind: 'RIGHT' }],
    });
    const t = trail(s, 'R1', 4);
    // Three full no-path ticks again, then RIGHT turns the robot (NORTH -> EAST).
    expect(t.out).toEqual(['WAITING', 'WAITING', 'UNREACHABLE', 'TURNED']);
    expect(t.pose[3]).toBe('0,0,EAST');
  });

  it('CLEAR_QUEUE resets the counter, so a GOTO queued later has a full budget', () => {
    let s = fromMap('R1> . R2>', { R1: 'GOTO 2,0' });
    s = ticks(s, 2).state;
    expect(robotOf(s, 'R1').gotoNoPathTicks).toBe(2);
    s = ok(s, { type: 'CLEAR_QUEUE', id: 'R1' }).state;
    expect(robotOf(s, 'R1')).toMatchObject({ queue: [], gotoNoPathTicks: 0 });
    s = queue(s, 'R1', 'GOTO 2,0');
    expect(trail(s, 'R1', 3).out).toEqual(['WAITING', 'WAITING', 'UNREACHABLE']);
  });

  it('a path found resets the counter even when the resulting step is blocked', () => {
    // R5 wants (2,0) where R6 stands (facing WEST). R1 sits on (1,1) and will MOVE south into (1,0) on tick 3.
    //   t1: R1 turns RIGHT (to WEST), R6 turns RIGHT (to NORTH), R5: target held -> WAITING (1)
    //   t2: R1 turns LEFT (to SOUTH), R6 moves to (2,1),         R5: still held at planning time -> WAITING (2)
    //   t3: R1 MOVEs to (1,0). R5 now has a path, steps EAST into (1,0) too, and loses the contest to
    //       R1 (lower number): BLOCKED(CONTESTED). The GOTO stays; the counter is reset to 0.
    //   t4: R1 on (1,0) and R6 on (2,1) wall off the target -> no path again: WAITING with counter 1
    //       (it would be UNREACHABLE here if the blocked tick had not reset the counter).
    const s = fromMap(
      `
      . . .
      . R1v .
      R5^ . R6<
      `,
      { R1: 'RIGHT LEFT MOVE', R5: 'GOTO 2,0', R6: 'RIGHT MOVE' },
    );
    const t = trail(s, 'R5', 4);
    expect(t.out).toEqual(['WAITING', 'WAITING', blocked('CONTESTED'), 'WAITING']);
    // Facing: unchanged while waiting, turned toward the step (and kept) on the blocked tick.
    expect(t.pose).toEqual(['0,0,NORTH', '0,0,NORTH', '0,0,EAST', '0,0,EAST']);
    expect(robotOf(t.state, 'R5')).toMatchObject({ gotoNoPathTicks: 1, queue: [goto(2, 0)] });
    // And after exactly 3 ticks the counter was 0 (checked on a shorter run).
    const three = ticks(s, 3).state;
    expect(robotOf(three, 'R5')).toMatchObject({ gotoNoPathTicks: 0, queue: [goto(2, 0)] });
  });
});

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

describe('GOTO: arrival', () => {
  it('already at the target: ARRIVED, the tick is used up, then the next command runs', () => {
    const s = fromMap(
      `
      . . .
      . R1> .
      . . .
      `,
      { R1: 'GOTO 1,1 MOVE' },
    );
    const t = trail(s, 'R1', 2);
    expect(t.out).toEqual(['ARRIVED', 'MOVED']);
    expect(t.pose).toEqual(['1,1,EAST', '2,1,EAST']);
    const first = resultOf(t.results[0] ?? [], 'R1');
    expect(first.command).toEqual(goto(1, 1));
    expect(first.from).toEqual(first.to);
    expect(reached(first)).toBe(false); // reachedGoto is for GOTO steps; ARRIVED is its own outcome
  });

  it('arriving by a step is MOVED with reachedGoto, and the next command runs on the next tick', () => {
    const s = fromMap('R1> . .', { R1: 'GOTO 2,0 LEFT' });
    const t = trail(s, 'R1', 4);
    expect(t.out).toEqual(['MOVED', 'MOVED', 'TURNED', 'IDLE']);
    expect(t.results.map((res) => reached(resultOf(res, 'R1')))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(t.pose[2]).toBe('2,0,NORTH');
  });

  it('GOTO then GOTO: the second starts the tick after the first arrives', () => {
    const s = buildFloor(3, 3, [robot('R1', 0, 0, 'EAST', 'GOTO 2,0 GOTO 2,2')]);
    const t = trail(s, 'R1', 5);
    expect(t.at).toEqual(['1,0', '2,0', '2,1', '2,2', '2,2']);
    expect(t.out).toEqual(['MOVED', 'MOVED', 'MOVED', 'MOVED', 'IDLE']);
    expect(t.results.map((res) => reached(resultOf(res, 'R1')))).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it('GOTO in the middle of a mixed queue: MOVE, GOTO, LEFT run in order', () => {
    // R1 at (0,0) facing NORTH, 5x5. QUEUE R1 MOVE GOTO 2,2 LEFT.
    //   t1 MOVE -> (0,1)
    //   t2 GOTO from (0,1): N (0,2) and E (1,1) both leave distance 2 -> NORTH -> (0,2)
    //   t3 GOTO from (0,2): E (1,2) leaves distance 1 -> (1,2)
    //   t4 GOTO from (1,2): E (2,2) arrives (reachedGoto)
    //   t5 LEFT: facing EAST -> NORTH
    const s = buildFloor(5, 5, [robot('R1', 0, 0, 'NORTH', 'MOVE GOTO 2,2 LEFT')]);
    const t = trail(s, 'R1', 6);
    expect(t.pose).toEqual([
      '0,1,NORTH',
      '0,2,NORTH',
      '1,2,EAST',
      '2,2,EAST',
      '2,2,NORTH',
      '2,2,NORTH',
    ]);
    expect(t.out).toEqual(['MOVED', 'MOVED', 'MOVED', 'MOVED', 'TURNED', 'IDLE']);
    expect(reached(resultOf(t.results[3] ?? [], 'R1'))).toBe(true);
  });

  it('the robot ends facing the way of its last step', () => {
    const s = buildFloor(4, 4, [robot('R1', 0, 3, 'NORTH', 'GOTO 3,0')]);
    const end = ticks(s, 6).state;
    // 6 steps. At every cell of the top row EAST ties with SOUTH and wins, so the route is
    // (1,3),(2,3),(3,3) and then straight down; the last step is SOUTH.
    expect(cells(end)['R1']).toBe('3,0,SOUTH');
    expect(robotOf(end, 'R1').queue).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GOTO inside the simultaneous rules (1.3 still applies to the GOTO step)
// ---------------------------------------------------------------------------

describe('GOTO: interaction with other movers in the same tick', () => {
  it('loses a contest to a lower-numbered plain mover: BLOCKED(CONTESTED), GOTO kept, facing kept', () => {
    // R1 (plain, lower) and R3 (GOTO) both aim at (1,2). R4 follows R3 and must be BEHIND_BLOCKED.
    const s = fromMap(
      `
      R1> . .
      . R3< .
      . R4^ .
      `,
      { R1: 'MOVE', R3: 'GOTO 1,2', R4: 'MOVE' },
    );
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({
      R1: 'MOVED',
      R3: blocked('CONTESTED'),
      R4: blocked('BEHIND_BLOCKED'),
    });
    expect(cells(t.state)).toEqual({ R1: '1,2,EAST', R3: '1,1,NORTH', R4: '1,0,NORTH' });
    expect(robotOf(t.state, 'R3')).toMatchObject({ queue: [goto(1, 2)], gotoNoPathTicks: 0 });
    expect(reached(resultOf(t.results, 'R3'))).toBe(false);
  });

  it('a GOTO step that loses its contest is blocked even when it is the final step', () => {
    // 3x2 floor: (1,1) is R3's target and its last step. Blocked on the last step => the GOTO is not consumed.
    const s = fromMap(
      `
      R1> . .
      . R3< .
      `,
      { R1: 'MOVE', R3: 'GOTO 1,1' },
    );
    const t = tick(s);
    expect(robotOf(t.state, 'R3').queue).toEqual([goto(1, 1)]);
    // Next tick R1 sits on the target: R3 waits.
    expect(outcomes(tick(t.state).results)['R3']).toBe('WAITING');
  });

  it('wins a contest against a higher-numbered plain mover', () => {
    const s = fromMap(
      `
      . R2v .
      R1> . .
      . . .
      `,
      { R1: 'GOTO 2,1', R2: 'MOVE' },
    );
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
    expect(cells(t.state)).toEqual({ R1: '1,1,EAST', R2: '1,2,SOUTH' });
  });

  it('the GOTO robot has no special priority: a lower-numbered plain mover beats it', () => {
    const s = fromMap(
      `
      . R1v .
      R2> . .
      . . .
      `,
      { R1: 'MOVE', R2: 'GOTO 2,1' },
    );
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
    // The GOTO robot turned to face its step (EAST) and keeps that facing.
    expect(cells(t.state)).toEqual({ R1: '1,1,SOUTH', R2: '0,1,EAST' });
    expect(robotOf(t.state, 'R2').queue).toEqual([goto(2, 1)]);
  });

  it('a plain robot may follow a GOTO robot that moves away in the same tick', () => {
    const s = fromMap('R2> R1> . .', { R1: 'GOTO 3,0', R2: 'MOVE' });
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'MOVED', R2: 'MOVED' });
    expect(cells(t.state)).toEqual({ R1: '2,0,EAST', R2: '1,0,EAST' });
  });

  it('a plain robot behind a WAITING GOTO robot is blocked (OCCUPIED: the GOTO robot did not try to move)', () => {
    const s = fromMap('R2> R1> . R3>', { R1: 'GOTO 3,0', R2: 'MOVE' });
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({
      R1: 'WAITING',
      R2: blocked('OCCUPIED'),
      R3: 'IDLE',
    });
  });

  it('a plain robot behind a robot that ARRIVED this tick is blocked (OCCUPIED)', () => {
    const s = fromMap('R2> R1>', { R1: 'GOTO 1,0', R2: 'MOVE' });
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'ARRIVED', R2: blocked('OCCUPIED') });
    expect(cells(t.state)).toEqual({ R1: '1,0,EAST', R2: '0,0,EAST' });
  });

  it('two GOTO robots on different lanes do not disturb each other', () => {
    const s = fromMap(
      `
      R2> . .
      . . .
      R1> . .
      `,
      { R1: 'GOTO 2,0', R2: 'GOTO 2,2' },
    );
    const a = trail(s, 'R1', 2);
    const b = trail(s, 'R2', 2);
    expect(a.at).toEqual(['1,0', '2,0']);
    expect(b.at).toEqual(['1,2', '2,2']);
    expect(a.out).toEqual(['MOVED', 'MOVED']);
    expect(b.out).toEqual(['MOVED', 'MOVED']);
  });

  it("two GOTO robots whose targets are each other's cells meet in the middle and then wait: no swapping", () => {
    // 5x1. R1 (0,0) -> (3,0); R2 (4,0) -> (1,0). Both targets are free at the start, so both step:
    //   t1 R1 -> (1,0), R2 -> (3,0). From now on each stands on the other's target.
    //   t2 and t3: both WAITING. t4: both UNREACHABLE.
    const s = fromMap('R1> . . . R2<', { R1: 'GOTO 3,0', R2: 'GOTO 1,0' });
    const a = trail(s, 'R1', 4);
    const b = trail(s, 'R2', 4);
    expect(a.out).toEqual(['MOVED', 'WAITING', 'WAITING', 'UNREACHABLE']);
    expect(b.out).toEqual(['MOVED', 'WAITING', 'WAITING', 'UNREACHABLE']);
    expect(cells(a.state)).toEqual({ R1: '1,0,EAST', R2: '3,0,WEST' });
  });

  it("two GOTO robots standing on each other's targets both wait at once", () => {
    const s = fromMap('R1> . R2<', { R1: 'GOTO 2,0', R2: 'GOTO 0,0' });
    expect(outcomes(tick(s).results)).toEqual({ R1: 'WAITING', R2: 'WAITING' });
  });

  it('two GOTO robots whose first steps clash on one cell: the lower number wins', () => {
    // 3x3. R1 at (1,0) wants (1,2): its only shortest path is north through (1,1).
    // R3 at (0,1) wants (2,1): its only shortest path is east through (1,1). Both claim (1,1).
    const s = fromMap(
      `
      . . .
      R3> . .
      . R1^ .
      `,
      { R1: 'GOTO 1,2', R3: 'GOTO 2,1' },
    );
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: 'MOVED', R3: blocked('CONTESTED') });
    expect(cells(t.state)).toEqual({ R1: '1,1,NORTH', R3: '0,1,EAST' });
    expect(robotOf(t.state, 'R3').queue).toEqual([goto(2, 1)]);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('GOTO: purity', () => {
  it('does not mutate its input state and is deterministic', () => {
    const s = fromMap(
      `
      . . . .
      R1> # . .
      . R2^ . .
      `,
      { R1: 'GOTO 3,1 LEFT', R2: 'GOTO 3,0' },
    );
    const frozen = deepFreeze(structuredClone(s));
    const a = ticks(frozen, 5);
    const b = ticks(structuredClone(s), 5);
    expect(a).toEqual(b);
  });

  it('GOTO state survives a JSON round trip mid-journey (plain data)', () => {
    let s: FloorState = fromMap('R1> . . . R2>', { R1: 'GOTO 4,0' });
    s = ticks(s, 2).state;
    const copy = JSON.parse(JSON.stringify(s)) as FloorState;
    expect(ticks(copy, 3)).toEqual(ticks(s, 3));
  });
});
