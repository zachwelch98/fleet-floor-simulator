import { FACINGS } from './types.js';
import type { Facing, Position, RobotId } from './types.js';

/** "R" (either case) followed by ASCII digits only. Anything else is not a robot ID. */
const ROBOT_ID_PATTERN = /^[Rr]([0-9]+)$/;

/**
 * Parse a robot ID, case-insensitively. Leading zeros are normalized ("R01" → 1).
 * Returns null for anything that is not R<positive integer> ("R0", "R", "X1", "R1a"),
 * and for numbers too large to be represented exactly.
 */
export function parseRobotNum(raw: string): number | null {
  const match = ROBOT_ID_PATTERN.exec(raw);
  if (match === null) {
    return null;
  }
  const num = Number(match[1]);
  if (!Number.isSafeInteger(num) || num < 1) {
    return null;
  }
  return num;
}

/** Canonical ID for a robot number: 7 → "R7". */
export function formatRobotId(num: number): RobotId {
  return `R${num}`;
}

/** Position of `facing` in the clockwise FACINGS list. */
function facingIndex(facing: Facing): number {
  return FACINGS.indexOf(facing);
}

/** Facing after a 90° turn. */
export function turnLeft(facing: Facing): Facing {
  const counterClockwise = (facingIndex(facing) + FACINGS.length - 1) % FACINGS.length;
  return FACINGS[counterClockwise] as Facing;
}

export function turnRight(facing: Facing): Facing {
  const clockwise = (facingIndex(facing) + 1) % FACINGS.length;
  return FACINGS[clockwise] as Facing;
}

/** The neighbouring cell one step in `facing` (may be off-floor). NORTH is y + 1. */
export function stepForward(pos: Position, facing: Facing): Position {
  switch (facing) {
    case 'NORTH':
      return { x: pos.x, y: pos.y + 1 };
    case 'EAST':
      return { x: pos.x + 1, y: pos.y };
    case 'SOUTH':
      return { x: pos.x, y: pos.y - 1 };
    case 'WEST':
      return { x: pos.x - 1, y: pos.y };
  }
}
