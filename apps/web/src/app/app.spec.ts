import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FloorDto, HistoryEntry } from '@fleet/protocol';
import { describe, expect, it } from 'vitest';
import { App } from './app';
import { FLOOR_API, FLOOR_SOCKET } from './core/transport';
import { FloorStore } from './store/floor.store';
import {
  MockApi,
  MockSocket,
  entry,
  flush,
  floorDto,
  floorState,
  robot,
  tickResult,
} from './testing/mocks';

const CREATED = entry(1, { type: 'FLOOR_CREATED', width: 10, height: 8 });

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await flush();
    fixture.detectChanges();
  }
}

async function mount(
  floor: FloorDto = floorDto(),
  history: HistoryEntry[] = [CREATED],
  connect = true,
) {
  const api = new MockApi();
  const socket = new MockSocket();
  api.getFloor.mockResolvedValue(floor);
  api.getHistory.mockResolvedValue(history);
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      { provide: FLOOR_API, useValue: api },
      { provide: FLOOR_SOCKET, useValue: socket },
    ],
  });
  const fixture = TestBed.createComponent(App);
  const el = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();
  await settle(fixture);
  if (connect) {
    socket.handlers.onConnect();
    await settle(fixture);
  }
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const qa = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  return { fixture, api, socket, el, q, qa, store: TestBed.inject(FloorStore) };
}

describe('App shell', () => {
  it('shows the loading text first and then the floor header', async () => {
    const api = new MockApi();
    api.getFloor.mockReturnValue(new Promise(() => undefined));
    api.getHistory.mockResolvedValue([]);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: FLOOR_API, useValue: api },
        { provide: FLOOR_SOCKET, useValue: new MockSocket() },
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Fleet Floor Simulator');
    expect(el.querySelector('[data-testid="app-loading"]')?.textContent).toContain(
      'Loading floor…',
    );
    expect(el.querySelector('[data-testid="btn-step"]')).toBeNull();
  });

  it('renders size, tick and a connected badge once ready', async () => {
    const { q } = await mount(floorDto({ state: floorState({ tick: 12 }) }));
    expect(q('floor-size')?.textContent?.trim()).toBe('10×8');
    expect(q('floor-size')?.getAttribute('data-width')).toBe('10');
    expect(q('tick-counter')?.textContent?.trim()).toBe('Tick 12');
    expect(q('tick-counter')?.getAttribute('data-tick')).toBe('12');
    expect(q('conn-status')?.getAttribute('data-state')).toBe('connected');
    expect(q('offline-banner')).toBeNull();
  });

  it('shows the error state with a working Retry', async () => {
    const api = new MockApi();
    api.getFloor.mockRejectedValueOnce(new Error('down')).mockResolvedValue(floorDto());
    api.getHistory.mockResolvedValue([CREATED]);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: FLOOR_API, useValue: api },
        { provide: FLOOR_SOCKET, useValue: new MockSocket() },
      ],
    });
    const fixture = TestBed.createComponent(App);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await settle(fixture);
    expect(el.querySelector('[data-testid="app-error"]')?.textContent).toContain(
      "Can't reach the server.",
    );
    el.querySelector<HTMLButtonElement>('[data-testid="btn-retry"]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-testid="app-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="floor-grid"]')).not.toBeNull();
  });

  it('shows the offline banner and disables mutating controls; Reconnect appears when disconnected', async () => {
    const { fixture, socket, q } = await mount();
    socket.handlers.onDisconnect(false);
    await settle(fixture);
    expect(q('conn-status')?.getAttribute('data-state')).toBe('reconnecting');
    expect(q('offline-banner')?.textContent).toContain(
      'Connection lost. Retrying… Changes are paused.',
    );
    expect((q('btn-step') as HTMLButtonElement).disabled).toBe(true);
    expect((q('btn-play') as HTMLButtonElement).disabled).toBe(true);
    expect((q('btn-new-floor') as HTMLButtonElement).disabled).toBe(true);
    expect(q('floor-grid')?.getAttribute('data-disabled')).toBe('true');
    expect(q('btn-reconnect')).toBeNull();

    socket.handlers.onGiveUp();
    await settle(fixture);
    expect(q('offline-banner')?.textContent).toContain("You're offline.");
    expect(q('btn-reconnect')).not.toBeNull();
  });
});

describe('App grid and interactions', () => {
  it('emits rows top to bottom so (0,0) is the bottom-left cell', async () => {
    const { qa, q } = await mount();
    const cells = qa('floor-grid')[0]!.querySelectorAll<HTMLElement>('[role="gridcell"]');
    expect(cells).toHaveLength(80);
    expect(cells[0]!.dataset['testid']).toBe('cell-0-7');
    expect(cells[79]!.dataset['testid']).toBe('cell-9-0');
    expect(q('floor-grid')?.getAttribute('aria-label')).toBe('Floor grid, 10 columns by 8 rows');
    expect(q('axis-y-7')?.textContent?.trim()).toBe('7');
    expect(q('axis-x-9')?.textContent?.trim()).toBe('9');
    expect(q('cell-3-4')?.getAttribute('aria-label')).toBe('Cell 3,4: empty');
    expect(q('cell-3-4')?.getAttribute('data-obstacle')).toBe('false');
    expect(q('cell-3-4')?.hasAttribute('data-robot')).toBe(false);
  });

  it('reflects robots, obstacles, selection, queue chips and the empty hint', async () => {
    const r1 = robot('R1', 2, 3, {
      facing: 'EAST',
      queue: [{ kind: 'MOVE' }, { kind: 'GOTO', x: 5, y: 5 }],
    });
    const { q, qa, store, fixture } = await mount(
      floorDto({
        state: floorState({ robots: [r1], obstacles: [{ x: 4, y: 4 }], nextRobotNum: 2 }),
      }),
    );
    expect(q('grid-hint')).toBeNull();
    expect(q('grid-legend')).not.toBeNull();
    expect(q('cell-4-4')?.getAttribute('data-obstacle')).toBe('true');
    expect(q('cell-2-3')?.getAttribute('data-robot')).toBe('R1');
    expect(q('robot-R1')?.getAttribute('data-facing')).toBe('EAST');
    expect(q('robot-R1')?.textContent).toBe('R1');
    expect(q('robot-R1')?.getAttribute('data-selected')).toBe('false');
    // First GOTO in the queue is drawn as a pending marker (it is not at the front).
    expect(q('goto-target-R1')?.getAttribute('data-state')).toBe('pending');
    expect(q('cell-5-5')?.getAttribute('data-goto-target')).toBe('R1');
    expect(q('queue-R1')?.getAttribute('data-length')).toBe('2');
    const chips = qa('queue-item');
    expect(chips.map((c) => c.getAttribute('data-kind'))).toEqual(['MOVE', 'GOTO']);
    expect(chips[1]!.getAttribute('data-x')).toBe('5');
    expect(chips[0]!.getAttribute('data-front')).toBe('true');
    expect(q('last-result-R1')?.textContent).toContain('Last tick: no result yet');
    expect(q('last-result-R1')?.hasAttribute('data-outcome')).toBe(false);

    store.select('R1');
    await flushAndRender(fixture);
    expect(q('robot-R1')?.getAttribute('data-selected')).toBe('true');
    expect(q('cell-2-3')?.getAttribute('aria-selected')).toBe('true');
    expect(q('selection-title')?.textContent?.trim()).toBe('Selected: R1 · (2,3) · facing EAST');
    expect(q('selection-panel')?.getAttribute('data-robot')).toBe('R1');
    expect(q('robot-row-R1')?.getAttribute('data-selected')).toBe('true');
  });

  it('shows the empty-floor hint, the edit banner and the GOTO banner in the single status line', async () => {
    const { q, store, fixture } = await mount();
    expect(q('grid-hint')?.textContent).toContain('Click a cell to place a robot.');
    expect(q('robot-list-empty')?.textContent).toContain('place R1');
    store.setEditMode(true);
    await flushAndRender(fixture);
    expect(q('edit-banner')?.textContent).toContain("Robots can't be clicked here.");
    expect(q('grid-hint')).toBeNull();
    expect(q('toggle-edit')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('floor-grid')?.getAttribute('data-edit-mode')).toBe('true');
  });

  it('places a robot on click, selects it, and queues MOVE on ArrowUp', async () => {
    const { q, api, store, fixture } = await mount();
    const placed = entry(2, {
      type: 'ROBOT_PLACED',
      id: 'R1',
      x: 3,
      y: 2,
      facing: 'NORTH',
      replaced: false,
    });
    api.sendAction.mockResolvedValueOnce({
      kind: 'success',
      body: {
        ok: true,
        floor: floorDto({
          version: 2,
          state: floorState({ robots: [robot('R1', 3, 2)], nextRobotNum: 2 }),
        }),
        history: [placed],
      },
    });
    q('cell-3-2')!.click();
    await settle(fixture);
    expect(q('robot-R1')?.getAttribute('data-selected')).toBe('true');
    expect(q('history-entry')?.textContent).toContain('R1 placed at (3,2) facing NORTH.');

    api.sendAction.mockResolvedValueOnce({
      kind: 'success',
      body: {
        ok: true,
        floor: floorDto({
          version: 3,
          state: floorState({
            robots: [robot('R1', 3, 2, { queue: [{ kind: 'MOVE' }] })],
            nextRobotNum: 2,
          }),
        }),
        history: [entry(3, { type: 'COMMANDS_QUEUED', id: 'R1', commands: [{ kind: 'MOVE' }] })],
      },
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await settle(fixture);
    expect(api.sendAction).toHaveBeenLastCalledWith({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'MOVE' }],
    });
    expect(q('queue-R1')?.getAttribute('data-length')).toBe('1');
    expect(store.selectedId()).toBe('R1');
  });

  it('ignores arrow keys typed into the interval slider', async () => {
    const { q, api, store, fixture } = await mount(
      floorDto({ state: floorState({ robots: [robot('R1', 1, 1)], nextRobotNum: 2 }) }),
    );
    store.select('R1');
    await flushAndRender(fixture);
    q('input-interval')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    await settle(fixture);
    expect(api.sendAction).not.toHaveBeenCalled();
  });

  it('hands the keyboard back after a grid click: the slider is blurred, so ArrowUp queues MOVE', async () => {
    const { q, api, el, fixture } = await mount(
      floorDto({ state: floorState({ robots: [robot('R1', 1, 1)], nextRobotNum: 2 }) }),
    );
    document.body.append(el);
    const slider = q('input-interval') as HTMLInputElement;
    slider.focus();
    expect(document.activeElement).toBe(slider);
    q('cell-1-1')!.click();
    await settle(fixture);
    expect(document.activeElement).not.toBe(slider);
    api.sendAction.mockResolvedValueOnce({
      kind: 'success',
      body: { ok: true, floor: floorDto({ version: 2 }), history: [] },
    });
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    await settle(fixture);
    expect(api.sendAction).toHaveBeenCalledWith({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'MOVE' }],
    });
    el.remove();
  });

  it('pad GOTO in edit mode turns edit off and arms GOTO', async () => {
    const { q, store, fixture } = await mount(
      floorDto({ state: floorState({ robots: [robot('R1', 1, 1)], nextRobotNum: 2 }) }),
    );
    store.select('R1');
    store.setEditMode(true);
    await settle(fixture);
    q('btn-goto-mode')!.click();
    await settle(fixture);
    expect(q('toggle-edit')?.getAttribute('aria-pressed')).toBe('false');
    expect(q('btn-goto-mode')?.getAttribute('data-armed')).toBe('true');
    expect(q('goto-banner')).not.toBeNull();
  });

  it('shows last-tick badges and rejection toasts with their data attributes', async () => {
    const r1 = robot('R1', 1, 1);
    const tick = entry(
      2,
      {
        type: 'TICK_RESOLVED',
        tick: 1,
        results: [
          tickResult('R1', {
            outcome: 'BLOCKED',
            reason: 'WALL',
            from: { x: 1, y: 1 },
            to: { x: 1, y: 1 },
          }),
        ],
      },
      1,
    );
    const { q, api, fixture } = await mount(
      floorDto({ version: 2, state: floorState({ robots: [r1], tick: 1, nextRobotNum: 2 }) }),
      [CREATED, tick],
    );
    const badge = q('badge-R1')!;
    expect(badge.getAttribute('data-outcome')).toBe('BLOCKED');
    expect(badge.getAttribute('data-reason')).toBe('WALL');
    expect(badge.textContent).toContain('WL');
    // The key lights up the badge that is on the floor, and nothing else.
    expect(q('legend-WL')?.getAttribute('data-active')).toBe('true');
    expect(q('legend-CT')?.getAttribute('data-active')).toBe('false');
    expect(q('legend-on-floor')?.textContent).toContain('WL on the floor');
    expect(q('last-result-R1')?.getAttribute('data-reason')).toBe('WALL');
    expect(q('history-tick-1')?.getAttribute('data-seq')).toBe('2');
    expect(q('history-tick-toggle-1')?.textContent).toContain('Tick 1 - 1 blocked');

    api.sendAction.mockResolvedValueOnce({
      kind: 'rejected',
      body: {
        ok: false,
        reason: 'CELL_IS_OBSTACLE',
        message: 'dev text',
        floor: floorDto({
          version: 2,
          state: floorState({ robots: [r1], tick: 1, nextRobotNum: 2 }),
        }),
      },
    });
    q('cell-5-5')!.click();
    await settle(fixture);
    const toast = q('toast')!;
    expect(toast.getAttribute('data-reason')).toBe('CELL_IS_OBSTACLE');
    expect(toast.getAttribute('data-kind')).toBe('error');
    expect(toast.getAttribute('data-stale')).toBe('false');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(q('toast-message')?.textContent).toBe(
      "There's an obstacle in that cell. Turn on Edit obstacles to remove it.",
    );
    expect(q('toast-detail')).toBeNull();
    q('toast-dismiss')!.click();
    await settle(fixture);
    expect(q('toast')).toBeNull();
  });
});

async function flushAndRender(fixture: ComponentFixture<unknown>): Promise<void> {
  await settle(fixture);
}
