/**
 * Shared helpers for the E2E specs. Test ids come from docs/design/UI_SPEC.md section 10; copy strings come
 * from sections 5.5 and 7.4. The specs press Step, not Play (no timing); scenarios.spec.ts is the one exception.
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { Action } from '@fleet/engine';
import type { CommandRejected, CommandSuccess, HistoryEntry } from '@fleet/protocol';

const FLOOR = '/api/floors/main';

/** Reset the shared floor "main" to a blank floor. History is kept by design, so old entries remain. */
export async function resetFloor(
  request: APIRequestContext,
  width = 10,
  height = 8,
): Promise<CommandSuccess> {
  return send(request, { type: 'CREATE_FLOOR', width, height });
}

/** Send an action through the REST API the way another user's client would; it must be accepted. */
export async function send(request: APIRequestContext, action: Action): Promise<CommandSuccess> {
  const res =
    action.type === 'TICK'
      ? await request.post(`${FLOOR}/step`)
      : await request.post(`${FLOOR}/commands`, { data: { action } });
  expect(res.status(), `${JSON.stringify(action)}: ${await res.text()}`).toBe(200);
  return (await res.json()) as CommandSuccess;
}

/** Send an action that the engine must reject (409). */
export async function sendRejected(
  request: APIRequestContext,
  action: Action,
): Promise<CommandRejected> {
  const res = await request.post(`${FLOOR}/commands`, { data: { action } });
  expect(res.status()).toBe(409);
  return (await res.json()) as CommandRejected;
}

export async function sendAll(
  request: APIRequestContext,
  actions: readonly Action[],
): Promise<void> {
  for (const action of actions) await send(request, action);
}

/** The newest history seq (0 when there is none). Take it before acting, then use `historyAfter`. */
export async function latestSeq(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${FLOOR}/history?limit=1`);
  expect(res.status()).toBe(200);
  const entries = (await res.json()) as HistoryEntry[];
  return entries[0]?.seq ?? 0;
}

export async function historyAfter(
  request: APIRequestContext,
  seq: number,
): Promise<HistoryEntry[]> {
  const res = await request.get(`${FLOOR}/history?after=${seq}&limit=2000`);
  expect(res.status()).toBe(200);
  return (await res.json()) as HistoryEntry[];
}

/** The history entries of one event type after `seq`, oldest first. */
export async function entriesOfType(
  request: APIRequestContext,
  seq: number,
  type: HistoryEntry['event']['type'],
): Promise<HistoryEntry[]> {
  return (await historyAfter(request, seq)).filter((entry) => entry.event.type === type);
}

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('tick-counter')).toBeVisible();
}

export const cell = (page: Page, x: number, y: number): Locator =>
  page.getByTestId(`cell-${x}-${y}`);

export async function currentTick(page: Page): Promise<number> {
  const raw = await page.getByTestId('tick-counter').getAttribute('data-tick');
  return Number(raw);
}

/** Press Step once and wait for the tick counter to advance by exactly one. */
export async function pressStep(page: Page): Promise<number> {
  const before = await currentTick(page);
  await page.getByTestId('btn-step').click();
  await expect(page.getByTestId('tick-counter')).toHaveAttribute('data-tick', String(before + 1));
  return before + 1;
}

/** A standalone history line (placement, obstacle, queue, ...) by its seq. */
export const historyLine = (page: Page, seq: number): Locator =>
  page.locator(`[data-testid="history-entry"][data-seq="${seq}"]`);

/**
 * The tick group for a TICK_RESOLVED history entry. Tick numbers repeat after New floor and history is kept
 * across tests, so the group is addressed by tick AND seq.
 */
export const tickGroup = (page: Page, entry: HistoryEntry): Locator =>
  page.locator(`[data-testid="history-tick-${entry.tick}"][data-seq="${entry.seq}"]`);

/** A toast by its data-reason. */
export const toast = (page: Page, reason: string): Locator =>
  page.locator(`[data-testid="toast"][data-reason="${reason}"]`);
