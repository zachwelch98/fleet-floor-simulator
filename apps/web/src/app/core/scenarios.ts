/**
 * Scenario picker catalogue (pure). Each entry is a scenario file from `scenarios/` bundled as a
 * string, turned into the actions that set the shared floor up and the checkpoints (one per REPORT)
 * the panel checks while the server ticks. Nothing here talks to the server.
 */
import {
  SCENARIO_DEFAULT_FLOOR,
  apply,
  createFloorState,
  formatReport,
  parseScenarioLine,
} from '@fleet/engine';
import type { Action, FloorState } from '@fleet/engine';
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
import gotoAroundObstacle from '../../../../../scenarios/goto_around_obstacle.txt';
import gotoAroundObstacleExpected from '../../../../../scenarios/goto_around_obstacle.expected';
import rotationBrokenByLowerOutsider from '../../../../../scenarios/rotation_broken_by_lower_outsider.txt';
import rotationBrokenByLowerOutsiderExpected from '../../../../../scenarios/rotation_broken_by_lower_outsider.expected';
import rotationEight from '../../../../../scenarios/rotation_eight.txt';
import rotationEightExpected from '../../../../../scenarios/rotation_eight.expected';

/** One REPORT: the lines expected once `afterTicks` ticks have run since the load. */
export interface Checkpoint {
  /** Cumulative TICK count at the REPORT (>= 1). */
  readonly afterTicks: number;
  /** `R1 2,2,SOUTH` lines, or `EMPTY`, exactly as the runner prints them. */
  readonly expected: readonly string[];
}

export interface ScenarioDef {
  readonly id: string;
  readonly title: string;
  readonly group: 'brief' | 'curated';
  /** The bundled files, as written. */
  readonly text: string;
  readonly expected: string;
  /** Applied in order on the shared floor; always starts with a CREATE_FLOOR. */
  readonly setup: readonly Action[];
  readonly checkpoints: readonly Checkpoint[];
}

const LINE_BREAK = /\r\n|\r|\n/;

/** Expected-file lines without the trailing newline. */
function expectedLines(expected: string): string[] {
  const lines = expected.split(LINE_BREAK);
  while (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Dry-runs `text` through the engine, the way the runner does, to find what Load must send and
 * where the REPORTs fall.
 * - `setup`: every action line before the first TICK that the engine accepts (rejected lines are
 *   ignored, as in the runner). An implicit `CREATE_FLOOR 5,5` (the scenario default) goes first
 *   unless the file starts with a FLOOR line.
 * - `checkpoints`: the `.expected` file cut into one block per REPORT, sized by the robot count at
 *   that REPORT (`EMPTY` is one line).
 * Throws when the file cannot be played live: an action after the first TICK (Play drives the
 * ticks, so nothing can be injected mid-run), a REPORT before any TICK, or an `.expected` file that
 * does not match the number of REPORT lines.
 */
export function buildScenario(
  id: string,
  title: string,
  group: ScenarioDef['group'],
  text: string,
  expected: string,
): ScenarioDef {
  const expectedAll = expectedLines(expected);
  let state: FloorState = createFloorState(
    SCENARIO_DEFAULT_FLOOR.width,
    SCENARIO_DEFAULT_FLOOR.height,
  );
  const setup: Action[] = [];
  const checkpoints: Checkpoint[] = [];
  let ticks = 0;
  let used = 0;

  for (const raw of text.split(LINE_BREAK)) {
    const line = parseScenarioLine(raw);
    switch (line.kind) {
      case 'action': {
        if (ticks > 0) {
          throw new Error(`${id}: an action after the first TICK cannot be played live`);
        }
        const result = apply(state, line.action);
        if (result.ok) {
          state = result.state;
          setup.push(line.action);
        }
        break;
      }
      case 'tick':
        for (let i = 0; i < line.count; i++) {
          const result = apply(state, { type: 'TICK' });
          if (result.ok) {
            state = result.state;
          }
        }
        ticks += line.count;
        break;
      case 'report': {
        if (ticks === 0) {
          throw new Error(`${id}: a REPORT before the first TICK cannot be checked live`);
        }
        const size = formatReport(state.robots).length;
        checkpoints.push({ afterTicks: ticks, expected: expectedAll.slice(used, used + size) });
        used += size;
        break;
      }
      case 'skip':
      case 'invalid':
        break;
    }
  }

  if (used !== expectedAll.length) {
    throw new Error(
      `${id}: the .expected file has ${expectedAll.length} lines, REPORTs print ${used}`,
    );
  }
  if (checkpoints.length === 0) {
    throw new Error(`${id}: no REPORT, nothing to check`);
  }
  if (setup[0]?.type !== 'CREATE_FLOOR') {
    setup.unshift({
      type: 'CREATE_FLOOR',
      width: SCENARIO_DEFAULT_FLOOR.width,
      height: SCENARIO_DEFAULT_FLOOR.height,
    });
  }
  return { id, title, group, text, expected, setup, checkpoints };
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
];

export function findScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
