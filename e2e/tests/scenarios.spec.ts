import { expect, test, type Page } from '@playwright/test';
import { cell, openApp, pressStep, resetFloor, send, toast } from './helpers.js';

/**
 * Scenario picker: Load sets the shared floor up with ordinary commands, Play (or Step) walks the
 * script from the browser (one server Step per tick), and each REPORT is checked as its tick lands. The only spec that
 * presses Play: it waits for the panel's own result, never for a fixed time.
 */
test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

test.afterEach(async ({ request }) => {
  // A failed run must not leave the shared server ticking for the next spec.
  await request.post('/api/floors/main/pause');
});

test.describe('scenario picker', () => {
  test('brief e: Load, Play, both checkpoints pass, the run stops at the end with R1 2,2,SOUTH and R2 3,1,EAST', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId('scenario-select').selectOption('brief_e_queues');
    await page.getByTestId('btn-load-scenario').click();

    // The shared floor now holds the scenario's setup: 4x3, R1 and R2 with their queues, tick 0.
    await expect(page.getByTestId('scenario-title')).toHaveAttribute(
      'data-scenario',
      'brief_e_queues',
    );
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '4');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-height', '3');
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '2');
    await expect(page.getByTestId('queue-R2')).toHaveAttribute('data-length', '6');
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 2 passed');
    await expect(page.getByTestId('scenario-hint')).toBeVisible();
    await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('checkpoint-0')).toContainText('After tick 3');
    await expect(page.getByTestId('checkpoint-1')).toContainText('After tick 13');

    await page.getByTestId('input-interval').fill('100');
    await page.getByTestId('btn-play').click();

    await expect(page.getByTestId('scenario-summary')).toHaveText('2 / 2 passed');
    await expect(page.getByTestId('scenario-summary')).toHaveAttribute('data-state', 'passed');
    await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('checkpoint-1')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('scenario-hint')).toHaveCount(0);
    // The script player ends by itself: the Play button flips back and the end positions stand.
    await expect(page.getByTestId('btn-play')).toHaveAttribute('data-playing', 'false');
    await expect(page.getByTestId('checkpoint-1')).toContainText('R2 3,1,EAST');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '2');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-y', '2');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-facing', 'SOUTH');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-x', '3');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-y', '1');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-facing', 'EAST');
  });

  test('Step also drives it: brief a passes after one Step, and Reload starts it over', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId('scenario-select').selectOption('brief_a_chain');
    await page.getByTestId('btn-load-scenario').click();
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');
    await expect(page.getByTestId('robot-R3')).toHaveAttribute('data-x', '2');

    await pressStep(page);
    await expect(page.getByTestId('scenario-summary')).toHaveText('1 / 1 passed');
    await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('robot-R3')).toHaveAttribute('data-x', '3');

    await page.getByTestId('btn-reload-scenario').click();
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
    await expect(page.getByTestId('robot-R3')).toHaveAttribute('data-x', '2');
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');
    await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pending');
  });

  test('a scenario with no FLOOR line gets the default 5x5 floor, and another tab sees the setup live', async ({
    context,
  }) => {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await openApp(tabA);
    await openApp(tabB);
    await expect(tabB.getByTestId('floor-size')).toHaveAttribute('data-width', '10');

    await tabA.getByTestId('scenario-select').selectOption('brief_b_headon');
    await tabA.getByTestId('btn-load-scenario').click();

    await expect(tabA.getByTestId('floor-size')).toHaveAttribute('data-width', '5');
    await expect(tabA.getByTestId('floor-size')).toHaveAttribute('data-height', '5');
    await expect(tabB.getByTestId('floor-size')).toHaveAttribute('data-width', '5');
    await expect(tabB.getByTestId('floor-size')).toHaveAttribute('data-height', '5');
    await expect(cell(tabB, 0, 0)).toHaveAttribute('data-robot', 'R1');
    await expect(cell(tabB, 1, 0)).toHaveAttribute('data-robot', 'R2');
    await expect(tabB.getByTestId('queue-R1')).toHaveAttribute('data-length', '1');
    await expect(toast(tabB, 'FLOOR_RESET')).toHaveCount(1);
    // Both tabs show the checkpoints; only tab B is marked as watching (DECISIONS 5.10).
    await expect(tabA.getByTestId('scenario-title')).toHaveAttribute(
      'data-scenario',
      'brief_b_headon',
    );
    await expect(tabB.getByTestId('scenario-title')).toHaveAttribute(
      'data-scenario',
      'brief_b_headon',
    );
    await expect(tabA.getByTestId('scenario-remote')).toHaveCount(0);
    await expect(tabB.getByTestId('scenario-remote')).toBeVisible();

    // The run is driven from tab A. A Step pressed in tab B changes the floor under it, so tab A
    // flags the run as modified instead of counting that tick (DECISIONS 5.8), and tab B shows it too.
    await pressStep(tabB);
    await expect(tabA.getByTestId('scenario-modified')).toBeVisible();
    await expect(tabA.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');
    await expect(tabB.getByTestId('scenario-modified')).toBeVisible();
  });

  test('an edit after loading is flagged, and a new floor from elsewhere ends the run', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await page.getByTestId('scenario-select').selectOption('brief_d_rotation');
    await page.getByTestId('btn-load-scenario').click();
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');
    await expect(page.getByTestId('scenario-modified')).toHaveCount(0);

    await send(request, { type: 'PLACE_ROBOT', id: 'R5', x: 4, y: 4, facing: 'NORTH' });
    await expect(page.getByTestId('scenario-modified')).toBeVisible();

    await resetFloor(request, 6, 4);
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '6');
    await expect(page.getByTestId('scenario-title')).toHaveCount(0);
    await expect(page.getByTestId('btn-reload-scenario')).toHaveCount(0);
  });

  test('every screen shows the checkpoints live, a late joiner too, and they go when the driving tab closes', async ({
    browser,
  }) => {
    const driver = await browser.newContext();
    const watcher = await browser.newContext();
    try {
      const tabA = await driver.newPage();
      const tabB = await watcher.newPage();
      await openApp(tabA);
      await openApp(tabB);
      await tabA.getByTestId('scenario-select').selectOption('brief_e_queues');
      await tabA.getByTestId('btn-load-scenario').click();
      await expect(tabB.getByTestId('scenario-summary')).toHaveText('0 / 2 passed');
      await expect(tabB.getByTestId('scenario-hint')).toHaveCount(0);

      await tabA.getByTestId('input-interval').fill('100');
      await tabA.getByTestId('btn-play').click();
      await expect(tabB.getByTestId('scenario-summary')).toHaveText('2 / 2 passed');
      await expect(tabB.getByTestId('checkpoint-1')).toHaveAttribute('data-status', 'pass');
      await expect(tabB.getByTestId('checkpoint-1')).toContainText('R2 3,1,EAST');

      // A screen opened after the run gets it when it joins.
      const tabC = await watcher.newPage();
      await openApp(tabC);
      await expect(tabC.getByTestId('scenario-summary')).toHaveText('2 / 2 passed');
      await expect(tabC.getByTestId('scenario-remote')).toBeVisible();

      await tabA.close();
      await expect(tabB.getByTestId('scenario-title')).toHaveCount(0);
      await expect(tabC.getByTestId('scenario-title')).toHaveCount(0);
    } finally {
      await driver.close();
      await watcher.close();
    }
  });

  test('an uploaded scenario shows on a browser that never had the file, and Reload there takes it over', async ({
    browser,
  }) => {
    const driver = await browser.newContext();
    const watcher = await browser.newContext();
    try {
      const tabA = await driver.newPage();
      const tabB = await watcher.newPage();
      await openApp(tabA);
      await openApp(tabB);
      await upload(tabA, 'shared-run.txt', 'PLACE R1 0,0,EAST\nQUEUE R1 MOVE\nTICK\nREPORT\n');
      await tabA.getByTestId('btn-load-scenario').click();
      await expect(tabA.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');

      await expect(tabB.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');
      await expect(tabB.getByTestId('checkpoint-0')).toContainText('R1 1,0,EAST');
      await expect(tabB.getByTestId('runner-command')).toContainText('shared-run.txt');

      await tabB.getByTestId('btn-reload-scenario').click();
      await expect(tabB.getByTestId('scenario-remote')).toHaveCount(0);
      await expect(tabA.getByTestId('scenario-remote')).toBeVisible();
      await pressStep(tabB);
      await expect(tabB.getByTestId('scenario-summary')).toHaveText('1 / 1 passed');
      await expect(tabA.getByTestId('scenario-summary')).toHaveText('1 / 1 passed');
    } finally {
      await driver.close();
      await watcher.close();
    }
  });
});

async function upload(page: Page, name: string, text: string): Promise<void> {
  await page
    .getByTestId('input-upload-scenario')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });
}
