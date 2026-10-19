/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { openApp, resetFloor } from './helpers.js';

/**
 * Sidebar layout: the scenario panel, command pad, Robots and History must never overlap, never be
 * clipped out of reach, and the sidebar must not move when the floor size changes.
 *
 * Written black-box from the UX rulings in the fix plan (rulings 1-4), not from the implementation:
 * - Nothing overlaps, ever. If the panes cannot all fit, the sidebar scrolls as one column.
 * - Robots and History keep their 200px minimums (UI_SPEC 1.1) at the desktop breakpoint (>= 900px).
 * - The scenario panel takes at most about 35% of the sidebar height.
 * - Floor size changes (3x3, 5x5, 20x20) never shift the sidebar's width or position.
 *
 * Geometry is read in the sidebar's scroll coordinates (element offset from the sidebar's content
 * origin plus its scrollTop), so it holds whether the sidebar scrolls or the page does. Below 900px the
 * page scrolls and the sidebar just flows, so the same checks apply there.
 */

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;

const PANES = [
  { name: 'scenario panel', selector: 'app-scenario-panel' },
  { name: 'command pad', selector: 'app-command-pad' },
  { name: 'robots', selector: '.robots-wrap' },
  { name: 'history', selector: '.history-wrap' },
] as const;

interface Box {
  name: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** How far unclipped, in-flow content hangs out of the pane's bottom edge (0 when contained). */
  spill: number;
  overflowY: string;
  /** Whether the element at the centre of the pane's on-screen part is the pane (or inside it). */
  hitOk: boolean | null;
}

interface SidebarMetrics {
  /** Viewport-relative box of the sidebar, and of the grid column. */
  sidebar: { left: number; top: number; width: number };
  gridCol: { left: number; top: number; width: number };
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  overflowY: string;
  scrollTop: number;
  docOverflowX: number;
  panes: Box[];
}

/** Read every pane's box in the sidebar's scroll coordinates, plus the sidebar's own geometry. */
async function measure(page: Page): Promise<SidebarMetrics> {
  return page.evaluate((panes) => {
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    const gridCol = document.querySelector('.grid-col') as HTMLElement;
    const sr = sidebar.getBoundingClientRect();
    const gr = gridCol.getBoundingClientRect();
    const cs = getComputedStyle(sidebar);
    const boxes = panes.flatMap((p) => {
      const el = document.querySelector(p.selector) as HTMLElement | null;
      if (!el) return [];
      const r = el.getBoundingClientRect();
      // Scroll coordinates: offset from the sidebar's padding-box origin, plus how far it has scrolled.
      const top = r.top - sr.top - sidebar.clientTop + sidebar.scrollTop;
      const left = r.left - sr.left - sidebar.clientLeft + sidebar.scrollLeft;
      // Hit test the centre of the part that is on screen (inside the sidebar and the viewport).
      const vTop = Math.max(r.top, sr.top, 0);
      const vBottom = Math.min(r.bottom, sr.bottom, window.innerHeight);
      let hitOk: boolean | null = null;
      if (vBottom - vTop > 4) {
        const hit = document.elementFromPoint((r.left + r.right) / 2, (vTop + vBottom) / 2);
        // A toast is a deliberate, short-lived overlay; it does not count as a layout overlap.
        hitOk = !!hit && (el.contains(hit) || !!hit.closest('[data-testid="toast-region"]'));
      }
      // Content that hangs out of the pane's bottom edge and is not clipped by the pane or by an inner
      // scroll container. Absolutely positioned bits (visually-hidden labels) do not count.
      let spill = 0;
      for (const d of Array.from(el.querySelectorAll('*'))) {
        const pos = getComputedStyle(d).position;
        if (pos === 'absolute' || pos === 'fixed') continue;
        const over = d.getBoundingClientRect().bottom - r.bottom;
        if (over <= 1) continue;
        let clipped = false;
        for (let a = d.parentElement; a && a !== el.parentElement; a = a.parentElement) {
          if (
            getComputedStyle(a).overflowY !== 'visible' &&
            a.getBoundingClientRect().bottom <= r.bottom + 1
          ) {
            clipped = true;
            break;
          }
        }
        if (!clipped) spill = Math.max(spill, over);
      }
      return [
        {
          name: p.name,
          top,
          bottom: top + r.height,
          left,
          right: left + r.width,
          spill,
          overflowY: getComputedStyle(el).overflowY,
          hitOk,
        },
      ];
    });
    return {
      sidebar: { left: sr.left, top: sr.top, width: sr.width },
      gridCol: { left: gr.left, top: gr.top, width: gr.width },
      clientHeight: sidebar.clientHeight,
      clientWidth: sidebar.clientWidth,
      scrollHeight: sidebar.scrollHeight,
      overflowY: cs.overflowY,
      scrollTop: sidebar.scrollTop,
      docOverflowX:
        (document.scrollingElement?.scrollWidth ?? 0) - document.documentElement.clientWidth,
      panes: boxes,
    };
  }, PANES);
}

const EPS = 1;

/**
 * Every layout rule as a list of readable violations. An empty list means the sidebar is fine.
 * `desktop` is true at the two-column breakpoint, where Robots and History have 200px minimums.
 */
async function sidebarViolations(page: Page): Promise<string[]> {
  const m = await measure(page);
  const desktop = (page.viewportSize()?.width ?? 0) >= 900;
  const out: string[] = [];
  const fmt = (b: Box): string => `${b.name} [${Math.round(b.top)}..${Math.round(b.bottom)}]`;

  if (m.panes.length !== PANES.length) {
    out.push(`expected ${PANES.length} sidebar panes, found ${m.panes.length}`);
  }

  // 1. Pairwise non-intersection, in scroll coordinates.
  for (let i = 0; i < m.panes.length; i++) {
    for (let j = i + 1; j < m.panes.length; j++) {
      const a = m.panes[i]!;
      const b = m.panes[j]!;
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (overlapY > EPS && overlapX > EPS) {
        out.push(`overlap: ${fmt(a)} and ${fmt(b)} intersect by ${Math.round(overlapY)}px`);
      }
    }
  }

  // 2. Each pane sits inside the sidebar's scroll box, and that box is reachable: either the sidebar
  // is a scroll container (overflow-y auto/scroll) or the panes fit inside its visible height.
  const scrollable = m.overflowY === 'auto' || m.overflowY === 'scroll';
  const limit = scrollable ? m.scrollHeight : m.clientHeight;
  for (const b of m.panes) {
    if (b.top < -EPS) out.push(`${fmt(b)} starts above the sidebar`);
    if (b.bottom > limit + EPS) {
      out.push(
        `${fmt(b)} runs ${Math.round(b.bottom - limit)}px past the sidebar's ${
          scrollable ? 'scrollable' : 'visible'
        } height (${Math.round(limit)}px); the sidebar is ${
          scrollable ? 'scrollable' : 'not scrollable, so this part is clipped and unreachable'
        }`,
      );
    }
    if (b.left < -EPS || b.right > m.clientWidth + EPS) {
      out.push(
        `${b.name} sticks out sideways (${Math.round(b.left)}..${Math.round(b.right)} of ${m.clientWidth}px)`,
      );
    }
    // 3. A pane's own content must stay inside its box (inner scrolling is fine).
    if (b.spill > EPS) {
      out.push(`${b.name} content hangs ${Math.round(b.spill)}px out of its box, unclipped`);
    }
    // 4. Whatever is on screen of the pane is really the pane, not something painted over it.
    if (b.hitOk === false) out.push(`${b.name}: another element is painted over its centre`);
  }

  // 5. Rulings 3 and 2: minimum heights at the desktop breakpoint, bounded scenario panel.
  if (desktop) {
    for (const b of m.panes) {
      if ((b.name === 'robots' || b.name === 'history') && b.bottom - b.top < 199) {
        out.push(`${b.name} is ${Math.round(b.bottom - b.top)}px tall, under its 200px minimum`);
      }
    }
  }
  if (m.docOverflowX > 1) out.push(`the page scrolls sideways by ${m.docOverflowX}px`);
  return out;
}

/** Assert the sidebar layout and name the state in the failure message. */
async function expectSidebarOk(page: Page, state: string): Promise<void> {
  const violations = await sidebarViolations(page);
  expect(violations, `sidebar layout at "${state}"`).toEqual([]);
}

async function loadScenario(page: Page, id: string): Promise<void> {
  await page.getByTestId('scenario-select').selectOption(id);
  await page.getByTestId('btn-load-scenario').click();
  await expect(page.getByTestId('scenario-title')).toHaveAttribute('data-scenario', id);
}

/** Press Play at the fastest interval and wait for the run to finish (auto-pause with all passed). */
async function playToEnd(page: Page, total: number): Promise<void> {
  await page.getByTestId('input-interval').fill('100');
  await page.getByTestId('btn-play').click();
  await expect(page.getByTestId('scenario-summary')).toHaveText(`${total} / ${total} passed`);
  await expect(page.getByTestId('btn-play')).toHaveAttribute('data-playing', 'false');
}

test.beforeEach(async ({ request }) => {
  await resetFloor(request);
});

test.afterEach(async ({ request }) => {
  await request.post('/api/floors/main/pause');
});

for (const vp of VIEWPORTS) {
  test.describe(`sidebar panes at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('initial load: nothing overlaps or is clipped', async ({ page }) => {
      await openApp(page);
      await expectSidebarOk(page, 'initial load');
    });

    test('brief e: loaded, then played to the auto-pause', async ({ page }) => {
      await openApp(page);
      await loadScenario(page, 'brief_e_queues');
      await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 2 passed');
      await expectSidebarOk(page, 'brief e loaded');
      await playToEnd(page, 2);
      await expectSidebarOk(page, 'brief e finished');
    });

    test('brief e: Reload after a finished run, then Play again', async ({ page }) => {
      await openApp(page);
      await loadScenario(page, 'brief_e_queues');
      await playToEnd(page, 2);
      await page.getByTestId('btn-reload-scenario').click();
      await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 2 passed');
      await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
      await expectSidebarOk(page, 'brief e reloaded');
      await playToEnd(page, 2);
      await expectSidebarOk(page, 'brief e played after Reload');
    });

    test('goto_around_obstacle (6 checkpoints): loaded and finished', async ({ page }) => {
      await openApp(page);
      await loadScenario(page, 'goto_around_obstacle');
      await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 6 passed');
      await expectSidebarOk(page, 'goto_around_obstacle loaded');
      await playToEnd(page, 6);
      await expectSidebarOk(page, 'goto_around_obstacle finished');
    });

    test('New floor after a finished run', async ({ page }) => {
      await openApp(page);
      await loadScenario(page, 'brief_e_queues');
      await playToEnd(page, 2);
      await page.getByTestId('btn-new-floor').click();
      await expect(page.getByTestId('dialog-new-floor')).toBeVisible();
      await page.getByTestId('btn-floor-create').click();
      await expect(page.getByTestId('dialog-new-floor')).toBeHidden();
      await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', '0');
      await expect(page.getByTestId('queue-R1')).toHaveCount(0);
      await expectSidebarOk(page, 'new floor after a finished run');
    });

    test('rotation_eight (3x3, 8 robots) then brief b (5x5)', async ({ page }) => {
      await openApp(page);
      await loadScenario(page, 'rotation_eight');
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '3');
      await expectSidebarOk(page, 'rotation_eight loaded');
      await loadScenario(page, 'brief_b_headon');
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '5');
      await expectSidebarOk(page, 'brief b loaded after rotation_eight');
    });

    test('the sidebar and grid column keep their position and width across 3x3, 5x5 and 20x20', async ({
      page,
      request,
    }) => {
      await openApp(page);
      await loadScenario(page, 'rotation_eight');
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '3');
      const small = await measure(page);

      await loadScenario(page, 'brief_b_headon');
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '5');
      const medium = await measure(page);

      await resetFloor(request, 20, 20);
      await expect(page.getByTestId('floor-size')).toHaveAttribute('data-width', '20');
      const large = await measure(page);

      for (const [label, other] of [
        ['5x5', medium],
        ['20x20', large],
      ] as const) {
        expect(other.sidebar.left, `sidebar x, 3x3 vs ${label}`).toBeCloseTo(small.sidebar.left, 0);
        expect(other.sidebar.width, `sidebar width, 3x3 vs ${label}`).toBeCloseTo(
          small.sidebar.width,
          0,
        );
        expect(other.gridCol.left, `grid column x, 3x3 vs ${label}`).toBeCloseTo(
          small.gridCol.left,
          0,
        );
        expect(other.gridCol.width, `grid column width, 3x3 vs ${label}`).toBeCloseTo(
          small.gridCol.width,
          0,
        );
        if (vp.width >= 900) {
          // Side by side: the columns also start at the same height.
          expect(other.sidebar.top, `sidebar y, 3x3 vs ${label}`).toBeCloseTo(small.sidebar.top, 0);
        }
      }
      await expectSidebarOk(page, 'sidebar after 20x20');
    });

    test('the sidebar does not jump when a scenario is loaded, run and reloaded', async ({
      page,
    }) => {
      await openApp(page);
      await loadScenario(page, 'brief_e_queues');
      const loaded = await measure(page);
      await playToEnd(page, 2);
      const done = await measure(page);
      await page.getByTestId('btn-reload-scenario').click();
      await expect(page.getByTestId('scenario-summary')).toHaveText('0 / 2 passed');
      const reloaded = await measure(page);
      for (const [label, other] of [
        ['finished', done],
        ['reloaded', reloaded],
      ] as const) {
        expect(other.sidebar.left, `sidebar x, loaded vs ${label}`).toBeCloseTo(
          loaded.sidebar.left,
          0,
        );
        expect(other.sidebar.width, `sidebar width, loaded vs ${label}`).toBeCloseTo(
          loaded.sidebar.width,
          0,
        );
      }
      // Reload on a finished run returns the panel to the layout it had right after Load.
      const top = (m: SidebarMetrics, name: string): number | undefined =>
        m.panes.find((p) => p.name === name)?.top;
      expect(top(reloaded, 'command pad'), 'command pad y, loaded vs reloaded').toBeCloseTo(
        top(loaded, 'command pad') ?? -1,
        0,
      );
    });

    test('the scenario panel takes at most about 35% of the sidebar height', async ({ page }) => {
      test.skip(vp.width < 900, 'only the two-column layout has a capped sidebar height');
      await openApp(page);
      await loadScenario(page, 'goto_around_obstacle');
      await playToEnd(page, 6);
      const m = await measure(page);
      const panel = m.panes.find((p) => p.name === 'scenario panel')!;
      expect(
        panel.bottom - panel.top,
        'scenario panel height with 6 checkpoints',
      ).toBeLessThanOrEqual(m.clientHeight * 0.35 + 8);
    });
  });
}
