/**
 * Rule 4: following. A robot may move into a cell occupied at the start of the tick only if that
 * robot successfully moves out during the same tick. If the robot in front is blocked, everyone
 * behind it is blocked too.
 *
 * Reasons (DECISIONS 2.4): OCCUPIED = the robot in front never tried to move (idle or turning);
 * BEHIND_BLOCKED = the robot in front tried to move and was blocked.
 */
import { describe, expect, it } from 'vitest';
import {
  blocked,
  buildFloor,
  cells,
  fromMap,
  ok,
  outcomes,
  robot,
  tick,
  tickMap,
  ticks,
} from './helpers.js';

const allMove = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'MOVE']));

describe('chains that move', () => {
  it('brief example a: R1, R2, R3 in a row all step forward together', () => {
    const { pos, out } = tickMap('R1> R2> R3> . .', allMove('R1', 'R2', 'R3'));
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '2,0,EAST', R3: '3,0,EAST' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: 'MOVED' });
  });

  it('the front robot has the HIGHEST number: priority does not matter for following', () => {
    const { pos, out } = tickMap('R3> R2> R1> . .', allMove('R1', 'R2', 'R3'));
    expect(pos).toEqual({ R3: '1,0,EAST', R2: '2,0,EAST', R1: '3,0,EAST' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: 'MOVED' });
  });

  it('R10 may follow R2 (ID order is irrelevant when no cell is contested)', () => {
    const { pos } = tickMap('R10> R2> .', allMove('R2', 'R10'));
    expect(pos).toEqual({ R2: '2,0,EAST', R10: '1,0,EAST' });
  });

  it('a chain of five moves one cell and keeps its spacing', () => {
    const { pos } = tickMap('R1> R2> R3> R4> R5> .', allMove('R1', 'R2', 'R3', 'R4', 'R5'));
    expect(pos).toEqual({
      R1: '1,0,EAST',
      R2: '2,0,EAST',
      R3: '3,0,EAST',
      R4: '4,0,EAST',
      R5: '5,0,EAST',
    });
  });

  it('vertical chain moving south', () => {
    const { pos } = tickMap('R1v\nR2v\nR3v\n.', allMove('R1', 'R2', 'R3'));
    // R1 at (0,3), R2 (0,2), R3 (0,1); free cell (0,0) is in front of R3.
    expect(pos).toEqual({ R1: '0,2,SOUTH', R2: '0,1,SOUTH', R3: '0,0,SOUTH' });
  });

  it('a chain that bends: followers go around the corner into the cells just vacated', () => {
    // R1 (2,2) E leads east; R2 (1,2) E follows; R3 (1,1) N follows R2; R4 (1,0) N follows R3.
    const map = `
      . R2> R1> .
      . R3^ . .
      . R4^ . .
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4'));
    expect(pos).toEqual({ R1: '3,2,EAST', R2: '2,2,EAST', R3: '1,2,NORTH', R4: '1,1,NORTH' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: 'MOVED', R4: 'MOVED' });
  });

  it('the leader may be moving sideways relative to the follower', () => {
    // R2 (0,0) E follows into (1,0), which R1 vacates by going north to (1,1).
    const { pos, out } = tickMap('. .\nR2> R1^', allMove('R1', 'R2'));
    expect(pos).toEqual({ R1: '1,1,NORTH', R2: '1,0,EAST' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED' });
  });

  it('a chain keeps moving over several ticks', () => {
    const s = fromMap('R1> R2> R3> . . .', {
      R1: 'MOVE MOVE MOVE',
      R2: 'MOVE MOVE MOVE',
      R3: 'MOVE MOVE MOVE',
    });
    const { state } = ticks(s, 3);
    expect(cells(state)).toEqual({ R1: '3,0,EAST', R2: '4,0,EAST', R3: '5,0,EAST' });
  });
});

describe('chains that are blocked', () => {
  it('lead blocked by the floor edge: the lead is WALL, everyone behind is BEHIND_BLOCKED', () => {
    const { pos, out } = tickMap('. R1> R2> R3>', allMove('R1', 'R2', 'R3'));
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '2,0,EAST', R3: '3,0,EAST' });
    expect(out).toEqual({
      R3: blocked('WALL'),
      R2: blocked('BEHIND_BLOCKED'),
      R1: blocked('BEHIND_BLOCKED'),
    });
  });

  it('lead blocked by an obstacle: OBSTACLE then BEHIND_BLOCKED all the way back', () => {
    const { pos, out } = tickMap('R4> R3> R2> R1> # .', allMove('R1', 'R2', 'R3', 'R4'));
    expect(pos).toEqual({ R4: '0,0,EAST', R3: '1,0,EAST', R2: '2,0,EAST', R1: '3,0,EAST' });
    expect(out).toEqual({
      R1: blocked('OBSTACLE'),
      R2: blocked('BEHIND_BLOCKED'),
      R3: blocked('BEHIND_BLOCKED'),
      R4: blocked('BEHIND_BLOCKED'),
    });
  });

  it('lead idle: the robot right behind is OCCUPIED, the rest BEHIND_BLOCKED', () => {
    const { pos, out } = tickMap('R1> R2> R3> .', allMove('R1', 'R2'));
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '1,0,EAST', R3: '2,0,EAST' });
    expect(out).toEqual({ R1: blocked('BEHIND_BLOCKED'), R2: blocked('OCCUPIED'), R3: 'IDLE' });
  });

  it('lead turning on the spot occupies its cell for the whole tick', () => {
    const { pos, out } = tickMap('R1> R2> R3> .', { R1: 'MOVE', R2: 'MOVE', R3: 'LEFT' });
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '1,0,EAST', R3: '2,0,NORTH' });
    expect(out).toEqual({ R1: blocked('BEHIND_BLOCKED'), R2: blocked('OCCUPIED'), R3: 'TURNED' });
  });

  it('a stationary robot in the middle splits the chain: front part moves, back part is blocked', () => {
    // R1 (0,0), R2 (1,0) move; R3 (2,0) is idle; R4 (3,0) moves away to (4,0).
    const { pos, out } = tickMap('R1> R2> R3> R4> .', { R1: 'MOVE', R2: 'MOVE', R4: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '1,0,EAST', R3: '2,0,EAST', R4: '4,0,EAST' });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'),
      R2: blocked('OCCUPIED'),
      R3: 'IDLE',
      R4: 'MOVED',
    });
  });

  it('lead loses a contest: followers are BEHIND_BLOCKED', () => {
    // R1 (2,1) S and R5 (1,0) E both aim at (2,0); R1 wins. R6 (0,0) E follows R5.
    const map = `
      . . R1v
      R6> R5> .
    `;
    const { pos, out } = tickMap(map, { R1: 'MOVE', R5: 'MOVE', R6: 'MOVE' });
    expect(pos).toEqual({ R1: '2,0,SOUTH', R5: '1,0,EAST', R6: '0,0,EAST' });
    expect(out).toEqual({ R1: 'MOVED', R5: blocked('CONTESTED'), R6: blocked('BEHIND_BLOCKED') });
  });

  it('a blocked lead blocks followers over the whole queue, tick after tick', () => {
    const s = fromMap('R1> R2> R3>', {
      R1: 'MOVE MOVE',
      R2: 'MOVE MOVE',
      R3: 'MOVE MOVE',
    });
    const { history, state } = ticks(s, 2);
    for (const r of history) {
      expect(outcomes(r)).toEqual({
        R1: blocked('BEHIND_BLOCKED'),
        R2: blocked('BEHIND_BLOCKED'),
        R3: blocked('WALL'),
      });
    }
    expect(cells(state)).toEqual({ R1: '0,0,EAST', R2: '1,0,EAST', R3: '2,0,EAST' });
  });

  it('the whole chain moves once the obstacle in front of the lead is removed', () => {
    let s = fromMap('R1> R2> # .', { R1: 'MOVE MOVE', R2: 'MOVE MOVE' });
    s = tick(s).state; // R2 hits the obstacle, R1 is blocked behind it
    expect(cells(s)).toEqual({ R1: '0,0,EAST', R2: '1,0,EAST' });
    s = ok(s, { type: 'SET_OBSTACLE', x: 2, y: 0, present: false }).state;
    expect(cells(tick(s).state)).toEqual({ R1: '1,0,EAST', R2: '2,0,EAST' });
  });
});

describe('moving into a cell vacated this tick', () => {
  it('a robot that moves out frees its cell for a different robot coming from the side', () => {
    // R1 (1,0) E leaves to (2,0); R2 (1,1) S drops into the vacated (1,0).
    const { pos, out } = tickMap('. R2v .\n. R1> .', allMove('R1', 'R2'));
    expect(pos).toEqual({ R1: '2,0,EAST', R2: '1,0,SOUTH' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED' });
  });

  it('a robot cannot enter a cell that a robot is merely turning in', () => {
    const { pos, out } = tickMap('. R2v .\n. R1> .', { R1: 'LEFT', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '1,0,NORTH', R2: '1,1,SOUTH' });
    expect(out).toEqual({ R1: 'TURNED', R2: blocked('OCCUPIED') });
  });

  it('the follower does not move further than one cell even if the lead leaves two cells of room', () => {
    const { pos } = tickMap('R1> R2> . . .', allMove('R1', 'R2'));
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '2,0,EAST' });
  });
});

describe('independence from placement order', () => {
  it('a three-robot chain gives the same result for every placement order', () => {
    const specs = [
      robot('R3', 2, 0, 'EAST', 'MOVE'),
      robot('R1', 0, 0, 'EAST', 'MOVE'),
      robot('R2', 1, 0, 'EAST', 'MOVE'),
    ];
    const a = tick(buildFloor(4, 1, specs));
    const b = tick(buildFloor(4, 1, [specs[1]!, specs[2]!, specs[0]!]));
    const c = tick(buildFloor(4, 1, [...specs].reverse()));
    expect(a.state).toEqual(b.state);
    expect(a.state).toEqual(c.state);
    expect(cells(a.state)).toEqual({ R1: '1,0,EAST', R2: '2,0,EAST', R3: '3,0,EAST' });
  });
});
