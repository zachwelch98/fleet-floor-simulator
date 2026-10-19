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
  toast,
} from './helpers.js';

test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

test.describe('two tabs stay in sync (Module D)', () => {
  test('a placement, a queue, a Step and an obstacle in one tab appear in the other', async ({
    context,
    request,
  }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await openApp(tabA);
    await openApp(tabB);
    const baseline = await latestSeq(request);

    // Tab A places a robot.
    await cell(tabA, 2, 2).click();
    await expect(cell(tabB, 2, 2)).toHaveAttribute('data-robot', 'R1');
    await expect(tabB.getByTestId('robot-R1')).toHaveAttribute('data-facing', 'NORTH');
    await expect(tabB.getByTestId('robot-row-R1')).toBeVisible();
    // Selection is a per-tab preference.
    await expect(tabA.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'true');
    await expect(tabB.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'false');
    const [placed] = await entriesOfType(request, baseline, 'ROBOT_PLACED');
    await expect(historyLine(tabB, placed!.seq)).toContainText('R1 placed at (2,2) facing NORTH.');
    // No toast for a quiet remote change.
    await expect(tabB.getByTestId('toast')).toHaveCount(0);

    // Tab B selects R1 and queues MOVE, MOVE with the keyboard.
    await tabB.getByTestId('robot-select-R1').click();
    await tabB.keyboard.press('ArrowUp');
    await tabB.keyboard.press('ArrowUp');
    await expect(tabA.getByTestId('queue-R1')).toHaveAttribute('data-length', '2');
    await expect(tabB.getByTestId('queue-R1')).toHaveAttribute('data-length', '2');

    // Tab A presses Step; both tabs show tick 1, the moved robot and the tick group.
    await pressStep(tabA);
    await expect(tabB.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');
    await expect(tabB.getByTestId('robot-R1')).toHaveAttribute('data-y', '3');
    await expect(tabB.getByTestId('queue-R1')).toHaveAttribute('data-length', '1');
    const [tick] = await entriesOfType(request, baseline, 'TICK_RESOLVED');
    await expect(tickGroup(tabB, tick!).getByTestId('history-entry')).toContainText(
      'R1 moved (2,2) → (2,3).',
    );
    await expect(tabB.getByTestId('last-result-R1')).toHaveAttribute('data-outcome', 'MOVED');

    // Tab B adds an obstacle in edit mode; tab A (not in edit mode) sees it.
    await tabB.getByTestId('toggle-edit').click();
    await cell(tabB, 7, 7).click();
    await expect(cell(tabA, 7, 7)).toHaveAttribute('data-obstacle', 'true');
    await expect(tabA.getByTestId('toggle-edit')).toHaveAttribute('data-on', 'false');
    await expect(tabB.getByTestId('toggle-edit')).toHaveAttribute('data-on', 'true');

    // Both tabs agree on the version-derived facts.
    for (const tab of [tabA, tabB]) {
      await expect(tab.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');
      await expect(tab.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');
    }
  });

  test('changes made over the API (another client) show up live without a reload', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await send(request, { type: 'PLACE_ROBOT', id: 'R1', x: 4, y: 4, facing: 'WEST' });
    await expect(cell(page, 4, 4)).toHaveAttribute('data-robot', 'R1');
    await send(request, { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'LEFT' }] });
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '1');
    await send(request, { type: 'TICK' });
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-facing', 'SOUTH');
    await send(request, { type: 'CLEAR_QUEUE', id: 'R1' });
    await send(request, { type: 'REMOVE_ROBOT', id: 'R1' });
    await expect(page.getByTestId('robot-R1')).toHaveCount(0);
    await expect(page.getByTestId('robot-list-empty')).toBeVisible();
  });

  test('a robot deleted in another tab while selected: selection clears with an info toast', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await openApp(tabA);
    await openApp(tabB);
    await cell(tabA, 1, 1).click();
    await expect(tabA.getByTestId('selection-panel')).toHaveAttribute('data-robot', 'R1');
    await expect(tabB.getByTestId('robot-row-R1')).toBeVisible();

    await tabB.getByTestId('btn-delete-robot-R1').click();
    await expect(tabA.getByTestId('robot-R1')).toHaveCount(0);
    await expect(tabA.getByTestId('selection-panel')).not.toHaveAttribute('data-robot', /.+/);
    const t = toast(tabA, 'ROBOT_REMOVED_REMOTE');
    await expect(t).toHaveCount(1);
    await expect(t).toHaveAttribute('data-kind', 'info');
    await expect(t.getByTestId('toast-message')).toHaveText('R1 was deleted.');
    // The tab that did it gets no toast for its own action.
    await expect(tabB.getByTestId('toast')).toHaveCount(0);
  });

  test('a new floor made in another tab resets this tab, keeps its edit mode, and tells it why', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await openApp(tabA);
    await openApp(tabB);
    await cell(tabA, 1, 1).click();
    await tabA.getByTestId('toggle-edit').click();
    await expect(tabB.getByTestId('robot-R1')).toBeVisible();

    await tabB.getByTestId('btn-new-floor').click();
    await tabB.getByTestId('input-floor-width').fill('6');
    await tabB.getByTestId('input-floor-height').fill('4');
    await tabB.getByTestId('btn-floor-create').click();

    await expect(tabA.getByTestId('floor-size')).toHaveAttribute('data-width', '6');
    await expect(tabA.getByTestId('floor-size')).toHaveAttribute('data-height', '4');
    await expect(tabA.getByTestId('robot-R1')).toHaveCount(0);
    await expect(tabA.getByTestId('selection-panel')).not.toHaveAttribute('data-robot', /.+/);
    await expect(tabA.getByTestId('toggle-edit')).toHaveAttribute('data-on', 'true');
    const t = toast(tabA, 'FLOOR_RESET');
    await expect(t).toHaveCount(1);
    await expect(t).toHaveAttribute('data-kind', 'info');
    await expect(t.getByTestId('toast-message')).toHaveText('The floor was reset to 6×4.');
    await expect(tabB.getByTestId('toast')).toHaveCount(0);
  });
});

test.describe('persistence', () => {
  test('a refresh keeps the floor, the queues, the history and the last-tick badges', async ({
    page,
    request,
  }) => {
    await sendAll(request, [
      { type: 'PLACE_ROBOT', id: 'R1', x: 2, y: 2, facing: 'NORTH' },
      { type: 'PLACE_ROBOT', id: 'R2', x: 9, y: 7, facing: 'NORTH' },
      { type: 'SET_OBSTACLE', x: 3, y: 3, present: true },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }, { kind: 'RIGHT' }] },
      { type: 'QUEUE_COMMANDS', id: 'R2', commands: [{ kind: 'MOVE' }] },
    ]);
    const baseline = await latestSeq(request);
    await openApp(page);
    await pressStep(page);
    // Local, memory-only preferences before the refresh.
    await page.getByTestId('robot-select-R1').click();
    await page.getByTestId('toggle-edit').click();
    await expect(page.getByTestId('toggle-edit')).toHaveAttribute('data-on', 'true');

    await page.reload();
    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');

    // Server state survived.
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-y', '3');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-y', '7');
    await expect(cell(page, 3, 3)).toHaveAttribute('data-obstacle', 'true');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '1');
    await expect(page.getByTestId('queue-R1').getByTestId('queue-item').first()).toHaveAttribute(
      'data-kind',
      'RIGHT',
    );
    await expect(page.getByTestId('queue-R2')).toHaveAttribute('data-length', '0');
    // History and the badges derived from it survived.
    const [tick] = await entriesOfType(request, baseline, 'TICK_RESOLVED');
    await expect(
      tickGroup(page, tick!).locator('[data-testid="history-entry"][data-robot="R2"]'),
    ).toContainText('R2 blocked at (9,7): the floor edge is ahead.');
    await expect(page.getByTestId('badge-R2')).toHaveAttribute('data-reason', 'WALL');
    await expect(page.getByTestId('last-result-R1')).toHaveAttribute('data-outcome', 'MOVED');
    // UI preferences did not (UI_SPEC 0.6).
    await expect(page.getByTestId('toggle-edit')).toHaveAttribute('data-on', 'false');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId('selection-panel')).not.toHaveAttribute('data-robot', /.+/);
  });

  test('what the UI did survives a refresh: placement, obstacle, queue, Step', async ({ page }) => {
    await openApp(page);
    await cell(page, 5, 1).click();
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '2');
    await page.getByTestId('toggle-edit').click();
    await cell(page, 8, 2).click();
    await expect(cell(page, 8, 2)).toHaveAttribute('data-obstacle', 'true');
    await pressStep(page);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-y', '2');

    await page.reload();
    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');
    await expect(cell(page, 5, 2)).toHaveAttribute('data-robot', 'R1');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-facing', 'NORTH');
    await expect(cell(page, 8, 2)).toHaveAttribute('data-obstacle', 'true');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '1');
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');
  });

  test('a fresh tab (new context) sees the same state', async ({ page, browser, request }) => {
    await sendAll(request, [
      { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'EAST' },
      { type: 'SET_OBSTACLE', x: 5, y: 5, present: true },
    ]);
    await openApp(page);
    const other = await browser.newContext();
    try {
      const tab = await other.newPage();
      await tab.goto(new URL('/', page.url()).href);
      await expect(tab.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');
      await expect(cell(tab, 0, 0)).toHaveAttribute('data-robot', 'R1');
      await expect(cell(tab, 5, 5)).toHaveAttribute('data-obstacle', 'true');
    } finally {
      await other.close();
    }
  });
});
