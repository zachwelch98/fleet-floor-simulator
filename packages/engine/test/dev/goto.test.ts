import { describe, expect, it } from 'vitest';
import { firstStepToward } from '../../src/pathfinding.js';
import { cells, fromMap, ok, outcomes, queue, robotOf, tick, ticks } from '../helpers.js';

describe('GOTO execution', () => {
  it('walks a straight line and arrives on the last step', () => {
    const start = fromMap('R1> . . . .', { R1: 'GOTO 4,0' });
    const { state, history } = ticks(start, 4);

    expect(history.map((results) => outcomes(results).R1)).toEqual([
      'MOVED',
      'MOVED',
      'MOVED',
      'MOVED',
    ]);
    expect(history.map((results) => results[0]?.reachedGoto)).toEqual([
      undefined,
      undefined,
      undefined,
      true,
    ]);
    expect(cells(state).R1).toBe('4,0,EAST');
    expect(robotOf(state, 'R1').queue).toEqual([]);
  });

  it('keeps the GOTO queued until the step onto the target', () => {
    const { state } = ticks(fromMap('R1> . . .', { R1: 'GOTO 3,0' }), 2);
    expect(robotOf(state, 'R1').queue).toEqual([{ kind: 'GOTO', x: 3, y: 0 }]);
  });

  it('prefers NORTH, then EAST, when several first steps are equally short', () => {
    const start = fromMap(
      `
      . . .
      . . .
      R1v . .
      `,
      { R1: 'GOTO 2,2' },
    );
    const first = tick(start);
    // Turning is free: facing SOUTH at the start, NORTH after the first step.
    expect(cells(first.state).R1).toBe('0,1,NORTH');

    const { history } = ticks(start, 4);
    const route = history.map((results) => results[0]?.facing);
    expect(route).toEqual(['NORTH', 'NORTH', 'EAST', 'EAST']);
  });

  it('prefers SOUTH over WEST when only those two are equally short', () => {
    const start = fromMap(
      `
      . . R1>
      . . .
      . . .
      `,
      { R1: 'GOTO 0,0' },
    );
    const first = tick(start);
    expect(cells(first.state).R1).toBe('2,1,SOUTH');
  });

  it('routes around obstacles', () => {
    const start = fromMap(
      `
      . . .
      # # .
      R1^ . .
      `,
      { R1: 'GOTO 0,2' },
    );
    // The straight way north is walled off, so the robot goes round: E, E, N, N, W, W.
    const { state, history } = ticks(start, 6);
    expect(history.flat().map((result) => result.outcome)).toEqual(Array(6).fill('MOVED'));
    expect(history.map((results) => results[0]?.facing)).toEqual([
      'EAST',
      'EAST',
      'NORTH',
      'NORTH',
      'WEST',
      'WEST',
    ]);
    expect(cells(state).R1).toBe('0,2,WEST');
    expect(robotOf(state, 'R1').queue).toEqual([]);
  });

  it('treats the target as a wall while another robot sits on it: WAITING, WAITING, UNREACHABLE, then the next command', () => {
    const start = fromMap(
      `
      R1> . R2^ .
      `,
      { R1: 'GOTO 2,0 MOVE' },
    );
    const { state, history } = ticks(start, 3);

    expect(history.map((results) => outcomes(results).R1)).toEqual([
      'WAITING',
      'WAITING',
      'UNREACHABLE',
    ]);
    expect(history.map((results) => results[0]?.to)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(robotOf(state, 'R1').queue).toEqual([{ kind: 'MOVE' }]);
    expect(robotOf(state, 'R1').gotoNoPathTicks).toBe(0);

    // Tick 4: the queued MOVE runs.
    const fourth = tick(state);
    expect(outcomes(fourth.results).R1).toBe('MOVED');
    expect(cells(fourth.state).R1).toBe('1,0,EAST');
  });

  it('leaves the facing unchanged while waiting', () => {
    const start = fromMap('R1v . R2^ .', { R1: 'GOTO 2,0' });
    // R1 faces SOUTH on a 1-row floor; no path, so it must not turn.
    const { state } = ticks(start, 2);
    expect(cells(state).R1).toBe('0,0,SOUTH');
    expect(robotOf(state, 'R1').gotoNoPathTicks).toBe(2);
  });

  it('resets the no-path counter when a path reappears', () => {
    const start = fromMap('R1> . R2^ .', { R1: 'GOTO 2,0' });
    const waiting = ticks(start, 2).state;
    expect(robotOf(waiting, 'R1').gotoNoPathTicks).toBe(2);

    // R2 leaves: the path comes back, R1 steps, and the counter is back at 0.
    const cleared = ok(waiting, { type: 'REMOVE_ROBOT', id: 'R2' }).state;
    const stepped = tick(cleared);
    expect(outcomes(stepped.results).R1).toBe('MOVED');
    expect(robotOf(stepped.state, 'R1').gotoNoPathTicks).toBe(0);

    // R2 comes back: one WAITING tick, not an UNREACHABLE from the earlier two.
    const blockedAgain = ok(stepped.state, {
      type: 'PLACE_ROBOT',
      id: 'R2',
      x: 2,
      y: 0,
      facing: 'NORTH',
    }).state;
    const next = tick(blockedAgain);
    expect(outcomes(next.results).R1).toBe('WAITING');
    expect(robotOf(next.state, 'R1').gotoNoPathTicks).toBe(1);
  });

  it('is BLOCKED(CONTESTED) when the step loses a contest, keeps the GOTO and the new facing', () => {
    const start = fromMap(
      `
      R2^ . .
      . R1^ .
      `,
      { R1: 'MOVE', R2: 'GOTO 2,1' },
    );
    const first = tick(start);
    expect(outcomes(first.results)).toEqual({ R1: 'MOVED', R2: 'BLOCKED(CONTESTED)' });
    expect(cells(first.state).R2).toBe('0,1,EAST');
    expect(robotOf(first.state, 'R2').queue).toEqual([{ kind: 'GOTO', x: 2, y: 1 }]);
    expect(robotOf(first.state, 'R2').gotoNoPathTicks).toBe(0);

    // R1 now sits in the way (a wall for the search), so R2 detours south.
    const second = tick(first.state);
    expect(outcomes(second.results).R2).toBe('MOVED');
    expect(cells(second.state).R2).toBe('0,0,SOUTH');
  });

  it('finishes an already-at-target GOTO as ARRIVED and removes it', () => {
    const start = fromMap('. R1> .', { R1: 'GOTO 1,0 MOVE' });
    const first = tick(start);
    expect(outcomes(first.results).R1).toBe('ARRIVED');
    expect(first.results[0]?.reachedGoto).toBeUndefined();
    expect(cells(first.state).R1).toBe('1,0,EAST');
    expect(robotOf(first.state, 'R1').queue).toEqual([{ kind: 'MOVE' }]);

    const second = tick(first.state);
    expect(outcomes(second.results).R1).toBe('MOVED');
    expect(cells(second.state).R1).toBe('2,0,EAST');
  });

  it('runs a GOTO then a MOVE from one queue', () => {
    const { state, history } = ticks(fromMap('R1> . . . .', { R1: 'GOTO 2,0 MOVE' }), 3);
    expect(history.map((results) => results[0]?.reachedGoto)).toEqual([undefined, true, undefined]);
    expect(cells(state).R1).toBe('3,0,EAST');
    expect(robotOf(state, 'R1').queue).toEqual([]);
  });

  it('makes a GOTO robot stuck behind another in a one-wide corridor wait, since the leader is a wall', () => {
    const start = fromMap('R1> R2> . . .', { R1: 'GOTO 3,0', R2: 'GOTO 2,0' });
    const { state, history } = ticks(start, 3);
    expect(history.map((results) => outcomes(results))).toEqual([
      { R1: 'WAITING', R2: 'MOVED' },
      { R1: 'WAITING', R2: 'IDLE' },
      { R1: 'UNREACHABLE', R2: 'IDLE' },
    ]);
    expect(history[0]?.[1]?.reachedGoto).toBe(true);
    expect(cells(state)).toEqual({ R1: '0,0,EAST', R2: '2,0,EAST' });
  });

  it('lets two GOTO robots run side by side in a two-wide corridor', () => {
    const start = fromMap(
      `
      R2> . . .
      R1> . . .
      `,
      { R1: 'GOTO 3,0', R2: 'GOTO 3,1' },
    );
    const { state, history } = ticks(start, 3);
    expect(history.flat().map((result) => result.outcome)).toEqual(Array(6).fill('MOVED'));
    expect(cells(state)).toEqual({ R1: '3,0,EAST', R2: '3,1,EAST' });
  });

  it('gives up for two GOTO robots facing each other in a one-wide corridor', () => {
    const start = fromMap('R1> . . . R2<', { R1: 'GOTO 4,0', R2: 'GOTO 0,0' });
    const { state, history } = ticks(start, 3);
    expect(history.map((results) => outcomes(results))).toEqual([
      { R1: 'WAITING', R2: 'WAITING' },
      { R1: 'WAITING', R2: 'WAITING' },
      { R1: 'UNREACHABLE', R2: 'UNREACHABLE' },
    ]);
    expect(cells(state)).toEqual({ R1: '0,0,EAST', R2: '4,0,WEST' });
  });

  it('detours around an idle robot in a two-wide corridor', () => {
    const start = fromMap(
      `
      . . . . .
      R1> . R2^ . .
      `,
      { R1: 'GOTO 4,0' },
    );
    const { state, history } = ticks(start, 6);
    expect(history.map((results) => outcomes(results).R1)).toEqual(Array(6).fill('MOVED'));
    expect(cells(state).R1).toBe('4,0,SOUTH');
  });

  it('CLEAR_QUEUE resets the no-path counter', () => {
    const waiting = ticks(fromMap('R1> . R2^ .', { R1: 'GOTO 2,0' }), 2).state;
    expect(robotOf(waiting, 'R1').gotoNoPathTicks).toBe(2);

    const cleared = ok(waiting, { type: 'CLEAR_QUEUE', id: 'R1' }).state;
    expect(robotOf(cleared, 'R1').gotoNoPathTicks).toBe(0);

    // A fresh GOTO gets its whole budget: WAITING, WAITING, UNREACHABLE again.
    const again = queue(cleared, 'R1', 'GOTO 2,0');
    const { history } = ticks(again, 3);
    expect(history.map((results) => outcomes(results).R1)).toEqual([
      'WAITING',
      'WAITING',
      'UNREACHABLE',
    ]);
  });
});

describe('firstStepToward', () => {
  it('returns null when the target is held by another robot', () => {
    const state = fromMap('R1> . R2^');
    expect(firstStepToward(state, robotOf(state, 'R1'), { x: 2, y: 0 })).toBeNull();
  });

  it('returns null when walled in', () => {
    const state = fromMap(
      `
      . # .
      # R1^ #
      . # .
      `,
    );
    expect(firstStepToward(state, robotOf(state, 'R1'), { x: 0, y: 0 })).toBeNull();
  });

  it('returns null when already on the target', () => {
    const state = fromMap('R1> .');
    expect(firstStepToward(state, robotOf(state, 'R1'), { x: 0, y: 0 })).toBeNull();
  });

  it('treats other robots as walls but ignores the mover itself', () => {
    const state = fromMap(
      `
      . R2^ .
      R1> . .
      `,
    );
    // Straight to (2,1) would pass (1,1); R2 is there, so the route is E, E, N.
    expect(firstStepToward(state, robotOf(state, 'R1'), { x: 2, y: 1 })).toBe('EAST');
  });
});
