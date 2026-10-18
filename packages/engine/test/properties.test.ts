/**
 * Differential and property tests (fast-check, global seed 424242 from test/setup.ts).
 *
 * Random small floors with obstacles, robots with gappy numbers (R2, R10, ...) and random
 * MOVE/LEFT/RIGHT queues are run through the real `apply` and through the naive reference
 * resolver in test/reference/. They must agree, and structural invariants must hold.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FACINGS,
  apply,
  type Action,
  type Command,
  type Facing,
  type FloorState,
  type RejectionReason,
  type RobotTickResult,
  type WorldEvent,
} from '../src/index.js';
import { refFromState, refTick, type RefState } from './reference/reference-tick.js';
import { ok } from './helpers.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

interface RobotGen {
  cell: number;
  num: number;
  facing: Facing;
  queue: Command[];
}

interface ScenarioGen {
  width: number;
  height: number;
  obstacleCells: number[];
  robots: RobotGen[];
  shuffleKeys: number[];
}

const commandArb: fc.Arbitrary<Command> = fc
  .constantFrom<Command['kind']>('MOVE', 'MOVE', 'MOVE', 'LEFT', 'RIGHT')
  .map((kind) => ({ kind }) as Command);

const robotArb: fc.Arbitrary<RobotGen> = fc.record({
  cell: fc.nat(),
  num: fc.integer({ min: 1, max: 12 }),
  facing: fc.constantFrom(...FACINGS),
  queue: fc.array(commandArb, { maxLength: 5 }),
});

const MAX_ROBOTS = 16;

const scenarioArb: fc.Arbitrary<ScenarioGen> = fc.record({
  width: fc.integer({ min: 1, max: 6 }),
  height: fc.integer({ min: 1, max: 6 }),
  obstacleCells: fc.array(fc.nat(), { maxLength: 6 }),
  robots: fc.array(robotArb, { maxLength: MAX_ROBOTS }),
  shuffleKeys: fc.array(fc.integer(), { minLength: MAX_ROBOTS, maxLength: MAX_ROBOTS }),
});

/** Resolve the raw random data to a valid, duplicate-free layout (independent of any ordering). */
function layout(sc: ScenarioGen) {
  const cells = sc.width * sc.height;
  const obstacles = new Set<number>(sc.obstacleCells.map((c) => c % cells));
  const usedCells = new Set<number>();
  const usedNums = new Set<number>();
  const robots: (RobotGen & { cell: number })[] = [];
  for (const r of sc.robots) {
    const cell = r.cell % cells;
    if (obstacles.has(cell) || usedCells.has(cell) || usedNums.has(r.num)) continue;
    usedCells.add(cell);
    usedNums.add(r.num);
    robots.push({ ...r, cell });
  }
  return { obstacles: [...obstacles], robots };
}

/** Build the state through the public reducer, placing robots in the given permutation. */
function build(sc: ScenarioGen, permute: boolean): FloorState {
  const { obstacles, robots } = layout(sc);
  let state = ok(
    { width: 1, height: 1, obstacles: [], robots: [], nextRobotNum: 1, tick: 0 },
    { type: 'CREATE_FLOOR', width: sc.width, height: sc.height },
  ).state;
  for (const c of obstacles) {
    state = ok(state, {
      type: 'SET_OBSTACLE',
      x: c % sc.width,
      y: Math.floor(c / sc.width),
      present: true,
    }).state;
  }
  const order = robots.map((r, i) => ({ r, key: permute ? (sc.shuffleKeys[i] ?? 0) : i }));
  if (permute) order.sort((a, b) => a.key - b.key);
  for (const { r } of order) {
    state = ok(state, {
      type: 'PLACE_ROBOT',
      id: `R${r.num}`,
      x: r.cell % sc.width,
      y: Math.floor(r.cell / sc.width),
      facing: r.facing,
    }).state;
  }
  for (const { r } of order) {
    if (r.queue.length > 0) {
      state = ok(state, { type: 'QUEUE_COMMANDS', id: `R${r.num}`, commands: r.queue }).state;
    }
  }
  return state;
}

function tickResults(events: readonly WorldEvent[]): readonly RobotTickResult[] {
  const ev = events.flatMap((e) => (e.type === 'TICK_RESOLVED' ? [e] : []));
  expect(ev).toHaveLength(1);
  return ev[0]?.results ?? [];
}

const key = (x: number, y: number) => `${x},${y}`;

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const TICKS = 4;

describe('differential: engine vs naive reference resolver', () => {
  it('positions, facings, queues and moved/not-moved agree on every tick', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        let state = build(sc, false);
        let ref: RefState = refFromState(state);
        for (let t = 0; t < TICKS; t++) {
          const res = ok(state, { type: 'TICK' });
          const refStep = refTick(ref);
          const results = tickResults(res.events);

          expect(results.map((r) => r.id)).toEqual(refStep.results.map((r) => r.id));
          for (const [i, r] of results.entries()) {
            const rr = refStep.results[i];
            expect(rr).toBeDefined();
            if (!rr) continue;
            // moved / not moved / turned / idle
            expect(r.outcome).toBe(rr.outcome);
            expect(r.from).toEqual(rr.from);
            expect(r.to).toEqual(rr.to);
            expect(r.facing).toBe(rr.facing);
            expect(r.command).toEqual(rr.command);
          }
          const actual = res.state.robots.map((r) => ({
            id: r.id,
            x: r.x,
            y: r.y,
            facing: r.facing,
            queue: r.queue,
          }));
          const expected = refStep.state.robots.map((r) => ({
            id: r.id,
            x: r.x,
            y: r.y,
            facing: r.facing,
            queue: r.queue,
          }));
          expect(actual).toEqual(expected);

          state = res.state;
          ref = refStep.state;
        }
      }),
    );
  });

  it('block reasons agree with the reference (DECISIONS 2.1 to 2.4 and 2.7)', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        let state = build(sc, false);
        let ref: RefState = refFromState(state);
        for (let t = 0; t < TICKS; t++) {
          const res = ok(state, { type: 'TICK' });
          const refStep = refTick(ref);
          const results = tickResults(res.events);
          expect(results.map((r) => [r.id, r.reason])).toEqual(
            refStep.results.map((r) => [r.id, r.reason]),
          );
          state = res.state;
          ref = refStep.state;
        }
      }),
    );
  });
});

describe('invariants after every tick', () => {
  it('no shared cells, nobody off-floor or on an obstacle, at most one cell of movement', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        let state = build(sc, false);
        for (let t = 0; t < TICKS; t++) {
          const before = state;
          const res = ok(state, { type: 'TICK' });
          state = res.state;
          const obstacleKeys = new Set(state.obstacles.map((o) => key(o.x, o.y)));
          const seen = new Set<string>();
          for (const r of state.robots) {
            expect(r.x).toBeGreaterThanOrEqual(0);
            expect(r.y).toBeGreaterThanOrEqual(0);
            expect(r.x).toBeLessThan(state.width);
            expect(r.y).toBeLessThan(state.height);
            expect(obstacleKeys.has(key(r.x, r.y))).toBe(false);
            expect(seen.has(key(r.x, r.y))).toBe(false);
            seen.add(key(r.x, r.y));
          }
          for (const r of state.robots) {
            const prev = before.robots.find((p) => p.id === r.id);
            expect(prev).toBeDefined();
            if (!prev) continue;
            expect(Math.abs(r.x - prev.x) + Math.abs(r.y - prev.y)).toBeLessThanOrEqual(1);
            // each non-empty queue shrinks by exactly one; an empty one stays empty
            expect(r.queue.length).toBe(Math.max(0, prev.queue.length - 1));
          }
        }
      }),
    );
  });

  it('tick +1, one result per robot sorted by number, everything else untouched', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const before = build(sc, false);
        const res = ok(before, { type: 'TICK' });
        expect(res.state.tick).toBe(before.tick + 1);
        expect(res.state.width).toBe(before.width);
        expect(res.state.height).toBe(before.height);
        expect(res.state.obstacles).toEqual(before.obstacles);
        expect(res.state.nextRobotNum).toBe(before.nextRobotNum);
        expect(res.state.robots.map((r) => r.id)).toEqual(before.robots.map((r) => r.id));
        const results = tickResults(res.events);
        expect(results.map((r) => r.id)).toEqual(before.robots.map((r) => r.id));
        const nums = results.map((r) => Number(r.id.slice(1)));
        expect(nums).toEqual([...nums].sort((a, b) => a - b));
      }),
    );
  });

  it('result fields are consistent with the states before and after', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const before = build(sc, false);
        const res = ok(before, { type: 'TICK' });
        for (const r of tickResults(res.events)) {
          const prev = before.robots.find((p) => p.id === r.id);
          const next = res.state.robots.find((p) => p.id === r.id);
          expect(prev).toBeDefined();
          expect(next).toBeDefined();
          if (!prev || !next) continue;
          expect(r.from).toEqual({ x: prev.x, y: prev.y });
          expect(r.to).toEqual({ x: next.x, y: next.y });
          expect(r.facing).toBe(next.facing);
          expect(r.command).toEqual(prev.queue[0] ?? null);
          expect(r.reason !== undefined).toBe(r.outcome === 'BLOCKED');
          if (r.outcome === 'MOVED') expect(r.to).not.toEqual(r.from);
          else expect(r.to).toEqual(r.from);
          if (r.outcome === 'IDLE') expect(prev.queue).toHaveLength(0);
          if (r.outcome === 'TURNED') expect(['LEFT', 'RIGHT']).toContain(r.command?.kind);
          if (r.outcome === 'MOVED' || r.outcome === 'BLOCKED')
            expect(r.command?.kind).toBe('MOVE');
        }
      }),
    );
  });

  it('WALL and OBSTACLE are reported exactly when the target cell is off the floor / an obstacle', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const before = build(sc, false);
        const res = ok(before, { type: 'TICK' });
        const obstacleKeys = new Set(before.obstacles.map((o) => key(o.x, o.y)));
        const dx = { NORTH: 0, EAST: 1, SOUTH: 0, WEST: -1 } as const;
        const dy = { NORTH: 1, EAST: 0, SOUTH: -1, WEST: 0 } as const;
        for (const r of tickResults(res.events)) {
          if (r.command?.kind !== 'MOVE') continue;
          const prev = before.robots.find((p) => p.id === r.id);
          if (!prev) continue;
          const tx = prev.x + dx[prev.facing];
          const ty = prev.y + dy[prev.facing];
          const off = tx < 0 || ty < 0 || tx >= before.width || ty >= before.height;
          if (off) expect(r.reason).toBe('WALL');
          else if (obstacleKeys.has(key(tx, ty))) expect(r.reason).toBe('OBSTACLE');
          else expect(['WALL', 'OBSTACLE']).not.toContain(r.reason);
        }
      }),
    );
  });
});

describe('permutation invariance', () => {
  it('placing robots in a shuffled order gives the identical state, tick results and events', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const a = build(sc, false);
        const b = build(sc, true);
        expect(b).toEqual(a);
        let sa = a;
        let sb = b;
        for (let t = 0; t < TICKS; t++) {
          const ra = ok(sa, { type: 'TICK' });
          const rb = ok(sb, { type: 'TICK' });
          expect(rb.events).toEqual(ra.events);
          expect(rb.state).toEqual(ra.state);
          sa = ra.state;
          sb = rb.state;
        }
      }),
    );
  });
});

describe('determinism', () => {
  it('the same input twice gives deep-equal output, and a cloned input gives the same too', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const state = build(sc, false);
        const first = apply(state, { type: 'TICK' });
        const second = apply(state, { type: 'TICK' });
        const third = apply(structuredClone(state), { type: 'TICK' });
        expect(second).toEqual(first);
        expect(third).toEqual(first);
      }),
    );
  });

  it('TICK never mutates its input', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const state = build(sc, false);
        const snapshot = structuredClone(state);
        apply(state, { type: 'TICK' });
        expect(state).toEqual(snapshot);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Reducer: random action sequences keep the canonical-form invariants
// ---------------------------------------------------------------------------

const REASONS: RejectionReason[] = [
  'INVALID_SIZE',
  'INVALID_ID',
  'OUT_OF_BOUNDS',
  'CELL_IS_OBSTACLE',
  'CELL_OCCUPIED',
  'UNKNOWN_ROBOT',
  'INVALID_COMMAND',
  'INVALID_GOTO_TARGET',
];

const idArb = fc.integer({ min: 1, max: 6 }).map((n) => `R${n}`);
const coord = fc.integer({ min: -1, max: 6 });
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant('CREATE_FLOOR' as const),
      width: fc.integer({ min: 0, max: 7 }),
      height: fc.integer({ min: 0, max: 7 }),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      type: fc.constant('PLACE_ROBOT' as const),
      id: idArb,
      x: coord,
      y: coord,
      facing: fc.constantFrom(...FACINGS),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant('PLACE_ROBOT' as const),
      x: coord,
      y: coord,
      facing: fc.constantFrom(...FACINGS),
    }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('REMOVE_ROBOT' as const), id: idArb }) },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant('SET_OBSTACLE' as const),
      x: coord,
      y: coord,
      present: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant('TOGGLE_OBSTACLE' as const), x: coord, y: coord }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant('QUEUE_COMMANDS' as const),
      id: idArb,
      commands: fc.array(commandArb, { minLength: 1, maxLength: 4 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('CLEAR_QUEUE' as const), id: idArb }) },
  { weight: 5, arbitrary: fc.constant({ type: 'TICK' as const }) },
);

function assertCanonical(s: FloorState): void {
  expect(s.width).toBeGreaterThanOrEqual(1);
  expect(s.width).toBeLessThanOrEqual(20);
  expect(s.height).toBeGreaterThanOrEqual(1);
  expect(s.height).toBeLessThanOrEqual(20);
  const nums = s.robots.map((r) => r.num);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  expect(new Set(nums).size).toBe(nums.length);
  const occupied = new Set<string>();
  const obstacleKeys = new Set(s.obstacles.map((o) => key(o.x, o.y)));
  expect(obstacleKeys.size).toBe(s.obstacles.length);
  for (const r of s.robots) {
    expect(r.id).toBe(`R${r.num}`);
    expect(r.x >= 0 && r.y >= 0 && r.x < s.width && r.y < s.height).toBe(true);
    expect(obstacleKeys.has(key(r.x, r.y))).toBe(false);
    expect(occupied.has(key(r.x, r.y))).toBe(false);
    occupied.add(key(r.x, r.y));
    expect(s.nextRobotNum).toBeGreaterThan(r.num);
  }
  for (const o of s.obstacles) {
    expect(o.x >= 0 && o.y >= 0 && o.x < s.width && o.y < s.height).toBe(true);
  }
  const sorted = [...s.obstacles].sort((a, b) => a.x - b.x || a.y - b.y);
  expect(s.obstacles).toEqual(sorted);
}

describe('reducer: random action sequences', () => {
  it('every accepted action leaves a canonical state; every rejection uses a known reason and changes nothing', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 60 }), (actions) => {
        let state: FloorState = ok(
          { width: 1, height: 1, obstacles: [], robots: [], nextRobotNum: 1, tick: 0 },
          { type: 'CREATE_FLOOR', width: 5, height: 4 },
        ).state;
        for (const action of actions) {
          const snapshot = structuredClone(state);
          const res = apply(state, action);
          expect(state).toEqual(snapshot); // input never mutated, accepted or not
          if (res.ok) {
            assertCanonical(res.state);
            if (action.type === 'TICK') expect(res.state.tick).toBe(state.tick + 1);
            else if (action.type !== 'CREATE_FLOOR') {
              expect(res.state.tick).toBe(state.tick);
              expect(res.state.nextRobotNum).toBeGreaterThanOrEqual(state.nextRobotNum);
            }
            state = res.state;
          } else {
            expect(REASONS).toContain(res.reason);
            // The same rejected action is rejected again with the same reason (state is unchanged).
            const again = apply(state, action);
            expect(again.ok).toBe(false);
            if (!again.ok) expect(again.reason).toBe(res.reason);
          }
        }
      }),
    );
  });

  it('the auto-ID high-water mark never decreases, and auto placement never reuses an ID', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 60 }), (actions) => {
        let state: FloorState = ok(
          { width: 1, height: 1, obstacles: [], robots: [], nextRobotNum: 1, tick: 0 },
          { type: 'CREATE_FLOOR', width: 6, height: 6 },
        ).state;
        const everUsed = new Set<number>();
        for (const action of actions) {
          if (action.type === 'CREATE_FLOOR') continue; // a new floor resets the world (and the mark)
          const res = apply(state, action);
          if (!res.ok) continue;
          expect(res.state.nextRobotNum).toBeGreaterThanOrEqual(state.nextRobotNum);
          if (action.type === 'PLACE_ROBOT' && action.id === undefined) {
            const placed = res.state.robots.find((r) => !state.robots.some((p) => p.id === r.id));
            expect(placed).toBeDefined();
            if (placed) {
              expect(placed.num).toBe(state.nextRobotNum);
              expect(everUsed.has(placed.num)).toBe(false);
            }
          }
          for (const r of res.state.robots) everUsed.add(r.num);
          state = res.state;
        }
      }),
    );
  });
});
