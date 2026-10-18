/**
 * GOTO (Module A) property tests: invariants with GOTO commands in random queues.
 * fast-check with the global seed 424242 from test/setup.ts.
 *
 * The one piece of "model" here is `distancesToTarget`, a plain breadth-first search written straight
 * from DECISIONS 3.1 (walls = obstacles, floor edge, every other robot's current cell). It is used
 * only to check what the engine reports; it is not a second implementation of the tick.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FACINGS,
  apply,
  type Command,
  type Facing,
  type FloorState,
  type RobotTickResult,
  type WorldEvent,
} from '../src/index.js';
import { ok } from './helpers.js';

const key = (x: number, y: number) => `${x},${y}`;

function tickResults(events: readonly WorldEvent[]): readonly RobotTickResult[] {
  const ev = events.flatMap((e) => (e.type === 'TICK_RESOLVED' ? [e] : []));
  expect(ev).toHaveLength(1);
  return ev[0]?.results ?? [];
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

type CmdGen = { kind: 'MOVE' | 'LEFT' | 'RIGHT' } | { kind: 'GOTO'; cell: number };

interface RobotGen {
  cell: number;
  num: number;
  facing: Facing;
  queue: CmdGen[];
}

interface ScenarioGen {
  width: number;
  height: number;
  obstacleCells: number[];
  robots: RobotGen[];
  shuffleKeys: number[];
}

const cmdArb: fc.Arbitrary<CmdGen> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .constantFrom<'MOVE' | 'LEFT' | 'RIGHT'>('MOVE', 'LEFT', 'RIGHT')
      .map((kind) => ({ kind })),
  },
  { weight: 3, arbitrary: fc.nat().map((cell) => ({ kind: 'GOTO' as const, cell })) },
);

const MAX_ROBOTS = 8;

const scenarioArb: fc.Arbitrary<ScenarioGen> = fc.record({
  width: fc.integer({ min: 1, max: 6 }),
  height: fc.integer({ min: 1, max: 6 }),
  obstacleCells: fc.array(fc.nat(), { maxLength: 6 }),
  robots: fc.array(
    fc.record({
      cell: fc.nat(),
      num: fc.integer({ min: 1, max: 12 }),
      facing: fc.constantFrom(...FACINGS),
      queue: fc.array(cmdArb, { maxLength: 4 }),
    }),
    { maxLength: MAX_ROBOTS },
  ),
  shuffleKeys: fc.array(fc.integer(), { minLength: MAX_ROBOTS, maxLength: MAX_ROBOTS }),
});

const BLANK: FloorState = {
  width: 1,
  height: 1,
  obstacles: [],
  robots: [],
  nextRobotNum: 1,
  tick: 0,
};

/** Build through the public reducer. GOTO targets on an obstacle are dropped (the reducer would reject them). */
function build(sc: ScenarioGen, permute: boolean): FloorState {
  const cellCount = sc.width * sc.height;
  const obstacles = new Set<number>(sc.obstacleCells.map((c) => c % cellCount));
  const usedCells = new Set<number>();
  const usedNums = new Set<number>();
  const robots: RobotGen[] = [];
  for (const r of sc.robots) {
    const cell = r.cell % cellCount;
    if (obstacles.has(cell) || usedCells.has(cell) || usedNums.has(r.num)) continue;
    usedCells.add(cell);
    usedNums.add(r.num);
    robots.push({ ...r, cell });
  }
  let state = ok(BLANK, { type: 'CREATE_FLOOR', width: sc.width, height: sc.height }).state;
  for (const c of obstacles) {
    state = ok(state, {
      type: 'SET_OBSTACLE',
      x: c % sc.width,
      y: Math.floor(c / sc.width),
      present: true,
    }).state;
  }
  const order = robots.map((r, i) => ({ r, order: permute ? (sc.shuffleKeys[i] ?? 0) : i }));
  if (permute) order.sort((a, b) => a.order - b.order);
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
    const commands: Command[] = [];
    for (const c of r.queue) {
      if (c.kind !== 'GOTO') {
        commands.push({ kind: c.kind });
      } else {
        const t = c.cell % cellCount;
        if (!obstacles.has(t)) {
          commands.push({ kind: 'GOTO', x: t % sc.width, y: Math.floor(t / sc.width) });
        }
      }
    }
    if (commands.length > 0) {
      state = ok(state, { type: 'QUEUE_COMMANDS', id: `R${r.num}`, commands }).state;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// The plain model of "is there a path, and which first step"
// ---------------------------------------------------------------------------

const STEP: Readonly<Record<Facing, readonly [number, number]>> = {
  NORTH: [0, 1],
  EAST: [1, 0],
  SOUTH: [0, -1],
  WEST: [-1, 0],
};

/**
 * Breadth-first distance to (tx,ty) over on-floor cells that are not obstacles and do not hold a
 * robot other than `selfId`. Empty when the target itself is a wall.
 */
function distancesToTarget(
  state: FloorState,
  selfId: string,
  tx: number,
  ty: number,
): Map<string, number> {
  const wall = new Set<string>(state.obstacles.map((o) => key(o.x, o.y)));
  for (const r of state.robots) if (r.id !== selfId) wall.add(key(r.x, r.y));
  const dist = new Map<string, number>();
  if (wall.has(key(tx, ty))) return dist;
  dist.set(key(tx, ty), 0);
  const frontier: [number, number][] = [[tx, ty]];
  for (let i = 0; i < frontier.length; i++) {
    const [x, y] = frontier[i] ?? [0, 0];
    const d = dist.get(key(x, y)) ?? 0;
    for (const f of FACINGS) {
      const [dx, dy] = STEP[f];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      if (wall.has(key(nx, ny)) || dist.has(key(nx, ny))) continue;
      dist.set(key(nx, ny), d + 1);
      frontier.push([nx, ny]);
    }
  }
  return dist;
}

/** First of NORTH, EAST, SOUTH, WEST whose neighbour is one step closer; null when there is no path. */
function expectedFirstStep(dist: Map<string, number>, x: number, y: number): Facing | null {
  const here = dist.get(key(x, y));
  if (here === undefined) return null;
  for (const f of FACINGS) {
    const [dx, dy] = STEP[f];
    if (dist.get(key(x + dx, y + dy)) === here - 1) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const TICKS = 8;

describe('GOTO invariants with GOTO in random queues', () => {
  it('no shared cells, nobody off-floor or on an obstacle, at most one cell of movement', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        let state = build(sc, false);
        for (let t = 0; t < TICKS; t++) {
          const before = state;
          state = ok(state, { type: 'TICK' }).state;
          const obstacleKeys = new Set(state.obstacles.map((o) => key(o.x, o.y)));
          const seen = new Set<string>();
          for (const r of state.robots) {
            expect(r.x >= 0 && r.y >= 0 && r.x < state.width && r.y < state.height).toBe(true);
            expect(obstacleKeys.has(key(r.x, r.y))).toBe(false);
            expect(seen.has(key(r.x, r.y))).toBe(false);
            seen.add(key(r.x, r.y));
            const prev = before.robots.find((p) => p.id === r.id);
            expect(prev).toBeDefined();
            if (prev) {
              expect(Math.abs(r.x - prev.x) + Math.abs(r.y - prev.y)).toBeLessThanOrEqual(1);
            }
          }
        }
      }),
    );
  });

  it('planning matches the spec: no path means WAITING then UNREACHABLE, otherwise the first NESW-ordered shortest step', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        let state = build(sc, false);
        for (let t = 0; t < TICKS; t++) {
          const before = state;
          const res = ok(state, { type: 'TICK' });
          state = res.state;
          for (const r of tickResults(res.events)) {
            const prev = before.robots.find((p) => p.id === r.id);
            const next = state.robots.find((p) => p.id === r.id);
            expect(prev).toBeDefined();
            expect(next).toBeDefined();
            const front = prev?.queue[0];
            if (!prev || !next || front?.kind !== 'GOTO') continue;
            expect(r.command).toEqual(front);

            if (prev.x === front.x && prev.y === front.y) {
              // Already there: ARRIVED, the tick is used, nothing moves, the GOTO leaves the queue.
              expect(r.outcome).toBe('ARRIVED');
              expect(r.to).toEqual(r.from);
              expect(r.facing).toBe(prev.facing);
              expect(next.queue).toEqual(prev.queue.slice(1));
              expect(next.gotoNoPathTicks).toBe(0);
              continue;
            }

            const dist = distancesToTarget(before, prev.id, front.x, front.y);
            const step = expectedFirstStep(dist, prev.x, prev.y);
            if (step === null) {
              // No path: wait (counter + 1) or give up on the third tick in a row.
              expect(r.to).toEqual(r.from);
              expect(r.facing).toBe(prev.facing);
              if (prev.gotoNoPathTicks + 1 >= 3) {
                expect(r.outcome).toBe('UNREACHABLE');
                expect(next.queue).toEqual(prev.queue.slice(1));
                expect(next.gotoNoPathTicks).toBe(0);
              } else {
                expect(r.outcome).toBe('WAITING');
                expect(next.queue).toEqual(prev.queue);
                expect(next.gotoNoPathTicks).toBe(prev.gotoNoPathTicks + 1);
              }
              continue;
            }

            // A path exists: the robot faces the preferred first step whether or not it gets to move.
            expect(r.facing).toBe(step);
            expect(next.gotoNoPathTicks).toBe(0);
            expect(['MOVED', 'BLOCKED']).toContain(r.outcome);
            if (r.outcome === 'MOVED') {
              const [dx, dy] = STEP[step];
              expect(r.to).toEqual({ x: prev.x + dx, y: prev.y + dy });
              const arrived = r.to.x === front.x && r.to.y === front.y;
              expect(r.reachedGoto === true).toBe(arrived);
              expect(next.queue).toEqual(arrived ? prev.queue.slice(1) : prev.queue);
            } else {
              // The step's target cell is on the floor, free of obstacles and of robots at planning
              // time, so the only thing that can stop it is losing a contest (DECISIONS 2.1, 2.3).
              expect(r.reason).toBe('CONTESTED');
              expect(r.to).toEqual(r.from);
              expect(r.reachedGoto).not.toBe(true);
              expect(next.queue).toEqual(prev.queue);
            }
          }
          // The counter only runs while a GOTO is at the front, and never reaches 3.
          for (const r of state.robots) {
            expect(r.gotoNoPathTicks).toBeLessThanOrEqual(2);
            if (r.gotoNoPathTicks > 0) expect(r.queue[0]?.kind).toBe('GOTO');
          }
        }
      }),
    );
  });

  it('robots whose front command is not a GOTO still consume exactly one command per tick', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        let state = build(sc, false);
        for (let t = 0; t < TICKS; t++) {
          const before = state;
          state = ok(state, { type: 'TICK' }).state;
          for (const prev of before.robots) {
            if (prev.queue[0]?.kind === 'GOTO') continue;
            const next = state.robots.find((p) => p.id === prev.id);
            expect(next?.queue.length).toBe(Math.max(0, prev.queue.length - 1));
          }
        }
      }),
    );
  });

  it('a lone robot arrives after exactly BFS-distance ticks; an unreachable target is given up on tick 3', () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 1, max: 6 }),
          height: fc.integer({ min: 1, max: 6 }),
          obstacleCells: fc.array(fc.nat(), { maxLength: 10 }),
          start: fc.nat(),
          target: fc.nat(),
          facing: fc.constantFrom(...FACINGS),
        }),
        (g) => {
          const n = g.width * g.height;
          const obstacles = new Set(g.obstacleCells.map((c) => c % n));
          const start = g.start % n;
          const target = g.target % n;
          obstacles.delete(start);
          obstacles.delete(target);
          let state = ok(BLANK, { type: 'CREATE_FLOOR', width: g.width, height: g.height }).state;
          for (const c of obstacles) {
            state = ok(state, {
              type: 'SET_OBSTACLE',
              x: c % g.width,
              y: Math.floor(c / g.width),
              present: true,
            }).state;
          }
          const sx = start % g.width;
          const sy = Math.floor(start / g.width);
          const tx = target % g.width;
          const ty = Math.floor(target / g.width);
          state = ok(state, {
            type: 'PLACE_ROBOT',
            id: 'R1',
            x: sx,
            y: sy,
            facing: g.facing,
          }).state;
          state = ok(state, {
            type: 'QUEUE_COMMANDS',
            id: 'R1',
            commands: [{ kind: 'GOTO', x: tx, y: ty }],
          }).state;

          const dist = distancesToTarget(state, 'R1', tx, ty).get(key(sx, sy));
          const outs: string[] = [];
          for (let t = 0; t < 10; t++) {
            const res = ok(state, { type: 'TICK' });
            state = res.state;
            outs.push(tickResults(res.events)[0]?.outcome ?? '?');
          }
          const end = state.robots[0];
          if (dist === undefined) {
            expect(outs.slice(0, 4)).toEqual(['WAITING', 'WAITING', 'UNREACHABLE', 'IDLE']);
            expect([end?.x, end?.y]).toEqual([sx, sy]);
          } else if (dist === 0) {
            expect(outs[0]).toBe('ARRIVED');
            expect(outs.slice(1).every((o) => o === 'IDLE')).toBe(true);
          } else {
            expect(outs.slice(0, dist).every((o) => o === 'MOVED')).toBe(true);
            expect(outs.slice(dist).every((o) => o === 'IDLE')).toBe(true);
            expect([end?.x, end?.y]).toEqual([tx, ty]);
          }
        },
      ),
    );
  });
});

describe('GOTO permutation invariance, determinism and purity', () => {
  it('placing robots in a shuffled order gives identical states and events with GOTO in the queues', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        let a = build(sc, false);
        let b = build(sc, true);
        expect(b).toEqual(a);
        for (let t = 0; t < TICKS; t++) {
          const ra = ok(a, { type: 'TICK' });
          const rb = ok(b, { type: 'TICK' });
          expect(rb.events).toEqual(ra.events);
          expect(rb.state).toEqual(ra.state);
          a = ra.state;
          b = rb.state;
        }
      }),
    );
  });

  it('TICK with GOTO is deterministic and never mutates its input', () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const state = build(sc, false);
        const snapshot = structuredClone(state);
        const first = apply(state, { type: 'TICK' });
        const second = apply(structuredClone(state), { type: 'TICK' });
        expect(state).toEqual(snapshot);
        expect(second).toEqual(first);
      }),
    );
  });
});
