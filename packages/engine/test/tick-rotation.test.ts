/**
 * Rule 5: rotation. Robots moving in a closed loop all succeed.
 *
 * A grid is bipartite, so every closed loop has EVEN length: 2 is the head-on swap (blocked), and
 * the smallest rotation is 4 robots. There is no 3-robot rotation (DECISIONS 2.7). Loops tested:
 * 4 (2x2), 6 (2x3 ring), 8 (3x3 ring around an empty centre) and a 76-robot ring on a 20x20 floor.
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
import { type Facing } from '../src/index.js';

const DELTA: Record<Facing, [number, number]> = {
  NORTH: [0, 1],
  EAST: [1, 0],
  SOUTH: [0, -1],
  WEST: [-1, 0],
};

const allMove = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'MOVE']));

describe('rotation of four', () => {
  it('brief example d: clockwise 2x2 loop, every robot moves', () => {
    const map = `
      R2> R3v
      R1^ R4<
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4'));
    expect(pos).toEqual({ R1: '0,1,NORTH', R2: '1,1,EAST', R3: '1,0,SOUTH', R4: '0,0,WEST' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: 'MOVED', R4: 'MOVED' });
  });

  it('anticlockwise loop', () => {
    const map = `
      R4v R3<
      R1> R2^
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4'));
    // (0,0)->(1,0)->(1,1)->(0,1)->(0,0)
    expect(pos).toEqual({ R1: '1,0,EAST', R2: '1,1,NORTH', R3: '0,1,WEST', R4: '0,0,SOUTH' });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: 'MOVED', R4: 'MOVED' });
  });

  it('the result does not depend on which robot numbers sit where', () => {
    const map = `
      R9> R1v
      R4^ R7<
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R4', 'R7', 'R9'));
    expect(pos).toEqual({ R4: '0,1,NORTH', R9: '1,1,EAST', R1: '1,0,SOUTH', R7: '0,0,WEST' });
    expect(out).toEqual({ R1: 'MOVED', R4: 'MOVED', R7: 'MOVED', R9: 'MOVED' });
  });

  it('a loop inside a bigger floor works next to an unrelated robot', () => {
    const map = `
      . . . . R5v
      . . . . .
      . R2> R3v . .
      . R1^ R4< . .
      . . . . .
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4', 'R5'));
    expect(pos).toEqual({
      R1: '1,2,NORTH',
      R2: '2,2,EAST',
      R3: '2,1,SOUTH',
      R4: '1,1,WEST',
      R5: '4,3,SOUTH',
    });
    expect(out).toEqual({ R1: 'MOVED', R2: 'MOVED', R3: 'MOVED', R4: 'MOVED', R5: 'MOVED' });
  });

  it('a full revolution: MOVE RIGHT repeated four times returns every robot to its start', () => {
    const map = `
      R2> R3v
      R1^ R4<
    `;
    const q = 'MOVE RIGHT MOVE RIGHT MOVE RIGHT MOVE RIGHT';
    const s = fromMap(map, { R1: q, R2: q, R3: q, R4: q });
    const start = cells(s);
    const first3 = ticks(s, 3);
    // t1 all MOVE (rotate), t2 all RIGHT (re-aim), t3 all MOVE (rotate again)
    expect(outcomes(first3.history[2] ?? [])).toEqual({
      R1: 'MOVED',
      R2: 'MOVED',
      R3: 'MOVED',
      R4: 'MOVED',
    });
    expect(cells(first3.state)).toEqual({
      R1: '1,1,EAST',
      R2: '1,0,SOUTH',
      R3: '0,0,WEST',
      R4: '0,1,NORTH',
    });
    expect(cells(ticks(s, 8).state)).toEqual(start);
  });
});

describe('larger rotations', () => {
  it('rotation of six on a 3x2 ring', () => {
    // Clockwise ring (0,1)->(1,1)->(2,1)->(2,0)->(1,0)->(0,0)->(0,1) with scrambled robot numbers.
    const map = `
      R4> R1> R6v
      R3^ R5< R2<
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4', 'R5', 'R6'));
    expect(pos).toEqual({
      R1: '2,1,EAST',
      R2: '1,0,WEST',
      R3: '0,1,NORTH',
      R4: '1,1,EAST',
      R5: '0,0,WEST',
      R6: '2,0,SOUTH',
    });
    for (const o of Object.values(out)) expect(o).toBe('MOVED');
  });

  it('rotation of eight on a 3x3 ring around an empty centre', () => {
    const map = `
      R1> R2> R3v
      R8^ . R4v
      R7^ R6< R5<
    `;
    const { pos, out } = tickMap(map, allMove('R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'));
    // Robot k moves into the cell robot k+1 started on (R8 into R1's).
    expect(pos).toEqual({
      R1: '1,2,EAST',
      R2: '2,2,EAST',
      R3: '2,1,SOUTH',
      R4: '2,0,SOUTH',
      R5: '1,0,WEST',
      R6: '0,0,WEST',
      R7: '0,1,NORTH',
      R8: '0,2,NORTH',
    });
    for (const o of Object.values(out)) expect(o).toBe('MOVED');
  });

  it('a 76-robot ring around the border of a 20x20 floor moves as one', () => {
    const W = 20;
    // Clockwise perimeter cells starting at the north-west corner.
    const ring: { x: number; y: number; facing: Facing }[] = [];
    for (let x = 0; x < W - 1; x++) ring.push({ x, y: W - 1, facing: 'EAST' });
    for (let y = W - 1; y > 0; y--) ring.push({ x: W - 1, y, facing: 'SOUTH' });
    for (let x = W - 1; x > 0; x--) ring.push({ x, y: 0, facing: 'WEST' });
    for (let y = 0; y < W - 1; y++) ring.push({ x: 0, y, facing: 'NORTH' });
    expect(ring).toHaveLength(76);
    // Scramble the numbering with a multiplier coprime to 76 so priorities are not in ring order.
    const idOf = (i: number) => `R${((i * 7) % 76) + 1}`;
    const specs = ring.map((c, i) => robot(idOf(i), c.x, c.y, c.facing, 'MOVE'));
    const t = tick(buildFloor(W, W, specs));
    const after = cells(t.state);
    ring.forEach((c, i) => {
      const [dx, dy] = DELTA[c.facing];
      expect(after[idOf(i)]).toBe(`${c.x + dx},${c.y + dy},${c.facing}`);
    });
    expect(t.results.every((r) => r.outcome === 'MOVED')).toBe(true);
  });
});

describe('a rotation needs every member to move', () => {
  const map = `
    R2> R3v
    R1^ R4<
  `;

  it('one idle member: its predecessor is OCCUPIED, everyone else BEHIND_BLOCKED, nobody moves', () => {
    const { pos, out } = tickMap(map, { R1: 'MOVE', R2: 'MOVE', R4: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,NORTH', R2: '0,1,EAST', R3: '1,1,SOUTH', R4: '1,0,WEST' });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'),
      R2: blocked('OCCUPIED'),
      R3: 'IDLE',
      R4: blocked('BEHIND_BLOCKED'),
    });
  });

  it('one member turning instead of moving breaks the loop the same way', () => {
    const { pos, out } = tickMap(map, { R1: 'MOVE', R2: 'MOVE', R3: 'LEFT', R4: 'MOVE' });
    expect(pos).toEqual({ R1: '0,0,NORTH', R2: '0,1,EAST', R3: '1,1,EAST', R4: '1,0,WEST' });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'),
      R2: blocked('OCCUPIED'),
      R3: 'TURNED',
      R4: blocked('BEHIND_BLOCKED'),
    });
  });

  it('eight-ring with one idle member: nobody moves', () => {
    const ring8 = `
      R1> R2> R3v
      R8^ . R4v
      R7^ R6< R5<
    `;
    const { pos, out } = tickMap(ring8, allMove('R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R8'));
    expect(pos).toEqual({
      R1: '0,2,EAST',
      R2: '1,2,EAST',
      R3: '2,2,SOUTH',
      R4: '2,1,SOUTH',
      R5: '2,0,WEST',
      R6: '1,0,WEST',
      R7: '0,0,NORTH',
      R8: '0,1,NORTH',
    });
    expect(out).toEqual({
      R1: blocked('BEHIND_BLOCKED'),
      R2: blocked('BEHIND_BLOCKED'),
      R3: blocked('BEHIND_BLOCKED'),
      R4: blocked('OCCUPIED'),
      R5: 'IDLE',
      R6: blocked('BEHIND_BLOCKED'),
      R7: blocked('BEHIND_BLOCKED'),
      R8: blocked('BEHIND_BLOCKED'),
    });
  });

  it('the pair that would form a 2-loop is not a rotation: it is HEAD_ON', () => {
    const { out } = tickMap('R1> R2<', allMove('R1', 'R2'));
    expect(out).toEqual({ R1: blocked('HEAD_ON'), R2: blocked('HEAD_ON') });
  });
});
