import { apply, createFloorState } from '../engine.js';
import { SCENARIO_DEFAULT_FLOOR } from '../types.js';
import type { Facing } from '../types.js';
import { parseScenarioLine } from './parse.js';

/** The robot fields REPORT prints. `Robot` and the TICK_RESOLVED result both fit, so the UI shares this. */
export interface ReportRobot {
  readonly id: string;
  readonly num: number;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
}

/** `R1 2,2,SOUTH` per robot sorted by robot number, or `EMPTY`. */
export function formatReport(robots: readonly ReportRobot[]): string[] {
  if (robots.length === 0) return ['EMPTY'];
  return [...robots].sort((a, b) => a.num - b.num).map((r) => `${r.id} ${r.x},${r.y},${r.facing}`);
}

/**
 * Run a whole scenario through the real engine (`apply`) and return the lines
 * REPORT would print, in order. Pure: no IO. Owner: Dev 2.
 */
export function runScenario(text: string): string[] {
  let state = createFloorState(SCENARIO_DEFAULT_FLOOR.width, SCENARIO_DEFAULT_FLOOR.height);
  const out: string[] = [];

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = parseScenarioLine(raw);
    switch (line.kind) {
      case 'action': {
        const result = apply(state, line.action);
        if (result.ok) state = result.state; // rejected lines are ignored
        break;
      }
      case 'tick':
        for (let i = 0; i < line.count; i++) {
          const result = apply(state, { type: 'TICK' });
          if (result.ok) state = result.state;
        }
        break;
      case 'report':
        out.push(...formatReport(state.robots));
        break;
      case 'skip':
      case 'invalid':
        break;
    }
  }
  return out;
}
