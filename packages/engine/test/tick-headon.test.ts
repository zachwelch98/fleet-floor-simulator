/**
 * Rule 3: head-on swap. Two robots moving into each other's cells are both blocked (HEAD_ON).
 *
 * A robot directly behind one of the pair aims at the same cell as the pair member facing it, so
 * the contest step acts first (DECISIONS 2.7): the follower is CONTESTED if it has the higher
 * number; if it has the LOWER number it wins the contest, the pair member becomes CONTESTED and
 * the swap never forms. BEHIND_BLOCKED appears only one robot further back.
 */
import { describe, expect, it } from 'vitest';
import {
  blocked,
  buildFloor,
  cells,
  fromMap,
  outcomes,
  robot,
  tick,
  tickMap,
  ticks,
} from './helpers.js';

describe('the basic swap', () => {
  it('brief example b: R1 east and R2 west, adjacent: both HEAD_ON, neither moves', () => {
    const { pos, out } = tickMap('R1> R2<', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '1,0,WEST' });
    expect(out).toEqual({ R1: blocked('HEAD_ON'), R2: blocked('HEAD_ON') });
  });

  it('vertical swap in the middle of a bigger floor', () => {
    const { pos, out } = tickMap('. . .\n. R1v .\n. R2^ .\n. . .', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '1,2,SOUTH', R2: '1,1,NORTH' });
    expect(out).toEqual({ R1: blocked('HEAD_ON'), R2: blocked('HEAD_ON') });
  });

  it('priority does not matter for a swap: high numbers both block', () => {
    const { pos, out } = tickMap('R10> R2<', { R10: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R2: '1,0,WEST', R10: '0,0,EAST' });
    expect(out).toEqual({ R2: blocked('HEAD_ON'), R10: blocked('HEAD_ON') });
  });

  it('works on a 2x1 floor with nothing else around', () => {
    const { pos } = tickMap('R1> R2<', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '1,0,WEST' });
  });

  it('the blocked MOVE is consumed, so the pair is free to act on the next command', () => {
    const s = fromMap('R1> R2<', { R1: 'MOVE RIGHT', R2: 'MOVE' });
    const { history, state } = ticks(s, 2);
    expect(history.map(outcomes)).toEqual([
      { R1: blocked('HEAD_ON'), R2: blocked('HEAD_ON') },
      { R1: 'TURNED', R2: 'IDLE' },
    ]);
    expect(cells(state)).toEqual({ R1: '0,0,SOUTH', R2: '1,0,WEST' });
  });

  it('the same pair blocks again every tick they keep trying', () => {
    const s = fromMap('R1> R2<', { R1: 'MOVE MOVE MOVE', R2: 'MOVE MOVE MOVE' });
    const { history, state } = ticks(s, 3);
    for (const r of history)
      expect(outcomes(r)).toEqual({ R1: blocked('HEAD_ON'), R2: blocked('HEAD_ON') });
    expect(cells(state)).toEqual({ R1: '0,0,EAST', R2: '1,0,WEST' });
  });

  it('two separate head-on pairs in one tick are both blocked', () => {
    const { pos, out } = tickMap('R1> R2< . R3v\n. . . R4^', {
      R1: 'MOVE',
      R2: 'MOVE',
      R3: 'MOVE',
      R4: 'MOVE',
    });
    expect(pos).toEqual({ R1: '0,1,EAST', R2: '1,1,WEST', R3: '3,1,SOUTH', R4: '3,0,NORTH' });
    expect(out).toEqual({
      R1: blocked('HEAD_ON'),
      R2: blocked('HEAD_ON'),
      R3: blocked('HEAD_ON'),
      R4: blocked('HEAD_ON'),
    });
  });
});

describe('not a head-on swap', () => {
  it('one robot turning instead of moving: the mover is OCCUPIED', () => {
    const { pos, out } = tickMap('R1> R2<', { R1: 'MOVE', R2: 'LEFT' });
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '1,0,SOUTH' });
    expect(out).toEqual({ R1: blocked('OCCUPIED'), R2: 'TURNED' });
  });

  it('one robot idle: the mover is OCCUPIED', () => {
    const { out } = tickMap('R1> R2<', { R1: 'MOVE' });
    expect(out).toEqual({ R1: blocked('OCCUPIED'), R2: 'IDLE' });
  });

  it('two cells apart is a contest, not a head-on', () => {
    const { out } = tickMap('R1> . R2<', { R1: 'MOVE', R2: 'MOVE' });
    expect(out).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
  });

  it('perpendicular neighbours: the mover ahead leaves, the other follows; both move', () => {
    // R1 (0,0) E aims at (1,0), where R2 stands facing north and moves to (1,1).
    const { pos, out } = tickMap('. .\nR1> R2^', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '1,1,NORTH' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED' });
  });

  it('facing away from each other (back to back) both just walk away', () => {
    const { pos, out } = tickMap('. R1< R2> .', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,WEST', R2: '3,0,EAST' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED' });
  });
});

describe('robots behind a head-on pair (DECISIONS 2.7)', () => {
  it('a HIGHER-numbered follower loses the contest: CONTESTED, and the pair is still HEAD_ON', () => {
    // R1 (0,0) E <-> R2 (1,0) W swap. R3 (2,0) W aims at (1,0), the same cell R1 aims at; R1 wins.
    const { pos, out } = tickMap('R1> R2< R3<', { R1: 'MOVE', R2: 'MOVE', R3: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '1,0,WEST', R3: '2,0,WEST' });
    expect(out).toEqual({
      R1: blocked('HEAD_ON'),
      R2: blocked('HEAD_ON'),
      R3: blocked('CONTESTED'),
    });
  });

  it('one robot further back is BEHIND_BLOCKED', () => {
    const { pos, out } = tickMap('R1> R2< R3< R4< R5<', {
      R1: 'MOVE',
      R2: 'MOVE',
      R3: 'MOVE',
      R4: 'MOVE',
      R5: 'MOVE',
    });
    expect(pos).toEqual({
      R1: '0,0,EAST',
      R2: '1,0,WEST',
      R3: '2,0,WEST',
      R4: '3,0,WEST',
      R5: '4,0,WEST',
    });
    expect(out).toEqual({
      R1: blocked('HEAD_ON'),
      R2: blocked('HEAD_ON'),
      R3: blocked('CONTESTED'),
      R4: blocked('BEHIND_BLOCKED'),
      R5: blocked('BEHIND_BLOCKED'),
    });
  });

  it('a LOWER-numbered follower wins the contest: the pair member is CONTESTED and no swap forms', () => {
    // R2 (0,0) E and R3 (1,0) W would swap, but R1 (2,0) W also aims at (1,0) and wins it.
    // R2 loses (CONTESTED). R3 aims at (0,0), held by R2 who tried to move and was blocked
    // (BEHIND_BLOCKED). R1 aims at (1,0), held by blocked R3 (BEHIND_BLOCKED). Nobody moves.
    const { pos, out } = tickMap('R2> R3< R1<', { R1: 'MOVE', R2: 'MOVE', R3: 'MOVE' });
    expect(pos).toEqual({ R1: '2,0,WEST', R2: '0,0,EAST', R3: '1,0,WEST' });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'),
      R2: blocked('CONTESTED'),
      R3: blocked('BEHIND_BLOCKED'),
    });
  });

  it('a follower from the side (perpendicular) is also resolved by the contest first', () => {
    // R2 (0,0) E <-> R3 (1,0) W would swap. R1 (1,1) S aims at (1,0), the same cell R2 aims at, and
    // R1 has the lowest number, so it wins that cell. R2 is CONTESTED; R3 and R1 are BEHIND_BLOCKED.
    const map = `
      . R1v
      R2> R3<
    `;
    const { pos, out } = tickMap(map, { R1: 'MOVE', R2: 'MOVE', R3: 'MOVE' });
    expect(pos).toEqual({ R1: '1,1,SOUTH', R2: '0,0,EAST', R3: '1,0,WEST' });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'),
      R2: blocked('CONTESTED'),
      R3: blocked('BEHIND_BLOCKED'),
    });
  });

  it('a robot behind the pair that is idle changes nothing', () => {
    const { out } = tickMap('R1> R2< R3<', { R1: 'MOVE', R2: 'MOVE' });
    expect(out).toEqual({ R1: blocked('HEAD_ON'), R2: blocked('HEAD_ON'), R3: 'IDLE' });
  });

  it('the robot behind the pair on the other side is treated the same way', () => {
    const map = `
      R4v .
      R1> R3<
    `;
    // R1 (0,0) E <-> R3 (1,0) W swap; R4 (0,1) S aims at (0,0), the same cell R3 aims at. R3 < R4 wins.
    const { out } = tickMap(map, { R1: 'MOVE', R3: 'MOVE', R4: 'MOVE' });
    expect(out).toEqual({
      R1: blocked('HEAD_ON'),
      R3: blocked('HEAD_ON'),
      R4: blocked('CONTESTED'),
    });
  });
});

describe('placement order independence for head-on', () => {
  it('gives the same result however the pair was placed', () => {
    const specs = [
      robot('R4', 1, 1, 'WEST', 'MOVE'),
      robot('R9', 0, 1, 'EAST', 'MOVE'),
      robot('R2', 3, 3, 'NORTH', 'MOVE'),
    ];
    const a = tick(buildFloor(4, 4, specs));
    const b = tick(buildFloor(4, 4, [...specs].reverse()));
    expect(a.state).toEqual(b.state);
    expect(a.results).toEqual(b.results);
    expect(outcomes(a.results)).toEqual({
      R2: blocked('WALL'),
      R4: blocked('HEAD_ON'),
      R9: blocked('HEAD_ON'),
    });
  });
});
