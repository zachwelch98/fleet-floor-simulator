import { afterEach, describe, expect, it } from 'vitest';
import { apply, createFloorState } from '@fleet/engine';
import type { Action, FloorState, WorldEvent } from '@fleet/engine';
import { DatabaseService } from '../../src/database/database.service.js';
import { FloorRepository, VersionConflictError } from '../../src/floors/floor.repository.js';

const AT = new Date('2026-01-02T03:04:05.000Z');
const open: DatabaseService[] = [];

function repo(): FloorRepository {
  const database = new DatabaseService(':memory:');
  open.push(database);
  return new FloorRepository(database);
}

afterEach(() => {
  for (const database of open.splice(0)) {
    database.onModuleDestroy();
  }
});

function applied(
  state: FloorState,
  action: Action,
): { state: FloorState; events: readonly WorldEvent[] } {
  const result = apply(state, action);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

describe('FloorRepository', () => {
  it('rejects a stale version without writing anything', () => {
    const repository = repo();
    const create: Action = { type: 'CREATE_FLOOR', width: 4, height: 4 };
    const created = applied(createFloorState(1, 1), create);
    repository.commit('f', 0, create, created.state, created.events, AT);

    const place: Action = { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' };
    const placed = applied(created.state, place);
    expect(() => repository.commit('f', 0, place, placed.state, placed.events, AT)).toThrow(
      VersionConflictError,
    );
    expect(() => repository.commit('f', 5, place, placed.state, placed.events, AT)).toThrow(
      VersionConflictError,
    );

    expect(repository.loadState('f')).toEqual({ version: 1, state: created.state });
    expect(repository.history('f')).toHaveLength(1);
    expect(repository.loadActions('f')).toEqual([create]);
  });

  it('returns null for unknown floors and rebuilds queues with GOTO arguments', () => {
    const repository = repo();
    expect(repository.loadState('missing')).toBeNull();

    let state = createFloorState(5, 5);
    const steps: Action[] = [
      { type: 'CREATE_FLOOR', width: 5, height: 5 },
      { type: 'PLACE_ROBOT', x: 0, y: 0, facing: 'EAST' },
      {
        type: 'QUEUE_COMMANDS',
        id: 'R1',
        commands: [{ kind: 'LEFT' }, { kind: 'GOTO', x: 3, y: 4 }, { kind: 'MOVE' }],
      },
    ];
    steps.forEach((action, index) => {
      const next = applied(state, action);
      repository.commit('f', index, action, next.state, next.events, AT);
      state = next.state;
    });
    expect(repository.loadState('f')?.state).toEqual(state);
    expect(repository.loadState('f')?.state.robots[0]?.queue).toEqual([
      { kind: 'LEFT' },
      { kind: 'GOTO', x: 3, y: 4 },
      { kind: 'MOVE' },
    ]);
  });
});
