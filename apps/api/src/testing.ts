import type { INestApplication } from '@nestjs/common';
import type { FloorState } from '@fleet/engine';

/**
 * Test-support contract for the persistence consistency check (PLAN.md "API + persistence").
 * Owner: Dev 2 implements; the Tester asserts all three states are deep-equal.
 */
export interface FloorInspection {
  readonly version: number;
  /** Rebuilt from the normalized tables (floors, obstacles, robots, queue_items). */
  readonly fromTables: FloorState;
  /** Parsed from floor_snapshots.state_json (latest snapshot). */
  readonly fromSnapshot: FloorState;
  /** Every stored action replayed through the engine's `apply` from an empty world. */
  readonly fromReplay: FloorState;
}

export function inspectFloor(_app: INestApplication, _floorId: string): FloorInspection {
  throw new Error('inspectFloor: not implemented');
}
