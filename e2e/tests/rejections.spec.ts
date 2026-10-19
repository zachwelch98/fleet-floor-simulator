import { expect, test } from '@playwright/test';
import { cell, openApp, resetFloor, send, toast } from './helpers.js';

// Exact toast copy from docs/design/UI_SPEC.md section 5.5.
const COPY = {
  CELL_IS_OBSTACLE: "There's an obstacle in that cell. Turn on Edit obstacles to remove it.",
  CELL_OCCUPIED_PLACE: 'A robot is already in that cell.',
  CELL_OCCUPIED_TOGGLE: "Can't change an obstacle under a robot. Move or delete the robot first.",
  INVALID_GOTO_TARGET:
    "GOTO needs a free cell on the floor. Obstacles and cells outside the floor aren't valid targets.",
  NO_ROBOT_SELECTED: 'Select a robot first, then Shift+click a cell to send it there.',
  STALE: 'Your view was out of date and has been updated.',
} as const;

test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

test.describe('rejection toasts', () => {
  test('placing a robot on an obstacle: CELL_IS_OBSTACLE with the exact copy, dismissible', async ({
    page,
    request,
  }) => {
    await send(request, { type: 'SET_OBSTACLE', x: 5, y: 5, present: true });
    await openApp(page);

    await cell(page, 5, 5).click();
    const t = toast(page, 'CELL_IS_OBSTACLE');
    await expect(t).toHaveCount(1);
    await expect(t).toHaveAttribute('data-kind', 'error');
    await expect(t).toHaveAttribute('data-stale', 'false');
    await expect(t.getByTestId('toast-message')).toHaveText(COPY.CELL_IS_OBSTACLE);
    await expect(t.getByTestId('toast-detail')).toHaveCount(0);
    // The UI did not change: no robot, still an obstacle, nothing queued anywhere.
    await expect(cell(page, 5, 5)).toHaveAttribute('data-obstacle', 'true');
    await expect(cell(page, 5, 5)).not.toHaveAttribute('data-robot', /.+/);
    await expect(page.getByTestId('robot-list-empty')).toBeVisible();

    await t.getByTestId('toast-dismiss').click();
    await expect(t).toHaveCount(0);
  });

  test('an identical rejection does not stack toasts', async ({ page, request }) => {
    await send(request, { type: 'SET_OBSTACLE', x: 5, y: 5, present: true });
    await openApp(page);
    let rejections = 0;
    page.on('response', (res) => {
      if (res.url().endsWith('/api/floors/main/commands') && res.status() === 409) rejections++;
    });
    for (let click = 1; click <= 3; click++) await cell(page, 5, 5).click();
    // Wait until the server has answered all three before counting toasts.
    await expect.poll(() => rejections).toBe(3);
    await expect(toast(page, 'CELL_IS_OBSTACLE')).toHaveCount(1);
  });

  test('edit-mode click on a robot: CELL_OCCUPIED (toggle copy) and no obstacle appears', async ({
    page,
    request,
  }) => {
    await send(request, { type: 'PLACE_ROBOT', id: 'R1', x: 3, y: 3, facing: 'NORTH' });
    await openApp(page);
    await page.getByTestId('toggle-edit').click();
    await cell(page, 3, 3).click();

    const t = toast(page, 'CELL_OCCUPIED');
    await expect(t).toHaveCount(1);
    await expect(t.getByTestId('toast-message')).toHaveText(COPY.CELL_OCCUPIED_TOGGLE);
    await expect(cell(page, 3, 3)).toHaveAttribute('data-obstacle', 'false');
    await expect(cell(page, 3, 3)).toHaveAttribute('data-robot', 'R1');
  });

  test('Shift+click with no robot selected: NO_ROBOT_SELECTED, nothing is sent', async ({
    page,
    request,
  }) => {
    await openApp(page);
    const versionBefore = (
      (await (await request.get('/api/floors/main')).json()) as { version: number }
    ).version;
    await cell(page, 2, 2).click({ modifiers: ['Shift'] });
    const t = toast(page, 'NO_ROBOT_SELECTED');
    await expect(t).toHaveCount(1);
    await expect(t.getByTestId('toast-message')).toHaveText(COPY.NO_ROBOT_SELECTED);
    const after = (await (await request.get('/api/floors/main')).json()) as { version: number };
    expect(after.version).toBe(versionBefore);
  });

  test('GOTO to an obstacle: INVALID_GOTO_TARGET and nothing is queued', async ({
    page,
    request,
  }) => {
    await send(request, { type: 'PLACE_ROBOT', id: 'R1', x: 1, y: 1, facing: 'NORTH' });
    await send(request, { type: 'SET_OBSTACLE', x: 4, y: 4, present: true });
    await openApp(page);
    await page.getByTestId('robot-select-R1').click();
    await cell(page, 4, 4).click({ modifiers: ['Shift'] });

    const t = toast(page, 'INVALID_GOTO_TARGET');
    await expect(t).toHaveCount(1);
    await expect(t.getByTestId('toast-message')).toHaveText(COPY.INVALID_GOTO_TARGET);
    await expect(page.getByTestId('queue-R1')).toHaveAttribute('data-length', '0');
    await expect(page.getByTestId('goto-target-R1')).toHaveCount(0);
  });

  test('losing a same-cell race: CELL_OCCUPIED, marked stale, and the view catches up', async ({
    page,
    request,
  }) => {
    await openApp(page);
    await expect(cell(page, 6, 6)).not.toHaveAttribute('data-robot', /.+/);

    // The UI sends PLACE (6,6). Just before the request reaches the server, "another user" places a robot
    // in that very cell over the API, so the UI's request loses deterministically (DECISIONS 7.2).
    let raced = false;
    await page.route('**/api/floors/main/commands', async (route) => {
      if (!raced) {
        raced = true;
        await send(request, { type: 'PLACE_ROBOT', x: 6, y: 6, facing: 'SOUTH' });
      }
      await route.continue();
    });
    await cell(page, 6, 6).click();

    const t = toast(page, 'CELL_OCCUPIED');
    await expect(t).toHaveCount(1);
    await expect(t).toHaveAttribute('data-kind', 'error');
    await expect(t).toHaveAttribute('data-stale', 'true');
    await expect(t.getByTestId('toast-message')).toHaveText(COPY.CELL_OCCUPIED_PLACE);
    await expect(t.getByTestId('toast-detail')).toHaveText(COPY.STALE);

    // Caught up: the winner's robot (R1, facing SOUTH) is on the grid; the loser's click placed nothing.
    expect(raced).toBe(true);
    await expect(cell(page, 6, 6)).toHaveAttribute('data-robot', 'R1');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-facing', 'SOUTH');
    await expect(page.getByTestId('robot-list').getByTestId('robot-row-R2')).toHaveCount(0);
    const floor = (await (await request.get('/api/floors/main')).json()) as {
      state: { robots: unknown[] };
    };
    expect(floor.state.robots).toHaveLength(1);
  });
});
