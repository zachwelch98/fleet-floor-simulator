/**
 * Rule 1: walls. Leaving the floor or entering an obstacle is blocked (DECISIONS 2.1 step 3).
 * Reasons: WALL for off-floor targets, OBSTACLE for obstacle targets; both are decided before
 * contests, so a robot aiming at either never competes for a cell (DECISIONS 2.3).
 */
import { describe, expect, it } from 'vitest';
import { type Facing } from '../src/index.js';
import {
  blocked,
  buildFloor,
  cells,
  ok,
  outcomes,
  robot,
  tick,
  tickMap,
  ticks,
} from './helpers.js';

describe('floor edges (WALL)', () => {
  // 3x3 floor, robot on the middle of each edge facing out.
  const edgeCases: [string, number, number, Facing][] = [
    ['north edge', 1, 2, 'NORTH'],
    ['east edge', 2, 1, 'EAST'],
    ['south edge', 1, 0, 'SOUTH'],
    ['west edge', 0, 1, 'WEST'],
  ];

  it.each(edgeCases)(
    'a robot on the %s facing out is BLOCKED(WALL) and stays put',
    (_n, x, y, facing) => {
      const s = buildFloor(3, 3, [robot('R1', x, y, facing, 'MOVE')]);
      const t = tick(s);
      expect(cells(t.state)).toEqual({ R1: `${x},${y},${facing}` });
      expect(t.results).toEqual([
        {
          id: 'R1',
          command: { kind: 'MOVE' },
          outcome: 'BLOCKED',
          reason: 'WALL',
          from: { x, y },
          to: { x, y },
          facing,
        },
      ]);
    },
  );

  it.each([
    ['south-west corner facing south', 0, 0, 'SOUTH'],
    ['south-west corner facing west', 0, 0, 'WEST'],
    ['south-east corner facing south', 2, 0, 'SOUTH'],
    ['south-east corner facing east', 2, 0, 'EAST'],
    ['north-west corner facing north', 0, 2, 'NORTH'],
    ['north-west corner facing west', 0, 2, 'WEST'],
    ['north-east corner facing north', 2, 2, 'NORTH'],
    ['north-east corner facing east', 2, 2, 'EAST'],
  ] as [string, number, number, Facing][])('%s is BLOCKED(WALL)', (_n, x, y, facing) => {
    const s = buildFloor(3, 3, [robot('R1', x, y, facing, 'MOVE')]);
    expect(outcomes(tick(s).results)).toEqual({ R1: blocked('WALL') });
  });

  it('a robot facing along the edge is not blocked', () => {
    const s = buildFloor(3, 3, [robot('R1', 0, 0, 'EAST', 'MOVE')]);
    expect(cells(tick(s).state)).toEqual({ R1: '1,0,EAST' });
  });

  it('the last cell is reachable and the next MOVE is then blocked', () => {
    const s = buildFloor(3, 1, [robot('R1', 0, 0, 'EAST', 'MOVE MOVE MOVE')]);
    const { history, state } = ticks(s, 3);
    expect(history.map((r) => outcomes(r).R1)).toEqual(['MOVED', 'MOVED', blocked('WALL')]);
    expect(cells(state)).toEqual({ R1: '2,0,EAST' });
  });

  it('1x1 floor: every facing is walled in', () => {
    const s = buildFloor(1, 1, [
      robot('R1', 0, 0, 'NORTH', 'MOVE RIGHT MOVE RIGHT MOVE RIGHT MOVE'),
    ]);
    const { history, state } = ticks(s, 7);
    expect(history.map((r) => outcomes(r).R1)).toEqual([
      blocked('WALL'),
      'TURNED',
      blocked('WALL'),
      'TURNED',
      blocked('WALL'),
      'TURNED',
      blocked('WALL'),
    ]);
    expect(history.map((r) => r[0]?.facing)).toEqual([
      'NORTH',
      'EAST',
      'EAST',
      'SOUTH',
      'SOUTH',
      'WEST',
      'WEST',
    ]);
    expect(cells(state)).toEqual({ R1: '0,0,WEST' });
  });

  it('20x20 floor: the far corner is a wall in both outward directions', () => {
    const s = buildFloor(20, 20, [
      robot('R1', 19, 19, 'NORTH', 'MOVE'),
      robot('R2', 0, 0, 'WEST', 'MOVE'),
      robot('R3', 19, 0, 'EAST', 'MOVE'),
      robot('R4', 0, 19, 'NORTH', 'MOVE'),
    ]);
    expect(outcomes(tick(s).results)).toEqual({
      R1: blocked('WALL'),
      R2: blocked('WALL'),
      R3: blocked('WALL'),
      R4: blocked('WALL'),
    });
  });

  it('the wall block is not a turn: facing is unchanged', () => {
    const s = buildFloor(2, 2, [robot('R1', 1, 1, 'EAST', 'MOVE')]);
    expect(tick(s).results[0]?.facing).toBe('EAST');
  });
});

describe('obstacles (OBSTACLE)', () => {
  const dirs: [Facing, string][] = [
    // robot R1 at the centre (1,1) of a 3x3 floor, obstacle directly ahead
    ['NORTH', '. # .\n. R1^ .\n. . .'],
    ['EAST', '. . .\n. R1> #\n. . .'],
    ['SOUTH', '. . .\n. R1v .\n. # .'],
    ['WEST', '. . .\n# R1< .\n. . .'],
  ];

  it.each(dirs)('an obstacle directly %s blocks with OBSTACLE', (facing, map) => {
    const { pos, out } = tickMap(map, { R1: 'MOVE' });
    expect(pos).toEqual({ R1: `1,1,${facing}` });
    expect(out).toEqual({ R1: blocked('OBSTACLE') });
  });

  it('obstacles on the diagonal or behind do not block', () => {
    const { pos, out } = tickMap('# . #\n. R1^ .\n# . #', { R1: 'MOVE' });
    expect(pos).toEqual({ R1: '1,2,NORTH' });
    expect(out).toEqual({ R1: 'MOVED' });
  });

  it('a robot walks around an obstacle', () => {
    // R1 at (0,0) wants to reach (2,0) past an obstacle at (1,0): north, east, east, south...
    const s = buildFloor(
      3,
      2,
      [robot('R1', 0, 0, 'EAST', 'MOVE LEFT MOVE RIGHT MOVE MOVE RIGHT MOVE')],
      [[1, 0]],
    );
    const { history, state } = ticks(s, 8);
    expect(outcomes(history[0] ?? [])).toEqual({ R1: blocked('OBSTACLE') });
    // blocked MOVE; LEFT -> N; MOVE (0,1); RIGHT -> E; MOVE (1,1); MOVE (2,1); RIGHT -> S; MOVE (2,0)
    expect(cells(state)).toEqual({ R1: '2,0,SOUTH' });
  });

  it('a blocked move into an obstacle is consumed like any other command', () => {
    const s = buildFloor(3, 1, [robot('R1', 0, 0, 'EAST', 'MOVE MOVE')], [[1, 0]]);
    const t1 = tick(s);
    expect(t1.state.robots[0]?.queue).toHaveLength(1);
    const t2 = tick(t1.state);
    expect(outcomes(t2.results)).toEqual({ R1: blocked('OBSTACLE') });
    expect(t2.state.robots[0]?.queue).toEqual([]);
  });

  it('a robot between the floor edge and an obstacle reports the edge as WALL, not OBSTACLE', () => {
    const { out } = tickMap('# R1^', { R1: 'MOVE' });
    expect(out).toEqual({ R1: blocked('WALL') });
  });

  it('an obstacle added between ticks takes effect on the next tick', () => {
    let s = buildFloor(4, 1, [robot('R1', 0, 0, 'EAST', 'MOVE MOVE MOVE')]);
    s = tick(s).state; // R1 at (1,0)
    s = ok(s, { type: 'SET_OBSTACLE', x: 2, y: 0, present: true }).state;
    const t = tick(s);
    expect(outcomes(t.results)).toEqual({ R1: blocked('OBSTACLE') });
    expect(cells(t.state)).toEqual({ R1: '1,0,EAST' });
  });

  it('an obstacle removed between ticks opens the way', () => {
    let s = buildFloor(4, 1, [robot('R1', 0, 0, 'EAST', 'MOVE MOVE MOVE')], [[1, 0]]);
    s = tick(s).state; // blocked
    s = ok(s, { type: 'SET_OBSTACLE', x: 1, y: 0, present: false }).state;
    expect(cells(tick(s).state)).toEqual({ R1: '1,0,EAST' });
  });

  it('a robot behind a robot blocked by an obstacle is BEHIND_BLOCKED', () => {
    // R1 aims at the obstacle; R2 follows R1.
    const { pos, out } = tickMap('R2> R1> # .', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '0,0,EAST' });
    expect(out).toEqual({ R1: blocked('OBSTACLE'), R2: blocked('BEHIND_BLOCKED') });
  });

  it('precedence: two robots aiming at the same obstacle are both OBSTACLE, not CONTESTED', () => {
    // Obstacle decides before contests (DECISIONS 2.1 step 3 before 4; 2.3), so neither contests.
    const { pos, out } = tickMap('. R3v .\nR1> # R5<\n. . .', {
      R1: 'MOVE',
      R3: 'MOVE',
      R5: 'MOVE',
    });
    expect(pos).toEqual({ R1: '0,1,EAST', R3: '1,2,SOUTH', R5: '2,1,WEST' });
    expect(out).toEqual({
      R1: blocked('OBSTACLE'),
      R3: blocked('OBSTACLE'),
      R5: blocked('OBSTACLE'),
    });
  });
});
