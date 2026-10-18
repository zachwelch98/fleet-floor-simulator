import { apply, createFloorState } from '../engine.js';
import { SCENARIO_DEFAULT_FLOOR } from '../types.js';
import type { FloorState } from '../types.js';
import { parseScenarioLine } from './parse.js';

/** `R1 2,2,SOUTH` per robot sorted by robot number, or `EMPTY`. */
function report(state: FloorState): string[] {
  if (state.robots.length === 0) return ['EMPTY'];
  return [...state.robots]
    .sort((a, b) => a.num - b.num)
    .map((r) => `${r.id} ${r.x},${r.y},${r.facing}`);
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
        out.push(...report(state));
        break;
      case 'skip':
      case 'invalid':
        break;
    }
  }
  return out;
}
