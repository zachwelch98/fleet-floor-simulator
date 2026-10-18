import { formatRobotId, parseRobotNum, stepForward, turnLeft, turnRight } from './geometry.js';
import { firstStepToward } from './pathfinding.js';
import { resolveMoves } from './resolve-moves.js';
import type { MoveResolution } from './resolve-moves.js';
import { GOTO_MAX_NO_PATH_TICKS, MAX_FLOOR_SIZE, MIN_FLOOR_SIZE } from './types.js';
import type {
  Action,
  ApplyResult,
  Command,
  Facing,
  FloorState,
  Position,
  RejectionReason,
  Robot,
  RobotTickResult,
  WorldEvent,
} from './types.js';

/** A blank floor. Caller is responsible for valid dimensions (use CREATE_FLOOR to validate). */
export function createFloorState(width: number, height: number): FloorState {
  return { width, height, obstacles: [], robots: [], nextRobotNum: 1, tick: 0 };
}

/**
 * The single entry point for changing the world. Pure: never mutates `state`.
 * Owner: Dev 1 (Engine). Contract: docs/PLAN.md "Engine design" + DECISIONS.md.
 */
export function apply(state: FloorState, action: Action): ApplyResult {
  switch (action.type) {
    case 'CREATE_FLOOR':
      return createFloor(action.width, action.height);
    case 'PLACE_ROBOT':
      return placeRobot(state, action);
    case 'REMOVE_ROBOT':
      return removeRobot(state, action.id);
    case 'SET_OBSTACLE':
      return setObstacle(state, action.x, action.y, action.present);
    case 'TOGGLE_OBSTACLE':
      return toggleObstacle(state, action.x, action.y);
    case 'QUEUE_COMMANDS':
      return queueCommands(state, action.id, action.commands);
    case 'CLEAR_QUEUE':
      return clearQueue(state, action.id);
    case 'TICK':
      return tick(state);
  }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function reject(reason: RejectionReason, message: string): ApplyResult {
  return { ok: false, reason, message };
}

function accept(state: FloorState, events: readonly WorldEvent[]): ApplyResult {
  return { ok: true, state, events };
}

// ---------------------------------------------------------------------------
// Lookups and validation
// ---------------------------------------------------------------------------

function isOnFloor(state: FloorState, x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < state.width &&
    y >= 0 &&
    y < state.height
  );
}

function hasObstacle(state: FloorState, x: number, y: number): boolean {
  return state.obstacles.some((obstacle) => obstacle.x === x && obstacle.y === y);
}

function robotAt(state: FloorState, x: number, y: number): Robot | undefined {
  return state.robots.find((robot) => robot.x === x && robot.y === y);
}

function robotByNum(state: FloorState, num: number): Robot | undefined {
  return state.robots.find((robot) => robot.num === num);
}

function isValidSize(size: number): boolean {
  return Number.isInteger(size) && size >= MIN_FLOOR_SIZE && size <= MAX_FLOOR_SIZE;
}

/** Keeps the canonical ordering: robots by number. */
function sortRobots(robots: readonly Robot[]): Robot[] {
  return [...robots].sort((a, b) => a.num - b.num);
}

/** Keeps the canonical ordering: obstacles by x, then y. */
function sortObstacles(obstacles: readonly Position[]): Position[] {
  return [...obstacles].sort((a, b) => a.x - b.x || a.y - b.y);
}

/** The outcome of looking up a robot by an ID that came from outside. */
type RobotLookup = { readonly robot: Robot } | { readonly rejection: ApplyResult };

function findRobot(state: FloorState, rawId: string): RobotLookup {
  const num = parseRobotNum(rawId);
  if (num === null) {
    return { rejection: reject('INVALID_ID', `"${rawId}" is not a valid robot ID`) };
  }
  const robot = robotByNum(state, num);
  if (robot === undefined) {
    return { rejection: reject('UNKNOWN_ROBOT', `No robot ${formatRobotId(num)} on this floor`) };
  }
  return { robot };
}

// ---------------------------------------------------------------------------
// CREATE_FLOOR
// ---------------------------------------------------------------------------

function createFloor(width: number, height: number): ApplyResult {
  if (!isValidSize(width) || !isValidSize(height)) {
    return reject(
      'INVALID_SIZE',
      `Floor size ${String(width)}x${String(height)} is invalid; width and height must be whole numbers from ${MIN_FLOOR_SIZE} to ${MAX_FLOOR_SIZE}`,
    );
  }
  return accept(createFloorState(width, height), [{ type: 'FLOOR_CREATED', width, height }]);
}

// ---------------------------------------------------------------------------
// PLACE_ROBOT / REMOVE_ROBOT
// ---------------------------------------------------------------------------

function placeRobot(
  state: FloorState,
  action: Extract<Action, { type: 'PLACE_ROBOT' }>,
): ApplyResult {
  const { x, y, facing } = action;

  // Work out which robot number this is: the one given, or the next free one.
  let num: number;
  if (action.id === undefined) {
    num = state.nextRobotNum;
  } else {
    const parsed = parseRobotNum(action.id);
    if (parsed === null) {
      return reject('INVALID_ID', `"${action.id}" is not a valid robot ID`);
    }
    num = parsed;
  }
  const id = formatRobotId(num);

  if (!isOnFloor(state, x, y)) {
    return reject(
      'OUT_OF_BOUNDS',
      `Cell (${String(x)},${String(y)}) is off the ${state.width}x${state.height} floor`,
    );
  }
  if (hasObstacle(state, x, y)) {
    return reject('CELL_IS_OBSTACLE', `Cell (${x},${y}) is an obstacle`);
  }
  const occupant = robotAt(state, x, y);
  if (occupant !== undefined && occupant.num !== num) {
    return reject('CELL_OCCUPIED', `Cell (${x},${y}) is occupied by ${occupant.id}`);
  }

  const existing = robotByNum(state, num);
  // An existing robot keeps its queue; PLACE resets its GOTO no-path counter (DECISIONS 3.5, 4.4).
  const placed: Robot = {
    id,
    num,
    x,
    y,
    facing,
    queue: existing?.queue ?? [],
    gotoNoPathTicks: 0,
  };

  const otherRobots = state.robots.filter((robot) => robot.num !== num);
  const next: FloorState = {
    ...state,
    robots: sortRobots([...otherRobots, placed]),
    // High-water mark: placing R3 on a floor whose mark is 10 leaves it at 10.
    nextRobotNum: Math.max(state.nextRobotNum, num + 1),
  };
  return accept(next, [
    { type: 'ROBOT_PLACED', id, x, y, facing, replaced: existing !== undefined },
  ]);
}

function removeRobot(state: FloorState, rawId: string): ApplyResult {
  const found = findRobot(state, rawId);
  if ('rejection' in found) {
    return found.rejection;
  }
  // nextRobotNum is deliberately untouched, so the removed robot's ID is never reused.
  const next: FloorState = {
    ...state,
    robots: state.robots.filter((robot) => robot.num !== found.robot.num),
  };
  return accept(next, [{ type: 'ROBOT_REMOVED', id: found.robot.id }]);
}

// ---------------------------------------------------------------------------
// SET_OBSTACLE / TOGGLE_OBSTACLE
// ---------------------------------------------------------------------------

function setObstacle(state: FloorState, x: number, y: number, present: boolean): ApplyResult {
  if (!isOnFloor(state, x, y)) {
    return reject(
      'OUT_OF_BOUNDS',
      `Cell (${String(x)},${String(y)}) is off the ${state.width}x${state.height} floor`,
    );
  }
  if (hasObstacle(state, x, y) === present) {
    // Already in the requested state: success, nothing changes, nothing to log.
    return accept(state, []);
  }
  if (present) {
    const occupant = robotAt(state, x, y);
    if (occupant !== undefined) {
      return reject('CELL_OCCUPIED', `Cell (${x},${y}) is occupied by ${occupant.id}`);
    }
  }

  const obstacles = present
    ? sortObstacles([...state.obstacles, { x, y }])
    : state.obstacles.filter((obstacle) => obstacle.x !== x || obstacle.y !== y);
  return accept({ ...state, obstacles }, [{ type: 'OBSTACLE_SET', x, y, present }]);
}

function toggleObstacle(state: FloorState, x: number, y: number): ApplyResult {
  // Off-floor coordinates are rejected by setObstacle, whatever `present` is.
  return setObstacle(state, x, y, !hasObstacle(state, x, y));
}

// ---------------------------------------------------------------------------
// QUEUE_COMMANDS / CLEAR_QUEUE
// ---------------------------------------------------------------------------

/** Outcome of validating one command: a clean copy, or the rejection to return. */
type CommandCheck = { readonly command: Command } | { readonly rejection: ApplyResult };

function checkCommand(state: FloorState, command: Command): CommandCheck {
  switch (command.kind) {
    case 'MOVE':
      return { command: { kind: 'MOVE' } };
    case 'LEFT':
      return { command: { kind: 'LEFT' } };
    case 'RIGHT':
      return { command: { kind: 'RIGHT' } };
    case 'GOTO': {
      const { x, y } = command;
      if (!isOnFloor(state, x, y)) {
        return {
          rejection: reject(
            'INVALID_GOTO_TARGET',
            `GOTO target (${String(x)},${String(y)}) is off the floor`,
          ),
        };
      }
      if (hasObstacle(state, x, y)) {
        return {
          rejection: reject('INVALID_GOTO_TARGET', `GOTO target (${x},${y}) is an obstacle`),
        };
      }
      return { command: { kind: 'GOTO', x, y } };
    }
    default:
      return { rejection: reject('INVALID_COMMAND', `Unknown command ${JSON.stringify(command)}`) };
  }
}

function queueCommands(
  state: FloorState,
  rawId: string,
  commands: readonly Command[],
): ApplyResult {
  const found = findRobot(state, rawId);
  if ('rejection' in found) {
    return found.rejection;
  }
  const { robot } = found;

  if (commands.length === 0) {
    return reject('INVALID_COMMAND', 'No commands to queue');
  }

  // Validate every command before queueing any of them, so a bad one queues nothing.
  const accepted: Command[] = [];
  for (const command of commands) {
    const check = checkCommand(state, command);
    if ('rejection' in check) {
      return check.rejection;
    }
    accepted.push(check.command);
  }

  const updated: Robot = { ...robot, queue: [...robot.queue, ...accepted] };
  return accept(replaceRobot(state, updated), [
    { type: 'COMMANDS_QUEUED', id: robot.id, commands: accepted },
  ]);
}

function clearQueue(state: FloorState, rawId: string): ApplyResult {
  const found = findRobot(state, rawId);
  if ('rejection' in found) {
    return found.rejection;
  }
  const updated: Robot = { ...found.robot, queue: [] };
  return accept(replaceRobot(state, updated), [{ type: 'QUEUE_CLEARED', id: found.robot.id }]);
}

/** Same robots, with the one sharing `updated.num` swapped for `updated`. Order is preserved. */
function replaceRobot(state: FloorState, updated: Robot): FloorState {
  return {
    ...state,
    robots: state.robots.map((robot) => (robot.num === updated.num ? updated : robot)),
  };
}

// ---------------------------------------------------------------------------
// TICK (DECISIONS.md 2.1)
// ---------------------------------------------------------------------------

/**
 * What one robot intends to do this tick, decided before any robot actually moves
 * (steps 1 and 2 of DECISIONS 2.1).
 */
interface RobotPlan {
  readonly robot: Robot;
  /** The command that runs this tick, or null if the queue is empty. */
  readonly command: Command | null;
  /** Facing at the end of the tick. Turning is applied immediately, even if the move is later blocked. */
  readonly facing: Facing;
  /** Value of `gotoNoPathTicks` after this tick. */
  readonly gotoNoPathTicks: number;
  /** The cell this robot wants to step into, or null if it is not trying to move. */
  readonly moveTarget: Position | null;
  /** The result to report when the robot is not trying to move. Unused when `moveTarget` is set. */
  readonly stationaryOutcome: StationaryOutcome;
  /**
   * Is the front command removed from the queue at the end of the tick?
   *  - 'ALWAYS': it was used up (MOVE, LEFT, RIGHT, or a GOTO that arrived or gave up).
   *  - 'NEVER': it stays (GOTO that is still travelling or waiting).
   *  - 'IF_MOVED': GOTO step onto its final target: removed only if the robot really moved.
   */
  readonly removeFront: 'ALWAYS' | 'NEVER' | 'IF_MOVED';
}

type StationaryOutcome = 'IDLE' | 'TURNED' | 'WAITING' | 'UNREACHABLE' | 'ARRIVED';

function tick(state: FloorState): ApplyResult {
  // Steps 1 and 2: every robot picks its command and decides whether it wants to move.
  const plans = state.robots.map((robot) => planRobot(state, robot));

  // Steps 3 to 5: decide which of the wanted moves succeed.
  const resolutions = resolveMoves({
    width: state.width,
    height: state.height,
    isObstacle: (x, y) => hasObstacle(state, x, y),
    robots: state.robots,
    intents: plans.flatMap((plan) =>
      plan.moveTarget === null ? [] : [{ num: plan.robot.num, target: plan.moveTarget }],
    ),
  });

  // Step 6: apply all positions together and record one result per robot.
  const results: RobotTickResult[] = [];
  const robots: Robot[] = [];
  for (const plan of plans) {
    const resolution = resolutions.get(plan.robot.num);
    const finished = finishRobot(plan, resolution);
    results.push(finished.result);
    robots.push(finished.robot);
  }

  const newTick = state.tick + 1;
  const next: FloorState = { ...state, robots, tick: newTick };
  return accept(next, [{ type: 'TICK_RESOLVED', tick: newTick, results }]);
}

// --- steps 1 and 2: planning ------------------------------------------------

function planRobot(state: FloorState, robot: Robot): RobotPlan {
  const front = robot.queue[0];
  if (front === undefined) {
    return stationaryPlan(robot, null, robot.facing, 'IDLE', 'NEVER');
  }

  switch (front.kind) {
    case 'LEFT':
      return stationaryPlan(robot, front, turnLeft(robot.facing), 'TURNED', 'ALWAYS');
    case 'RIGHT':
      return stationaryPlan(robot, front, turnRight(robot.facing), 'TURNED', 'ALWAYS');
    case 'MOVE':
      return {
        robot,
        command: front,
        facing: robot.facing,
        gotoNoPathTicks: robot.gotoNoPathTicks,
        moveTarget: stepForward(robot, robot.facing),
        stationaryOutcome: 'IDLE',
        removeFront: 'ALWAYS',
      };
    case 'GOTO':
      return planGotoStep(state, robot, front);
  }
}

function stationaryPlan(
  robot: Robot,
  command: Command | null,
  facing: Facing,
  outcome: StationaryOutcome,
  removeFront: RobotPlan['removeFront'],
): RobotPlan {
  return {
    robot,
    command,
    facing,
    gotoNoPathTicks: robot.gotoNoPathTicks,
    moveTarget: null,
    stationaryOutcome: outcome,
    removeFront,
  };
}

/**
 * GOTO (DECISIONS section 3). Each tick the robot searches for a shortest path afresh:
 *  - target is the robot's own cell → stationaryPlan(..., 'ARRIVED', 'ALWAYS'), counter reset to 0;
 *  - no path → stationaryPlan(..., 'WAITING', 'NEVER') with the counter + 1, or on the
 *    GOTO_MAX_NO_PATH_TICKS-th tick in a row 'UNREACHABLE' with 'ALWAYS' and the counter back at 0;
 *  - path found → a plan with the new facing, `moveTarget` set to the first step, the counter
 *    reset to 0, and removeFront 'IF_MOVED' when that step lands on the GOTO target, else 'NEVER'.
 */
function planGotoStep(state: FloorState, robot: Robot, command: Command): RobotPlan {
  if (command.kind !== 'GOTO') {
    throw new Error('planGotoStep needs a GOTO command');
  }
  const target: Position = { x: command.x, y: command.y };

  if (robot.x === target.x && robot.y === target.y) {
    return {
      ...stationaryPlan(robot, command, robot.facing, 'ARRIVED', 'ALWAYS'),
      gotoNoPathTicks: 0,
    };
  }

  const direction = firstStepToward(state, robot, target);
  if (direction === null) {
    const noPathTicks = robot.gotoNoPathTicks + 1;
    if (noPathTicks >= GOTO_MAX_NO_PATH_TICKS) {
      return {
        ...stationaryPlan(robot, command, robot.facing, 'UNREACHABLE', 'ALWAYS'),
        gotoNoPathTicks: 0,
      };
    }
    return {
      ...stationaryPlan(robot, command, robot.facing, 'WAITING', 'NEVER'),
      gotoNoPathTicks: noPathTicks,
    };
  }

  // Turning to face the step is free and sticks even if the move is then blocked (DECISIONS 3.6).
  const step = stepForward(robot, direction);
  const stepIsTarget = step.x === target.x && step.y === target.y;
  return {
    robot,
    command,
    facing: direction,
    gotoNoPathTicks: 0,
    moveTarget: step,
    stationaryOutcome: 'IDLE',
    removeFront: stepIsTarget ? 'IF_MOVED' : 'NEVER',
  };
}

// --- step 6: applying the outcome -------------------------------------------

interface FinishedRobot {
  readonly robot: Robot;
  readonly result: RobotTickResult;
}

function finishRobot(plan: RobotPlan, resolution: MoveResolution | undefined): FinishedRobot {
  const { robot, command, facing, moveTarget } = plan;
  const from: Position = { x: robot.x, y: robot.y };

  if (moveTarget !== null && resolution === undefined) {
    throw new Error(`Move resolution missing for ${robot.id}`);
  }
  const moved = moveTarget !== null && resolution?.outcome === 'MOVED';
  const to = moved ? moveTarget : from;
  const removeFront = plan.removeFront === 'ALWAYS' || (plan.removeFront === 'IF_MOVED' && moved);

  const nextRobot: Robot = {
    ...robot,
    x: to.x,
    y: to.y,
    facing,
    queue: removeFront ? robot.queue.slice(1) : robot.queue,
    gotoNoPathTicks: plan.gotoNoPathTicks,
  };
  const base = { id: robot.id, command, from, to, facing };

  if (moveTarget === null) {
    return { robot: nextRobot, result: { ...base, outcome: plan.stationaryOutcome } };
  }
  if (resolution?.outcome === 'BLOCKED') {
    return { robot: nextRobot, result: { ...base, outcome: 'BLOCKED', reason: resolution.reason } };
  }
  if (command?.kind === 'GOTO' && plan.removeFront === 'IF_MOVED') {
    return { robot: nextRobot, result: { ...base, outcome: 'MOVED', reachedGoto: true } };
  }
  return { robot: nextRobot, result: { ...base, outcome: 'MOVED' } };
}
