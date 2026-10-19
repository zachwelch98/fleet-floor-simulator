import { expect, test, type Page } from '@playwright/test';
import { openApp, resetFloor } from './helpers.js';

/**
 * The key under the floor: it highlights the badges that are on the grid right now, and it can be
 * collapsed with the choice remembered across a reload.
 */
test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

async function loadBriefC(page: Page): Promise<void> {
  await openApp(page);
  await page.getByTestId('scenario-select').selectOption('brief_c_contest_behind');
  await page.getByTestId('btn-load-scenario').click();
  // Wait for the setup to land before stepping, or the step would count as an edit of the floor.
  await expect(page.getByTestId('robot-R3')).toBeVisible();
  await expect(page.getByTestId('scenario-hint')).toBeVisible();
}

test.describe('grid key', () => {
  test('brief c after one Step: CT and BB are highlighted, the other badges are not', async ({
    page,
  }) => {
    await loadBriefC(page);
    const legend = page.getByTestId('grid-legend');
    await expect(legend).toBeVisible();
    // Nothing has a badge before the first tick: every entry is at full strength.
    await expect(page.getByTestId('legend-CT')).toHaveAttribute('data-active', 'false');
    await expect(legend).toHaveAttribute('data-has-active', 'false');

    await page.getByTestId('btn-step').click();
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');

    await expect(page.getByTestId('badge-R2')).toContainText('CT');
    await expect(page.getByTestId('badge-R3')).toContainText('BB');
    await expect(page.getByTestId('legend-CT')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('legend-BB')).toHaveAttribute('data-active', 'true');
    for (const code of ['WL', 'OB', 'HO', 'OC', 'WT', 'UN', 'AR', 'OK']) {
      await expect(page.getByTestId(`legend-${code}`)).toHaveAttribute('data-active', 'false');
    }
    await expect(legend).toHaveAttribute('data-has-active', 'true');
    await expect(page.getByTestId('legend-on-floor')).toHaveText('· CT, BB on the floor');
  });

  test('the key stays put when the edit banner appears, and the grid does not resize', async ({
    page,
  }) => {
    await loadBriefC(page);
    const legend = page.getByTestId('grid-legend');
    const cell = page.getByTestId('cell-0-0');
    const before = { legend: await legend.boundingBox(), cell: await cell.boundingBox() };
    await page.getByTestId('toggle-edit').click();
    await expect(page.getByTestId('edit-banner')).toBeVisible();
    await expect(legend).toBeVisible();
    const after = { legend: await legend.boundingBox(), cell: await cell.boundingBox() };
    expect(after.legend?.y).toBeCloseTo(before.legend?.y ?? -1, 0);
    expect(after.cell?.width).toBeCloseTo(before.cell?.width ?? -1, 1);
  });

  test('collapse the key, reload, and it is still collapsed', async ({ page }) => {
    await loadBriefC(page);
    const legend = page.getByTestId('grid-legend');
    await expect(legend).toHaveAttribute('open', '');

    await page.getByTestId('legend-summary').click();
    await expect(legend).not.toHaveAttribute('open', '');
    await expect(page.getByTestId('legend-CT')).toBeHidden();
    // The browser fires `toggle` after the click; wait for the choice to be saved before reloading.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('fleet.legendOpen.v1')))
      .toBe('closed');

    await page.reload();
    await expect(page.getByTestId('tick-counter')).toBeVisible();
    await expect(page.getByTestId('grid-legend')).toBeVisible();
    await expect(page.getByTestId('grid-legend')).not.toHaveAttribute('open', '');
    await expect(page.getByTestId('legend-CT')).toBeHidden();

    // Open it again: that choice is remembered too.
    await page.getByTestId('legend-summary').click();
    await expect(page.getByTestId('legend-CT')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('fleet.legendOpen.v1')))
      .toBe('open');
    await page.reload();
    await expect(page.getByTestId('grid-legend')).toHaveAttribute('open', '');
  });

  test('the collapsed summary names the badges on the floor', async ({ page }) => {
    await loadBriefC(page);
    await page.getByTestId('btn-step').click();
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '1');
    await page.getByTestId('legend-summary').click();
    await expect(page.getByTestId('legend-on-floor')).toBeVisible();
    await expect(page.getByTestId('legend-on-floor')).toHaveText('· CT, BB on the floor');
  });
});
