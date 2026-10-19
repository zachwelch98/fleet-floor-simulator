/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, resetFloor } from './helpers.js';

/**
 * Uploaded scenarios: any .txt file, any name, in the brief's section 1.5 format, uploaded from the Scenarios pane,
 * stored in this browser, played from the browser (one server Step per tick, later commands sent between ticks),
 * checked against an optional .expected file.
 *
 * Written black-box from the approved plan ("Upload your own scenario file and watch it run live"). Files are
 * uploaded as in-memory buffers with odd names; the bundled scenarios/ files are only read for their text.
 * Details the plan does not pin (exact ignored-line wording, how the runner-differs mark reads) are asserted
 * loosely; see the assumptions in the commit / hand-off notes.
 */

const SCENARIOS_DIR = join(import.meta.dirname, '..', '..', 'scenarios');
const bundled = (name: string, ext: 'txt' | 'expected'): string =>
  readFileSync(join(SCENARIOS_DIR, `${name}.${ext}`), 'utf8');

/** The lines `npm run scenario -- file` prints (a trailing newline is not a line). */
const linesOf = (text: string): string[] => {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const REPORT_LINE = /R\d+ -?\d+,-?\d+,(?:NORTH|EAST|SOUTH|WEST)|EMPTY/g;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function upload(
  page: Page,
  name: string,
  text: string,
  mimeType = 'text/plain',
): Promise<void> {
  await page
    .getByTestId('input-upload-scenario')
    .setInputFiles({ name, mimeType, buffer: Buffer.from(text, 'utf8') });
}

async function attachExpected(page: Page, name: string, text: string): Promise<void> {
  await page
    .getByTestId('input-upload-expected')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });
}

/** Option values (ids) in the picker's "Uploaded" group whose label contains `name`. */
async function uploadedValues(page: Page, name: string): Promise<string[]> {
  return page.getByTestId('scenario-select').evaluate((el, wanted) => {
    const out: string[] = [];
    for (const group of Array.from(el.querySelectorAll('optgroup'))) {
      if (!/upload/i.test(group.label)) continue;
      for (const o of Array.from(group.querySelectorAll('option'))) {
        if ((o.textContent ?? '').includes(wanted)) out.push(o.value);
      }
    }
    return out;
  }, name);
}

/** Wait for the upload to show up in the picker, then select it. Returns its option value. */
async function selectUploaded(page: Page, name: string): Promise<string> {
  await expect.poll(() => uploadedValues(page, name), { timeout: 10_000 }).toHaveLength(1);
  const value = (await uploadedValues(page, name))[0]!;
  await page.getByTestId('scenario-select').selectOption(value);
  return value;
}

/** Select an already-uploaded scenario and press Load. */
async function loadUploaded(page: Page, name: string): Promise<void> {
  await selectUploaded(page, name);
  await page.getByTestId('btn-load-scenario').click();
  await expect(page.getByTestId('scenario-title')).toBeVisible();
}

/** Upload, select and Load in one go. */
async function uploadAndLoad(page: Page, name: string, text: string): Promise<void> {
  await upload(page, name, text);
  await loadUploaded(page, name);
}

/** Press Play at the fastest interval and wait for every checkpoint to pass and the run to auto-pause. */
async function playToEnd(page: Page, total: number): Promise<void> {
  await page.getByTestId('input-interval').fill('100');
  await page.getByTestId('btn-play').click();
  await expect(page.getByTestId('scenario-summary')).toHaveText(`${total} / ${total} passed`, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('scenario-summary')).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('btn-play')).toHaveAttribute('data-playing', 'false', {
    timeout: 15_000,
  });
}

async function pressStepOnce(page: Page): Promise<void> {
  const before = Number(await page.getByTestId('tick-counter').getAttribute('data-tick'));
  await page.getByTestId('btn-step').click();
  await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', String(before + 1));
}

/** The report lines found in the runner-output block, in order (headers and decoration are ignored). */
async function runnerLines(page: Page): Promise<string[]> {
  const text = (await page.getByTestId('runner-output').textContent()) ?? '';
  return text.match(REPORT_LINE) ?? [];
}

/** Open the collapsible ignored list if it is a closed <details>. */
async function expandIgnored(page: Page): Promise<Locator> {
  const list = page.getByTestId('ignored-lines');
  await expect(list).toBeVisible();
  const details = list.locator('xpath=self::details | ancestor::details').first();
  if ((await details.count()) > 0 && !(await details.evaluate((d: HTMLDetailsElement) => d.open))) {
    await details.locator('summary').first().click();
  }
  return list;
}

/**
 * The ignored row for `text` must show the 1-based `line` number next to the original text and give
 * a reason (some words that are neither the number nor the text).
 */
async function expectIgnoredRow(list: Locator, line: number, text: string): Promise<void> {
  const rest = await list.evaluate(
    (root, args) => {
      const { want, n } = args;
      const number = new RegExp(`(^|[^\\d,])${n}([^\\d,]|$)`);
      // Start at the deepest element that holds the text, then climb until the line number shows up.
      const holders = Array.from(root.querySelectorAll('*')).filter(
        (c) =>
          (c.textContent ?? '').includes(want) &&
          !Array.from(c.children).some((k) => (k.textContent ?? '').includes(want)),
      );
      let a: Element | null = holders[0] ?? null;
      while (a) {
        const stripped = (a.textContent ?? '').replace(want, ' ');
        if (number.test(stripped)) return stripped;
        if (a === root) break;
        a = a.parentElement;
      }
      return null;
    },
    { want: text, n: line },
  );
  expect(rest, `ignored list has a row with line ${line} next to "${text}"`).not.toBeNull();
  const reason = (rest ?? '').replace(new RegExp(`(^|[^\\d,])${line}([^\\d,]|$)`), ' ');
  expect(reason, `ignored row for line ${line} gives a reason`).toMatch(/[A-Za-z]{3,}/);
}

test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

test.afterEach(async ({ request }) => {
  // A failed run must not leave the shared server ticking for the next spec.
  await request.post('/api/floors/main/pause');
});

// ---------------------------------------------------------------------------------------------
// (a) A mid-script file plays to the end and every checkpoint passes
// ---------------------------------------------------------------------------------------------

test.describe('(a) upload, Play to the end', () => {
  test('goto_two_robots_corridor (QUEUE after the first TICK) under a name with spaces: all 3 checkpoints pass, runner output = .expected', async ({
    page,
  }) => {
    const name = 'my floor test.txt';
    await openApp(page);
    await uploadAndLoad(page, name, bundled('goto_two_robots_corridor', 'txt'));

    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 3 passed');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '5');
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-height', '1');
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
    for (const i of [0, 1, 2]) {
      await expect(page.getByTestId(`checkpoint-${i}`)).toHaveAttribute('data-status', 'pending');
    }

    // The runner block is what `npm run scenario -- <file>` prints, headed by that command.
    expect(await runnerLines(page)).toEqual(
      linesOf(bundled('goto_two_robots_corridor', 'expected')),
    );
    await expect(page.getByTestId('scenario-results')).toContainText(/npm run scenario/);
    await expect(page.getByTestId('scenario-results')).toContainText(name);

    await playToEnd(page, 3);
    for (const i of [0, 1, 2]) {
      await expect(page.getByTestId(`checkpoint-${i}`)).toHaveAttribute('data-status', 'pass');
    }
    // Run finished on the real server floor: tick 5, R1 2,0 EAST (it won the contest), R2 3,0 WEST.
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '5');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '2');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-x', '3');
    await expect(page.getByTestId('scenario-modified')).toHaveCount(0);
    // The runner block is unchanged by the run.
    expect(await runnerLines(page)).toEqual(
      linesOf(bundled('goto_two_robots_corridor', 'expected')),
    );
  });

  test('a file with no extension and no .expected: the runner output is the expected, and it passes', async ({
    page,
  }) => {
    await openApp(page);
    await uploadAndLoad(page, 'notes', bundled('brief_e_queues', 'txt'));
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 2 passed');
    expect(await runnerLines(page)).toEqual(linesOf(bundled('brief_e_queues', 'expected')));
    await expect(page.getByTestId('scenario-results')).toContainText('notes');
    await playToEnd(page, 2);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-facing', 'SOUTH');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-x', '3');
  });

  test('a matching .expected upload also passes, and no runner mark appears', async ({ page }) => {
    await openApp(page);
    await upload(page, 'corridor.txt', bundled('goto_two_robots_corridor', 'txt'));
    await selectUploaded(page, 'corridor.txt');
    await attachExpected(
      page,
      'corridor.expected',
      bundled('goto_two_robots_corridor', 'expected'),
    );
    await page.getByTestId('btn-load-scenario').click();
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 3 passed');
    await playToEnd(page, 3);
    for (const i of [0, 1, 2]) {
      await expect(page.getByTestId(`checkpoint-${i}`)).not.toContainText(/runner/i);
    }
  });

  test('a file with no REPORT still loads: the runner output is shown and there are no checkpoints', async ({
    page,
  }) => {
    await openApp(page);
    await uploadAndLoad(
      page,
      'no report.txt',
      'FLOOR 3,3\nPLACE R1 0,0,EAST\nQUEUE R1 MOVE\nTICK\n',
    );
    await expect(page.getByTestId('checkpoint-0')).toHaveCount(0);
    await expect(page.getByTestId('runner-output')).toBeVisible();
    await expect(page.getByTestId('upload-error')).toHaveCount(0);
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '3');
  });
});

// ---------------------------------------------------------------------------------------------
// (b) Bad lines are listed; the run still goes ahead
// ---------------------------------------------------------------------------------------------

test.describe('(b) ignored lines', () => {
  // Line numbers are 1-based and count comments and blank lines.
  const BAD = [
    '# bad lines: an unknown robot, an off-floor PLACE and a junk keyword', // 1
    'FLOOR 3,3', // 2
    'PLACE R1 0,0,EAST', // 3
    'QUEUE R9 MOVE', // 4  engine rejects: no such robot
    'PLACE R2 9,9,NORTH', // 5  engine rejects: off the floor
    '', // 6
    'FROBNICATE 1,2', // 7  parse error: unknown keyword
    'QUEUE R1 MOVE MOVE', // 8
    'TICK 2', // 9
    'REPORT', // 10
    '',
  ].join('\n');

  test('each ignored line is listed with its line number, text and a reason; the run loads and passes', async ({
    page,
  }) => {
    await openApp(page);
    await uploadAndLoad(page, 'notes', BAD);

    await expect(page.getByText(/Ignored lines \(3\)/)).toBeVisible();
    const list = await expandIgnored(page);
    await expectIgnoredRow(list, 4, 'QUEUE R9 MOVE');
    await expectIgnoredRow(list, 5, 'PLACE R2 9,9,NORTH');
    await expectIgnoredRow(list, 7, 'FROBNICATE 1,2');
    // Lines that ran, comments and blank lines are not listed.
    await expect(list).not.toContainText('PLACE R1 0,0,EAST');
    await expect(list).not.toContainText('# bad lines');

    // The run goes ahead the way the runner does: R1 moves two cells, nothing else exists.
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');
    expect(await runnerLines(page)).toEqual(['R1 2,0,EAST']);
    await playToEnd(page, 1);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '2');
    await expect(page.getByTestId('robot-R2')).toHaveCount(0);
    await expect(page.getByTestId('robot-R9')).toHaveCount(0);
    await expect(page.getByTestId('upload-error')).toHaveCount(0);
  });

  test('TICK 0 and a trailing comment are listed too (DECISIONS 4.7, 4.11)', async ({ page }) => {
    await openApp(page);
    await uploadAndLoad(
      page,
      'ticks.txt',
      'FLOOR 3,3\nPLACE R1 0,0,EAST\nQUEUE R1 MOVE # go\nTICK 0\nQUEUE R1 MOVE\nTICK\nREPORT\n',
    );
    const list = await expandIgnored(page);
    await expectIgnoredRow(list, 3, 'QUEUE R1 MOVE # go');
    await expectIgnoredRow(list, 4, 'TICK 0');
    await playToEnd(page, 1);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '1');
  });
});

// ---------------------------------------------------------------------------------------------
// (c) A wrong .expected: failing checkpoint plus a runner != expected mark
// ---------------------------------------------------------------------------------------------

test.describe('(c) deliberately wrong .expected', () => {
  const WRONG_EXPECTED = [
    'R1 0,0,EAST', // wrong: the runner (and the floor) say R1 1,0,EAST after tick 1
    'R2 3,0,WEST',
    'R1 1,0,EAST',
    'R2 3,0,WEST',
    'R1 2,0,EAST',
    'R2 3,0,WEST',
    '',
  ].join('\n');

  test('checkpoint 0 fails against the expected, shows what the floor did, and carries a runner mark; the others pass', async ({
    page,
  }) => {
    await openApp(page);
    await upload(page, 'wrong.txt', bundled('goto_two_robots_corridor', 'txt'));
    await selectUploaded(page, 'wrong.txt');
    await attachExpected(page, 'wrong.expected', WRONG_EXPECTED);
    await page.getByTestId('btn-load-scenario').click();
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 3 passed');

    await page.getByTestId('input-interval').fill('100');
    await page.getByTestId('btn-play').click();
    await expect(page.getByTestId('scenario-summary')).toHaveText('2 / 3 passed', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('btn-play')).toHaveAttribute('data-playing', 'false', {
      timeout: 15_000,
    });

    const first = page.getByTestId('checkpoint-0');
    await expect(first).toHaveAttribute('data-status', 'fail');
    await expect(page.getByTestId('checkpoint-1')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('checkpoint-2')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('scenario-summary')).not.toHaveAttribute('data-state', 'passed');

    // The failing card shows the (wrong) expected and the live result from the floor.
    await expect(first.getByTestId('checkpoint-expected')).toContainText('R1 0,0,EAST');
    await expect(first.getByTestId('checkpoint-actual')).toContainText('R1 1,0,EAST');

    // runner != expected is called out on the card where they differ, and only there.
    await expect(first).toContainText(/runner/i);
    await expect(page.getByTestId('checkpoint-1')).not.toContainText(/runner/i);
    await expect(page.getByTestId('checkpoint-2')).not.toContainText(/runner/i);

    // The runner block is the CLI output, not the (wrong) expected.
    expect(await runnerLines(page)).toEqual(
      linesOf(bundled('goto_two_robots_corridor', 'expected')),
    );
  });

  test('an .expected with the wrong number of lines does not break the page: the scenario still loads and the checkpoints still exist', async ({
    page,
  }) => {
    await openApp(page);
    await upload(page, 'short.txt', bundled('goto_two_robots_corridor', 'txt'));
    await selectUploaded(page, 'short.txt');
    await attachExpected(page, 'short.expected', 'R1 1,0,EAST\nR2 3,0,WEST\n');
    await page.getByTestId('btn-load-scenario').click();
    await expect(page.getByTestId('scenario-title')).toBeVisible();
    await expect(page.getByTestId('scenario-summary')).toHaveText(/\/ 3 passed\s*$/);
    await expect(page.getByTestId('checkpoint-0')).toBeVisible();
    await expect(page.getByTestId('checkpoint-2')).toBeVisible();
    await expect(page.getByTestId('runner-output')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// (d) Persistence in this browser, and Remove
// ---------------------------------------------------------------------------------------------

test.describe('(d) uploads are kept in this browser', () => {
  test('an upload survives a reload and still runs; Remove deletes it, also after a reload', async ({
    page,
  }) => {
    const name = 'my floor test.txt';
    await openApp(page);
    await upload(page, name, bundled('brief_a_chain', 'txt'));
    const id = await selectUploaded(page, name);
    expect(id).toMatch(/^upload:/);

    await page.reload();
    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');
    await expect.poll(() => uploadedValues(page, name)).toEqual([id]);

    // It still loads and passes after the reload.
    await loadUploaded(page, name);
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 1 passed');
    await pressStepOnce(page);
    await expect(page.getByTestId('scenario-summary')).toHaveText('1 / 1 passed');

    // Remove (after the reload) deletes it from the picker...
    await page.getByTestId('scenario-select').selectOption(id);
    await page.getByTestId('btn-remove-upload').click();
    await expect.poll(() => uploadedValues(page, name)).toEqual([]);

    // ...and it stays gone after another reload.
    await page.reload();
    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');
    await expect(page.getByTestId('scenario-select')).toBeVisible();
    expect(await uploadedValues(page, name)).toEqual([]);
  });

  test('Remove only removes the selected upload; bundled scenarios cannot be removed', async ({
    page,
  }) => {
    await openApp(page);
    await upload(page, 'one.txt', bundled('brief_a_chain', 'txt'));
    await selectUploaded(page, 'one.txt');
    await upload(page, 'two.txt', bundled('brief_b_headon', 'txt'));
    await selectUploaded(page, 'two.txt');
    await page.getByTestId('btn-remove-upload').click();
    await expect.poll(() => uploadedValues(page, 'two.txt')).toEqual([]);
    expect(await uploadedValues(page, 'one.txt')).toHaveLength(1);

    await page.getByTestId('scenario-select').selectOption('brief_a_chain');
    await expect(page.getByTestId('btn-remove-upload')).toHaveCount(0);
  });

  test('the same file name uploaded twice gives two separate entries', async ({ page }) => {
    await openApp(page);
    await upload(page, 'dup.txt', bundled('brief_a_chain', 'txt'));
    await expect.poll(() => uploadedValues(page, 'dup.txt')).toHaveLength(1);
    await upload(page, 'dup.txt', bundled('brief_b_headon', 'txt'));
    await expect.poll(() => uploadedValues(page, 'dup.txt')).toHaveLength(2);
    const [a, b] = await uploadedValues(page, 'dup.txt');
    expect(a).not.toBe(b);
  });

  test('uploads are per browser: a fresh browser context sees none', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const other = await ctx.newPage();
      await openApp(other);
      expect(await uploadedValues(other, '.txt')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('a file over 64 KB is refused with an inline error and is not added', async ({ page }) => {
    await openApp(page);
    const big = `# padding\n${'# xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n'.repeat(1100)}`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(64 * 1024);
    await upload(page, 'huge.txt', big);
    const error = page.getByTestId('upload-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/[A-Za-z]{3,}/);
    expect(await uploadedValues(page, 'huge.txt')).toEqual([]);
    // A normal file afterwards still works.
    await upload(page, 'fine.txt', bundled('brief_a_chain', 'txt'));
    await expect.poll(() => uploadedValues(page, 'fine.txt')).toHaveLength(1);
  });

  test('the 21st upload is refused with an inline error', async ({ page }) => {
    await openApp(page);
    for (let i = 1; i <= 20; i++) {
      await upload(page, `bulk-${i}.txt`, `FLOOR 3,3\n# ${i}\n`);
    }
    await expect.poll(() => uploadedValues(page, 'bulk-20.txt')).toHaveLength(1);
    await expect(page.getByTestId('upload-error')).toHaveCount(0);
    await upload(page, 'bulk-21.txt', 'FLOOR 3,3\n');
    await expect(page.getByTestId('upload-error')).toBeVisible();
    expect(await uploadedValues(page, 'bulk-21.txt')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// (e) FLOOR in the middle of a script
// ---------------------------------------------------------------------------------------------

test.describe('(e) FLOOR mid-script', () => {
  test('floor_resets_world.txt plays to the end and passes', async ({ page }) => {
    await openApp(page);
    await uploadAndLoad(page, 'floors.txt', bundled('floor_resets_world', 'txt'));
    // The first REPORT comes before the first TICK, so it is captured from the floor at Load (EMPTY after
    // the second FLOOR): that checkpoint already passes and the other two are pending.
    await expect(page.getByTestId('scenario-summary')).toHaveText('1 / 3 passed');
    await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('checkpoint-1')).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('checkpoint-2')).toHaveAttribute('data-status', 'pending');
    expect(await runnerLines(page)).toEqual(linesOf(bundled('floor_resets_world', 'expected')));
    // Both FLOOR lines come before the first TICK, so the loaded floor is already the second one (4x4).
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '4');
    await playToEnd(page, 3);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '2');
    await expect(page.getByTestId('scenario-modified')).toHaveCount(0);
  });

  test('a FLOOR after ticks (new floor between ticks) is part of the run, not an interference', async ({
    page,
  }) => {
    const text = [
      'FLOOR 4,4',
      'PLACE R1 0,0,EAST',
      'QUEUE R1 MOVE',
      'TICK',
      'REPORT', // R1 1,0,EAST
      'FLOOR 3,3', // wipes the world mid-script
      'REPORT', // EMPTY
      'PLACE R1 0,0,NORTH',
      'QUEUE R1 MOVE MOVE',
      'TICK 2',
      'REPORT', // R1 0,2,NORTH
      '',
    ].join('\n');
    await openApp(page);
    await uploadAndLoad(page, 'refloor', text);
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 3 passed');
    expect(await runnerLines(page)).toEqual(['R1 1,0,EAST', 'EMPTY', 'R1 0,2,NORTH']);
    await playToEnd(page, 3);
    await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '3');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-y', '2');
    await expect(page.getByTestId('scenario-modified')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------
// (f) Step walks an uploaded mid-script file one tick at a time
// ---------------------------------------------------------------------------------------------

test.describe('(f) Step through an uploaded file', () => {
  test('goto_two_robots_corridor: one tick per Step, each report is checked at its own tick boundary', async ({
    page,
  }) => {
    await openApp(page);
    await uploadAndLoad(page, 'step me.txt', bundled('goto_two_robots_corridor', 'txt'));
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 3 passed');

    // Reports are after tick 1, tick 4 and tick 5.
    const passedAfter: Record<number, string> = {
      1: '1 / 3 passed',
      2: '1 / 3 passed',
      3: '1 / 3 passed',
      4: '2 / 3 passed',
      5: '3 / 3 passed',
    };
    for (let tick = 1; tick <= 5; tick++) {
      await pressStepOnce(page);
      await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', String(tick));
      await expect(page.getByTestId('scenario-summary')).toHaveText(passedAfter[tick]!);
      await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pass');
      await expect(page.getByTestId('checkpoint-1')).toHaveAttribute(
        'data-status',
        tick >= 4 ? 'pass' : 'pending',
      );
      await expect(page.getByTestId('checkpoint-2')).toHaveAttribute(
        'data-status',
        tick >= 5 ? 'pass' : 'pending',
      );
    }
    await expect(page.getByTestId('scenario-summary')).toHaveAttribute('data-state', 'passed');
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '2');
    await expect(page.getByTestId('robot-R2')).toHaveAttribute('data-x', '3');
  });

  test('a command in the file after a TICK is sent between ticks: the robot has not moved before the Step that follows it', async ({
    page,
  }) => {
    const text = [
      'FLOOR 5,1',
      'PLACE R1 0,0,EAST',
      'TICK',
      'REPORT', // after tick 1: nothing queued yet, R1 has not moved
      'QUEUE R1 MOVE', // sent between tick 1 and tick 2
      'TICK',
      'REPORT', // after tick 2: R1 has moved once
      '',
    ].join('\n');
    await openApp(page);
    await uploadAndLoad(page, 'between', text);
    expect(await runnerLines(page)).toEqual(['R1 0,0,EAST', 'R1 1,0,EAST']);

    await pressStepOnce(page);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '0');
    await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('checkpoint-1')).toHaveAttribute('data-status', 'pending');

    await pressStepOnce(page);
    await expect(page.getByTestId('robot-R1')).toHaveAttribute('data-x', '1');
    await expect(page.getByTestId('checkpoint-1')).toHaveAttribute('data-status', 'pass');
    await expect(page.getByTestId('scenario-summary')).toHaveText('2 / 2 passed');
  });

  test('Reload restarts an uploaded run from tick 0', async ({ page }) => {
    await openApp(page);
    await uploadAndLoad(page, 'again.txt', bundled('goto_two_robots_corridor', 'txt'));
    await pressStepOnce(page);
    await expect(page.getByTestId('scenario-summary')).toHaveText('1 / 3 passed');
    await page.getByTestId('btn-reload-scenario').click();
    await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
    await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 3 passed');
    await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'pending');
    await playToEnd(page, 3);
  });

  test('an edit from outside during the run marks it modified', async ({ page, request }) => {
    await openApp(page);
    await uploadAndLoad(page, 'edit.txt', bundled('goto_two_robots_corridor', 'txt'));
    await pressStepOnce(page);
    await request.post('/api/floors/main/commands', {
      data: { action: { type: 'SET_OBSTACLE', x: 4, y: 0, present: true } },
    });
    await expect(page.getByTestId('scenario-modified')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// (g) Layout invariants with the runner output and the ignored list on screen
// ---------------------------------------------------------------------------------------------

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;

interface Rect {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

async function rects(page: Page): Promise<{ sidebar: Rect[]; docOverflowX: number }> {
  return page.evaluate(() => {
    const read = (name: string, selector: string): Rect[] => {
      const el = document.querySelector(selector);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ name, left: r.left, right: r.right, top: r.top, bottom: r.bottom }];
    };
    return {
      sidebar: [
        ...read('scenario panel', 'app-scenario-panel'),
        ...read('command pad', 'app-command-pad'),
        ...read('robots', '.robots-wrap'),
        ...read('history', '.history-wrap'),
      ],
      docOverflowX:
        (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth,
    };
  });
}

/** Minimal layout check: sidebar panes never intersect, the page never scrolls sideways, robots/history keep 200px. */
async function expectLayoutOk(page: Page, state: string): Promise<void> {
  const desktop = (page.viewportSize()?.width ?? 0) >= 900;
  const { sidebar, docOverflowX } = await rects(page);
  expect(sidebar.length, `${state}: four sidebar panes`).toBe(4);
  for (let i = 0; i < sidebar.length; i++) {
    for (let j = i + 1; j < sidebar.length; j++) {
      const a = sidebar[i]!;
      const b = sidebar[j]!;
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      expect(
        overlapY > 1 && overlapX > 1,
        `${state}: ${a.name} and ${b.name} overlap by ${Math.round(overlapY)}px`,
      ).toBe(false);
    }
  }
  expect(docOverflowX, `${state}: page scrolls sideways`).toBeLessThanOrEqual(1);
  if (desktop) {
    for (const r of sidebar) {
      if (r.name === 'robots' || r.name === 'history') {
        expect(r.bottom - r.top, `${state}: ${r.name} height`).toBeGreaterThanOrEqual(199);
      }
    }
  }
}

/** The runner block and the ignored list sit inside the results section, unclipped and not under anything. */
async function expectResultsOk(page: Page, state: string): Promise<void> {
  for (const id of ['runner-output', 'ignored-lines']) {
    const el = page.getByTestId(id);
    await el.scrollIntoViewIfNeeded();
    const info = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const results = node.closest('[data-testid="scenario-results"]');
      const rr = results?.getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
      const hit = document.elementFromPoint(
        (r.left + r.right) / 2,
        Math.min(Math.max((r.top + r.bottom) / 2, 0), window.innerHeight - 1),
      );
      return {
        inResults: !!results,
        leftOk: rr ? r.left >= rr.left - 1 : false,
        rightOk: rr ? r.right <= rr.right + 1 : false,
        overlapsSidebar:
          !!sidebar &&
          Math.min(r.right, sidebar.right) - Math.max(r.left, sidebar.left) > 1 &&
          Math.min(r.bottom, sidebar.bottom) - Math.max(r.top, sidebar.top) > 1,
        width: r.width,
        hitOk: !!hit && (node.contains(hit) || hit.contains(node)),
      };
    });
    expect(info.inResults, `${state}: ${id} is inside the scenario results`).toBe(true);
    expect(info.leftOk && info.rightOk, `${state}: ${id} stays inside the results width`).toBe(
      true,
    );
    expect(info.overlapsSidebar, `${state}: ${id} overlaps the sidebar`).toBe(false);
    expect(info.width, `${state}: ${id} has width`).toBeGreaterThan(20);
    expect(info.hitOk, `${state}: ${id} is painted over`).toBe(true);
  }
}

const LAYOUT_FILE = [
  '# layout: a mid-script QUEUE plus three ignored lines',
  'FLOOR 5,1',
  'PLACE R1 0,0,EAST',
  'PLACE R2 4,0,WEST',
  'QUEUE R1 GOTO 3,0',
  'QUEUE R2 GOTO 1,0',
  'QUEUE R8 MOVE',
  'PLACE R3 9,9,EAST',
  'WHAT IS THIS LINE',
  'TICK',
  'REPORT',
  'TICK 3',
  'REPORT',
  'QUEUE R1 MOVE',
  'QUEUE R2 MOVE',
  'TICK',
  'REPORT',
  '',
].join('\n');

for (const vp of VIEWPORTS) {
  test.describe(`layout with runner output and ignored list at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('loaded, collapsed and expanded, then played to the end', async ({ page }) => {
      await openApp(page);
      await uploadAndLoad(page, 'a very long file name for the layout check.txt', LAYOUT_FILE);
      await expect(page.getByTestId('runner-output')).toBeVisible();
      await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 3 passed');

      await expectLayoutOk(page, 'uploaded, loaded');
      await expectResultsOk(page, 'uploaded, loaded');

      await expandIgnored(page);
      await expectLayoutOk(page, 'ignored list expanded');
      await expectResultsOk(page, 'ignored list expanded');

      await playToEnd(page, 3);
      await expectLayoutOk(page, 'uploaded, finished');
      await expectResultsOk(page, 'uploaded, finished');

      // The scenario panel with its upload / attach / remove buttons stays a compact part of the sidebar.
      if (vp.width >= 900) {
        const panel = await page.locator('app-scenario-panel').boundingBox();
        const sidebar = await page.locator('.sidebar').boundingBox();
        expect(panel!.height, 'scenario panel height').toBeLessThanOrEqual(
          sidebar!.height * 0.35 + 8,
        );
      }
    });

    test('a wrong .expected (runner marks on the cards) keeps the layout intact', async ({
      page,
    }) => {
      await openApp(page);
      await upload(page, 'wrong.txt', LAYOUT_FILE);
      await selectUploaded(page, 'wrong.txt');
      await attachExpected(
        page,
        'wrong.expected',
        'R1 0,0,EAST\nR2 4,0,WEST\nR1 1,0,EAST\nR2 3,0,WEST\nR1 2,0,EAST\nR2 3,0,WEST\n',
      );
      await page.getByTestId('btn-load-scenario').click();
      await expect(page.getByTestId('scenario-summary')).toBeVisible();
      await page.getByTestId('btn-step').click();
      await expect(page.getByTestId('checkpoint-0')).toHaveAttribute('data-status', 'fail');
      await expectLayoutOk(page, 'failing checkpoint with runner mark');
      await expectResultsOk(page, 'failing checkpoint with runner mark');
    });
  });
}
