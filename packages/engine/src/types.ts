/**
 * Engine contract. Every other part of the system (scenario runner, API, UI) codes
 * against these types. Changes go through the PM; see docs/PLAN.md.
 *
 * All state is plain, JSON-serializable data so it can be snapshotted to SQLite,
 * sent over the wire, and deep-compared in tests without custom serializers.
 */

export type Facing = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';

/** Clockwise order. Also the GOTO tie-break order (NORTH, EAST, SOUTH, WEST). */
export const FACINGS: readonly Facing[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

export const MIN_FLOOR_SIZE = 1;
export const MAX_FLOOR_SIZE = 20;
export const UI_DEFAULT_FLOOR = { width: 10, height: 8 } as const;
export const SCENARIO_DEFAULT_FLOOR = { width: 5, height: 5 } as const;

/** GOTO is dropped after this many consecutive ticks without a path. */
export const GOTO_MAX_NO_PATH_TICKS = 3;

/** Origin (0,0) is the south-west corner; x grows east, y grows north. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/** Canonical robot ID: "R" followed by a positive integer without leading zeros, e.g. "R1", "R10". */
export type RobotId = string;

export type Command =
  | { readonly kind: 'MOVE' }
  | { readonly kind: 'LEFT' }
  | { readonly kind: 'RIGHT' }
  | { readonly kind: 'GOTO'; readonly x: number; readonly y: number };

export interface Robot {
  readonly id: RobotId;
  /** Numeric part of the ID. Contest priority: lower wins. */
  readonly num: number;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  /** Pending commands, front first. A GOTO stays at the front until it arrives or gives up. */
  readonly queue: readonly Command[];
  /** Consecutive ticks the front GOTO found no path. Reset when a path is found and on PLACE. */
  readonly gotoNoPathTicks: number;
}

/**
 * The whole world for one floor.
 * Invariants (canonical form, so deep-equality is meaningful):
 *  - `robots` sorted by `num` ascending, unique ids, unique cells, all on-floor, none on obstacles.
 *  - `obstacles` sorted by x then y, no duplicates, all on-floor.
 */
export interface FloorState {
  readonly width: number;
  readonly height: number;
  readonly obstacles: readonly Position[];
  readonly robots: readonly Robot[];
  /** High-water mark for UI auto-IDs: next auto-placed robot is R<nextRobotNum>. Never decreases. */
  readonly nextRobotNum: number;
  /** Number of ticks resolved on this floor so far. */
  readonly tick: number;
}

// ---------------------------------------------------------------------------
// Actions: every change to the world goes through `apply(state, action)`.
// ---------------------------------------------------------------------------

export type Action =
  /** Replace the world with a blank floor (scenario FLOOR, UI "new floor"). */
  | { readonly type: 'CREATE_FLOOR'; readonly width: number; readonly height: number }
  /**
   * Place a robot. `id` omitted → auto-assign R<nextRobotNum> (UI click).
   * `id` of an existing robot → move it there (keeps queue, resets gotoNoPathTicks).
   */
  | {
      readonly type: 'PLACE_ROBOT';
      readonly id?: RobotId;
      readonly x: number;
      readonly y: number;
      readonly facing: Facing;
    }
  | { readonly type: 'REMOVE_ROBOT'; readonly id: RobotId }
  /** Scenario OBSTACLE uses present: true. Setting an existing state is a successful no-op. */
  | { readonly type: 'SET_OBSTACLE'; readonly x: number; readonly y: number; readonly present: boolean }
  /** UI edit-mode click. */
  | { readonly type: 'TOGGLE_OBSTACLE'; readonly x: number; readonly y: number }
  /** Append one or more commands. Atomic: if any command is invalid, nothing is queued. */
  | { readonly type: 'QUEUE_COMMANDS'; readonly id: RobotId; readonly commands: readonly Command[] }
  | { readonly type: 'CLEAR_QUEUE'; readonly id: RobotId }
  | { readonly type: 'TICK' };

export type ActionType = Action['type'];

/** Why an action was refused. The state is unchanged when an action is rejected. */
export type RejectionReason =
  | 'INVALID_SIZE' // floor dimensions outside 1..20 or not integers
  | 'INVALID_ID' // malformed robot ID (e.g. "R0", "X1")
  | 'OUT_OF_BOUNDS' // target cell is off the floor
  | 'CELL_IS_OBSTACLE' // robot placement on an obstacle
  | 'CELL_OCCUPIED' // robot or obstacle placement on a cell holding (another) robot
  | 'UNKNOWN_ROBOT' // no robot with that ID
  | 'INVALID_COMMAND' // empty command list or malformed command
  | 'INVALID_GOTO_TARGET'; // GOTO target is off the floor or an obstacle

// ---------------------------------------------------------------------------
// Events: what `apply` reports. These form the history log.
// ---------------------------------------------------------------------------

export type BlockReason =
  | 'WALL' // target cell is off the floor
  | 'OBSTACLE' // target cell is an obstacle
  | 'CONTESTED' // a lower-numbered robot claimed the same target cell
  | 'HEAD_ON' // two robots tried to swap cells
  | 'OCCUPIED' // target cell holds a robot that is not trying to move this tick
  | 'BEHIND_BLOCKED'; // target cell holds a robot that tried to move but was blocked

export type TickOutcome =
  | 'MOVED' // moved one cell (plain MOVE or a GOTO step)
  | 'TURNED' // LEFT / RIGHT
  | 'BLOCKED' // MOVE (or GOTO step) failed; see `reason`. The command is still consumed (GOTO stays queued).
  | 'WAITING' // GOTO found no path this tick; robot did not move
  | 'UNREACHABLE' // GOTO found no path for the 3rd consecutive tick and was dropped
  | 'ARRIVED' // GOTO whose target is the robot's current cell at the start of the tick
  | 'IDLE'; // empty queue

export interface RobotTickResult {
  readonly id: RobotId;
  /** The command that ran this tick, or null when IDLE. */
  readonly command: Command | null;
  readonly outcome: TickOutcome;
  /** Present iff outcome === 'BLOCKED'. */
  readonly reason?: BlockReason;
  readonly from: Position;
  readonly to: Position;
  /** Facing at the end of the tick (a GOTO turn sticks even if the step is blocked). */
  readonly facing: Facing;
  /** True when a GOTO step moved the robot onto its target this tick (GOTO removed from queue). */
  readonly reachedGoto?: boolean;
}

export type WorldEvent =
  | { readonly type: 'FLOOR_CREATED'; readonly width: number; readonly height: number }
  | {
      readonly type: 'ROBOT_PLACED';
      readonly id: RobotId;
      readonly x: number;
      readonly y: number;
      readonly facing: Facing;
      /** True when an existing robot was moved by PLACE. */
      readonly replaced: boolean;
    }
  | { readonly type: 'ROBOT_REMOVED'; readonly id: RobotId }
  | { readonly type: 'OBSTACLE_SET'; readonly x: number; readonly y: number; readonly present: boolean }
  | { readonly type: 'COMMANDS_QUEUED'; readonly id: RobotId; readonly commands: readonly Command[] }
  | { readonly type: 'QUEUE_CLEARED'; readonly id: RobotId }
  /** One per tick. `results` has exactly one entry per robot, sorted by robot number. */
  | { readonly type: 'TICK_RESOLVED'; readonly tick: number; readonly results: readonly RobotTickResult[] };

export type ApplyResult =
  | { readonly ok: true; readonly state: FloorState; readonly events: readonly WorldEvent[] }
  | { readonly ok: false; readonly reason: RejectionReason; readonly message: string };
