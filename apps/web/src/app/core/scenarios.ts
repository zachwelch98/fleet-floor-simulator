/**
 * Scenario catalogue and model (pure). A scenario is a script (a bundled file or an upload) traced
 * through the engine's own runner: the trace gives the steps the script player replays on the shared
 * floor, the runner's output, the ignored lines, and one checkpoint per REPORT. Nothing here talks
 * to the server.
 */
import { formatReport, parseRobotNum, parseScenarioLine, traceScenario } from '@fleet/engine';
import type { RobotTickResult, ScenarioTrace } from '@fleet/engine';
import briefAChain from '../../../../../scenarios/brief_a_chain.txt';
import briefAChainExpected from '../../../../../scenarios/brief_a_chain.expected';
import briefBHeadon from '../../../../../scenarios/brief_b_headon.txt';
import briefBHeadonExpected from '../../../../../scenarios/brief_b_headon.expected';
import briefCContestBehind from '../../../../../scenarios/brief_c_contest_behind.txt';
import briefCContestBehindExpected from '../../../../../scenarios/brief_c_contest_behind.expected';
import briefDRotation from '../../../../../scenarios/brief_d_rotation.txt';
import briefDRotationExpected from '../../../../../scenarios/brief_d_rotation.expected';
import briefEQueues from '../../../../../scenarios/brief_e_queues.txt';
import briefEQueuesExpected from '../../../../../scenarios/brief_e_queues.expected';
import chainAroundCorner from '../../../../../scenarios/chain_around_corner.txt';
import chainAroundCornerExpected from '../../../../../scenarios/chain_around_corner.expected';
import contestThreeWay from '../../../../../scenarios/contest_three_way.txt';
import contestThreeWayExpected from '../../../../../scenarios/contest_three_way.expected';
import gotoTwoRobotsCorridor from '../../../../../scenarios/goto_two_robots_corridor.txt';
import gotoTwoRobotsCorridorExpected from '../../../../../scenarios/goto_two_robots_corridor.expected';
import gotoAroundObstacle from '../../../../../scenarios/goto_around_obstacle.txt';
import gotoAroundObstacleExpected from '../../../../../scenarios/goto_around_obstacle.expected';
import rotationBrokenByLowerOutsider from '../../../../../scenarios/rotation_broken_by_lower_outsider.txt';
import rotationBrokenByLowerOutsiderExpected from '../../../../../scenarios/rotation_broken_by_lower_outsider.expected';
import rotationEight from '../../../../../scenarios/rotation_eight.txt';
import rotationEightExpected from '../../../../../scenarios/rotation_eight.expected';

/**
 * One REPORT of a scenario. `runner` is what `npm run scenario` prints for it; `expected` is what
 * the `.expected` file says (the same lines when no file was attached).
 */
export interface Checkpoint {
  /** Position among the REPORTs (matches `trace.reports`). */
  readonly index: number;
  /** Cumulative TICK count at the REPORT (0 when it comes before the first tick). */
  readonly afterTicks: number;
  /** `R1 2,2,SOUTH` lines, or `EMPTY`, exactly as the runner prints them. */
  readonly runner: readonly string[];
  readonly expected: readonly string[];
}

export interface ScenarioDef {
  readonly id: string;
  readonly title: string;
  readonly group: 'brief' | 'curated' | 'uploaded';
  /** The name shown in the runner heading: `npm run scenario -- <fileName>`. */
  readonly fileName: string;
  /** The script, as written. */
  readonly text: string;
  /** The attached `.expected` file, if any. Without one the runner's output is the expected. */
  readonly expectedText?: string;
  /** What the engine did with the script: REPORT blocks, ignored lines, replayable steps. */
  readonly trace: ScenarioTrace;
  readonly checkpoints: readonly Checkpoint[];
  /** TICK steps in the whole script. */
  readonly totalTicks: number;
  /** Set when the `.expected` file's line count differs from the runner's REPORT lines. */
  readonly expectedLineMismatch: { readonly expected: number; readonly runner: number } | null;
}

/** A live run is refused above this many ticks (the runner output and checks are still shown). */
export const MAX_LIVE_TICKS = 1000;
/** Scripts with more ticks than this are not even traced (they would freeze the tab). */
export const MAX_TRACE_TICKS = 20_000;

const LINE_BREAK = /\r\n|\r|\n/;

/** Expected-file lines without the trailing newline. */
function expectedLines(expected: string): string[] {
  const lines = expected.split(LINE_BREAK);
  while (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** Sum of the TICK counts in a script, read before running anything. */
function countTicks(text: string): number {
  let total = 0;
  for (const raw of text.split(LINE_BREAK)) {
    const line = parseScenarioLine(raw);
    if (line.kind === 'tick') {
      total += line.count;
    }
  }
  return total;
}

/**
 * Traces `text` through the engine (the same runner as `npm run scenario`) and turns the result
 * into a scenario: one checkpoint per REPORT, with the `.expected` file (when given) cut into one
 * block per REPORT by the runner's own report sizes. Never throws on a bad script: lines that do
 * not parse or that the engine rejects are listed in `trace.ignored`, a script without REPORT just
 * has no checkpoints, and a REPORT before the first TICK is checked at tick 0. Only a script with
 * more than MAX_TRACE_TICKS ticks throws.
 */
export function buildScenario(
  id: string,
  title: string,
  group: ScenarioDef['group'],
  text: string,
  expectedText?: string,
  fileName = `scenarios/${id}.txt`,
): ScenarioDef {
  if (countTicks(text) > MAX_TRACE_TICKS) {
    throw new Error(`more than ${MAX_TRACE_TICKS.toLocaleString('en-US')} ticks`);
  }
  const trace = traceScenario(text);
  const expectedAll = expectedText === undefined ? null : expectedLines(expectedText);
  const checkpoints: Checkpoint[] = [];
  let ticks = 0;
  let used = 0;
  for (const step of trace.steps) {
    if (step.kind === 'tick') {
      ticks++;
    } else if (step.kind === 'report') {
      const runner = trace.reports[step.index] ?? [];
      const expected = expectedAll ? expectedAll.slice(used, used + runner.length) : runner;
      used += runner.length;
      checkpoints.push({ index: step.index, afterTicks: ticks, runner, expected });
    }
  }
  const runnerLines = trace.reports.reduce((n, r) => n + r.length, 0);
  return {
    id,
    title,
    group,
    fileName,
    text,
    ...(expectedText === undefined ? {} : { expectedText }),
    trace,
    checkpoints,
    totalTicks: ticks,
    expectedLineMismatch:
      expectedAll && expectedAll.length !== runnerLines
        ? { expected: expectedAll.length, runner: runnerLines }
        : null,
  };
}

/** The five brief examples (titles from the brief), then curated engine scenarios. */
export const SCENARIOS: readonly ScenarioDef[] = [
  buildScenario(
    'brief_a_chain',
    'a) A chain of robots moves together',
    'brief',
    briefAChain,
    briefAChainExpected,
  ),
  buildScenario(
    'brief_b_headon',
    'b) A head-on swap is blocked',
    'brief',
    briefBHeadon,
    briefBHeadonExpected,
  ),
  buildScenario(
    'brief_c_contest_behind',
    'c) A contested cell, and a robot stuck behind the loser',
    'brief',
    briefCContestBehind,
    briefCContestBehindExpected,
  ),
  buildScenario(
    'brief_d_rotation',
    'd) A rotation of four robots',
    'brief',
    briefDRotation,
    briefDRotationExpected,
  ),
  buildScenario(
    'brief_e_queues',
    'e) Queues of different lengths',
    'brief',
    briefEQueues,
    briefEQueuesExpected,
  ),
  buildScenario(
    'rotation_eight',
    'Rotation of eight robots',
    'curated',
    rotationEight,
    rotationEightExpected,
  ),
  buildScenario(
    'contest_three_way',
    'Three-way contest for one cell',
    'curated',
    contestThreeWay,
    contestThreeWayExpected,
  ),
  buildScenario(
    'chain_around_corner',
    'A chain turning a corner',
    'curated',
    chainAroundCorner,
    chainAroundCornerExpected,
  ),
  buildScenario(
    'rotation_broken_by_lower_outsider',
    'A rotation broken by a lower-numbered outsider',
    'curated',
    rotationBrokenByLowerOutsider,
    rotationBrokenByLowerOutsiderExpected,
  ),
  buildScenario(
    'goto_around_obstacle',
    'GOTO routes around an obstacle wall (Module A)',
    'curated',
    gotoAroundObstacle,
    gotoAroundObstacleExpected,
  ),
  buildScenario(
    'goto_two_robots_corridor',
    'Two GOTO robots in a corridor, then plain MOVEs sent mid-run',
    'curated',
    gotoTwoRobotsCorridor,
    gotoTwoRobotsCorridorExpected,
  ),
];

/**
 * What REPORT would print after a tick, read from that tick's results: each robot's end cell and
 * facing (`to` + `facing`). The engine sorts results by robot number already; formatReport sorts
 * again so the lines are right whatever the order.
 */
export function reportLines(results: readonly RobotTickResult[]): string[] {
  return formatReport(
    results.map((r) => ({
      id: r.id,
      num: parseRobotNum(r.id) ?? 0,
      x: r.to.x,
      y: r.to.y,
      facing: r.facing,
    })),
  );
}

export function findScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
