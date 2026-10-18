import type { INestApplication } from '@nestjs/common';
import { apply, createFloorState } from '@fleet/engine';
import type { FloorState } from '@fleet/engine';
import { FloorRepository } from './floors/floor.repository.js';

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

/** Throws if the floor does not exist or a stored action no longer applies. */
export function inspectFloor(app: INestApplication, floorId: string): FloorInspection {
  const repository = app.get(FloorRepository);
  const loaded = repository.loadState(floorId);
  const snapshot = repository.loadSnapshot(floorId);
  if (loaded === null || snapshot === null) {
    throw new Error(`inspectFloor: floor "${floorId}" not found`);
  }

  // The first stored action is always CREATE_FLOOR, which replaces the whole world, so the
  // starting placeholder does not matter.
  let replayed = createFloorState(1, 1);
  for (const [index, action] of repository.loadActions(floorId).entries()) {
    const result = apply(replayed, action);
    if (!result.ok) {
      throw new Error(
        `inspectFloor: stored action #${index + 1} (${action.type}) was rejected on replay: ${result.message}`,
      );
    }
    replayed = result.state;
  }

  return {
    version: loaded.version,
    fromTables: loaded.state,
    fromSnapshot: snapshot,
    fromReplay: replayed,
  };
}
