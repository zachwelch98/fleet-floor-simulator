import type { Action, ApplyResult, FloorState } from './types.js';

/** A blank floor. Caller is responsible for valid dimensions (use CREATE_FLOOR to validate). */
export function createFloorState(width: number, height: number): FloorState {
  return { width, height, obstacles: [], robots: [], nextRobotNum: 1, tick: 0 };
}

/**
 * The single entry point for changing the world. Pure: never mutates `state`.
 * Owner: Dev 1 (Engine). Contract: docs/PLAN.md "Engine design" + DECISIONS.md.
 */
export function apply(_state: FloorState, _action: Action): ApplyResult {
  throw new Error('apply: not implemented');
}
