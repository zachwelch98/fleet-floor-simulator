import type { Facing, Position, RobotId } from './types.js';

/**
 * Parse a robot ID, case-insensitively. Leading zeros are normalized ("R01" → 1).
 * Returns null for anything that is not R<positive integer> ("R0", "R", "X1", "R1a").
 */
export function parseRobotNum(_raw: string): number | null {
  throw new Error('parseRobotNum: not implemented');
}

/** Canonical ID for a robot number: 7 → "R7". */
export function formatRobotId(num: number): RobotId {
  return `R${num}`;
}

/** Facing after a 90° turn. */
export function turnLeft(_facing: Facing): Facing {
  throw new Error('turnLeft: not implemented');
}

export function turnRight(_facing: Facing): Facing {
  throw new Error('turnRight: not implemented');
}

/** The neighbouring cell one step in `facing` (may be off-floor). NORTH is y + 1. */
export function stepForward(_pos: Position, _facing: Facing): Position {
  throw new Error('stepForward: not implemented');
}
