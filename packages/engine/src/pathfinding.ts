import { stepForward } from './geometry.js';
import { FACINGS } from './types.js';
import type { Facing, FloorState, Position, Robot } from './types.js';

/** The parts of the world the search needs. */
type Floor = Pick<FloorState, 'width' | 'height' | 'obstacles' | 'robots'>;

/**
 * Which way should `robot` step to get closer to `target` (DECISIONS 3.1)?
 *
 * Walls: cells off the floor, obstacles, and every OTHER robot's current cell. That includes
 * the target itself: if another robot sits on it, nothing can reach it, so the answer is null.
 *
 * How: breadth-first search outward from the target gives each reachable cell its exact
 * distance (in steps) to the target. The robot then looks at its four neighbours in the order
 * NORTH, EAST, SOUTH, WEST and takes the first one that is one step closer than the robot is.
 * Because the order is fixed, equally short routes always resolve the same way.
 *
 * Returns null when the robot cannot reach the target. Returns null as well when the robot is
 * already on the target (the caller handles arrival before asking for a step).
 */
export function firstStepToward(floor: Floor, robot: Robot, target: Position): Facing | null {
  const distances = distancesFrom(floor, robot, target);
  const here = distances.get(cellKey(robot));
  if (here === undefined || here === 0) {
    return null;
  }

  for (const facing of FACINGS) {
    const neighbour = stepForward(robot, facing);
    if (distances.get(cellKey(neighbour)) === here - 1) {
      return facing;
    }
  }
  // Unreachable in practice: a cell at distance d always has a neighbour at distance d - 1.
  return null;
}

/**
 * Number of steps from every reachable cell to `target`, found by BFS from the target.
 * A missing cell means "no path". The cell the moving robot stands on counts as walkable
 * even though a robot (itself) is there.
 */
function distancesFrom(floor: Floor, mover: Robot, target: Position): Map<string, number> {
  const distances = new Map<string, number>();
  if (!isWalkable(floor, mover, target)) {
    return distances;
  }

  distances.set(cellKey(target), 0);
  const frontier: Position[] = [target];
  for (let next = 0; next < frontier.length; next++) {
    const cell = frontier[next] as Position;
    const distance = distances.get(cellKey(cell)) as number;
    for (const facing of FACINGS) {
      const neighbour = stepForward(cell, facing);
      if (!distances.has(cellKey(neighbour)) && isWalkable(floor, mover, neighbour)) {
        distances.set(cellKey(neighbour), distance + 1);
        frontier.push(neighbour);
      }
    }
  }
  return distances;
}

/** On the floor, not an obstacle, and not held by a robot other than `mover`. */
function isWalkable(floor: Floor, mover: Robot, cell: Position): boolean {
  const onFloor = cell.x >= 0 && cell.x < floor.width && cell.y >= 0 && cell.y < floor.height;
  if (!onFloor) {
    return false;
  }
  if (floor.obstacles.some((obstacle) => obstacle.x === cell.x && obstacle.y === cell.y)) {
    return false;
  }
  return !floor.robots.some(
    (other) => other.num !== mover.num && other.x === cell.x && other.y === cell.y,
  );
}

function cellKey(cell: Position): string {
  return `${cell.x},${cell.y}`;
}
