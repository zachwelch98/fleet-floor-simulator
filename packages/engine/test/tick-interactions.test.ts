/**
 * Combinations of the five rules, extreme floor sizes, and mixed-command ticks.
 * Reasons follow DECISIONS 2.1 to 2.4 and 2.7.
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

const allMove = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'MOVE']));

describe('contest winner breaks a rotation (DECISIONS 2.2)', () => {
  // Loop R2 (0,0)N -> R3 (0,1)E -> R4 (1,1)S -> R5 (1,0)W -> back to R2's cell.
  // The outsider at (2,0) facing west aims at (1,0), which R4 also aims at.
  it('lower-numbered outsider wins the cell, the loop is broken, EVERYONE is blocked', () => {
    const map = `
      R3> R4v .
      R2^ R5< R1<
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4', 'R5'));
    expect(pos).toEqual({
      R1: '2,0,WEST',
      R2: '0,0,NORTH',
      R3: '0,1,EAST',
      R4: '1,1,SOUTH',
      R5: '1,0,WEST',
    });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'), // won the contest, but R5 in its target cell cannot leave
      R2: blocked('BEHIND_BLOCKED'),
      R3: blocked('BEHIND_BLOCKED'),
      R4: blocked('CONTESTED'), // the loser stays blocked, no retry
      R5: blocked('BEHIND_BLOCKED'),
    });
  });

  it('higher-numbered outsider loses the contest: the loop still rotates', () => {
    const map = `
      R3> R4v .
      R2^ R5< R9<
    `;
    const { pos, out } = tickMap(map, allMove('R2', 'R3', 'R4', 'R5', 'R9'));
    expect(pos).toEqual({
      R2: '0,1,NORTH',
      R3: '1,1,EAST',
      R4: '1,0,SOUTH',
      R5: '0,0,WEST',
      R9: '2,0,WEST',
    });
    expect(out).toEqual({
      R2: 'MOVED',
      R3: 'MOVED',
      R4: 'MOVED',
      R5: 'MOVED',
      R9: blocked('CONTESTED'),
    });
  });

  it('outsider entering from the north contests a different loop cell', () => {
    // Outsider R1 (0,2) facing south aims at (0,1), the cell R2 (0,0, facing north) also aims at.
    const map = `
      R1v .
      R3> R4v
      R2^ R5<
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4', 'R5'));
    expect(pos).toEqual({
      R1: '0,2,SOUTH',
      R2: '0,0,NORTH',
      R3: '0,1,EAST',
      R4: '1,1,SOUTH',
      R5: '1,0,WEST',
    });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'),
      R2: blocked('CONTESTED'),
      R3: blocked('BEHIND_BLOCKED'),
      R4: blocked('BEHIND_BLOCKED'),
      R5: blocked('BEHIND_BLOCKED'),
    });
  });
});

describe('several groups in one tick', () => {
  it('a head-on pair, a moving chain and a contest do not affect each other', () => {
    const real = `
      . . . . R6v .
      . . . R7> . .
      R3> R4> R5> . . .
      . . . . . .
      . . . . . .
      R1> R2< . . . .
    `;
    // y=5: R6 (4,5) S ; y=4: R7 (3,4) E ; y=3: R3 R4 R5 ; y=0: R1 R2
    const { pos, out } = tickMap(real, allMove('R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'));
    expect(pos).toEqual({
      R1: '0,0,EAST',
      R2: '1,0,WEST',
      R3: '1,3,EAST',
      R4: '2,3,EAST',
      R5: '3,3,EAST',
      R6: '4,4,SOUTH',
      R7: '3,4,EAST',
    });
    expect(out).toEqual({
      R1: blocked('HEAD_ON'),
      R2: blocked('HEAD_ON'),
      R3: 'MOVED',
      R4: 'MOVED',
      R5: 'MOVED',
      R6: 'MOVED',
      R7: blocked('CONTESTED'),
    });
  });

  it('every kind of outcome in one tick', () => {
    const map = `
      . . . . R2^
      . R4> R5< . .
      . . R3^ . .
      . . . . .
      R1^ . . R7> R6<
    `;
    const { pos, out } = tickMap(map, {
      R1: 'MOVE',
      R2: 'MOVE',
      R3: 'LEFT',
      R4: 'MOVE',
      R5: 'MOVE',
      R7: 'MOVE',
    });
    expect(pos).toEqual({
      R1: '0,1,NORTH',
      R2: '4,4,NORTH',
      R3: '2,2,WEST',
      R4: '1,3,EAST',
      R5: '2,3,WEST',
      R6: '4,0,WEST',
      R7: '3,0,EAST',
    });
    expect(out).toEqual({
      R1: 'MOVED',
      R2: blocked('WALL'),
      R3: 'TURNED',
      R4: blocked('HEAD_ON'),
      R5: blocked('HEAD_ON'),
      R6: 'IDLE',
      R7: blocked('OCCUPIED'),
    });
  });

  it('a staircase of followers moves as one: each takes the cell vacated by the one ahead', () => {
    // R3 (1,1) W -> (0,1); R2 (1,0) N -> (1,1); R1 (0,0) E -> (1,0).
    const { pos, out } = tickMap('. R3<\nR1> R2^', allMove('R1', 'R2', 'R3'));
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '1,1,NORTH', R3: '0,1,WEST' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: 'MOVED' });
  });

  it('diagonal neighbours never interact', () => {
    const { pos, out } = tickMap('R2< .\nR1> .', allMove('R1', 'R2'));
    // R2 (0,1) W -> wall; R1 (0,0) E -> (1,0)
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '0,1,WEST' });
    expect(out).toEqual({ R1: 'MOVED', R2: blocked('WALL') });
  });
});

describe('the lead of a chain runs out of commands', () => {
  it('after the lead goes idle the follower is blocked (OCCUPIED) from then on', () => {
    const s = fromMap('R1> R2> . .', { R2: 'MOVE', R1: 'MOVE MOVE' });
    const { history, state } = ticks(s, 2);
    expect(history.map(outcomes)).toEqual([
      { R1: 'MOVED', R2: 'MOVED' },
      { R1: blocked('OCCUPIED'), R2: 'IDLE' },
    ]);
    expect(cells(state)).toEqual({ R1: '1,0,EAST', R2: '2,0,EAST' });
  });
});

describe('extreme floors', () => {
  it('1x1 floor: an idle or turning robot is fine, a second robot has no room', () => {
    const s = buildFloor(1, 1, [robot('R1', 0, 0, 'NORTH', 'LEFT')]);
    const t = tick(s);
    expect(cells(t.state)).toEqual({ R1: '0,0,WEST' });
    expect(t.results.map((r) => r.outcome)).toEqual(['TURNED']);
    expect(tick(t.state).results.map((r) => r.outcome)).toEqual(['IDLE']);
  });

  it('20x1 floor: a row of 19 moves together, with the 20th cell free', () => {
    const specs = Array.from({ length: 19 }, (_v, i) => robot(`R${i + 1}`, i, 0, 'EAST', 'MOVE'));
    const t = tick(buildFloor(20, 1, specs));
    for (const r of t.results) expect(r.outcome).toBe('MOVED');
    for (let i = 0; i < 19; i++) expect(cells(t.state)[`R${i + 1}`]).toBe(`${i + 1},0,EAST`);
  });

  it('20x1 floor: a full row of 20 is stuck because the lead hits the wall', () => {
    const specs = Array.from({ length: 20 }, (_v, i) => robot(`R${i + 1}`, i, 0, 'EAST', 'MOVE'));
    const t = tick(buildFloor(20, 1, specs));
    const o = outcomes(t.results);
    expect(o.R20).toBe(blocked('WALL'));
    for (let i = 1; i < 20; i++) expect(o[`R${i}`]).toBe(blocked('BEHIND_BLOCKED'));
    for (let i = 0; i < 20; i++) expect(cells(t.state)[`R${i + 1}`]).toBe(`${i},0,EAST`);
  });

  it('20x1 floor: one idle robot in the middle splits a row of 19', () => {
    const specs = Array.from({ length: 19 }, (_v, i) =>
      robot(`R${i + 1}`, i, 0, 'EAST', i + 1 === 10 ? undefined : 'MOVE'),
    );
    const t = tick(buildFloor(20, 1, specs));
    const o = outcomes(t.results);
    for (let n = 11; n <= 19; n++) expect(o[`R${n}`]).toBe('MOVED');
    expect(o.R10).toBe('IDLE');
    expect(o.R9).toBe(blocked('OCCUPIED'));
    for (let n = 1; n <= 8; n++) expect(o[`R${n}`]).toBe(blocked('BEHIND_BLOCKED'));
    const c = cells(t.state);
    expect(c.R9).toBe('8,0,EAST');
    expect(c.R10).toBe('9,0,EAST');
    expect(c.R11).toBe('11,0,EAST');
    expect(c.R19).toBe('19,0,EAST');
  });

  it('1x20 column heading north behaves like a row', () => {
    const specs = Array.from({ length: 19 }, (_v, i) =>
      robot(`R${20 - i - 1}`, 0, i, 'NORTH', 'MOVE'),
    );
    const t = tick(buildFloor(1, 20, specs));
    for (const r of t.results) expect(r.outcome).toBe('MOVED');
    // robot at y=i has number 19-i and ends on y=i+1
    for (let i = 0; i < 19; i++) expect(cells(t.state)[`R${19 - i}`]).toBe(`0,${i + 1},NORTH`);
  });

  it('20x20 floor completely full, everyone facing east: only walls decide, nobody moves', () => {
    const specs = [];
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) specs.push(robot(`R${y * 20 + x + 1}`, x, y, 'EAST', 'MOVE'));
    }
    const s = buildFloor(20, 20, specs);
    expect(s.robots).toHaveLength(400);
    const t = tick(s);
    expect(t.results).toHaveLength(400);
    for (const r of t.results) {
      expect(r.outcome).toBe('BLOCKED');
      expect(r.reason).toBe(r.from.x === 19 ? 'WALL' : 'BEHIND_BLOCKED');
      expect(r.to).toEqual(r.from);
    }
  });

  it('20x20 floor: a packed 2x2 block rotates in the north-east corner', () => {
    const s = buildFloor(20, 20, [
      robot('R1', 18, 18, 'NORTH', 'MOVE'),
      robot('R2', 18, 19, 'EAST', 'MOVE'),
      robot('R3', 19, 19, 'SOUTH', 'MOVE'),
      robot('R4', 19, 18, 'WEST', 'MOVE'),
    ]);
    expect(cells(tick(s).state)).toEqual({
      R1: '18,19,NORTH',
      R2: '19,19,EAST',
      R3: '19,18,SOUTH',
      R4: '18,18,WEST',
    });
  });
});
