import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { findScenario } from '../core/scenarios';
import { FLOOR_API, FLOOR_SOCKET, type CommandOutcome } from '../core/transport';
import { MockApi, MockSocket, entry, floorDto, tickResult } from '../testing/mocks';
import { FloorStore } from './floor.store';
import { ScenarioStore } from './scenario.store';

const E = findScenario('brief_e_queues')!;
const BASE = { def: E, baseVersion: 5, baseTick: 0 };

/** The server's TICK_RESOLVED for brief e at `tick`, ending where R1 and R2 are given. */
function tickEntry(seq: number, tick: number, r1: [number, number, 'SOUTH'], r2: [number, number]) {
  return entry(
    seq,
    {
      type: 'TICK_RESOLVED',
      tick,
      results: [
        tickResult('R1', { outcome: 'IDLE', to: { x: r1[0], y: r1[1] }, facing: r1[2] }),
        tickResult('R2', { outcome: 'MOVED', to: { x: r2[0], y: r2[1] }, facing: 'EAST' }),
      ],
    },
    tick,
  );
}

async function setup() {
  const api = new MockApi();
  const socket = new MockSocket();
  api.getFloor.mockResolvedValue(floorDto());
  api.getHistory.mockResolvedValue([]);
  api.pause.mockResolvedValue(floorDto({ playing: false }));
  TestBed.configureTestingModule({
    providers: [
      { provide: FLOOR_API, useValue: api },
      { provide: FLOOR_SOCKET, useValue: socket },
    ],
  });
  const floor = TestBed.inject(FloorStore);
  await floor.init();
  floor.connection.set('connected');
  const scenarios = TestBed.inject(ScenarioStore);
  return { api, floor, scenarios };
}

function success(version: number): CommandOutcome {
  return { kind: 'success', body: { ok: true, floor: floorDto({ version }), history: [] } };
}

describe('ScenarioStore checkpoints', () => {
  it('has no run until a scenario is loaded', async () => {
    const { scenarios } = await setup();
    expect(scenarios.run()).toBeNull();
  });

  it('goes pending, then pass as the server reaches each checkpoint tick', async () => {
    const { floor, scenarios } = await setup();
    scenarios.active.set(BASE);
    expect(scenarios.run()?.checkpoints.map((c) => c.status)).toEqual(['pending', 'pending']);

    floor.history.set([
      tickEntry(6, 1, [2, 2, 'SOUTH'], [0, 1]),
      tickEntry(7, 2, [2, 2, 'SOUTH'], [0, 1]),
    ]);
    expect(scenarios.run()?.checkpoints.map((c) => c.status)).toEqual(['pending', 'pending']);

    floor.history.update((h) => [...h, tickEntry(8, 3, [2, 2, 'SOUTH'], [1, 1])]);
    const first = scenarios.run()!;
    expect(first.checkpoints.map((c) => c.status)).toEqual(['pass', 'pending']);
    expect(first.passed).toBe(1);
    expect(first.complete).toBe(false);

    floor.history.update((h) => [...h, tickEntry(9, 13, [2, 2, 'SOUTH'], [3, 1])]);
    const done = scenarios.run()!;
    expect(done.checkpoints.map((c) => c.status)).toEqual(['pass', 'pass']);
    expect(done.passed).toBe(2);
    expect(done.complete).toBe(true);
    expect(done.modified).toBe(false);
  });

  it('fails a checkpoint with the lines the server produced', async () => {
    const { floor, scenarios } = await setup();
    scenarios.active.set(BASE);
    floor.history.set([tickEntry(6, 3, [2, 2, 'SOUTH'], [0, 2])]);
    const cp = scenarios.run()!.checkpoints[0]!;
    expect(cp.status).toBe('fail');
    expect(cp.expected).toEqual(['R1 2,2,SOUTH', 'R2 1,1,EAST']);
    expect(cp.actual).toEqual(['R1 2,2,SOUTH', 'R2 0,2,EAST']);
    expect(scenarios.run()!.passed).toBe(0);
  });

  it('matches by tick number relative to the load, and ignores history from before it', async () => {
    const { floor, scenarios } = await setup();
    // The floor already stood at tick 40 when the setup finished; entry 4 is from before the load.
    scenarios.active.set({ def: E, baseVersion: 5, baseTick: 40 });
    floor.history.set([
      tickEntry(4, 43, [2, 2, 'SOUTH'], [1, 1]),
      tickEntry(6, 41, [2, 2, 'SOUTH'], [0, 1]),
      tickEntry(7, 43, [2, 2, 'SOUTH'], [1, 1]),
    ]);
    expect(scenarios.run()!.checkpoints[0]!.status).toBe('pass');
    floor.history.set([tickEntry(4, 43, [2, 2, 'SOUTH'], [1, 1])]);
    expect(scenarios.run()!.checkpoints[0]!.status).toBe('pending');
  });

  it('marks the run modified on any non-tick change after the load, but not for the setup itself', async () => {
    const { floor, scenarios } = await setup();
    scenarios.active.set(BASE);
    floor.history.set([
      entry(5, { type: 'COMMANDS_QUEUED', id: 'R1', commands: [{ kind: 'MOVE' }] }),
    ]);
    expect(scenarios.run()!.modified).toBe(false);
    floor.history.update((h) => [
      ...h,
      entry(6, { type: 'OBSTACLE_SET', x: 1, y: 1, present: true }),
    ]);
    expect(scenarios.run()!.modified).toBe(true);
  });

  it('ends the run when a floor is created after the load', async () => {
    const { floor, scenarios } = await setup();
    scenarios.active.set(BASE);
    floor.history.set([entry(6, { type: 'FLOOR_CREATED', width: 3, height: 3 })]);
    expect(scenarios.run()).toBeNull();
  });
});

describe('ScenarioStore load', () => {
  it('sends the setup of the selected scenario and tracks from the floor held afterwards', async () => {
    const { api, scenarios } = await setup();
    let version = 1;
    api.sendAction.mockImplementation(async () => success(++version));
    scenarios.select('brief_b_headon');
    const loading = scenarios.load();
    expect(scenarios.loading()).toBe(true);
    await loading;
    expect(scenarios.loading()).toBe(false);
    expect(api.sendAction).toHaveBeenCalledTimes(findScenario('brief_b_headon')!.setup.length);
    expect(scenarios.active()).toMatchObject({ baseVersion: version, baseTick: 0 });
    expect(scenarios.active()?.def.id).toBe('brief_b_headon');
  });

  it('starts no run when the setup is refused, and clears the previous one', async () => {
    const { api, scenarios } = await setup();
    scenarios.active.set(BASE);
    api.sendAction.mockResolvedValue({
      kind: 'rejected',
      body: { ok: false, reason: 'CELL_OCCUPIED', message: 'x', floor: floorDto({ version: 2 }) },
    });
    await scenarios.load();
    expect(scenarios.active()).toBeNull();
    expect(scenarios.loading()).toBe(false);
  });

  it('reload loads the active scenario again even if the picker moved on', async () => {
    const { api, scenarios } = await setup();
    let version = 1;
    api.sendAction.mockImplementation(async () => success(++version));
    scenarios.select('brief_a_chain');
    await scenarios.load();
    scenarios.select('brief_e_queues');
    await scenarios.reload();
    expect(scenarios.active()?.def.id).toBe('brief_a_chain');
    expect(scenarios.selectedId()).toBe('brief_a_chain');
  });
});

describe('ScenarioStore auto-pause', () => {
  it('pauses once when the last checkpoint resolves while playing, and leaves a later Play alone', async () => {
    const { api, floor, scenarios } = await setup();
    scenarios.active.set(BASE);
    floor.floor.set(floorDto({ playing: true, version: 8 }));
    floor.history.set([tickEntry(6, 3, [2, 2, 'SOUTH'], [1, 1])]);
    TestBed.tick();
    expect(api.pause).not.toHaveBeenCalled();

    floor.history.update((h) => [...h, tickEntry(7, 13, [2, 2, 'SOUTH'], [3, 1])]);
    TestBed.tick();
    await Promise.resolve();
    expect(api.pause).toHaveBeenCalledTimes(1);

    // Another tick lands before the pause did, then the user presses Play again: no second pause.
    floor.history.update((h) => [...h, tickEntry(8, 14, [2, 2, 'SOUTH'], [3, 1])]);
    floor.floor.set(floorDto({ playing: false, version: 9 }));
    floor.floor.set(floorDto({ playing: true, version: 10 }));
    TestBed.tick();
    expect(api.pause).toHaveBeenCalledTimes(1);
  });

  it('does not pause while paused or before the run is complete', async () => {
    const { api, floor, scenarios } = await setup();
    scenarios.active.set(BASE);
    floor.history.set([
      tickEntry(6, 3, [2, 2, 'SOUTH'], [1, 1]),
      tickEntry(7, 13, [2, 2, 'SOUTH'], [3, 1]),
    ]);
    TestBed.tick();
    expect(api.pause).not.toHaveBeenCalled();
  });
});
