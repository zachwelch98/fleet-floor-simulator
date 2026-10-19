import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENARIOS } from '../core/scenarios';
import { FLOOR_API, FLOOR_SOCKET } from '../core/transport';
import { MockApi, MockSocket, fakeServer, flush } from '../testing/mocks';
import { FloorStore } from './floor.store';
import { ScenarioStore } from './scenario.store';

async function setup() {
  localStorage.clear();
  const api = new MockApi();
  const socket = new MockSocket();
  const server = fakeServer(api);
  TestBed.resetTestingModule();
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
  return { api, socket, server, floor, scenarios };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function load(env: Env, id: string): Promise<void> {
  env.scenarios.select(id);
  await env.scenarios.load();
}

/** Deliver what the socket would carry for something another tab did. */
function broadcast(env: Env, action: Parameters<Env['server']['external']>[0]): void {
  const body = env.server.external(action);
  env.socket.handlers.onUpdated({ floor: body.floor, history: [...body.history] });
}

const statuses = (env: Env) => env.scenarios.run()?.checkpoints.map((c) => c.status);
const types = (env: Env) => env.server.sent.map((a) => a.type);

afterEach(() => {
  vi.useRealTimers();
});

describe('load', () => {
  it('sends the setup up to the first tick, no tick, and waits for Play or Step', async () => {
    const env = await setup();
    await load(env, 'brief_e_queues');
    expect(types(env)).toEqual([
      'CREATE_FLOOR',
      'PLACE_ROBOT',
      'PLACE_ROBOT',
      'QUEUE_COMMANDS',
      'QUEUE_COMMANDS',
    ]);
    expect(env.api.step).not.toHaveBeenCalled();
    expect(env.scenarios.loading()).toBe(false);
    expect(env.scenarios.active()?.def.id).toBe('brief_e_queues');
    expect(statuses(env)).toEqual(['pending', 'pending']);
    expect(env.scenarios.run()).toMatchObject({ modified: false, finished: false });
  });

  it('starts no run when the setup is refused, and clears the previous one', async () => {
    const env = await setup();
    await load(env, 'brief_a_chain');
    expect(env.scenarios.run()).not.toBeNull();
    env.api.sendAction.mockResolvedValue({
      kind: 'rejected',
      body: {
        ok: false,
        reason: 'CELL_OCCUPIED',
        message: 'x',
        floor: env.server.dto(),
      },
    });
    await load(env, 'brief_b_headon');
    expect(env.scenarios.active()).toBeNull();
    expect(env.scenarios.loading()).toBe(false);
  });

  it('captures a REPORT that comes before the first tick straight from the floor', async () => {
    const env = await setup();
    env.scenarios.select('brief_a_chain');
    await env.scenarios.importFile(
      new File(['PLACE R1 0,0,EAST\nREPORT\nQUEUE R1 MOVE\nTICK\nREPORT\n'], 'early.txt'),
    );
    await env.scenarios.load();
    expect(statuses(env)).toEqual(['pass', 'pending']);
    expect(env.scenarios.run()!.checkpoints[0]).toMatchObject({
      afterTicks: 0,
      live: ['R1 0,0,EAST'],
    });
    await env.scenarios.step();
    expect(statuses(env)).toEqual(['pass', 'pass']);
    expect(env.scenarios.run()!.finished).toBe(true);
  });

  it('reload loads the active scenario again even if the picker moved on', async () => {
    const env = await setup();
    await load(env, 'brief_a_chain');
    env.scenarios.select('brief_e_queues');
    await env.scenarios.reload();
    expect(env.scenarios.active()?.def.id).toBe('brief_a_chain');
    expect(env.scenarios.selectedId()).toBe('brief_a_chain');
  });

  it('refuses a live run over 1000 ticks: floor untouched, checks shown as not run', async () => {
    const env = await setup();
    await env.scenarios.importFile(
      new File(['FLOOR 3,3\nPLACE R1 0,0,EAST\nTICK 1001\nREPORT\n'], 'long.txt'),
    );
    await env.scenarios.load();
    expect(env.server.sent).toEqual([]);
    const run = env.scenarios.run()!;
    expect(run.refused).toBe(true);
    expect(run.checkpoints.map((c) => c.status)).toEqual(['na']);
    expect(run.checkpoints[0]?.runner).toEqual(['R1 0,0,EAST']);
    // Play and Step are the server's: nothing to drive.
    await env.scenarios.step();
    expect(env.api.step).toHaveBeenCalledTimes(1);
    await env.scenarios.play();
    expect(env.api.play).toHaveBeenCalledTimes(1);
  });
});

describe('Step', () => {
  it('advances through one tick and reads the REPORT after it', async () => {
    const env = await setup();
    await load(env, 'brief_a_chain');
    await env.scenarios.step();
    expect(env.api.step).toHaveBeenCalledTimes(1);
    expect(statuses(env)).toEqual(['pass']);
    expect(env.scenarios.run()).toMatchObject({ passed: 1, complete: true, finished: true });
    expect(env.scenarios.stepping()).toBe(false);
  });

  it('sends commands that come after a tick right before the next one, in file order', async () => {
    const env = await setup();
    await load(env, 'goto_two_robots_corridor');
    const afterLoad = env.server.sent.length;
    await env.scenarios.step(); // tick 1, REPORT
    expect(statuses(env)).toEqual(['pass', 'pending', 'pending']);
    for (let i = 0; i < 3; i++) await env.scenarios.step(); // ticks 2-4, REPORT
    expect(statuses(env)).toEqual(['pass', 'pass', 'pending']);
    expect(types(env).slice(afterLoad)).toEqual(['TICK', 'TICK', 'TICK', 'TICK']);

    await env.scenarios.step(); // the two QUEUEs, then tick 5, REPORT
    expect(types(env).slice(afterLoad)).toEqual([
      'TICK',
      'TICK',
      'TICK',
      'TICK',
      'QUEUE_COMMANDS',
      'QUEUE_COMMANDS',
      'TICK',
    ]);
    expect(statuses(env)).toEqual(['pass', 'pass', 'pass']);
    expect(env.scenarios.run()!.finished).toBe(true);
  });

  it('flushes actions that come after the last tick, so the run can finish', async () => {
    const env = await setup();
    await env.scenarios.importFile(
      new File(['PLACE R1 0,0,EAST\nTICK\nQUEUE R1 MOVE\nREPORT\n'], 'tail.txt'),
    );
    await env.scenarios.load();
    await env.scenarios.step();
    expect(types(env).slice(-2)).toEqual(['TICK', 'QUEUE_COMMANDS']);
    expect(env.scenarios.run()).toMatchObject({ finished: true, passed: 1 });
  });

  it('is the server Step when no run is active, and again after the run has finished', async () => {
    const env = await setup();
    await env.scenarios.step();
    expect(env.api.step).toHaveBeenCalledTimes(1);
    await load(env, 'brief_a_chain');
    await env.scenarios.step();
    expect(env.api.step).toHaveBeenCalledTimes(2); // the scenario's own tick
    await env.scenarios.step();
    expect(env.api.step).toHaveBeenCalledTimes(3); // finished: plain Step
    expect(env.scenarios.run()!.modified).toBe(false);
  });
});

describe('Play', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('walks the script one Step per interval and never uses the server Play', async () => {
    const env = await setup();
    await load(env, 'brief_e_queues'); // 13 ticks
    const playing = env.scenarios.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.scenarios.stepping()).toBe(true);
    expect(env.api.step).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(env.api.step).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(env.api.step).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    await playing;
    expect(env.api.step).toHaveBeenCalledTimes(13);
    expect(env.api.play).not.toHaveBeenCalled();
    expect(env.scenarios.stepping()).toBe(false);
    expect(statuses(env)).toEqual(['pass', 'pass']);
    expect(env.scenarios.run()).toMatchObject({ passed: 2, finished: true, modified: false });
  });

  it('follows the interval slider', async () => {
    const env = await setup();
    await load(env, 'brief_e_queues');
    env.floor.intervalMs.set(100);
    void env.scenarios.play();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100 * 4);
    expect(env.api.step).toHaveBeenCalledTimes(5);
  });

  it('Pause stops between steps and Play resumes where it left off', async () => {
    const env = await setup();
    await load(env, 'brief_e_queues');
    const playing = env.scenarios.play();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500 * 2);
    expect(env.api.step).toHaveBeenCalledTimes(3);
    await env.scenarios.pause();
    await playing;
    expect(env.scenarios.stepping()).toBe(false);
    expect(env.api.pause).not.toHaveBeenCalled(); // the server was never playing
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.api.step).toHaveBeenCalledTimes(3);
    expect(statuses(env)).toEqual(['pass', 'pending']); // after tick 3

    // Step works while paused; then Play continues from tick 5.
    await env.scenarios.step();
    expect(env.api.step).toHaveBeenCalledTimes(4);
    const resumed = env.scenarios.play();
    await vi.advanceTimersByTimeAsync(20_000);
    await resumed;
    expect(env.api.step).toHaveBeenCalledTimes(13);
    expect(statuses(env)).toEqual(['pass', 'pass']);
  });

  it('sends commands between ticks during Play too', async () => {
    const env = await setup();
    await load(env, 'goto_two_robots_corridor');
    const playing = env.scenarios.play();
    await vi.advanceTimersByTimeAsync(10_000);
    await playing;
    expect(types(env).slice(-3)).toEqual(['QUEUE_COMMANDS', 'QUEUE_COMMANDS', 'TICK']);
    expect(statuses(env)).toEqual(['pass', 'pass', 'pass']);
  });

  it('is the server Play when no run is active', async () => {
    const env = await setup();
    await env.scenarios.play();
    expect(env.api.play).toHaveBeenCalledTimes(1);
    expect(env.scenarios.stepping()).toBe(false);
    await env.scenarios.pause();
    expect(env.api.pause).toHaveBeenCalledTimes(1);
  });
});

describe('interference', () => {
  it('an answer whose version skips one (another tab acted in between) stops the run as modified', async () => {
    const env = await setup();
    await load(env, 'brief_e_queues');
    await env.scenarios.step();
    expect(env.scenarios.run()!.modified).toBe(false);
    env.server.external({ type: 'TOGGLE_OBSTACLE', x: 3, y: 0 }); // the store is not told
    await env.scenarios.step();
    expect(env.scenarios.run()!.modified).toBe(true);
    // Stopped: no further script steps; Step is now the plain server Step.
    const steps = env.api.step.mock.calls.length;
    await env.scenarios.step();
    expect(env.api.step).toHaveBeenCalledTimes(steps + 1);
    expect(env.scenarios.run()!.checkpoints.some((c) => c.status === 'pass')).toBe(false);
  });

  it('flags a change that arrives over the socket at once, and stops a running Play', async () => {
    vi.useFakeTimers();
    const env = await setup();
    await load(env, 'brief_e_queues');
    const playing = env.scenarios.play();
    await vi.advanceTimersByTimeAsync(600);
    expect(env.scenarios.stepping()).toBe(true);
    broadcast(env, { type: 'TOGGLE_OBSTACLE', x: 3, y: 0 });
    TestBed.tick();
    expect(env.scenarios.run()!.modified).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await playing;
    expect(env.scenarios.stepping()).toBe(false);
    expect(env.api.step.mock.calls.length).toBeLessThan(5);
  });

  it('flags server Play started from another tab', async () => {
    const env = await setup();
    await load(env, 'brief_e_queues');
    env.socket.handlers.onPlayback({ floorId: 'main', playing: true, intervalMs: 500 });
    TestBed.tick();
    expect(env.scenarios.run()!.modified).toBe(true);
  });

  it('does not flag a finished run for later edits, but a new floor ends it', async () => {
    const env = await setup();
    await load(env, 'brief_a_chain');
    await env.scenarios.step();
    broadcast(env, { type: 'TOGGLE_OBSTACLE', x: 4, y: 4 });
    TestBed.tick();
    expect(env.scenarios.run()).toMatchObject({ modified: false, passed: 1 });
    broadcast(env, { type: 'CREATE_FLOOR', width: 6, height: 4 });
    TestBed.tick();
    expect(env.scenarios.run()).toBeNull();
  });

  it('stops as failed when the server refuses a script command', async () => {
    const env = await setup();
    await load(env, 'brief_a_chain');
    env.api.step.mockResolvedValue({
      kind: 'rejected',
      body: { ok: false, reason: 'CELL_OCCUPIED', message: 'x', floor: env.server.dto() },
    });
    await env.scenarios.step();
    expect(env.scenarios.run()).toMatchObject({ failed: true, modified: false });
  });

  it("the run is not disturbed by this tab's own steps", async () => {
    const env = await setup();
    await load(env, 'goto_two_robots_corridor');
    for (let i = 0; i < 5; i++) await env.scenarios.step();
    TestBed.tick();
    await flush();
    expect(env.scenarios.run()).toMatchObject({ modified: false, failed: false, passed: 3 });
  });
});

describe('checks', () => {
  it('marks a failing live checkpoint and keeps the runner apart when an .expected differs', async () => {
    const env = await setup();
    await env.scenarios.importFile(new File(['PLACE R1 0,0,EAST\nTICK\nREPORT\n'], 'x.txt'));
    await env.scenarios.attachExpectedFile(new File(['R1 7,7,EAST\n'], 'x.expected'));
    await env.scenarios.load();
    await env.scenarios.step();
    const cp = env.scenarios.run()!.checkpoints[0]!;
    expect(cp).toMatchObject({
      status: 'fail',
      expected: ['R1 7,7,EAST'],
      runner: ['R1 0,0,EAST'],
      live: ['R1 0,0,EAST'],
      runnerDiffers: true,
    });
    expect(env.scenarios.run()!.passed).toBe(0);
  });

  it('with no .expected the runner output is the expected, and live must match it', async () => {
    const env = await setup();
    await env.scenarios.importFile(new File(['PLACE R1 0,0,EAST\nTICK\nREPORT\n'], 'x.txt'));
    await env.scenarios.load();
    await env.scenarios.step();
    expect(env.scenarios.run()!.checkpoints[0]).toMatchObject({
      status: 'pass',
      runnerDiffers: false,
    });
  });

  it('a script with no REPORT has no checkpoints and is complete once played', async () => {
    const env = await setup();
    await env.scenarios.importFile(new File(['PLACE R1 0,0,EAST\nTICK\n'], 'none.txt'));
    await env.scenarios.load();
    expect(env.scenarios.run()!.checkpoints).toEqual([]);
    await env.scenarios.step();
    expect(env.scenarios.run()).toMatchObject({ finished: true, complete: true, passed: 0 });
  });
});

describe('uploads through the store', () => {
  it('imports a file under any name, selects it, and lists it after the bundled ones', async () => {
    const env = await setup();
    await env.scenarios.importFile(new File(['TICK\nREPORT\n'], 'my floor test.txt'));
    expect(env.scenarios.selectedId()).toBe('upload:my-floor-test-txt-1');
    expect(env.scenarios.selected()?.title).toBe('my floor test.txt');
    expect(env.scenarios.scenarios().length).toBe(SCENARIOS.length + 1);
    expect(env.scenarios.scenarios().at(-1)?.group).toBe('uploaded');
  });

  it('shows an upload error and leaves the picker alone for an oversized file', async () => {
    const env = await setup();
    const before = env.scenarios.selectedId();
    await env.scenarios.importFile(new File(['#'.repeat(70_000)], 'big.txt'));
    expect(env.scenarios.uploadError()).toMatch(/64 KB/);
    expect(env.scenarios.selectedId()).toBe(before);
    env.scenarios.clearUploadError();
    expect(env.scenarios.uploadError()).toBeNull();
  });

  it('Remove drops the selected upload and ends its run; bundled scenarios cannot be removed', async () => {
    const env = await setup();
    env.scenarios.removeSelected(); // a bundled scenario: nothing happens
    expect(env.scenarios.scenarios()).toHaveLength(SCENARIOS.length);
    await env.scenarios.importFile(new File(['TICK\nREPORT\n'], 'a.txt'));
    await env.scenarios.load();
    expect(env.scenarios.run()).not.toBeNull();
    env.scenarios.removeSelected();
    expect(env.scenarios.scenarios()).toHaveLength(SCENARIOS.length);
    expect(env.scenarios.run()).toBeNull();
    expect(env.scenarios.selectedId()).toBe(SCENARIOS[0]?.id);
  });
});
