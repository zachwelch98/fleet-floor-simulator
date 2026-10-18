import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, ApplyResult, FloorState } from '../../src/types.js';

// runScenario is tested against a fake `apply` because Dev 1's real reducer lands in parallel.
// The fake implements just enough of the contract to exercise the runner's own logic:
// sequencing, rejection handling, TICK N repetition, REPORT formatting. Real end-to-end
// behaviour is covered by the golden scenarios once the engine is merged.
const calls: Action[] = [];

vi.mock('../../src/geometry.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/geometry.js')>();
  return {
    ...actual,
    parseRobotNum: (raw: string): number | null => {
      const m = /^R(\d+)$/i.exec(raw);
      if (!m) return null;
      const n = Number(m[1]);
      return n >= 1 ? n : null;
    },
  };
});

vi.mock('../../src/engine.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/engine.js')>();
  const reject = (message: string): ApplyResult => ({
    ok: false,
    reason: 'OUT_OF_BOUNDS',
    message,
  });
  return {
    ...actual,
    apply: (state: FloorState, action: Action): ApplyResult => {
      calls.push(action);
      switch (action.type) {
        case 'CREATE_FLOOR':
          if (action.width < 1 || action.width > 20 || action.height < 1 || action.height > 20) {
            return reject('size');
          }
          return {
            ok: true,
            state: actual.createFloorState(action.width, action.height),
            events: [],
          };
        case 'PLACE_ROBOT': {
          if (action.x < 0 || action.y < 0 || action.x >= state.width || action.y >= state.height) {
            return reject('bounds');
          }
          const id = action.id ?? `R${state.nextRobotNum}`;
          const num = Number(id.slice(1));
          const others = state.robots.filter((r) => r.id !== id);
          const robot = {
            id,
            num,
            x: action.x,
            y: action.y,
            facing: action.facing,
            queue: [],
            gotoNoPathTicks: 0,
          };
          // Deliberately insert unsorted to prove runScenario sorts REPORT output itself.
          return { ok: true, state: { ...state, robots: [...others, robot] }, events: [] };
        }
        case 'TICK':
          return { ok: true, state: { ...state, tick: state.tick + 1 }, events: [] };
        default:
          return { ok: true, state, events: [] };
      }
    },
  };
});

import { runScenario } from '../../src/scenario/run.js';

beforeEach(() => {
  calls.length = 0;
});

describe('runScenario (fake apply)', () => {
  it('returns no output when there is no REPORT', () => {
    expect(runScenario('FLOOR 4,3\nPLACE R1 0,0,NORTH\nTICK 2')).toEqual([]);
    expect(runScenario('')).toEqual([]);
  });

  it('prints EMPTY for a REPORT with no robots', () => {
    expect(runScenario('REPORT')).toEqual(['EMPTY']);
    expect(runScenario('FLOOR 3,3\nREPORT\nREPORT')).toEqual(['EMPTY', 'EMPTY']);
  });

  it('prints robots sorted by robot number, not placement order', () => {
    const out = runScenario('PLACE R10 4,4,WEST\nPLACE R2 1,0,EAST\nPLACE R1 0,0,NORTH\nREPORT');
    expect(out).toEqual(['R1 0,0,NORTH', 'R2 1,0,EAST', 'R10 4,4,WEST']);
  });

  it('starts from the default 5x5 floor without a FLOOR line', () => {
    expect(runScenario('PLACE R1 4,4,NORTH\nREPORT')).toEqual(['R1 4,4,NORTH']);
    expect(runScenario('PLACE R1 5,5,NORTH\nREPORT')).toEqual(['EMPTY']);
  });

  it('ignores rejected, invalid, blank and comment lines and keeps going', () => {
    const text = [
      '# header',
      '',
      'PLACE R1 9,9,NORTH',
      'PLACE R1 oops',
      'WHAT',
      'PLACE R2 1,1,SOUTH',
      'REPORT',
    ].join('\n');
    expect(runScenario(text)).toEqual(['R2 1,1,SOUTH']);
  });

  it('keeps the previous floor when FLOOR is rejected', () => {
    expect(runScenario('PLACE R1 4,4,NORTH\nFLOOR 99,99\nREPORT')).toEqual(['R1 4,4,NORTH']);
  });

  it('FLOOR replaces the world', () => {
    expect(runScenario('PLACE R1 1,1,NORTH\nFLOOR 3,3\nREPORT')).toEqual(['EMPTY']);
  });

  it('TICK N applies TICK exactly N times; bare TICK once; invalid TICK never', () => {
    runScenario('TICK 5');
    expect(calls.filter((a) => a.type === 'TICK')).toHaveLength(5);
    calls.length = 0;
    runScenario('TICK');
    expect(calls).toEqual([{ type: 'TICK' }]);
    calls.length = 0;
    runScenario('TICK 0\nTICK -2\nTICK x');
    expect(calls).toEqual([]);
  });

  it('sends parsed actions to apply in order', () => {
    runScenario('FLOOR 4,3\nOBSTACLE 1,1\nPLACE r1 0,0,east\nQUEUE R1 MOVE\nTICK 2');
    expect(calls).toEqual([
      { type: 'CREATE_FLOOR', width: 4, height: 3 },
      { type: 'SET_OBSTACLE', x: 1, y: 1, present: true },
      { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'EAST' },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }] },
      { type: 'TICK' },
      { type: 'TICK' },
    ]);
  });

  it('handles CRLF, CR and LF line endings alike', () => {
    const lf = 'PLACE R1 0,0,NORTH\nREPORT\nTICK\nREPORT';
    expect(runScenario(lf.replace(/\n/g, '\r\n'))).toEqual(runScenario(lf));
    expect(runScenario(lf.replace(/\n/g, '\r'))).toEqual(runScenario(lf));
    expect(runScenario(lf.replace(/\n/g, '\r\n'))).toEqual(['R1 0,0,NORTH', 'R1 0,0,NORTH']);
  });

  it('handles a final line without a trailing newline and with extra blank lines', () => {
    expect(runScenario('PLACE R1 0,0,SOUTH\n\n\nREPORT\n\n')).toEqual(['R1 0,0,SOUTH']);
    expect(runScenario('PLACE R1 0,0,SOUTH\nREPORT')).toEqual(['R1 0,0,SOUTH']);
  });

  it('is deterministic: the same text gives the same output', () => {
    const text =
      'FLOOR 4,3\nPLACE R2 0,0,NORTH\nPLACE R1 3,2,WEST\nTICK 3\nREPORT\nTICK 10\nREPORT';
    expect(runScenario(text)).toEqual(runScenario(text));
  });
});
