/**
 * Geometry helpers, per their doc comments:
 *  - parseRobotNum: case-insensitive, leading zeros normalised ("R01" -> 1), null when invalid (R0 included)
 *  - formatRobotId: 7 -> "R7"
 *  - turnLeft / turnRight: 90 degree turn
 *  - stepForward: the neighbouring cell in `facing`, may be off-floor, NORTH is y + 1
 */
import { describe, expect, it } from 'vitest';
import {
  FACINGS,
  formatRobotId,
  parseRobotNum,
  stepForward,
  turnLeft,
  turnRight,
  type Facing,
} from '../src/index.js';

describe('parseRobotNum', () => {
  it.each([
    ['R1', 1],
    ['R2', 2],
    ['R10', 10],
    ['R20', 20],
    ['R99999', 99999],
    ['r1', 1],
    ['r10', 10],
    ['R01', 1],
    ['R001', 1],
    ['r007', 7],
    ['R010', 10],
  ])('parses %j as %i', (raw, num) => {
    expect(parseRobotNum(raw)).toBe(num);
  });

  it.each(['R0', 'r0', 'R00', 'R000'])('R0-style %j is invalid (IDs start at R1)', (raw) => {
    expect(parseRobotNum(raw)).toBeNull();
  });

  it.each(['', 'R', 'r', '1', 'X1', 'RR1', 'R-1', 'R1.5', 'R1x', 'R 1'])(
    'malformed %j is null',
    (raw) => {
      expect(parseRobotNum(raw)).toBeNull();
    },
  );

  it('different spellings of the same robot parse to the same number', () => {
    const nums = ['R3', 'r3', 'R03', 'r003'].map(parseRobotNum);
    expect(new Set(nums)).toEqual(new Set([3]));
  });

  it('ordering is numeric: R2 < R10', () => {
    const a = parseRobotNum('R2');
    const b = parseRobotNum('R10');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a as number) < (b as number)).toBe(true);
  });
});

describe('formatRobotId', () => {
  it.each([
    [1, 'R1'],
    [7, 'R7'],
    [10, 'R10'],
    [20, 'R20'],
    [123, 'R123'],
  ])('%i -> %s', (num, id) => {
    expect(formatRobotId(num)).toBe(id);
  });

  it('round-trips with parseRobotNum', () => {
    for (const n of [1, 2, 9, 10, 11, 99, 100, 4321]) {
      expect(parseRobotNum(formatRobotId(n))).toBe(n);
    }
  });

  it('canonical IDs have no leading zeros even when parsed from a padded spelling', () => {
    const n = parseRobotNum('R007');
    expect(n).not.toBeNull();
    expect(formatRobotId(n as number)).toBe('R7');
  });
});

describe('turnLeft / turnRight', () => {
  const left: [Facing, Facing][] = [
    ['NORTH', 'WEST'],
    ['WEST', 'SOUTH'],
    ['SOUTH', 'EAST'],
    ['EAST', 'NORTH'],
  ];
  const right: [Facing, Facing][] = [
    ['NORTH', 'EAST'],
    ['EAST', 'SOUTH'],
    ['SOUTH', 'WEST'],
    ['WEST', 'NORTH'],
  ];

  it.each(left)('turnLeft(%s) = %s', (from, to) => {
    expect(turnLeft(from)).toBe(to);
  });

  it.each(right)('turnRight(%s) = %s', (from, to) => {
    expect(turnRight(from)).toBe(to);
  });

  it.each([...FACINGS])('left and right undo each other from %s', (f) => {
    expect(turnRight(turnLeft(f))).toBe(f);
    expect(turnLeft(turnRight(f))).toBe(f);
  });

  it.each([...FACINGS])('four turns of either kind are the identity from %s', (f) => {
    expect(turnLeft(turnLeft(turnLeft(turnLeft(f))))).toBe(f);
    expect(turnRight(turnRight(turnRight(turnRight(f))))).toBe(f);
  });

  it.each([...FACINGS])('two lefts equal two rights (a U-turn) from %s', (f) => {
    expect(turnLeft(turnLeft(f))).toBe(turnRight(turnRight(f)));
  });

  it('FACINGS is the clockwise order starting at NORTH', () => {
    expect([...FACINGS]).toEqual(['NORTH', 'EAST', 'SOUTH', 'WEST']);
    FACINGS.forEach((f, i) => {
      expect(turnRight(f)).toBe(FACINGS[(i + 1) % 4]);
    });
  });
});

describe('stepForward', () => {
  it.each([
    ['NORTH', { x: 3, y: 5 }],
    ['EAST', { x: 4, y: 4 }],
    ['SOUTH', { x: 3, y: 3 }],
    ['WEST', { x: 2, y: 4 }],
  ] as [Facing, { x: number; y: number }][])('from (3,4) facing %s -> %o', (facing, expected) => {
    expect(stepForward({ x: 3, y: 4 }, facing)).toEqual(expected);
  });

  it('may leave the floor (no clamping): the origin stepping south or west', () => {
    expect(stepForward({ x: 0, y: 0 }, 'SOUTH')).toEqual({ x: 0, y: -1 });
    expect(stepForward({ x: 0, y: 0 }, 'WEST')).toEqual({ x: -1, y: 0 });
  });

  it('does not mutate its input and returns a new object', () => {
    const p = Object.freeze({ x: 1, y: 1 });
    const q = stepForward(p, 'NORTH');
    expect(q).not.toBe(p);
    expect(p).toEqual({ x: 1, y: 1 });
  });

  it('only returns x and y', () => {
    expect(Object.keys(stepForward({ x: 1, y: 1 }, 'EAST')).sort()).toEqual(['x', 'y']);
  });
});
