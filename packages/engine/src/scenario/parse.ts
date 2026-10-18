import type { Action } from '../types.js';

/**
 * One parsed scenario line.
 * - `action`: an engine action to apply (FLOOR, OBSTACLE, PLACE, QUEUE).
 * - `tick`: advance N ticks (N >= 1).
 * - `report`: print positions.
 * - `skip`: blank line or comment.
 * - `invalid`: unparseable; the runner ignores it and keeps going.
 */
export type ScenarioLine =
  | { readonly kind: 'action'; readonly action: Action }
  | { readonly kind: 'tick'; readonly count: number }
  | { readonly kind: 'report' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'invalid'; readonly why: string };

/** Pure, case-insensitive parser for a single line. Owner: Dev 2. */
export function parseScenarioLine(_line: string): ScenarioLine {
  throw new Error('parseScenarioLine: not implemented');
}
