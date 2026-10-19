import { expect, test, type Page } from '@playwright/test';
import { cell, entriesOfType, historyLine, latestSeq, openApp, resetFloor } from './helpers.js';

const VALIDATION_COPY = 'Enter whole numbers from 1 to 20.';

test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

async function openDialog(page: Page): Promise<void> {
  await page.getByTestId('btn-new-floor').click();
  await expect(page.getByTestId('dialog-new-floor')).toBeVisible();
}

async function fillSize(page: Page, width: string, height: string): Promise<void> {
  await page.getByTestId('input-floor-width').fill(width);
  await page.getByTestId('input-floor-height').fill(height);
}

test.describe('new floor dialog', () => {
  test('opens prefilled with the current size and the width field focused', async ({ page }) => {
    await openApp(page);
    await openDialog(page);
    await expect(page.getByTestId('input-floor-width')).toHaveValue('10');
    await expect(page.getByTestId('input-floor-height')).toHaveValue('8');
    await expect(page.getByTestId('input-floor-width')).toBeFocused();
    await expect(page.getByTestId('floor-dialog-error')).toHaveCount(0);
    await expect(page.getByTestId('btn-floor-create')).toBeEnabled();
    await expect(page.getByTestId('dialog-new-floor')).toContainText(
      'This clears all robots, obstacles and queues. The history log is kept.',
    );
  });

  test.describe('validation', () => {
    for (const [name, width, height] of [
      ['width zero', '0', '8'],
      ['height zero', '10', '0'],
      ['width over 20', '21', '8'],
      ['height over 20', '10', '21'],
      ['negative width', '-3', '8'],
      ['empty width', '', '8'],
      ['empty height', '10', ''],
      ['fractional width', '2.5', '8'],
    ] as const) {
      test(`${name} shows the error and disables Create`, async ({ page, request }) => {
        await openApp(page);
        const before = await latestSeq(request);
        await openDialog(page);
        await fillSize(page, width, height);
        await expect(page.getByTestId('floor-dialog-error')).toHaveText(VALIDATION_COPY);
        await expect(page.getByTestId('btn-floor-create')).toBeDisabled();
        // Fixing the values clears the error and enables Create again.
        await fillSize(page, '5', '5');
        await expect(page.getByTestId('floor-dialog-error')).toHaveCount(0);
        await expect(page.getByTestId('btn-floor-create')).toBeEnabled();
        // Nothing was sent while invalid.
        expect(await latestSeq(request)).toBe(before);
      });
    }

    test('Enter in an invalid dialog creates nothing and keeps the dialog open', async ({
      page,
      request,
    }) => {
      await openApp(page);
      const before = await latestSeq(request);
      await openDialog(page);
      await fillSize(page, '0', '8');
      await page.getByTestId('input-floor-height').press('Enter');
      await expect(page.getByTestId('dialog-new-floor')).toBeVisible();
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '10');
      expect(await latestSeq(request)).toBe(before);
    });
  });

  test('Cancel closes the dialog, changes nothing, and returns focus to the opener', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await cell(page, 1, 1).click();
    await expect(page.getByTestId('robot-R1')).toBeVisible();
    const before = await latestSeq(request);
    await openDialog(page);
    await fillSize(page, '3', '3');
    await page.getByTestId('btn-floor-cancel').click();
    await expect(page.getByTestId('dialog-new-floor')).toBeHidden();
    await expect(page.getByTestId('btn-new-floor')).toBeFocused();
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '10');
    await expect(page.getByTestId('robot-R1')).toBeVisible();
    expect(await latestSeq(request)).toBe(before);
  });

  test('Escape cancels', async ({ page }) => {
    await openApp(page);
    await openDialog(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog-new-floor')).toBeHidden();
    await expect(page.getByTestId('btn-new-floor')).toBeFocused();
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '10');
  });

  test('creating a floor replaces the world: new size, no robots, tick 0, history line, edit mode kept', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await cell(page, 5, 3).click();
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '1');
    await page.getByTestId('btn-step').click();
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');
    await page.getByTestId('toggle-edit').click();
    await cell(page, 8, 6).click();
    await expect(cell(page, 8, 6)).toHaveAttribute('data-obstacle', 'true');

    const baseline = await latestSeq(request);
    await openDialog(page);
    await fillSize(page, '6', '4');
    await page.getByTestId('btn-floor-create').click();

    await expect(page.getByTestId('dialog-new-floor')).toBeHidden();
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '6');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-height', '4');
    await expect(page.getByTestId('floor-size')).toContainText('6×4');
    await expect(page.getByTestId('floor-grid')).toHaveAttribute('data-width', '6');
    await expect(page.getByTestId('floor-grid')).toHaveAttribute('data-height', '4');
    // Exactly 6 columns and 4 rows of cells.
    await expect(cell(page, 5, 3)).toBeVisible();
    await expect(cell(page, 6, 3)).toHaveCount(0);
    await expect(cell(page, 5, 4)).toHaveCount(0);
    await expect(page.locator('[data-testid^="cell-"]')).toHaveCount(24);
    // Everything cleared.
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
    await expect(page.getByTestId('robot-R1')).toHaveCount(0);
    await expect(page.getByTestId('robot-list-empty')).toContainText(
      'No robots yet. Click an empty cell on the grid to place R1.',
    );
    await expect(page.locator('[data-testid^="cell-"][data-obstacle="true"]')).toHaveCount(0);
    await expect(page.getByTestId('selection-panel')).not.toHaveAttribute('data-robot', /.+/);
    // Edit mode stays as it was; the user's own action gets no toast.
    await expect(page.getByTestId('toggle-edit')).toHaveAttribute('data-on', 'true');
    await expect(page.getByTestId('toast')).toHaveCount(0);
    // The history says so, and the old history is still there.
    const [created] = await entriesOfType(request, baseline, 'FLOOR_CREATED');
    expect(created).toBeDefined();
    const line = historyLine(page, created!.seq);
    await expect(line).toHaveAttribute('data-type', 'FLOOR_CREATED');
    await expect(line).toContainText(
      'New floor 6×4 created. All robots, obstacles and queues were cleared.',
    );
    await expect(
      page.locator('[data-testid="history-entry"][data-type="ROBOT_PLACED"]'),
    ).not.toHaveCount(0);
    // Robots can be placed on the new floor, numbered from R1 again.
    await page.getByTestId('toggle-edit').click();
    await cell(page, 0, 0).click();
    await expect(cell(page, 0, 0)).toHaveAttribute('data-robot', 'R1');
  });

  test('Enter submits the dialog', async ({ page }) => {
    await openApp(page);
    await openDialog(page);
    await fillSize(page, '3', '2');
    await page.getByTestId('input-floor-height').press('Enter');
    await expect(page.getByTestId('dialog-new-floor')).toBeHidden();
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '3');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-height', '2');
  });

  for (const [width, height] of [
    ['1', '1'],
    ['20', '20'],
  ] as const) {
    test(`the limits ${width}×${height} are accepted`, async ({ page }) => {
      await openApp(page);
      await openDialog(page);
      await fillSize(page, width, height);
      await expect(page.getByTestId('btn-floor-create')).toBeEnabled();
      await page.getByTestId('btn-floor-create').click();
      await expect(page.getByTestId('dialog-new-floor')).toBeHidden();
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', width);
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-height', height);
      const lastX = Number(width) - 1;
      const lastY = Number(height) - 1;
      await expect(cell(page, lastX, lastY)).toBeVisible();
      await expect(cell(page, 0, 0)).toBeVisible();
      await expect(cell(page, lastX + 1, 0)).toHaveCount(0);
    });
  }

  test('the new size survives a refresh', async ({ page }) => {
    await openApp(page);
    await openDialog(page);
    await fillSize(page, '7', '5');
    await page.getByTestId('btn-floor-create').click();
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '7');
    await page.reload();
    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '7');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-height', '5');
  });
});
