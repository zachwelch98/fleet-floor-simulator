import { expect, test } from '@playwright/test';
import {
  cell,
  entriesOfType,
  historyLine,
  latestSeq,
  openApp,
  pressStep,
  resetFloor,
  send,
  sendAll,
  tickGroup,
} from './helpers.js';

test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

test.describe('placing robots and editing obstacles', () => {
  test('clicking an empty cell places the next robot, selects it, and logs it', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '10');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-height', '8');
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
    await expect(page.getByTestId('grid-hint')).toBeVisible();
    await expect(page.getByTestId('robot-list-empty')).toBeVisible();

    const baseline = await latestSeq(request);
    await cell(page, 3, 2).click();

    await expect(cell(page, 3, 2)).toHaveAttribute('data-robot', 'R1');
    const robot = page.getByTestId('robot-R1');
    await expect(robot).toHaveText('R1');
    await expect(robot).toHaveAttribute('data-x', '3');
    await expect(robot).toHaveAttribute('data-y', '2');
    await expect(robot).toHaveAttribute('data-facing', 'NORTH');
    await expect(robot).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('selection-panel')).toHaveAttribute('data-robot', 'R1');
    await expect(page.getByTestId('selection-title')).toContainText('R1');
    await expect(page.getByTestId('selection-title')).toContainText('(3,2)');
    await expect(page.getByTestId('selection-title')).toContainText('NORTH');
    await expect(page.getByTestId('robot-row-R1')).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '0');
    await expect(page.getByTestId('queue-empty-R1')).toBeVisible();
    await expect(page.getByTestId('grid-hint')).toHaveCount(0);
    await expect(page.getByTestId('robot-list-empty')).toHaveCount(0);

    const [placed] = await entriesOfType(request, baseline, 'ROBOT_PLACED');
    expect(placed).toBeDefined();
    const line = historyLine(page, placed!.seq);
    await expect(line).toContainText('R1 placed at (3,2) facing NORTH.');
    await expect(line).toHaveAttribute('data-type', 'ROBOT_PLACED');
    await expect(line).toHaveAttribute('data-robot', 'R1');
  });

  test('later clicks place R2, R3, ... (max + 1), and clicking a robot selects it instead of placing', async ({
    page,
  }) => {
    await openApp(page);
    await cell(page, 0, 0).click();
    await expect(page.getByTestId('robot-R1')).toBeVisible();
    await cell(page, 1, 0).click();
    await expect(cell(page, 1, 0)).toHaveAttribute('data-robot', 'R2');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'false');

    // Clicking R1 selects it; no third robot appears.
    await cell(page, 0, 0).click();
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId('robot-list').getByTestId('robot-row-R3')).toHaveCount(0);

    // Clicking the selected robot again deselects it.
    await cell(page, 0, 0).click();
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId('selection-panel')).not.toHaveAttribute('data-robot', /.+/);
  });

  test('edit mode: toggling an empty cell adds then removes an obstacle, with history lines', async ({
    page,
    request,
  }) => {
    await openApp(page);
    const toggle = page.getByTestId('toggle-edit');
    await expect(toggle).toHaveAttribute('data-on', 'false');
    await expect(page.getByTestId('edit-banner')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-on', 'true');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('floor-grid')).toHaveAttribute('data-edit-mode', 'true');
    await expect(page.getByTestId('edit-banner')).toContainText(
      "Edit mode: click a cell to add or remove an obstacle. Robots can't be clicked here.",
    );

    const baseline = await latestSeq(request);
    await cell(page, 4, 4).click();
    await expect(cell(page, 4, 4)).toHaveAttribute('data-obstacle', 'true');
    await cell(page, 4, 4).click();
    await expect(cell(page, 4, 4)).toHaveAttribute('data-obstacle', 'false');

    const sets = await entriesOfType(request, baseline, 'OBSTACLE_SET');
    expect(sets).toHaveLength(2);
    await expect(historyLine(page, sets[0]!.seq)).toContainText('Obstacle added at (4,4).');
    await expect(historyLine(page, sets[1]!.seq)).toContainText('Obstacle removed at (4,4).');

    // Edit mode places no robots.
    await expect(page.getByTestId('robot-list-empty')).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-on', 'false');
    await expect(page.getByTestId('edit-banner')).toHaveCount(0);
    await expect(page.getByTestId('floor-grid')).toHaveAttribute('data-edit-mode', 'false');
  });

  test('an obstacle added in edit mode blocks a placement in normal mode', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await page.getByTestId('toggle-edit').click();
    await cell(page, 6, 3).click();
    await expect(cell(page, 6, 3)).toHaveAttribute('data-obstacle', 'true');
    await page.getByTestId('toggle-edit').click();

    await cell(page, 6, 3).click();
    await expect(
      page.locator('[data-testid="toast"][data-reason="CELL_IS_OBSTACLE"]'),
    ).toBeVisible();
    await expect(cell(page, 6, 3)).not.toHaveAttribute('data-robot', /.+/);
    const floor = await (await request.get('/api/floors/main')).json();
    expect(floor.state.robots).toEqual([]);
  });
});

test.describe('queueing with the keyboard and stepping', () => {
  test('arrow keys queue MOVE/LEFT/RIGHT on the selected robot; Step runs one command per tick', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await cell(page, 2, 2).click();
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'true');

    const baseline = await latestSeq(request);
    // Up, Up, Right, Up, then Down (no binding: queues nothing), then Left.
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft']) {
      await page.keyboard.press(key);
    }
    const chips = page.getByTestId('queue-R1').getByTestId('queue-item');
    await expect(chips).toHaveCount(5);
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '5');
    const kinds = ['MOVE', 'MOVE', 'RIGHT', 'MOVE', 'LEFT'];
    for (const [index, kind] of kinds.entries()) {
      await expect(chips.nth(index)).toHaveAttribute('data-kind', kind);
      await expect(chips.nth(index)).toHaveAttribute('data-front', index === 0 ? 'true' : 'false');
    }
    await expect(chips.nth(0)).toContainText('Move');
    await expect(chips.nth(2)).toContainText('Right');
    await expect(chips.nth(4)).toContainText('Left');
    await expect(page.getByTestId('queue-empty-R1')).toHaveCount(0);

    const queued = await entriesOfType(request, baseline, 'COMMANDS_QUEUED');
    expect(queued).toHaveLength(5);
    await expect(historyLine(page, queued[0]!.seq)).toContainText('Queued for R1: MOVE.');
    await expect(historyLine(page, queued[2]!.seq)).toContainText('Queued for R1: RIGHT.');
    await expect(historyLine(page, queued[4]!.seq)).toContainText('Queued for R1: LEFT.');

    // Step 1: MOVE north, (2,2) -> (2,3).
    await expect(page.getByTestId('btn-step')).toBeEnabled();
    expect(await pressStep(page)).toBe(1);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-y', '3');
    await expect(cell(page, 2, 3)).toHaveAttribute('data-robot', 'R1');
    await expect(cell(page, 2, 2)).not.toHaveAttribute('data-robot', /.+/);
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '4');
    await expect(chips).toHaveCount(4);
    await expect(chips.nth(0)).toHaveAttribute('data-front', 'true');
    await expect(page.getByTestId('last-result-R1')).toHaveAttribute('data-outcome', 'MOVED');

    // Steps 2-5: MOVE -> (2,4); RIGHT -> EAST; MOVE -> (3,4); LEFT -> NORTH.
    for (let tick = 2; tick <= 5; tick++) expect(await pressStep(page)).toBe(tick);
    const robot = page.getByTestId('robot-R1');
    await expect(robot).toHaveAttribute('data-x', '3');
    await expect(robot).toHaveAttribute('data-y', '4');
    await expect(robot).toHaveAttribute('data-facing', 'NORTH');
    await expect(cell(page, 3, 4)).toHaveAttribute('data-robot', 'R1');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '0');
    await expect(page.getByTestId('queue-empty-R1')).toBeVisible();
    await expect(page.getByTestId('last-result-R1')).toHaveAttribute('data-outcome', 'TURNED');
    await expect(page.getByTestId('robot-row-R1')).toHaveAttribute('data-facing', 'NORTH');

    // History: one tick group per tick with the exact result lines.
    const ticks = await entriesOfType(request, baseline, 'TICK_RESOLVED');
    expect(ticks.map((entry) => entry.tick)).toEqual([1, 2, 3, 4, 5]);
    const firstGroup = tickGroup(page, ticks[0]!);
    await expect(firstGroup).toHaveAttribute('data-open', 'true');
    await expect(firstGroup.getByTestId('history-tick-toggle-1')).toContainText('Tick 1 - 1 moved');
    await expect(firstGroup.getByTestId('history-entry')).toContainText('R1 moved (2,2) → (2,3).');
    await expect(
      tickGroup(page, ticks[2]!)
        .getByTestId('history-entry')
        .filter({ hasText: 'R1 turned RIGHT' }),
    ).toContainText('R1 turned RIGHT, now facing EAST.');
    await expect(tickGroup(page, ticks[3]!).getByTestId('history-entry')).toContainText(
      'R1 moved (2,4) → (3,4).',
    );
    await expect(tickGroup(page, ticks[4]!).getByTestId('history-entry')).toContainText(
      'R1 turned LEFT, now facing NORTH.',
    );
  });

  test('the on-screen command pad queues the same commands as the keys', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await expect(page.getByTestId('btn-cmd-move')).toBeDisabled();
    await cell(page, 5, 5).click();
    await expect(page.getByTestId('btn-cmd-move')).toBeEnabled();
    const baseline = await latestSeq(request);
    await page.getByTestId('btn-cmd-move').click();
    await page.getByTestId('btn-cmd-left').click();
    await page.getByTestId('btn-cmd-right').click();
    const chips = page.getByTestId('queue-R1').getByTestId('queue-item');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveAttribute('data-kind', 'MOVE');
    await expect(chips.nth(1)).toHaveAttribute('data-kind', 'LEFT');
    await expect(chips.nth(2)).toHaveAttribute('data-kind', 'RIGHT');
    expect(await entriesOfType(request, baseline, 'COMMANDS_QUEUED')).toHaveLength(3);

    // Clear queue empties it and logs it.
    await page.getByTestId('btn-clear-queue-R1').click();
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '0');
    await expect(page.getByTestId('btn-clear-queue-R1')).toBeDisabled();
    const [cleared] = await entriesOfType(request, baseline, 'QUEUE_CLEARED');
    expect(cleared).toBeDefined();
    await expect(historyLine(page, cleared!.seq)).toContainText("R1's queue cleared.");
  });

  test('Delete removes the robot, clears the selection, and never reuses its id', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await cell(page, 1, 1).click();
    await cell(page, 2, 1).click();
    await expect(page.getByTestId('robot-R2')).toBeVisible();
    const baseline = await latestSeq(request);

    await page.getByTestId('btn-delete-robot-R2').click();
    await expect(page.getByTestId('robot-R2')).toHaveCount(0);
    await expect(page.getByTestId('robot-row-R2')).toHaveCount(0);
    await expect(page.getByTestId('selection-panel')).not.toHaveAttribute('data-robot', /.+/);
    const [removed] = await entriesOfType(request, baseline, 'ROBOT_REMOVED');
    expect(removed).toBeDefined();
    await expect(historyLine(page, removed!.seq)).toContainText('R2 deleted.');

    // The next placement is R3, not R2.
    await cell(page, 4, 4).click();
    await expect(cell(page, 4, 4)).toHaveAttribute('data-robot', 'R3');
  });

  test('GOTO: shift-click sends a GOTO, the target marker shows, two Steps arrive', async ({
    page,
    request,
  }) => {
    await send(request, { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'EAST' });
    await openApp(page);
    await page.getByTestId('robot-select-R1').click();
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'true');

    const baseline = await latestSeq(request);
    await cell(page, 2, 0).click({ modifiers: ['Shift'] });
    const chips = page.getByTestId('queue-R1').getByTestId('queue-item');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAttribute('data-kind', 'GOTO');
    await expect(chips.first()).toHaveAttribute('data-x', '2');
    await expect(chips.first()).toHaveAttribute('data-y', '0');
    await expect(chips.first()).toContainText('GOTO 2,0');
    const marker = page.getByTestId('goto-target-R1');
    await expect(marker).toHaveAttribute('data-state', 'active');
    await expect(marker).toHaveAttribute('data-x', '2');
    await expect(cell(page, 2, 0)).toHaveAttribute('data-goto-target', 'R1');
    const [queued] = await entriesOfType(request, baseline, 'COMMANDS_QUEUED');
    await expect(historyLine(page, queued!.seq)).toContainText('Queued for R1: GOTO 2,0.');

    await pressStep(page);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '1');
    await expect(page.getByTestId('queue-R1').getByTestId('queue-item')).toHaveCount(1);
    await pressStep(page);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '2');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '0');
    await expect(page.getByTestId('goto-target-R1')).toHaveCount(0);
    await expect(page.getByTestId('badge-R1')).toHaveAttribute('data-outcome', 'MOVED');
    await expect(page.getByTestId('badge-R1')).toHaveAttribute('data-reached', 'true');

    const ticks = await entriesOfType(request, baseline, 'TICK_RESOLVED');
    await expect(tickGroup(page, ticks[1]!).getByTestId('history-entry')).toContainText(
      'R1 moved (1,0) → (2,0) and reached its GOTO target.',
    );
  });

  test('the GOTO… button arms a target pick without Shift', async ({ page, request }) => {
    await send(request, { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'NORTH' });
    await openApp(page);
    await page.getByTestId('robot-select-R1').click();
    await page.getByTestId('btn-goto-mode').click();
    await expect(page.getByTestId('btn-goto-mode')).toHaveAttribute('data-armed', 'true');
    await expect(page.getByTestId('goto-banner')).toContainText(
      'GOTO: click the cell R1 should go to. Esc cancels.',
    );
    await cell(page, 0, 3).click();
    await expect(page.getByTestId('queue-R1').getByTestId('queue-item')).toHaveCount(1);
    await expect(page.getByTestId('goto-target-R1')).toHaveAttribute('data-y', '3');
    await expect(page.getByTestId('btn-goto-mode')).toHaveAttribute('data-armed', 'false');
    await expect(page.getByTestId('goto-banner')).toHaveCount(0);
  });

  test('Escape disarms GOTO first, then deselects', async ({ page, request }) => {
    await send(request, { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'NORTH' });
    await openApp(page);
    await page.getByTestId('robot-select-R1').click();
    await page.getByTestId('btn-goto-mode').click();
    await expect(page.getByTestId('goto-banner')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('goto-banner')).toHaveCount(0);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'false');
  });
});

test.describe('tick results: badges and history copy', () => {
  test('every block reason gets a badge and its exact history sentence', async ({
    page,
    request,
  }) => {
    await sendAll(request, [
      // R1 -> obstacle ahead.
      { type: 'PLACE_ROBOT', id: 'R1', x: 1, y: 1, facing: 'EAST' },
      { type: 'SET_OBSTACLE', x: 2, y: 1, present: true },
      // R2 -> floor edge ahead.
      { type: 'PLACE_ROBOT', id: 'R2', x: 9, y: 5, facing: 'EAST' },
      // R3 and R4 both want (5,3); R3 has priority and moves.
      { type: 'PLACE_ROBOT', id: 'R3', x: 4, y: 3, facing: 'EAST' },
      { type: 'PLACE_ROBOT', id: 'R4', x: 6, y: 3, facing: 'WEST' },
      // R5 is stopped by R6, which is standing still.
      { type: 'PLACE_ROBOT', id: 'R5', x: 0, y: 6, facing: 'NORTH' },
      { type: 'PLACE_ROBOT', id: 'R6', x: 0, y: 7, facing: 'NORTH' },
      ...['R1', 'R2', 'R3', 'R4', 'R5'].map((id) => ({
        type: 'QUEUE_COMMANDS' as const,
        id,
        commands: [{ kind: 'MOVE' as const }],
      })),
    ]);
    const baseline = await latestSeq(request);
    await openApp(page);
    await pressStep(page);

    const [tick] = await entriesOfType(request, baseline, 'TICK_RESOLVED');
    expect(tick).toBeDefined();
    const group = tickGroup(page, tick!);
    await expect(group.getByTestId('history-tick-toggle-1')).toContainText('1 moved, 4 blocked');

    const sentence = (robot: string, text: string) =>
      group
        .locator(`[data-testid="history-entry"][data-robot="${robot}"]`)
        .filter({ hasText: text });
    await expect(sentence('R1', 'R1 blocked at (1,1): obstacle at (2,1).')).toHaveCount(1);
    await expect(sentence('R2', 'R2 blocked at (9,5): the floor edge is ahead.')).toHaveCount(1);
    await expect(
      sentence(
        'R4',
        'R4 blocked at (6,3): a lower-numbered robot also wants (5,3) and has priority.',
      ),
    ).toHaveCount(1);
    await expect(
      sentence('R5', "R5 blocked at (0,6): R6 is standing at (0,7) and didn't move."),
    ).toHaveCount(1);
    await expect(sentence('R3', 'R3 moved (4,3) → (5,3).')).toHaveCount(1);

    const reasons = { R1: 'OBSTACLE', R2: 'WALL', R4: 'CONTESTED', R5: 'OCCUPIED' };
    for (const [id, reason] of Object.entries(reasons)) {
      const badge = page.getByTestId(`badge-${id}`);
      await expect(badge).toHaveAttribute('data-outcome', 'BLOCKED');
      await expect(badge).toHaveAttribute('data-reason', reason);
      await expect(page.getByTestId(`last-result-${id}`)).toHaveAttribute('data-reason', reason);
    }
    await expect(page.getByTestId('badge-R1')).toHaveAttribute(
      'title',
      /blocked at \(1,1\): obstacle at \(2,1\)/,
    );
    // Plain moves and idle robots get no badge.
    await expect(page.getByTestId('badge-R3')).toHaveCount(0);
    await expect(page.getByTestId('badge-R6')).toHaveCount(0);
    await expect(page.getByTestId('last-result-R3')).toHaveAttribute('data-outcome', 'MOVED');
    await expect(page.getByTestId('last-result-R6')).toHaveAttribute('data-outcome', 'IDLE');
    // The blocked robots did not move.
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '1');
    await expect(page.getByTestId('robot-R4')).toHaveAttribute('data-x', '6');
  });

  test('idle results are hidden until "Show idle robots" is on', async ({ page, request }) => {
    await send(request, { type: 'PLACE_ROBOT', id: 'R1', x: 2, y: 2, facing: 'NORTH' });
    const baseline = await latestSeq(request);
    await openApp(page);
    await pressStep(page);

    const [tick] = await entriesOfType(request, baseline, 'TICK_RESOLVED');
    const group = tickGroup(page, tick!);
    await expect(group).toHaveAttribute('data-empty', 'true');
    await expect(group.getByTestId('history-tick-toggle-1')).toContainText(
      'nothing happened (1 idle hidden)',
    );
    await expect(page.getByTestId('toggle-show-idle')).not.toBeChecked();
    await expect(page.locator('[data-testid="history-entry"][data-outcome="IDLE"]')).toHaveCount(0);

    await page.getByTestId('toggle-show-idle').check();
    await expect(group.getByTestId('history-entry')).toContainText('R1 idle (nothing queued).');
    await expect(group).not.toHaveAttribute('data-empty', 'true');
    await page.getByTestId('toggle-show-idle').uncheck();
    await expect(page.locator('[data-testid="history-entry"][data-outcome="IDLE"]')).toHaveCount(0);
  });

  test('history groups collapse and expand', async ({ page, request }) => {
    await sendAll(request, [
      { type: 'PLACE_ROBOT', id: 'R1', x: 2, y: 2, facing: 'NORTH' },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }] },
    ]);
    const baseline = await latestSeq(request);
    await openApp(page);
    await pressStep(page);
    const [tick] = await entriesOfType(request, baseline, 'TICK_RESOLVED');
    const group = tickGroup(page, tick!);
    await expect(group).toHaveAttribute('data-open', 'true');
    await page.getByTestId('btn-history-collapse-all').click();
    await expect(group).toHaveAttribute('data-open', 'false');
    await page.getByTestId('btn-history-expand-all').click();
    await expect(group).toHaveAttribute('data-open', 'true');
    await expect(group.getByTestId('history-entry')).toContainText('R1 moved (2,2) → (2,3).');
  });
});
