/**
 * A deliberately NAIVE reference implementation of one TICK for MOVE / LEFT / RIGHT (no GOTO).
 *
 * It shares no code with the real engine (only TYPE imports) and favours obviousness over speed:
 *
 *   1. Take the front command of every robot.
 *   2. LEFT / RIGHT turn. A MOVE whose target is off the floor or an obstacle is blocked.
 *   3. Among the remaining movers aiming at the same cell only the lowest number stays "tentatively
 *      moving"; the rest are blocked (contested).
 *   4. Remove every tentative mover that is part of a 2-cycle (two robots aiming at each other's cell).
 *   5. Repeat until nothing changes: a tentative mover whose target cell holds a robot that is NOT
 *      still tentatively moving is blocked too (that robot is staying, or is itself blocked).
 *   6. Everything left moves. (What remains are chains that end in an empty cell, and loops of
 *      length 4 or more, which the fixpoint never removes.)
 *
 * Block reasons follow DECISIONS 2.1 to 2.4 and 2.7.
 */
import type { BlockReason, Command, Facing, FloorState } from '../../src/types.js';

export interface RefRobot {
  id: string;
  num: number;
  x: number;
  y: number;
  facing: Facing;
  queue: Command[];
}

export interface RefState {
  width: number;
  height: number;
  obstacles: { x: number; y: number }[];
  robots: RefRobot[]; // sorted by num
}

export type RefOutcome = 'IDLE' | 'TURNED' | 'MOVED' | 'BLOCKED';

export interface RefResult {
  id: string;
  num: number;
  command: Command | null;
  outcome: RefOutcome;
  reason?: BlockReason;
  from: { x: number; y: number };
  to: { x: number; y: number };
  facing: Facing;
}

const DX: Record<Facing, number> = { NORTH: 0, EAST: 1, SOUTH: 0, WEST: -1 };
const DY: Record<Facing, number> = { NORTH: 1, EAST: 0, SOUTH: -1, WEST: 0 };
const CLOCKWISE: Facing[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

function rotate(f: Facing, quarterTurnsClockwise: number): Facing {
  const i = CLOCKWISE.indexOf(f);
  return CLOCKWISE[(i + quarterTurnsClockwise + 4) % 4] as Facing;
}

export function refFromState(s: FloorState): RefState {
  return {
    width: s.width,
    height: s.height,
    obstacles: s.obstacles.map((o) => ({ x: o.x, y: o.y })),
    robots: s.robots
      .map((r) => ({
        id: r.id,
        num: r.num,
        x: r.x,
        y: r.y,
        facing: r.facing,
        queue: [...r.queue],
      }))
      .sort((a, b) => a.num - b.num),
  };
}

export function refTick(state: RefState): { state: RefState; results: RefResult[] } {
  const robots = state.robots;
  const at = (x: number, y: number) => robots.find((r) => r.x === x && r.y === y);
  const isObstacle = (x: number, y: number) => state.obstacles.some((o) => o.x === x && o.y === y);
  const onFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < state.width && y < state.height;

  // Step 1 and 2: front commands, turns, wall / obstacle blocks.
  const command = new Map<string, Command | null>();
  const reason = new Map<string, BlockReason>();
  const target = new Map<string, { x: number; y: number }>();
  const tentative = new Set<string>();
  for (const r of robots) {
    const cmd = r.queue[0] ?? null;
    command.set(r.id, cmd);
    if (cmd?.kind !== 'MOVE') continue;
    const t = { x: r.x + DX[r.facing], y: r.y + DY[r.facing] };
    target.set(r.id, t);
    if (!onFloor(t.x, t.y)) reason.set(r.id, 'WALL');
    else if (isObstacle(t.x, t.y)) reason.set(r.id, 'OBSTACLE');
    else tentative.add(r.id);
  }

  // Step 3: contests. The lowest number aiming at a cell keeps its claim.
  for (const r of robots) {
    if (!tentative.has(r.id)) continue;
    const t = target.get(r.id);
    const rival = robots.find(
      (o) =>
        o.num < r.num &&
        tentative.has(o.id) &&
        target.get(o.id)?.x === t?.x &&
        target.get(o.id)?.y === t?.y,
    );
    if (rival) reason.set(r.id, 'CONTESTED');
  }
  for (const r of robots) if (reason.get(r.id) === 'CONTESTED') tentative.delete(r.id);

  // Step 4: head-on pairs (both aim at each other's cell).
  const aimsAtCellOf = (a: RefRobot, b: RefRobot) =>
    target.get(a.id)?.x === b.x && target.get(a.id)?.y === b.y;
  for (const a of robots) {
    for (const b of robots) {
      if (
        a.num < b.num &&
        tentative.has(a.id) &&
        tentative.has(b.id) &&
        aimsAtCellOf(a, b) &&
        aimsAtCellOf(b, a)
      ) {
        reason.set(a.id, 'HEAD_ON');
        reason.set(b.id, 'HEAD_ON');
      }
    }
  }
  for (const r of robots) if (reason.get(r.id) === 'HEAD_ON') tentative.delete(r.id);

  // Step 5: fixpoint. A mover whose target holds a robot that is not (still) moving is blocked.
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of robots) {
      if (!tentative.has(r.id)) continue;
      const t = target.get(r.id) as { x: number; y: number };
      const occupant = at(t.x, t.y);
      if (occupant && !tentative.has(occupant.id)) {
        tentative.delete(r.id);
        // The occupant "tried to move" iff its front command is MOVE.
        reason.set(r.id, command.get(occupant.id)?.kind === 'MOVE' ? 'BEHIND_BLOCKED' : 'OCCUPIED');
        changed = true;
      }
    }
  }

  // Step 6: apply.
  const results: RefResult[] = [];
  const next: RefRobot[] = [];
  for (const r of robots) {
    const cmd = command.get(r.id) ?? null;
    let facing = r.facing;
    let x = r.x;
    let y = r.y;
    let outcome: RefOutcome;
    if (cmd === null) outcome = 'IDLE';
    else if (cmd.kind === 'LEFT') {
      facing = rotate(r.facing, -1);
      outcome = 'TURNED';
    } else if (cmd.kind === 'RIGHT') {
      facing = rotate(r.facing, 1);
      outcome = 'TURNED';
    } else if (tentative.has(r.id)) {
      const t = target.get(r.id) as { x: number; y: number };
      x = t.x;
      y = t.y;
      outcome = 'MOVED';
    } else {
      outcome = 'BLOCKED';
    }
    const result: RefResult = {
      id: r.id,
      num: r.num,
      command: cmd,
      outcome,
      from: { x: r.x, y: r.y },
      to: { x, y },
      facing,
    };
    if (outcome === 'BLOCKED') result.reason = reason.get(r.id) as BlockReason;
    results.push(result);
    next.push({ id: r.id, num: r.num, x, y, facing, queue: r.queue.slice(1) });
  }
  return { state: { ...state, robots: next }, results };
}
