/**
 * Simultaneous MOVE resolution (DECISIONS.md 2.1, steps 3 to 5).
 *
 * Input: the floor, every robot's current cell, and the robots that want to move.
 * Output: for each robot that wanted to move, MOVED or BLOCKED with a reason.
 *
 * This module is pure and knows nothing about commands, queues or GOTO. The tick in
 * engine.ts decides *who wants to move where* (steps 1 and 2); this module decides
 * *who actually gets to*.
 *
 * Robots are always visited in ascending robot-number order, so results are deterministic.
 */

import type { BlockReason, Position } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A robot standing on the floor at the start of the tick. */
export interface RobotCell {
  readonly num: number;
  readonly x: number;
  readonly y: number;
}

/** A robot that wants to step into `target` this tick. */
export interface MoveIntent {
  readonly num: number;
  readonly target: Position;
}

export interface MoveRequest {
  readonly width: number;
  readonly height: number;
  readonly isObstacle: (x: number, y: number) => boolean;
  /** Every robot on the floor, including the ones that are not moving. */
  readonly robots: readonly RobotCell[];
  /** Robots that want to move. Each robot appears at most once. */
  readonly intents: readonly MoveIntent[];
}

export type MoveResolution =
  { readonly outcome: 'MOVED' } | { readonly outcome: 'BLOCKED'; readonly reason: BlockReason };

/** One entry per intent, keyed by robot number. */
export type MoveResolutions = ReadonlyMap<number, MoveResolution>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const MOVED: MoveResolution = { outcome: 'MOVED' };

function blocked(reason: BlockReason): MoveResolution {
  return { outcome: 'BLOCKED', reason };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isOnFloor(request: MoveRequest, target: Position): boolean {
  return target.x >= 0 && target.x < request.width && target.y >= 0 && target.y < request.height;
}

function sortedByNum(intents: readonly MoveIntent[]): MoveIntent[] {
  return [...intents].sort((a, b) => a.num - b.num);
}

// ---------------------------------------------------------------------------
// Step 3: walls and obstacles
// ---------------------------------------------------------------------------

/** Blocks every intent that aims off the floor (WALL) or into an obstacle (OBSTACLE). */
function blockWallsAndObstacles(
  request: MoveRequest,
  intents: readonly MoveIntent[],
): Map<number, MoveResolution> {
  const blockedEarly = new Map<number, MoveResolution>();
  for (const intent of intents) {
    if (!isOnFloor(request, intent.target)) {
      blockedEarly.set(intent.num, blocked('WALL'));
    } else if (request.isObstacle(intent.target.x, intent.target.y)) {
      blockedEarly.set(intent.num, blocked('OBSTACLE'));
    }
  }
  return blockedEarly;
}

// ---------------------------------------------------------------------------
// Step 4: contested cells
// ---------------------------------------------------------------------------

/**
 * When several robots aim at the same cell, the lowest robot number keeps its intent
 * and every other robot is blocked with CONTESTED. Because `intents` is sorted by
 * number, the first robot we see for a cell is the winner.
 */
function blockContestedCells(intents: readonly MoveIntent[]): Map<number, MoveResolution> {
  const winnerByCell = new Map<string, number>();
  const losers = new Map<number, MoveResolution>();
  for (const intent of intents) {
    const key = cellKey(intent.target.x, intent.target.y);
    if (winnerByCell.has(key)) {
      losers.set(intent.num, blocked('CONTESTED'));
    } else {
      winnerByCell.set(key, intent.num);
    }
  }
  return losers;
}

// ---------------------------------------------------------------------------
// Step 5: follow the chains
// ---------------------------------------------------------------------------
//
// After steps 3 and 4 every target cell has at most one robot aiming at it, and every
// robot has at most one target. Draw an arrow from each remaining mover to the robot
// standing on its target cell, and every mover sits on either a straight chain
//
//     R1 -> R2 -> R3 -> (empty cell, or a robot that is not moving)
//
// or a closed loop (R1 -> R2 -> R3 -> R1). A loop cannot have a tail leading into it,
// because that would mean two robots aim at the same cell.

/** What a single mover finds when it looks at the robot standing on its target cell. */
type LookAhead =
  /** The answer is known without following anyone: empty cell, or a robot that stays put. */
  | { readonly kind: 'DECIDED'; readonly fate: MoveResolution }
  /** The target cell holds another mover; this robot's fate depends on that one. */
  | { readonly kind: 'FOLLOW'; readonly next: number };

/** How a walk along a chain of movers ended. The last robot in the path is the one it ended on. */
type ChainEnd =
  /** The last robot's own fate is known (it looked ahead and got a DECIDED answer). */
  | { readonly kind: 'DECIDED'; readonly fate: MoveResolution }
  /** The last robot follows a mover whose fate was settled by an earlier walk. */
  | { readonly kind: 'JOINS_SETTLED'; readonly next: number }
  /** The last robot's target is a robot earlier in the same path, so the path is a loop. */
  | { readonly kind: 'LOOP'; readonly loopStart: number };

interface ChainWalk {
  /** Movers in the order we met them, each one following the next. */
  readonly path: readonly number[];
  readonly end: ChainEnd;
}

class ChainResolver {
  /** Final answers. A robot in here is "done". */
  private readonly fates: Map<number, MoveResolution>;
  /** Target cell of each robot that is still trying to move after steps 3 and 4. */
  private readonly targetByMover = new Map<number, Position>();
  /** Which robot stands on each cell at the start of the tick. */
  private readonly occupantByCell = new Map<string, number>();
  /** Every robot that had a MOVE intent, including the ones blocked in steps 3 and 4. */
  private readonly triedToMove: ReadonlySet<number>;

  constructor(
    robots: readonly RobotCell[],
    movers: readonly MoveIntent[],
    triedToMove: ReadonlySet<number>,
    alreadyBlocked: ReadonlyMap<number, MoveResolution>,
  ) {
    this.fates = new Map(alreadyBlocked);
    this.triedToMove = triedToMove;
    for (const robot of robots) {
      this.occupantByCell.set(cellKey(robot.x, robot.y), robot.num);
    }
    for (const mover of movers) {
      this.targetByMover.set(mover.num, mover.target);
    }
  }

  /** Decides every mover. `movers` must be sorted by robot number. */
  resolveAll(movers: readonly MoveIntent[]): void {
    for (const mover of movers) {
      // A robot is "unvisited" until it has a fate. Walks settle whole chains at once,
      // so a mover that already has a fate was reached by an earlier walk.
      if (!this.fates.has(mover.num)) {
        this.settleWalk(this.walkChain(mover.num));
      }
    }
  }

  get results(): ReadonlyMap<number, MoveResolution> {
    return this.fates;
  }

  // --- looking one step ahead ----------------------------------------------

  private lookAhead(mover: number): LookAhead {
    const target = this.targetByMover.get(mover) as Position;
    const occupant = this.occupantByCell.get(cellKey(target.x, target.y));

    if (occupant === undefined) {
      // Empty cell: free to move.
      return { kind: 'DECIDED', fate: MOVED };
    }
    if (this.targetByMover.has(occupant)) {
      // The robot in front is also trying to move (and was not blocked in steps 3 and 4).
      return { kind: 'FOLLOW', next: occupant };
    }
    if (this.triedToMove.has(occupant)) {
      // It tried to move but was blocked in steps 3 or 4: we are stuck behind a blocked robot.
      return { kind: 'DECIDED', fate: blocked('BEHIND_BLOCKED') };
    }
    // It never tried to move (idle, turning, waiting): it keeps its cell all tick.
    return { kind: 'DECIDED', fate: blocked('OCCUPIED') };
  }

  // --- walking a chain -----------------------------------------------------

  /**
   * Follows arrows from `start` until the chain ends. Each robot has one of three visit states:
   *  - unvisited:   no fate yet and not on `path`
   *  - in progress: on `path` of this walk
   *  - done:        has a fate
   */
  private walkChain(start: number): ChainWalk {
    const path: number[] = [];
    const positionOnPath = new Map<number, number>();
    let current = start;

    for (;;) {
      positionOnPath.set(current, path.length);
      path.push(current);

      const ahead = this.lookAhead(current);
      if (ahead.kind === 'DECIDED') {
        return { path, end: ahead };
      }
      if (this.fates.has(ahead.next)) {
        return { path, end: { kind: 'JOINS_SETTLED', next: ahead.next } };
      }
      const loopStart = positionOnPath.get(ahead.next);
      if (loopStart !== undefined) {
        return { path, end: { kind: 'LOOP', loopStart } };
      }
      current = ahead.next;
    }
  }

  // --- settling a walk -----------------------------------------------------

  private settleWalk(walk: ChainWalk): void {
    const { path, end } = walk;

    // Split the path into two parts:
    //  - `unsettled`: robots whose fate depends on the robot after them
    //  - `followed`:  the robot right after the last unsettled one, which already has a fate
    let unsettled: readonly number[];
    let followed: number;

    if (end.kind === 'DECIDED') {
      // Only the last robot in the path is decided directly.
      const last = path[path.length - 1] as number;
      this.fates.set(last, end.fate);
      unsettled = path.slice(0, -1);
      followed = last;
    } else if (end.kind === 'LOOP') {
      // The loop members decide each other; anyone before the loop follows it.
      this.settleLoop(path.slice(end.loopStart));
      unsettled = path.slice(0, end.loopStart);
      followed = path[end.loopStart] as number;
    } else {
      // JOINS_SETTLED: the whole path follows a robot that is already done.
      unsettled = path;
      followed = end.next;
    }

    // Walk backwards: each robot gets a fate based on the robot it follows.
    for (let i = unsettled.length - 1; i >= 0; i--) {
      const mover = unsettled[i] as number;
      this.fates.set(mover, this.fateWhenFollowing(followed));
      followed = mover;
    }
  }

  /** A loop of 2 is a head-on swap (both blocked). A loop of 3 or more is a rotation (all move). */
  private settleLoop(loop: readonly number[]): void {
    const fate = loop.length === 2 ? blocked('HEAD_ON') : MOVED;
    for (const mover of loop) {
      this.fates.set(mover, fate);
    }
  }

  private fateWhenFollowing(followed: number): MoveResolution {
    const followedFate = this.fates.get(followed) as MoveResolution;
    return followedFate.outcome === 'MOVED' ? MOVED : blocked('BEHIND_BLOCKED');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Resolves all MOVE intents of one tick at once. Returns one resolution per intent.
 * Never mutates its input.
 */
export function resolveMoves(request: MoveRequest): MoveResolutions {
  const intents = sortedByNum(request.intents);
  const triedToMove = new Set(intents.map((intent) => intent.num));

  // Step 3: walls and obstacles do not depend on other robots, so decide them first.
  const wallBlocks = blockWallsAndObstacles(request, intents);
  const afterWalls = intents.filter((intent) => !wallBlocks.has(intent.num));

  // Step 4: the lowest-numbered robot per target cell keeps its intent.
  const contestBlocks = blockContestedCells(afterWalls);
  const movers = afterWalls.filter((intent) => !contestBlocks.has(intent.num));

  // Step 5: the remaining movers follow chains and loops.
  const alreadyBlocked = new Map([...wallBlocks, ...contestBlocks]);
  const resolver = new ChainResolver(request.robots, movers, triedToMove, alreadyBlocked);
  resolver.resolveAll(movers);
  return resolver.results;
}
