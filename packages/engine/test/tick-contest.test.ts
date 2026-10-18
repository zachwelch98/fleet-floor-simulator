/**
 * Rule 2: contested cell. If several robots try to move into the same cell, the lowest robot
 * NUMBER wins the right to try (R2 beats R10); all the others are BLOCKED(CONTESTED), even if the
 * winner then turns out to be blocked itself (DECISIONS 2.2: no retry for the losers).
 *
 * Map reminder: top row of an ASCII map is the north-most row; `R1>` = robot 1 facing EAST.
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

describe('two robots, one cell', () => {
  it('lowest number wins: R1 vs R2 meeting in the middle with a one-cell gap', () => {
    // R1 (0,0) E and R2 (2,0) W both aim at (1,0).
    const { pos, out } = tickMap('R1> . R2<', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '2,0,WEST' });
    expect(out).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
  });

  it('numbers are compared as integers, not strings: R2 beats R10', () => {
    // "R10" < "R2" as strings, so a string compare would wrongly pick R10.
    const { pos, out } = tickMap('R10> . R2<', { R10: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R2: '1,0,WEST', R10: '0,0,EAST' });
    expect(out).toEqual({ R2: 'MOVED', R10: blocked('CONTESTED') });
  });

  it('R9 beats R10 and R100 beats nobody lower', () => {
    const a = tickMap('R9> . R10<', { R9: 'MOVE', R10: 'MOVE' });
    expect(a.out).toEqual({ R9: 'MOVED', R10: blocked('CONTESTED') });
    const b = tickMap('R100> . R20<', { R100: 'MOVE', R20: 'MOVE' });
    expect(b.out).toEqual({ R20: 'MOVED', R100: blocked('CONTESTED') });
  });

  it('the winner does not depend on which side it comes from', () => {
    const left = tickMap('R1> . R2<', { R1: 'MOVE', R2: 'MOVE' });
    const right = tickMap('R2> . R1<', { R1: 'MOVE', R2: 'MOVE' });
    expect(left.out).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
    expect(right.out).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
    expect(right.pos).toEqual({ R1: '1,0,WEST', R2: '0,0,EAST' });
  });

  it('the winner does not depend on the order the robots were placed in', () => {
    const specs = [robot('R2', 0, 0, 'EAST', 'MOVE'), robot('R7', 2, 0, 'WEST', 'MOVE')];
    for (const order of [specs, [...specs].reverse()]) {
      const t = tick(buildFloor(3, 1, order));
      expect(outcomes(t.results)).toEqual({ R2: 'MOVED', R7: blocked('CONTESTED') });
    }
  });

  it('perpendicular approach: south-moving R1 and east-moving R2 meet at (1,1)', () => {
    // R1 (1,2) S -> (1,1); R2 (0,1) E -> (1,1).
    const { pos, out } = tickMap('. R1v .\nR2> . .\n. . .', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '1,1,SOUTH', R2: '0,1,EAST' });
    expect(out).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
  });

  it('the loser keeps its position and facing, and its command is used up', () => {
    const s = fromMap('R1> . R2<', { R1: 'MOVE', R2: 'MOVE LEFT' });
    const t = tick(s);
    const r2 = t.state.robots.find((r) => r.id === 'R2');
    expect(r2).toMatchObject({ x: 2, y: 0, facing: 'WEST' });
    expect(r2?.queue).toEqual([{ kind: 'LEFT' }]);
  });

  it('the loser retries next tick and finds the cell occupied by the winner', () => {
    // Tick 2: R2 retries MOVE into (1,0) which now holds the idle R1.
    const s = fromMap('R1> . R2<', { R1: 'MOVE', R2: 'MOVE MOVE' });
    const { history } = ticks(s, 2);
    expect(outcomes(history[0] ?? [])).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED') });
    expect(outcomes(history[1] ?? [])).toEqual({ R1: 'IDLE', R2: blocked('OCCUPIED') });
  });
});

describe('three and four-way contests', () => {
  it('three robots on a 5x5: lowest of R3, R4, R5 wins (2,2)', () => {
    const map = `
      . . . . .
      . . . . .
      . R3> . R4< .
      . . R5^ . .
      . . . . .
    `;
    const { pos, out } = tickMap(map, { R3: 'MOVE', R4: 'MOVE', R5: 'MOVE' });
    expect(pos).toEqual({ R3: '2,2,EAST', R4: '3,2,WEST', R5: '2,1,NORTH' });
    expect(out).toEqual({ R3: 'MOVED', R4: blocked('CONTESTED'), R5: blocked('CONTESTED') });
  });

  it('four robots from all four sides: R3 wins over R9, R5 and R7', () => {
    const { pos, out } = tickMap(
      `
      . R9v .
      R7> . R5<
      . R3^ .
      `,
      { R3: 'MOVE', R5: 'MOVE', R7: 'MOVE', R9: 'MOVE' },
    );
    expect(pos).toEqual({ R3: '1,1,NORTH', R5: '2,1,WEST', R7: '0,1,EAST', R9: '1,2,SOUTH' });
    expect(out).toEqual({
      R3: 'MOVED',
      R5: blocked('CONTESTED'),
      R7: blocked('CONTESTED'),
      R9: blocked('CONTESTED'),
    });
  });

  it('only the movers contest: a robot that merely sits next to the cell does not', () => {
    // R1 (0,0) E and R3 (2,0) W contest (1,0); R2 at (1,1) is idle and unaffected.
    const { out, pos } = tickMap('. R2^ .\nR1> . R3<', { R1: 'MOVE', R3: 'MOVE' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'IDLE', R3: blocked('CONTESTED') });
    expect(pos.R2).toBe('1,1,NORTH');
  });

  it('a turning robot does not contest the cell it is facing', () => {
    // R1 turns LEFT while R2 moves into the cell R1 faces: R2 simply moves.
    const { out, pos } = tickMap('R1> . R2<', { R1: 'LEFT', R2: 'MOVE' });
    expect(out).toEqual({ R1: 'TURNED', R2: 'MOVED' });
    expect(pos).toEqual({ R1: '0,0,NORTH', R2: '1,0,WEST' });
  });

  it('two independent contests in the same tick resolve independently', () => {
    // Contest A at (1,0): R4 vs R6 (R4 wins). Contest B at (1,3): R2 vs R9 (R2 wins).
    const map = `
      R2> . R9<
      . . .
      . . .
      R6> . R4<
    `;
    const { out, pos } = tickMap(map, { R2: 'MOVE', R9: 'MOVE', R4: 'MOVE', R6: 'MOVE' });
    expect(out).toEqual({
      R2: 'MOVED',
      R4: 'MOVED',
      R6: blocked('CONTESTED'),
      R9: blocked('CONTESTED'),
    });
    expect(pos).toEqual({ R2: '1,3,EAST', R4: '1,0,WEST', R6: '0,0,EAST', R9: '2,3,WEST' });
  });
});

describe('contest losers and the robots behind them', () => {
  it('brief example c: a robot behind the loser is BEHIND_BLOCKED', () => {
    // R1 (0,1) E; R2 (2,1) W; R3 (3,1) W follows R2. R1 beats R2 for (1,1); R2 stays, so R3 stays.
    const { pos, out } = tickMap('R1> . R2< R3< .', { R1: 'MOVE', R2: 'MOVE', R3: 'MOVE' });
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '2,0,WEST', R3: '3,0,WEST' });
    expect(out).toEqual({ R1: 'MOVED', R2: blocked('CONTESTED'), R3: blocked('BEHIND_BLOCKED') });
  });

  it('a long queue behind the loser all stays put', () => {
    const { pos, out } = tickMap('R1> . R2< R3< R4< R5<', {
      R1: 'MOVE',
      R2: 'MOVE',
      R3: 'MOVE',
      R4: 'MOVE',
      R5: 'MOVE',
    });
    expect(pos).toEqual({
      R1: '1,0,EAST',
      R2: '2,0,WEST',
      R3: '3,0,WEST',
      R4: '4,0,WEST',
      R5: '5,0,WEST',
    });
    expect(out).toEqual({
      R1: 'MOVED',
      R2: blocked('CONTESTED'),
      R3: blocked('BEHIND_BLOCKED'),
      R4: blocked('BEHIND_BLOCKED'),
      R5: blocked('BEHIND_BLOCKED'),
    });
  });
});

describe('contest winner that is then blocked (DECISIONS 2.2, 2.3)', () => {
  it('winner blocked by an idle robot in the cell: winner OCCUPIED, loser still CONTESTED', () => {
    // R9 sits idle on (1,0); R1 (0,0) E and R2 (2,0) W both aim at it. R1 wins the right to try
    // but is blocked. R2 does not retry.
    const { pos, out } = tickMap('R1> R9^ R2<', { R1: 'MOVE', R2: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,EAST', R2: '2,0,WEST', R9: '1,0,NORTH' });
    expect(out).toEqual({ R1: blocked('OCCUPIED'), R2: blocked('CONTESTED'), R9: 'IDLE' });
  });

  it('winner blocked behind a robot that lost an earlier contest: BEHIND_BLOCKED, loser CONTESTED', () => {
    // Contest A at (2,0): R1 (2,1) S vs R5 (1,0) E; R1 wins and moves; R5 is CONTESTED.
    // Contest B at (1,0): R3 (0,0) E and R4 (1,1) S both aim at R5's cell. R3 wins the right to try,
    // but R5 is blocked, so R3 is BEHIND_BLOCKED; R4 stays CONTESTED.
    const map = `
      . R4v R1v
      R3> R5> .
    `;
    const { pos, out } = tickMap(map, { R1: 'MOVE', R3: 'MOVE', R4: 'MOVE', R5: 'MOVE' });
    expect(pos).toEqual({ R1: '2,0,SOUTH', R3: '0,0,EAST', R4: '1,1,SOUTH', R5: '1,0,EAST' });
    expect(out).toEqual({
      R1: 'MOVED',
      R3: blocked('BEHIND_BLOCKED'),
      R4: blocked('CONTESTED'),
      R5: blocked('CONTESTED'),
    });
  });

  it('winner follows a robot that leaves: both move, loser CONTESTED', () => {
    // R1 (1,1) E leaves to (2,1). R2 (0,1) E and R3 (1,0) N both aim at (1,1). R2 wins, follows R1.
    const map = `
      R2> R1> .
      . R3^ .
    `;
    const { pos, out } = tickMap(map, { R1: 'MOVE', R2: 'MOVE', R3: 'MOVE' });
    expect(pos).toEqual({ R1: '2,1,EAST', R2: '1,1,EAST', R3: '1,0,NORTH' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: blocked('CONTESTED') });
  });

  it('winner follows a robot that is blocked by an obstacle: BEHIND_BLOCKED, loser CONTESTED', () => {
    const map = `
      R2> R1> #
      . R3^ .
    `;
    const { pos, out } = tickMap(map, { R1: 'MOVE', R2: 'MOVE', R3: 'MOVE' });
    expect(pos).toEqual({ R1: '1,1,EAST', R2: '0,1,EAST', R3: '1,0,NORTH' });
    expect(out).toEqual({
      R1: blocked('OBSTACLE'),
      R2: blocked('BEHIND_BLOCKED'),
      R3: blocked('CONTESTED'),
    });
  });

  it('winner follows a robot that turns instead of moving: OCCUPIED, loser CONTESTED', () => {
    const map = `
      R2> R1> .
      . R3^ .
    `;
    const { out } = tickMap(map, { R1: 'LEFT', R2: 'MOVE', R3: 'MOVE' });
    expect(out).toEqual({ R1: 'TURNED', R2: blocked('OCCUPIED'), R3: blocked('CONTESTED') });
  });
});

describe('contests over several ticks', () => {
  it('after a contest the same pair can end up in a head-on on the next tick', () => {
    // R1 (0,0) E and R2 (2,0) W, each with MOVE MOVE. t1: R1 wins (1,0), R2 loses.
    const s = fromMap('R1> . R2<', { R1: 'MOVE MOVE', R2: 'MOVE MOVE' });
    const { history, state } = ticks(s, 2);
    expect(history.map(outcomes)).toEqual([
      { R1: 'MOVED', R2: blocked('CONTESTED') },
      // t2: R1 aims at (2,0) which holds R2; R2 aims at (1,0) which holds R1: a head-on swap.
      { R1: blocked('HEAD_ON'), R2: blocked('HEAD_ON') },
    ]);
    expect(cells(state)).toEqual({ R1: '1,0,EAST', R2: '2,0,WEST' });
  });
});
