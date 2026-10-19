import { TestBed } from '@angular/core/testing';
import type { Action } from '@fleet/engine';
import type { CommandRejected, CommandSuccess, FloorDto, HistoryEntry } from '@fleet/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOOR_API, FLOOR_SOCKET, type CommandOutcome } from '../core/transport';
import {
  MockApi,
  MockSocket,
  entry,
  flush,
  floorDto,
  floorState,
  robot,
  tickResult,
} from '../testing/mocks';
import { FloorStore } from './floor.store';
import { ToastService } from './toast.service';

const CREATED = entry(1, { type: 'FLOOR_CREATED', width: 10, height: 8 });

function setup(initial: FloorDto = floorDto(), history: HistoryEntry[] = [CREATED]) {
  const api = new MockApi();
  const socket = new MockSocket();
  api.getFloor.mockResolvedValue(initial);
  api.getHistory.mockResolvedValue(history);
  TestBed.configureTestingModule({
    providers: [
      { provide: FLOOR_API, useValue: api },
      { provide: FLOOR_SOCKET, useValue: socket },
    ],
  });
  const store = TestBed.inject(FloorStore);
  const toasts = TestBed.inject(ToastService);
  return { api, socket, store, toasts };
}

async function ready(ctx: ReturnType<typeof setup>): Promise<void> {
  await ctx.store.init();
  ctx.store.connection.set('connected');
}

function success(floor: FloorDto, history: HistoryEntry[]): CommandOutcome {
  const body: CommandSuccess = { ok: true, floor, history };
  return { kind: 'success', body };
}

function rejected(reason: CommandRejected['reason'], floor: FloorDto): CommandOutcome {
  return { kind: 'rejected', body: { ok: false, reason, message: 'server text', floor } };
}

function lastToast(toasts: ToastService) {
  const list = toasts.toasts();
  return list[list.length - 1];
}

describe('FloorStore loading and socket', () => {
  it('loads the floor and the newest history, then opens the socket', async () => {
    const ctx = setup();
    await ctx.store.init();
    expect(ctx.store.loadState()).toBe('ready');
    expect(ctx.store.floor()?.version).toBe(1);
    expect(ctx.store.history()).toHaveLength(1);
    expect(ctx.api.getHistory).toHaveBeenCalledWith({ limit: 500 });
    expect(ctx.socket.connect).toHaveBeenCalledTimes(1);
    expect(ctx.store.connection()).toBe('reconnecting');
  });

  it('shows the error state when the first load fails and can retry', async () => {
    const ctx = setup();
    ctx.api.getFloor.mockRejectedValueOnce(new Error('down'));
    await ctx.store.init();
    expect(ctx.store.loadState()).toBe('error');
    expect(ctx.socket.connect).not.toHaveBeenCalled();
    await ctx.store.init();
    expect(ctx.store.loadState()).toBe('ready');
  });

  it('on connect: joins the room, catches up after the last seq, then reports connected', async () => {
    const ctx = setup();
    await ctx.store.init();
    const newer = floorDto({ version: 2 });
    ctx.api.getFloor.mockResolvedValue(newer);
    ctx.api.getHistory.mockResolvedValue([entry(2, { type: 'ROBOT_REMOVED', id: 'R9' })]);
    ctx.socket.handlers.onConnect();
    await flush();
    expect(ctx.socket.join).toHaveBeenCalledWith('main');
    expect(ctx.api.getHistory).toHaveBeenLastCalledWith({ after: 1, limit: 2000 });
    expect(ctx.store.connection()).toBe('connected');
    expect(ctx.store.floor()?.version).toBe(2);
    expect(ctx.store.history().map((e) => e.seq)).toEqual([1, 2]);
  });

  it('maps socket drops: transient is reconnecting, server close and give-up are disconnected', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.socket.handlers.onDisconnect(false);
    expect(ctx.store.connection()).toBe('reconnecting');
    ctx.socket.handlers.onDisconnect(true);
    expect(ctx.store.connection()).toBe('disconnected');
    ctx.store.reconnect();
    expect(ctx.store.connection()).toBe('reconnecting');
    expect(ctx.socket.reconnect).toHaveBeenCalled();
    ctx.socket.handlers.onGiveUp();
    expect(ctx.store.connection()).toBe('disconnected');
  });
});

describe('FloorStore version gate, dedupe and catch-up', () => {
  it('applies only a newer floor and merges history by seq', async () => {
    const ctx = setup();
    await ready(ctx);
    const placed = entry(2, {
      type: 'ROBOT_PLACED',
      id: 'R1',
      x: 1,
      y: 1,
      facing: 'NORTH',
      replaced: false,
    });
    const v2 = floorDto({ version: 2, state: floorState({ robots: [robot('R1', 1, 1)] }) });
    ctx.socket.handlers.onUpdated({ floor: v2, history: [placed] });
    expect(ctx.store.floor()?.version).toBe(2);
    // The same broadcast again (echo of an HTTP answer) and an older one change nothing.
    ctx.socket.handlers.onUpdated({ floor: v2, history: [placed] });
    ctx.socket.handlers.onUpdated({ floor: floorDto({ version: 1 }), history: [CREATED] });
    expect(ctx.store.floor()?.version).toBe(2);
    expect(ctx.store.history().map((e) => e.seq)).toEqual([1, 2]);
    expect(ctx.store.state()?.robots).toHaveLength(1);
  });

  it('keeps history sorted and deduped when the HTTP answer and the socket echo both arrive', async () => {
    const ctx = setup();
    await ready(ctx);
    const placed = entry(2, {
      type: 'ROBOT_PLACED',
      id: 'R1',
      x: 1,
      y: 1,
      facing: 'NORTH',
      replaced: false,
    });
    const v2 = floorDto({ version: 2, state: floorState({ robots: [robot('R1', 1, 1)] }) });
    ctx.api.sendAction.mockResolvedValue(success(v2, [placed]));
    await ctx.store.activateCell({ x: 1, y: 1, shift: false });
    ctx.socket.handlers.onUpdated({ floor: v2, history: [placed] });
    expect(ctx.store.history().map((e) => e.seq)).toEqual([1, 2]);
    expect(ctx.store.floor()?.version).toBe(2);
  });

  it('on a version gap refetches the floor and the history after the last seq instead of applying', async () => {
    const ctx = setup();
    await ready(ctx);
    const v4 = floorDto({ version: 4, state: floorState({ tick: 3 }) });
    ctx.api.getFloor.mockResolvedValue(v4);
    ctx.api.getHistory.mockResolvedValue([entry(2, { type: 'ROBOT_REMOVED', id: 'R9' })]);
    const broadcast = floorDto({ version: 4, state: floorState({ tick: 99 }) });
    ctx.socket.handlers.onUpdated({
      floor: broadcast,
      history: [entry(4, { type: 'ROBOT_REMOVED', id: 'R8' })],
    });
    await flush();
    expect(ctx.api.getHistory).toHaveBeenLastCalledWith({ after: 1, limit: 2000 });
    // The authoritative GET won, not the broadcast payload; its history was not merged out of order.
    expect(ctx.store.state()?.tick).toBe(3);
    expect(ctx.store.history().map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('FloorStore derived lastResults', () => {
  it('derives results from the newest tick and drops re-placed, removed and vanished robots', async () => {
    const r1 = robot('R1', 2, 2);
    const r2 = robot('R2', 3, 3);
    const state = floorState({ robots: [r1, r2], tick: 1 });
    const tick = entry(
      2,
      {
        type: 'TICK_RESOLVED',
        tick: 1,
        results: [
          tickResult('R1', { outcome: 'BLOCKED', reason: 'WALL' }),
          tickResult('R2', { outcome: 'MOVED' }),
          tickResult('R3', { outcome: 'MOVED' }),
        ],
      },
      1,
    );
    const ctx = setup(floorDto({ version: 2, state }), [CREATED, tick]);
    await ctx.store.init();
    // R3 is not on the floor.
    expect([...ctx.store.lastResults().keys()]).toEqual(['R1', 'R2']);

    // A re-placement of R1 after the tick clears only R1's result.
    ctx.socket.handlers.onUpdated({
      floor: floorDto({ version: 3, state }),
      history: [
        entry(3, {
          type: 'ROBOT_PLACED',
          id: 'R1',
          x: 2,
          y: 2,
          facing: 'EAST',
          replaced: true,
        }),
      ],
    });
    expect([...ctx.store.lastResults().keys()]).toEqual(['R2']);
  });
});

describe('FloorStore activeBadges', () => {
  it('is the badge codes of robots on the floor now, and empty before the floor loads', async () => {
    const state = floorState({ robots: [robot('R1', 2, 2), robot('R2', 3, 3)], tick: 1 });
    const tick = entry(
      2,
      {
        type: 'TICK_RESOLVED',
        tick: 1,
        results: [
          tickResult('R1', { outcome: 'BLOCKED', reason: 'WALL' }),
          tickResult('R2', { outcome: 'MOVED' }),
          // Not on the floor: its badge must not count.
          tickResult('R3', { outcome: 'BLOCKED', reason: 'CONTESTED' }),
        ],
      },
      1,
    );
    const ctx = setup(floorDto({ version: 2, state }), [CREATED, tick]);
    expect(ctx.store.activeBadges().size).toBe(0);
    await ctx.store.init();
    expect([...ctx.store.activeBadges()]).toEqual(['WL']);
  });
});

describe('FloorStore rejections', () => {
  it('flags the toast stale when the rejection floor is newer than the version held at send time', async () => {
    const ctx = setup();
    await ready(ctx);
    const newer = floorDto({ version: 3, state: floorState({ robots: [robot('R1', 4, 4)] }) });
    ctx.api.sendAction.mockResolvedValue(rejected('CELL_OCCUPIED', newer));
    ctx.api.getHistory.mockResolvedValue([]);
    await ctx.store.activateCell({ x: 4, y: 4, shift: false });
    const toast = lastToast(ctx.toasts)!;
    expect(toast.reason).toBe('CELL_OCCUPIED');
    expect(toast.message).toBe('A robot is already in that cell.');
    expect(toast.stale).toBe(true);
    expect(toast.detail).toBe('Your view was out of date and has been updated.');
    // The authoritative floor was applied.
    expect(ctx.store.floor()?.version).toBe(3);
    expect(ctx.store.state()?.robots).toHaveLength(1);
  });

  it('is not stale when the rejection floor has the version the client already held', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.api.sendAction.mockResolvedValue(rejected('CELL_IS_OBSTACLE', floorDto({ version: 1 })));
    await ctx.store.activateCell({ x: 0, y: 0, shift: false });
    const toast = lastToast(ctx.toasts)!;
    expect(toast.reason).toBe('CELL_IS_OBSTACLE');
    expect(toast.stale).toBe(false);
    expect(toast.detail).toBeUndefined();
    expect(toast.title).toBe('server text');
  });

  it('uses the obstacle wording for CELL_OCCUPIED on TOGGLE_OBSTACLE and the fallback for unknown reasons', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.store.setEditMode(true);
    ctx.api.sendAction.mockResolvedValue(rejected('CELL_OCCUPIED', floorDto()));
    await ctx.store.activateCell({ x: 0, y: 0, shift: false });
    expect(lastToast(ctx.toasts)!.message).toBe(
      "Can't change an obstacle under a robot. Move or delete the robot first.",
    );
    ctx.api.sendAction.mockResolvedValue(
      rejected('SOMETHING_NEW' as CommandRejected['reason'], floorDto()),
    );
    await ctx.store.activateCell({ x: 1, y: 0, shift: false });
    expect(lastToast(ctx.toasts)!.message).toBe("Couldn't do that: server text");
  });

  it('shows NETWORK_ERROR and SERVER_ERROR toasts and leaves the floor alone', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.api.sendAction.mockResolvedValueOnce({ kind: 'NETWORK_ERROR' });
    await ctx.store.activateCell({ x: 0, y: 0, shift: false });
    expect(lastToast(ctx.toasts)!.reason).toBe('NETWORK_ERROR');
    ctx.api.sendAction.mockResolvedValueOnce({ kind: 'SERVER_ERROR' });
    await ctx.store.activateCell({ x: 1, y: 0, shift: false });
    expect(lastToast(ctx.toasts)!.reason).toBe('SERVER_ERROR');
    expect(ctx.store.floor()?.version).toBe(1);
  });

  it('sends nothing while offline and shows the OFFLINE toast', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.store.connection.set('reconnecting');
    await ctx.store.activateCell({ x: 0, y: 0, shift: false });
    await ctx.store.step();
    expect(ctx.api.sendAction).not.toHaveBeenCalled();
    expect(ctx.api.step).not.toHaveBeenCalled();
    expect(lastToast(ctx.toasts)!.reason).toBe('OFFLINE');
  });
});

describe('FloorStore commands', () => {
  it('sends one request at a time, in order', async () => {
    const ctx = setup(floorDto({ state: floorState({ robots: [robot('R1', 1, 1)] }) }));
    await ready(ctx);
    ctx.store.select('R1');
    const sent: Action[] = [];
    let release!: (o: CommandOutcome) => void;
    ctx.api.sendAction.mockImplementation((a) => {
      sent.push(a);
      return sent.length === 1
        ? new Promise<CommandOutcome>((res) => (release = res))
        : Promise.resolve(success(floorDto({ version: 3 }), []));
    });
    const first = ctx.store.queueCommand('MOVE');
    const second = ctx.store.queueCommand('LEFT');
    await flush();
    expect(sent.map((a) => a.type === 'QUEUE_COMMANDS' && a.commands[0]?.kind)).toEqual(['MOVE']);
    release(success(floorDto({ version: 2 }), []));
    await Promise.all([first, second]);
    expect(sent.map((a) => a.type === 'QUEUE_COMMANDS' && a.commands[0]?.kind)).toEqual([
      'MOVE',
      'LEFT',
    ]);
  });

  it('places on an empty cell with no id and selects the new robot from the response', async () => {
    const ctx = setup();
    await ready(ctx);
    const placed = entry(2, {
      type: 'ROBOT_PLACED',
      id: 'R1',
      x: 3,
      y: 2,
      facing: 'NORTH',
      replaced: false,
    });
    ctx.api.sendAction.mockResolvedValue(
      success(floorDto({ version: 2, state: floorState({ robots: [robot('R1', 3, 2)] }) }), [
        placed,
      ]),
    );
    await ctx.store.activateCell({ x: 3, y: 2, shift: false });
    expect(ctx.api.sendAction).toHaveBeenCalledWith({
      type: 'PLACE_ROBOT',
      x: 3,
      y: 2,
      facing: 'NORTH',
    });
    expect(ctx.store.selectedId()).toBe('R1');
    expect(ctx.toasts.toasts()).toHaveLength(0);
  });

  it('follows the pointer matrix: select, deselect, shift without selection, shift GOTO, armed GOTO, edit mode', async () => {
    const r1 = robot('R1', 1, 1);
    const r2 = robot('R2', 5, 5);
    const ctx = setup(floorDto({ state: floorState({ robots: [r1, r2] }) }));
    await ready(ctx);
    ctx.api.sendAction.mockResolvedValue(
      success(floorDto({ version: 2, state: floorState({ robots: [r1, r2] }) }), []),
    );

    // Shift-click with nothing selected: toast, no request.
    await ctx.store.activateCell({ x: 3, y: 3, shift: true });
    expect(lastToast(ctx.toasts)!.reason).toBe('NO_ROBOT_SELECTED');
    expect(ctx.api.sendAction).not.toHaveBeenCalled();

    // Click a robot selects, click it again deselects.
    await ctx.store.activateCell({ x: 1, y: 1, shift: false });
    expect(ctx.store.selectedId()).toBe('R1');
    await ctx.store.activateCell({ x: 1, y: 1, shift: false });
    expect(ctx.store.selectedId()).toBeNull();
    await ctx.store.activateCell({ x: 1, y: 1, shift: false });

    // Shift-click sends GOTO for the selected robot.
    await ctx.store.activateCell({ x: 3, y: 3, shift: true });
    expect(ctx.api.sendAction).toHaveBeenLastCalledWith({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'GOTO', x: 3, y: 3 }],
    });

    // Armed GOTO: next plain click sends GOTO and disarms.
    ctx.store.toggleGoto();
    expect(ctx.store.gotoArmed()).toBe(true);
    await ctx.store.activateCell({ x: 4, y: 4, shift: false });
    expect(ctx.api.sendAction).toHaveBeenLastCalledWith({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'GOTO', x: 4, y: 4 }],
    });
    expect(ctx.store.gotoArmed()).toBe(false);

    // Edit mode: toggles obstacles, ignores shift, disarms GOTO.
    ctx.store.toggleGoto();
    ctx.store.setEditMode(true);
    expect(ctx.store.gotoArmed()).toBe(false);
    await ctx.store.activateCell({ x: 5, y: 5, shift: true });
    expect(ctx.api.sendAction).toHaveBeenLastCalledWith({ type: 'TOGGLE_OBSTACLE', x: 5, y: 5 });
  });

  it('pad GOTO in edit mode turns edit off and arms; with no selection it does nothing', async () => {
    const ctx = setup(floorDto({ state: floorState({ robots: [robot('R1', 1, 1)] }) }));
    await ready(ctx);
    ctx.store.toggleGoto();
    expect(ctx.store.gotoArmed()).toBe(false);
    ctx.store.select('R1');
    ctx.store.setEditMode(true);
    ctx.store.toggleGoto();
    expect(ctx.store.editMode()).toBe(false);
    expect(ctx.store.gotoArmed()).toBe(true);
    // A second press (edit already off) disarms.
    ctx.store.toggleGoto();
    expect(ctx.store.gotoArmed()).toBe(false);
  });

  it('drops command keys silently while an own PLACE is in flight, then resumes', async () => {
    const ctx = setup(floorDto({ state: floorState({ robots: [robot('R1', 1, 1)] }) }));
    await ready(ctx);
    ctx.store.select('R1');
    let release!: (o: CommandOutcome) => void;
    ctx.api.sendAction.mockImplementationOnce(
      () => new Promise<CommandOutcome>((res) => (release = res)),
    );
    const placing = ctx.store.activateCell({ x: 4, y: 4, shift: false });
    await flush();
    await ctx.store.queueCommand('MOVE');
    await flush();
    expect(ctx.api.sendAction).toHaveBeenCalledTimes(1);
    expect(ctx.toasts.toasts()).toHaveLength(0);
    const placed = entry(2, {
      type: 'ROBOT_PLACED',
      id: 'R2',
      x: 4,
      y: 4,
      facing: 'NORTH',
      replaced: false,
    });
    release(
      success(
        floorDto({
          version: 2,
          state: floorState({ robots: [robot('R1', 1, 1), robot('R2', 4, 4)], nextRobotNum: 3 }),
        }),
        [placed],
      ),
    );
    await placing;
    expect(ctx.store.selectedId()).toBe('R2');
    ctx.api.sendAction.mockResolvedValue(success(floorDto({ version: 3 }), []));
    await ctx.store.queueCommand('LEFT');
    expect(ctx.api.sendAction).toHaveBeenLastCalledWith({
      type: 'QUEUE_COMMANDS',
      id: 'R2',
      commands: [{ kind: 'LEFT' }],
    });
  });

  it('resumes command keys after a failed PLACE', async () => {
    const ctx = setup(floorDto({ state: floorState({ robots: [robot('R1', 1, 1)] }) }));
    await ready(ctx);
    ctx.store.select('R1');
    ctx.api.sendAction.mockResolvedValueOnce({ kind: 'NETWORK_ERROR' });
    await ctx.store.activateCell({ x: 4, y: 4, shift: false });
    ctx.api.sendAction.mockResolvedValue(success(floorDto({ version: 2 }), []));
    await ctx.store.queueCommand('MOVE');
    expect(ctx.api.sendAction).toHaveBeenLastCalledWith({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'MOVE' }],
    });
  });

  it('announces a manual Step with one summary sentence', async () => {
    const ctx = setup();
    await ready(ctx);
    const tick = entry(
      2,
      {
        type: 'TICK_RESOLVED',
        tick: 1,
        results: [
          tickResult('R1', { outcome: 'MOVED', to: { x: 2, y: 3 } }),
          tickResult('R2', { outcome: 'BLOCKED', reason: 'OBSTACLE' }),
          tickResult('R3', { outcome: 'IDLE' }),
        ],
      },
      1,
    );
    ctx.api.step.mockResolvedValue(
      success(floorDto({ version: 2, state: floorState({ tick: 1 }) }), [tick]),
    );
    await ctx.store.step();
    expect(ctx.store.announcement()).toBe('Tick 1: R1 moved to 2,3. R2 blocked, obstacle ahead.');
  });
});

describe('FloorStore remote changes (Module D)', () => {
  it('clears the selection and toasts FLOOR_RESET on a remote FLOOR_CREATED', async () => {
    const ctx = setup(floorDto({ state: floorState({ robots: [robot('R1', 1, 1)] }) }));
    await ready(ctx);
    ctx.store.select('R1');
    ctx.store.setEditMode(true);
    ctx.socket.handlers.onUpdated({
      floor: floorDto({ version: 2, state: floorState({ width: 5, height: 4 }) }),
      history: [entry(2, { type: 'FLOOR_CREATED', width: 5, height: 4 })],
    });
    expect(ctx.store.selectedId()).toBeNull();
    expect(ctx.store.editMode()).toBe(true);
    const toast = lastToast(ctx.toasts)!;
    expect(toast.reason).toBe('FLOOR_RESET');
    expect(toast.kind).toBe('info');
    expect(toast.message).toBe('The floor was reset to 5×4.');
  });

  it('does not toast for the own CREATE_FLOOR, even when the socket echo arrives first', async () => {
    const ctx = setup();
    await ready(ctx);
    const created = entry(2, { type: 'FLOOR_CREATED', width: 5, height: 5 });
    const v2 = floorDto({ version: 2, state: floorState({ width: 5, height: 5 }) });
    ctx.api.sendAction.mockImplementation(async () => {
      ctx.socket.handlers.onUpdated({ floor: v2, history: [created] });
      return success(v2, [created]);
    });
    expect(await ctx.store.createFloor(5, 5)).toBe(true);
    expect(ctx.toasts.toasts()).toHaveLength(0);
  });

  it('toasts ROBOT_REMOVED_REMOTE and clears the selection when the selected robot is deleted elsewhere', async () => {
    const ctx = setup(floorDto({ state: floorState({ robots: [robot('R1', 1, 1)] }) }));
    await ready(ctx);
    ctx.store.select('R1');
    ctx.socket.handlers.onUpdated({
      floor: floorDto({ version: 2 }),
      history: [entry(2, { type: 'ROBOT_REMOVED', id: 'R1' })],
    });
    expect(ctx.store.selectedId()).toBeNull();
    const toast = lastToast(ctx.toasts)!;
    expect(toast.reason).toBe('ROBOT_REMOVED_REMOTE');
    expect(toast.message).toBe('R1 was deleted.');
  });

  it('clears the selection silently when our own delete removes the selected robot', async () => {
    const ctx = setup(floorDto({ state: floorState({ robots: [robot('R1', 1, 1)] }) }));
    await ready(ctx);
    ctx.store.select('R1');
    const removed = entry(2, { type: 'ROBOT_REMOVED', id: 'R1' });
    ctx.api.sendAction.mockResolvedValue(success(floorDto({ version: 2 }), [removed]));
    expect(await ctx.store.removeRobot('R1')).toBe(true);
    expect(ctx.store.selectedId()).toBeNull();
    expect(ctx.toasts.toasts()).toHaveLength(0);
  });

  it('announces new non-tick history entries to the live region but not ticks', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.socket.handlers.onUpdated({
      floor: floorDto({ version: 2 }),
      history: [entry(2, { type: 'OBSTACLE_SET', x: 2, y: 3, present: true })],
    });
    expect(ctx.store.announcement()).toBe('Obstacle added at (2,3).');
    ctx.socket.handlers.onUpdated({
      floor: floorDto({ version: 3, state: floorState({ tick: 1 }) }),
      history: [entry(3, { type: 'TICK_RESOLVED', tick: 1, results: [] }, 1)],
    });
    expect(ctx.store.announcement()).toBe('Obstacle added at (2,3).');
  });
});

describe('FloorStore playback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('adopts floor:playback for the button state, the slider and the announcement', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.socket.handlers.onPlayback({ floorId: 'main', playing: true, intervalMs: 200 });
    expect(ctx.store.playing()).toBe(true);
    expect(ctx.store.intervalMs()).toBe(200);
    expect(ctx.store.announcement()).toBe('Playing');
    ctx.socket.handlers.onPlayback({ floorId: 'main', playing: false, intervalMs: 200 });
    expect(ctx.store.playing()).toBe(false);
    expect(ctx.store.announcement()).toBe('Paused at tick 0');
  });

  it('does not let a tick broadcast snap a locally moved slider back while paused', async () => {
    const ctx = setup();
    await ready(ctx);
    ctx.store.changeInterval(2000);
    ctx.socket.handlers.onUpdated({
      floor: floorDto({ version: 2, state: floorState({ tick: 1 }) }),
      history: [entry(2, { type: 'TICK_RESOLVED', tick: 1, results: [] }, 1)],
    });
    expect(ctx.store.intervalMs()).toBe(2000);
  });

  it('sends the slider value with Play and re-sends /play 300 ms after a change while playing', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    await ready(ctx);
    ctx.store.changeInterval(1500);
    ctx.api.play.mockResolvedValue(floorDto({ playing: true, intervalMs: 1500 }));
    await ctx.store.play();
    expect(ctx.api.play).toHaveBeenLastCalledWith(1500);
    expect(ctx.store.playing()).toBe(true);

    ctx.store.changeInterval(1000);
    ctx.store.changeInterval(900);
    expect(ctx.store.intervalMs()).toBe(900);
    await vi.advanceTimersByTimeAsync(299);
    expect(ctx.api.play).toHaveBeenCalledTimes(1);
    ctx.api.play.mockResolvedValue(floorDto({ playing: true, intervalMs: 900 }));
    await vi.advanceTimersByTimeAsync(2);
    expect(ctx.api.play).toHaveBeenCalledTimes(2);
    expect(ctx.api.play).toHaveBeenLastCalledWith(900);
  });
});

describe('FloorStore loadScenario', () => {
  const SETUP: Action[] = [
    { type: 'CREATE_FLOOR', width: 5, height: 5 },
    { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'EAST' },
    { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }] },
  ];

  /** Every send is accepted and bumps the version by one. */
  function acceptAll(ctx: ReturnType<typeof setup>): Action[] {
    const sent: Action[] = [];
    ctx.api.sendAction.mockImplementation(async (a) => {
      sent.push(a);
      const version = 1 + sent.length;
      return success(floorDto({ version, state: floorState({ tick: 0 }) }), [
        entry(version, { type: 'FLOOR_CREATED', width: 5, height: 5 }),
      ]);
    });
    return sent;
  }

  it('sends the setup in order and resolves with the version and tick held afterwards', async () => {
    const ctx = setup();
    await ready(ctx);
    const sent = acceptAll(ctx);
    expect(await ctx.store.loadScenario(SETUP)).toEqual({ ok: true, version: 4, tick: 0 });
    expect(sent).toEqual(SETUP);
    expect(ctx.api.pause).not.toHaveBeenCalled();
  });

  it('pauses first when the floor is playing, before the first action', async () => {
    const ctx = setup(floorDto({ playing: true }));
    await ready(ctx);
    const order: string[] = [];
    ctx.api.pause.mockImplementation(async () => {
      order.push('pause');
      return floorDto({ playing: false });
    });
    ctx.api.sendAction.mockImplementation(async (a) => {
      order.push(a.type);
      return success(floorDto({ version: 2 }), []);
    });
    await ctx.store.loadScenario(SETUP.slice(0, 1));
    expect(order).toEqual(['pause', 'CREATE_FLOOR']);
  });

  it('sends nothing when the pause fails, because the floor is still ticking', async () => {
    const ctx = setup(floorDto({ playing: true }));
    await ready(ctx);
    ctx.api.pause.mockRejectedValue(new Error('down'));
    expect((await ctx.store.loadScenario(SETUP)).ok).toBe(false);
    expect(ctx.api.sendAction).not.toHaveBeenCalled();
  });

  it('stops at the first rejection and reports failure', async () => {
    const ctx = setup();
    await ready(ctx);
    const sent: Action[] = [];
    ctx.api.sendAction.mockImplementation(async (a) => {
      sent.push(a);
      return sent.length === 2
        ? rejected('CELL_OCCUPIED', floorDto({ version: 3 }))
        : success(floorDto({ version: 2 }), []);
    });
    const result = await ctx.store.loadScenario(SETUP);
    expect(result.ok).toBe(false);
    expect(sent).toHaveLength(2);
    expect(lastToast(ctx.toasts)!.reason).toBe('CELL_OCCUPIED');
  });

  it('sends nothing while offline and shows the OFFLINE toast', async () => {
    const ctx = setup();
    await ctx.store.init();
    ctx.store.connection.set('disconnected');
    expect((await ctx.store.loadScenario(SETUP)).ok).toBe(false);
    expect(ctx.api.sendAction).not.toHaveBeenCalled();
    expect(lastToast(ctx.toasts)!.reason).toBe('OFFLINE');
  });
});
