/**
 * Shared test helpers. Everything here goes through the public API (`apply`) only.
 *
 * ASCII maps: one text row per floor row, TOP ROW = NORTH-MOST (y = height - 1), so the map
 * reads like the floor drawn with north up. Tokens are separated by whitespace:
 *   .        empty cell
 *   #        obstacle
 *   R<n>^    robot n facing NORTH     R<n>>   EAST     R<n>v   SOUTH     R<n><   WEST
 *
 *   fromMap(`
 *     R1> R2> .
 *     .   .   #
 *   `)   // 3x2 floor: R1 at (0,1), R2 at (1,1), obstacle at (2,0)
 */
import {
  apply,
  createFloorState,
  type Action,
  type BlockReason,
  type Command,
  type Facing,
  type FloorState,
  type RejectionReason,
  type RobotTickResult,
  type WorldEvent,
} from '../src/index.js';

export const FACING_SYMBOL: Readonly<Record<string, Facing>> = {
  '^': 'NORTH',
  '>': 'EAST',
  v: 'SOUTH',
  '<': 'WEST',
};

export interface Applied {
  readonly state: FloorState;
  readonly events: readonly WorldEvent[];
}

/** Apply an action that must be accepted; throws a readable error otherwise. */
export function ok(state: FloorState, action: Action): Applied {
  const res = apply(state, action);
  if (!res.ok) {
    throw new Error(`expected ${action.type} to be accepted, got ${res.reason}: ${res.message}`);
  }
  return { state: res.state, events: res.events };
}

/** Apply an action that must be rejected; returns the reason. */
export function rejected(state: FloorState, action: Action): RejectionReason {
  const res = apply(state, action);
  if (res.ok) {
    throw new Error(`expected ${JSON.stringify(action)} to be rejected, but it was accepted`);
  }
  return res.reason;
}

/** Parse "MOVE LEFT RIGHT GOTO 3,4" into commands (test-side convenience; not the real parser). */
export function cmds(text: string): Command[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const out: Command[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'MOVE' || t === 'LEFT' || t === 'RIGHT') {
      out.push({ kind: t });
    } else if (t === 'GOTO') {
      const coords = tokens[++i];
      if (coords === undefined) throw new Error('GOTO needs coordinates');
      const [xs, ys] = coords.split(',');
      out.push({ kind: 'GOTO', x: Number(xs), y: Number(ys) });
    } else {
      throw new Error(`bad command token in test: ${String(t)}`);
    }
  }
  return out;
}

export interface RobotSpec {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly queue?: string;
}

export function robot(
  id: string,
  x: number,
  y: number,
  facing: Facing,
  queueText?: string,
): RobotSpec {
  return queueText === undefined ? { id, x, y, facing } : { id, x, y, facing, queue: queueText };
}

export function queue(state: FloorState, id: string, commands: string): FloorState {
  return ok(state, { type: 'QUEUE_COMMANDS', id, commands: cmds(commands) }).state;
}

/** Queue the same command text on every robot currently on the floor. */
export function queueAll(state: FloorState, commands: string): FloorState {
  let s = state;
  for (const r of state.robots) s = queue(s, r.id, commands);
  return s;
}

/**
 * Build a floor via actions: CREATE_FLOOR, obstacles, then robots in the given order (order must
 * not matter to the result), then queues.
 */
export function buildFloor(
  width: number,
  height: number,
  robots: readonly RobotSpec[] = [],
  obstacles: readonly (readonly [number, number])[] = [],
): FloorState {
  let state = ok(createFloorState(1, 1), { type: 'CREATE_FLOOR', width, height }).state;
  for (const [x, y] of obstacles) {
    state = ok(state, { type: 'SET_OBSTACLE', x, y, present: true }).state;
  }
  for (const r of robots) {
    state = ok(state, { type: 'PLACE_ROBOT', id: r.id, x: r.x, y: r.y, facing: r.facing }).state;
  }
  for (const r of robots) {
    if (r.queue !== undefined && r.queue.trim() !== '') {
      state = queue(state, r.id, r.queue);
    }
  }
  return state;
}

/** Build a floor from an ASCII map (see file header). `queues` maps robot id to command text. */
export function fromMap(map: string, queues: Readonly<Record<string, string>> = {}): FloorState {
  const rows = map
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(/\s+/));
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const robots: RobotSpec[] = [];
  const obstacles: [number, number][] = [];
  rows.forEach((row, rowIdx) => {
    if (row.length !== width) throw new Error(`ragged map row ${rowIdx}: ${row.join(' ')}`);
    const y = height - 1 - rowIdx;
    row.forEach((tok, x) => {
      if (tok === '.') return;
      if (tok === '#') {
        obstacles.push([x, y]);
        return;
      }
      const m = /^(R\d+)([\^>v<])$/.exec(tok);
      if (!m || m[1] === undefined || m[2] === undefined) throw new Error(`bad map token "${tok}"`);
      const facing = FACING_SYMBOL[m[2]];
      if (facing === undefined) throw new Error(`bad facing in "${tok}"`);
      robots.push(robot(m[1], x, y, facing));
    });
  });
  let state = buildFloor(width, height, robots, obstacles);
  for (const [id, text] of Object.entries(queues)) state = queue(state, id, text);
  return state;
}

export interface TickOutput {
  readonly state: FloorState;
  readonly events: readonly WorldEvent[];
  readonly results: readonly RobotTickResult[];
}

/** Apply one TICK (must be accepted) and pull out the TICK_RESOLVED results. */
export function tick(state: FloorState): TickOutput {
  const { state: next, events } = ok(state, { type: 'TICK' });
  const resolved = events.filter((e) => e.type === 'TICK_RESOLVED');
  if (resolved.length !== 1)
    throw new Error(`expected exactly one TICK_RESOLVED, got ${resolved.length}`);
  const ev = resolved[0];
  if (ev?.type !== 'TICK_RESOLVED') throw new Error('unreachable');
  return { state: next, events, results: ev.results };
}

/** Run n ticks; returns the final state and every tick's results. */
export function ticks(
  state: FloorState,
  n: number,
): { state: FloorState; history: RobotTickResult[][] } {
  let s = state;
  const history: RobotTickResult[][] = [];
  for (let i = 0; i < n; i++) {
    const t = tick(s);
    s = t.state;
    history.push([...t.results]);
  }
  return { state: s, history };
}

/** "x,y,FACING" per robot id, e.g. { R1: '1,0,EAST' }. */
export function cells(state: FloorState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of state.robots) out[r.id] = `${r.x},${r.y},${r.facing}`;
  return out;
}

export function robotOf(state: FloorState, id: string) {
  const r = state.robots.find((x) => x.id === id);
  if (!r) throw new Error(`no robot ${id} in state`);
  return r;
}

/** Compact result text per robot: MOVED, TURNED, IDLE, WAITING, ARRIVED, UNREACHABLE, BLOCKED(WALL)... */
export function outcomes(results: readonly RobotTickResult[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of results)
    out[r.id] = r.outcome === 'BLOCKED' ? `BLOCKED(${String(r.reason)})` : r.outcome;
  return out;
}

export function blocked(reason: BlockReason): string {
  return `BLOCKED(${reason})`;
}

export interface TickMapOutput {
  readonly before: FloorState;
  readonly after: FloorState;
  readonly pos: Record<string, string>;
  readonly out: Record<string, string>;
  readonly results: readonly RobotTickResult[];
}

/** Build the map, run one tick, and return positions + outcomes afterwards. */
export function tickMap(map: string, queues: Readonly<Record<string, string>>): TickMapOutput {
  const before = fromMap(map, queues);
  const t = tick(before);
  return {
    before,
    after: t.state,
    pos: cells(t.state),
    out: outcomes(t.results),
    results: t.results,
  };
}

/** Recursively freeze a value so any in-place mutation by the code under test throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Deep structural copy through JSON (state is plain JSON-serializable data by contract). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
