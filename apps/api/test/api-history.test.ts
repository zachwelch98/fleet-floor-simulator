/**
 * API history: GET /api/floors/:id/history?after=SEQ&limit=N.
 *
 * Contract (packages/protocol): ascending seq; with `after`, entries with seq > after, oldest first, at most
 * `limit`; without `after`, the NEWEST `limit` entries (still ascending); `limit` defaults to
 * HISTORY_DEFAULT_LIMIT (500) and is clamped to [1, HISTORY_MAX_LIMIT (2000)]; non-numeric -> 400.
 */
import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Action } from '@fleet/engine';
import {
  API_PREFIX,
  DEFAULT_FLOOR_ID,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  type CommandSuccess,
  type HistoryEntry,
} from '@fleet/protocol';
import {
  FIXED_ISO,
  getFloor,
  getHistory,
  http,
  makeApp,
  mustOk,
  mustReject,
  mustStep,
  postStep,
  snapshotOf,
} from './support.js';

const historyUrl = `${API_PREFIX}/floors/${DEFAULT_FLOOR_ID}/history`;

const seqsOf = (entries: readonly HistoryEntry[]): number[] => entries.map((e) => e.seq);

/** A short script with a variety of events: placements, a queue, an obstacle, ticks, a removal. */
const SCRIPT: readonly Action[] = [
  { type: 'PLACE_ROBOT', x: 1, y: 1, facing: 'NORTH' },
  { type: 'PLACE_ROBOT', x: 4, y: 4, facing: 'WEST' },
  { type: 'SET_OBSTACLE', x: 7, y: 7, present: true },
  {
    type: 'QUEUE_COMMANDS',
    id: 'R1',
    commands: [{ kind: 'MOVE' }, { kind: 'RIGHT' }, { kind: 'MOVE' }],
  },
  { type: 'TICK' },
  { type: 'TICK' },
  { type: 'CLEAR_QUEUE', id: 'R2' },
  { type: 'TICK' },
  { type: 'REMOVE_ROBOT', id: 'R2' },
  { type: 'TICK' },
];

describe('history: content and ordering', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Runs SCRIPT, returning every accepted response in order. */
  async function runScript(): Promise<CommandSuccess[]> {
    const responses: CommandSuccess[] = [];
    for (const action of SCRIPT) {
      responses.push(action.type === 'TICK' ? await mustStep(app) : await mustOk(app, action));
    }
    return responses;
  }

  it('lists entries in strictly ascending seq, all stamped with the injected clock', async () => {
    await runScript();
    const history = await getHistory(app);
    expect(history.length).toBeGreaterThanOrEqual(SCRIPT.length);
    const seqs = seqsOf(history);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const entry of history) {
      expect(entry.at).toBe(FIXED_ISO);
      expect(entry.floorId).toBe(DEFAULT_FLOOR_ID);
    }
  });

  it('each entry carries the floor version and tick of the action that produced it', async () => {
    const responses = await runScript();
    const expected = responses.flatMap((r) =>
      r.history.map((h) => ({ version: r.floor.version, tick: r.floor.state.tick, h })),
    );
    expect(expected.length).toBeGreaterThan(0);
    for (const { version, tick, h } of expected) {
      expect(h.version).toBe(version);
      expect(h.tick).toBe(tick);
    }
    // Versions never go backwards along the history.
    const versions = (await getHistory(app)).map((h) => h.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it('records the event payloads of the script, in order', async () => {
    await runScript();
    const events = (await getHistory(app)).map((h) => h.event);
    // The default floor's own creation may or may not be logged (api-boot leaves it open), so look at the tail.
    expect(events.slice(-10)).toEqual([
      { type: 'ROBOT_PLACED', id: 'R1', x: 1, y: 1, facing: 'NORTH', replaced: false },
      { type: 'ROBOT_PLACED', id: 'R2', x: 4, y: 4, facing: 'WEST', replaced: false },
      { type: 'OBSTACLE_SET', x: 7, y: 7, present: true },
      {
        type: 'COMMANDS_QUEUED',
        id: 'R1',
        commands: [{ kind: 'MOVE' }, { kind: 'RIGHT' }, { kind: 'MOVE' }],
      },
      expect.objectContaining({ type: 'TICK_RESOLVED', tick: 1 }),
      expect.objectContaining({ type: 'TICK_RESOLVED', tick: 2 }),
      { type: 'QUEUE_CLEARED', id: 'R2' },
      expect.objectContaining({ type: 'TICK_RESOLVED', tick: 3 }),
      { type: 'ROBOT_REMOVED', id: 'R2' },
      expect.objectContaining({ type: 'TICK_RESOLVED', tick: 4 }),
    ]);
  });

  it('a tick event has one result per robot, sorted by robot number', async () => {
    await runScript();
    const ticks = (await getHistory(app)).filter((h) => h.event.type === 'TICK_RESOLVED');
    expect(ticks).toHaveLength(4);
    const idsPerTick = ticks.map((t) =>
      t.event.type === 'TICK_RESOLVED' ? t.event.results.map((r) => r.id) : [],
    );
    // R2 is removed before the fourth tick.
    expect(idsPerTick).toEqual([['R1', 'R2'], ['R1', 'R2'], ['R1', 'R2'], ['R1']]);
  });

  it('CommandSuccess.history equals the matching entries from GET /history', async () => {
    const responses = await runScript();
    const all = await getHistory(app);
    const fromResponses = responses.flatMap((r) => r.history);
    expect(fromResponses.length).toBeGreaterThan(0);
    // Exactly the tail of the full history: nothing missing, nothing extra, same seq/version/tick/event/at.
    expect(all.slice(all.length - fromResponses.length)).toEqual(fromResponses);
    // And per response: it is the slice of GET after the previous response's last seq.
    let previousLast = all[all.length - fromResponses.length - 1]?.seq ?? 0;
    for (const response of responses) {
      const got = await getHistory(app, `?after=${previousLast}&limit=${response.history.length}`);
      expect(got).toEqual(response.history);
      previousLast = response.history.at(-1)?.seq ?? previousLast;
    }
  });

  it('POST /step returns its one TICK_RESOLVED entry, the same one GET lists last', async () => {
    const res = await mustStep(app);
    expect(res.history).toHaveLength(1);
    expect(res.history[0]?.event).toMatchObject({ type: 'TICK_RESOLVED', tick: 1 });
    expect(res.history[0]?.version).toBe(res.floor.version);
    expect((await getHistory(app)).at(-1)).toEqual(res.history[0]);
  });

  it('rejected commands add no history', async () => {
    await runScript();
    const before = await snapshotOf(app);
    await mustReject(app, { type: 'REMOVE_ROBOT', id: 'R9' });
    await mustReject(app, { type: 'PLACE_ROBOT', x: 7, y: 7, facing: 'NORTH' }); // obstacle
    await mustReject(app, { type: 'CREATE_FLOOR', width: 99, height: 1 });
    expect((await snapshotOf(app)).history).toEqual(before.history);
  });

  it('malformed commands add no history', async () => {
    await runScript();
    const before = await getHistory(app);
    const url = `${API_PREFIX}/floors/${DEFAULT_FLOOR_ID}/commands`;
    expect((await http(app).post(url).send({ action: null })).status).toBe(400);
    expect(
      (
        await http(app)
          .post(url)
          .send({ action: { type: 'NOPE' } })
      ).status,
    ).toBe(400);
    expect(
      (await http(app).post(url).set('Content-Type', 'application/json').send('{oops')).status,
    ).toBe(400);
    expect(await getHistory(app)).toEqual(before);
  });

  it('GET /history is read-only and repeatable', async () => {
    await runScript();
    const versionBefore = (await getFloor(app)).version;
    const a = await getHistory(app);
    const b = await getHistory(app);
    expect(b).toEqual(a);
    expect((await getFloor(app)).version).toBe(versionBefore);
  });
});

describe('history: after and limit', () => {
  let app: INestApplication;
  let all: HistoryEntry[];

  beforeAll(async () => {
    app = await makeApp();
    for (let i = 0; i < 12; i++) {
      await mustOk(app, { type: 'PLACE_ROBOT', x: i % 10, y: Math.floor(i / 10), facing: 'EAST' });
    }
    await postStep(app);
    all = await getHistory(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('has enough entries for the checks below', () => {
    expect(all.length).toBeGreaterThanOrEqual(13);
  });

  it('after=SEQ returns exactly the entries with a greater seq, oldest first', async () => {
    const pivot = all[4]?.seq ?? 0;
    const got = await getHistory(app, `?after=${pivot}`);
    expect(got).toEqual(all.filter((e) => e.seq > pivot));
    expect(got[0]?.seq).toBeGreaterThan(pivot);
  });

  it('after=0 returns everything', async () => {
    expect(await getHistory(app, '?after=0')).toEqual(all);
  });

  it('after the last seq returns an empty list, not an error', async () => {
    const last = all.at(-1)?.seq ?? 0;
    expect(await getHistory(app, `?after=${last}`)).toEqual([]);
    expect(await getHistory(app, `?after=${last + 1000}`)).toEqual([]);
  });

  it('without after, limit=N returns the NEWEST N entries, ascending', async () => {
    const got = await getHistory(app, '?limit=3');
    expect(got).toEqual(all.slice(-3));
    expect(seqsOf(got)).toEqual([...seqsOf(got)].sort((a, b) => a - b));
  });

  it('with after, limit=N returns the OLDEST N entries after it', async () => {
    const pivot = all[2]?.seq ?? 0;
    const got = await getHistory(app, `?after=${pivot}&limit=3`);
    expect(got).toEqual(all.filter((e) => e.seq > pivot).slice(0, 3));
  });

  it('paging with after+limit walks the whole history with no gaps or repeats', async () => {
    const collected: HistoryEntry[] = [];
    let cursor = 0;
    for (let guard = 0; guard < 100; guard++) {
      const page = await getHistory(app, `?after=${cursor}&limit=4`);
      if (page.length === 0) break;
      expect(page.length).toBeLessThanOrEqual(4);
      collected.push(...page);
      cursor = page.at(-1)?.seq ?? cursor;
    }
    expect(collected).toEqual(all);
  });

  it('limit larger than the history returns all of it', async () => {
    expect(await getHistory(app, '?limit=1000')).toEqual(all);
    expect(await getHistory(app, '?after=0&limit=1000')).toEqual(all);
  });

  it('limit=0 clamps up to 1 (newest without after, oldest with it)', async () => {
    expect(await getHistory(app, '?limit=0')).toEqual(all.slice(-1));
    const pivot = all[1]?.seq ?? 0;
    expect(await getHistory(app, `?after=${pivot}&limit=0`)).toEqual(
      all.filter((e) => e.seq > pivot).slice(0, 1),
    );
  });

  it.each([
    ['after=abc', '?after=abc'],
    ['after=1x', '?after=1x'],
    ['limit=abc', '?limit=abc'],
    ['limit=ten', '?limit=ten'],
    ['both non-numeric', '?after=a&limit=b'],
    ['one good, one bad', '?after=1&limit=lots'],
  ])('non-numeric query (%s) is 400', async (_name, query) => {
    const res = await http(app).get(`${historyUrl}${query}`);
    expect(res.status).toBe(400);
  });
});

describe('history: default and maximum limits', () => {
  let app: INestApplication;
  let total: number;

  /** More than HISTORY_MAX_LIMIT entries: every step adds one TICK_RESOLVED. */
  beforeAll(async () => {
    app = await makeApp();
    const steps = HISTORY_MAX_LIMIT + 100;
    for (let i = 0; i < steps; i++) {
      const res = await postStep(app);
      if (res.status !== 200) throw new Error(`step ${i} -> ${res.status}`);
    }
    // Total entries, counted through paging so nothing here depends on the limit clamp itself.
    total = 0;
    let cursor = 0;
    for (;;) {
      const page = await getHistory(app, `?after=${cursor}&limit=${HISTORY_MAX_LIMIT}`);
      if (page.length === 0) break;
      total += page.length;
      cursor = page.at(-1)?.seq ?? cursor;
    }
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('the constants are the documented ones', () => {
    expect(HISTORY_DEFAULT_LIMIT).toBe(500);
    expect(HISTORY_MAX_LIMIT).toBe(2000);
    expect(total).toBeGreaterThan(HISTORY_MAX_LIMIT);
  });

  it('defaults to the newest 500 entries when no limit is given', async () => {
    const got = await getHistory(app);
    expect(got).toHaveLength(HISTORY_DEFAULT_LIMIT);
    expect(got.at(-1)?.tick).toBe(HISTORY_MAX_LIMIT + 100);
    const seqs = seqsOf(got);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('defaults to the oldest 500 after `after` when no limit is given', async () => {
    const got = await getHistory(app, '?after=0');
    expect(got).toHaveLength(HISTORY_DEFAULT_LIMIT);
    expect(got).toEqual(await getHistory(app, `?after=0&limit=${HISTORY_DEFAULT_LIMIT}`));
  });

  it('limit=2000 returns 2000 entries', async () => {
    expect(await getHistory(app, `?limit=${HISTORY_MAX_LIMIT}`)).toHaveLength(HISTORY_MAX_LIMIT);
  });

  it('limit above the maximum is clamped to 2000 (newest without after)', async () => {
    const big = await getHistory(app, '?limit=5000');
    const max = await getHistory(app, `?limit=${HISTORY_MAX_LIMIT}`);
    expect(big).toHaveLength(HISTORY_MAX_LIMIT);
    expect(big).toEqual(max);
    expect(big.at(-1)?.tick).toBe(HISTORY_MAX_LIMIT + 100);
  });

  it('limit above the maximum is clamped to 2000 (oldest with after)', async () => {
    const big = await getHistory(app, '?after=0&limit=999999');
    expect(big).toHaveLength(HISTORY_MAX_LIMIT);
    const first = await getHistory(app, '?after=0&limit=1');
    expect(big[0]).toEqual(first[0]);
    // It is the oldest 2000, so the newest entry is not in it.
    const newest = await getHistory(app, '?limit=1');
    expect(big.at(-1)?.seq).toBeLessThan(newest[0]?.seq ?? 0);
  });

  it('limit=0 returns exactly 1 entry', async () => {
    const got = await getHistory(app, '?limit=0');
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual((await getHistory(app, '?limit=1'))[0]);
  });

  it('a post-response check: the floor is still consistent with the entry count', async () => {
    const floor = await getFloor(app);
    expect(floor.state.tick).toBe(HISTORY_MAX_LIMIT + 100);
    // Every accepted action of this app was a tick; the default floor's creation adds at most one entry.
    expect(total - (HISTORY_MAX_LIMIT + 100)).toBeLessThanOrEqual(1);
    expect(total - (HISTORY_MAX_LIMIT + 100)).toBeGreaterThanOrEqual(0);
    expect(floor.version - 1).toBe(HISTORY_MAX_LIMIT + 100);
  });
});
