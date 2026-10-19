import { apply, createFloorState } from '../engine.js';
import { SCENARIO_DEFAULT_FLOOR } from '../types.js';
import type { Action, Facing } from '../types.js';
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

/** One thing the script does, in order. `TICK N` is N `tick` steps. */
export type ScriptStep =
  | {
      readonly kind: 'action';
      readonly action: Action;
      /** 1-based line in the file; 0 for the implicit `CREATE_FLOOR 5,5`. */
      readonly line: number;
    }
  | { readonly kind: 'tick'; readonly line: number }
  /** `index` points into `ScenarioTrace.reports`. */
  | { readonly kind: 'report'; readonly index: number };

/** A line the runner skipped: it did not parse, or the engine rejected it. */
export interface IgnoredLine {
  /** 1-based. */
  readonly line: number;
  /** The line, trimmed. */
  readonly text: string;
  readonly why: string;
}

export interface ScenarioTrace {
  /** One block of `formatReport` lines per REPORT, in order. `reports.flat()` is the runner's output. */
  readonly reports: string[][];
  readonly ignored: IgnoredLine[];
  /**
   * What the script does: the actions the engine accepted, every tick, and a marker per REPORT.
   * Starts with a `CREATE_FLOOR` (the implicit 5x5 one unless the first accepted step is a FLOOR line).
   */
  readonly steps: ScriptStep[];
}

/**
 * Run a whole scenario through the real engine (`apply`) and keep a trace of it: the REPORT blocks,
 * the lines that were ignored (with why), and the steps a client can replay on a live floor.
 * Pure: no IO. Owner: Dev 2.
 */
export function traceScenario(text: string): ScenarioTrace {
  let state = createFloorState(SCENARIO_DEFAULT_FLOOR.width, SCENARIO_DEFAULT_FLOOR.height);
  const reports: string[][] = [];
  const ignored: IgnoredLine[] = [];
  const steps: ScriptStep[] = [];

  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const line = parseScenarioLine(raw);
    switch (line.kind) {
      case 'action': {
        const result = apply(state, line.action);
        if (result.ok) {
          state = result.state;
          steps.push({ kind: 'action', action: line.action, line: lineNo });
        } else {
          ignored.push({ line: lineNo, text: raw.trim(), why: result.message });
        }
        break;
      }
      case 'tick':
        for (let n = 0; n < line.count; n++) {
          const result = apply(state, { type: 'TICK' });
          if (result.ok) {
            state = result.state;
            steps.push({ kind: 'tick', line: lineNo });
          } else if (n === 0) {
            ignored.push({ line: lineNo, text: raw.trim(), why: result.message });
          }
        }
        break;
      case 'report':
        steps.push({ kind: 'report', index: reports.length });
        reports.push(formatReport(state.robots));
        break;
      case 'invalid':
        ignored.push({ line: lineNo, text: raw.trim(), why: line.why });
        break;
      case 'skip':
        break;
    }
  });

  const first = steps[0];
  if (!(first?.kind === 'action' && first.action.type === 'CREATE_FLOOR')) {
    steps.unshift({
      kind: 'action',
      action: {
        type: 'CREATE_FLOOR',
        width: SCENARIO_DEFAULT_FLOOR.width,
        height: SCENARIO_DEFAULT_FLOOR.height,
      },
      line: 0,
    });
  }
  return { reports, ignored, steps };
}

/**
 * Run a whole scenario through the real engine (`apply`) and return the lines
 * REPORT would print, in order. Pure: no IO. Owner: Dev 2.
 */
export function runScenario(text: string): string[] {
  return traceScenario(text).reports.flat();
}
