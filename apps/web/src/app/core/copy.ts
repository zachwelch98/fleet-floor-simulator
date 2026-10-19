/**
 * All user-facing wording and the small pure helpers that derive it from engine data.
 * Strings are copied exactly from docs/design/UI_SPEC.md (sections 4.4, 5.5, 7.4, 8).
 */
import type {
  Action,
  BlockReason,
  Command,
  Facing,
  Position,
  RejectionReason,
  Robot,
  RobotTickResult,
  TickOutcome,
  WorldEvent,
} from '@fleet/engine';

/** Floor size limits shown in copy. Mirrors the engine's 1..20 rule; the engine stays the judge. */
export const FLOOR_SIZE_MIN = 1;
export const FLOOR_SIZE_MAX = 20;

const STEP: Record<Facing, Position> = {
  NORTH: { x: 0, y: 1 },
  EAST: { x: 1, y: 0 },
  SOUTH: { x: 0, y: -1 },
  WEST: { x: -1, y: 0 },
};

const ARROW: Record<Facing, string> = { NORTH: '▲', EAST: '▶', SOUTH: '▼', WEST: '◀' };

export function facingArrow(facing: Facing): string {
  return ARROW[facing];
}

export function robotNum(id: string): number {
  return Number(id.slice(1));
}

export function pos(p: Position): string {
  return `(${p.x},${p.y})`;
}

/** Hue index 1..8 for a robot number, `(num - 1) % 8`. */
export function hueOf(num: number): number {
  return ((num - 1) % 8) + 1;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Upper-case form used in history lines: MOVE, LEFT, GOTO 3,4. */
export function commandWord(cmd: Command): string {
  return cmd.kind === 'GOTO' ? `GOTO ${cmd.x},${cmd.y}` : cmd.kind;
}

/** Queue chip text: ▲ Move, ◀ Left, Right ▶, ⌖ GOTO 3,4. */
export function chipText(cmd: Command): string {
  switch (cmd.kind) {
    case 'MOVE':
      return '▲ Move';
    case 'LEFT':
      return '◀ Left';
    case 'RIGHT':
      return 'Right ▶';
    case 'GOTO':
      return `⌖ GOTO ${cmd.x},${cmd.y}`;
  }
}

// ---------------------------------------------------------------------------
// Tick results
// ---------------------------------------------------------------------------

/** The cell a blocked robot tried to enter: `from` plus the unit step of `facing`. */
export function attemptedCell(result: RobotTickResult): Position {
  const step = STEP[result.facing];
  return { x: result.from.x + step.x, y: result.from.y + step.y };
}

/** The robot of the same tick that stood on the attempted cell, if any. */
export function blockerOf(
  result: RobotTickResult,
  results: readonly RobotTickResult[],
): RobotTickResult | undefined {
  const t = attemptedCell(result);
  return results.find((r) => r.id !== result.id && r.from.x === t.x && r.from.y === t.y);
}

function blockReasonText(result: RobotTickResult, results: readonly RobotTickResult[]): string {
  const t = pos(attemptedCell(result));
  const b = blockerOf(result, results)?.id;
  switch (result.reason) {
    case 'WALL':
      return 'the floor edge is ahead';
    case 'OBSTACLE':
      return `obstacle at ${t}`;
    case 'CONTESTED':
      return `a lower-numbered robot also wants ${t} and has priority`;
    case 'HEAD_ON':
      return `head-on with ${b ?? 'the robot'} at ${t}; robots can't swap cells`;
    case 'OCCUPIED':
      return `${b ?? 'a robot'} is standing at ${t} and didn't move`;
    case 'BEHIND_BLOCKED':
      return `${b ?? 'the robot'} ahead at ${t} was also blocked`;
    default:
      return 'something is in the way';
  }
}

export interface ResultLine {
  readonly glyph: string;
  /** Full sentence including the leading robot id and the final period. */
  readonly text: string;
  /** Block reason code shown muted after the sentence (BLOCKED only). */
  readonly code?: string;
}

function gotoTarget(result: RobotTickResult): Position {
  const c = result.command;
  return c && c.kind === 'GOTO' ? { x: c.x, y: c.y } : result.to;
}

export function resultLine(
  result: RobotTickResult,
  results: readonly RobotTickResult[],
): ResultLine {
  const id = result.id;
  switch (result.outcome) {
    case 'MOVED':
      return result.reachedGoto
        ? {
            glyph: '✓',
            text: `${id} moved ${pos(result.from)} → ${pos(result.to)} and reached its GOTO target.`,
          }
        : { glyph: '▶', text: `${id} moved ${pos(result.from)} → ${pos(result.to)}.` };
    case 'TURNED': {
      const dir = result.command?.kind === 'RIGHT' ? 'RIGHT' : 'LEFT';
      return { glyph: '↻', text: `${id} turned ${dir}, now facing ${result.facing}.` };
    }
    case 'BLOCKED': {
      const gotoNote = result.command?.kind === 'GOTO' ? ' Its GOTO stays queued.' : '';
      return {
        glyph: '✕',
        text: `${id} blocked at ${pos(result.from)}: ${blockReasonText(result, results)}.${gotoNote}`,
        ...(result.reason ? { code: result.reason } : {}),
      };
    }
    case 'WAITING':
      return {
        glyph: '…',
        text: `${id} waiting: no path to ${pos(gotoTarget(result))} this tick.`,
      };
    case 'UNREACHABLE':
      return {
        glyph: '!',
        text: `${id} gave up on GOTO ${pos(gotoTarget(result))}: no path for 3 ticks in a row. The GOTO was removed.`,
      };
    case 'ARRIVED':
      return {
        glyph: '◎',
        text: `${id} is already at ${pos(gotoTarget(result))}: GOTO complete.`,
      };
    case 'IDLE':
      return { glyph: '–', text: `${id} idle (nothing queued).` };
  }
}

/** The sentence without the leading robot id, capitalized, no final period (robot list "Last tick"). */
export function resultSentenceWithoutId(result: RobotTickResult, text: string): string {
  let rest = text.startsWith(`${result.id} `) ? text.slice(result.id.length + 1) : text;
  if (rest.endsWith('.')) {
    rest = rest.slice(0, -1);
  }
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export type OutcomeGroup =
  'moved' | 'turned' | 'blocked' | 'waiting' | 'unreachable' | 'arrived' | 'idle';

export function outcomeGroup(outcome: TickOutcome): OutcomeGroup {
  return outcome.toLowerCase() as OutcomeGroup;
}

export interface BadgeInfo {
  readonly text: string;
  readonly glyph: string;
  readonly group: OutcomeGroup;
  readonly reached: boolean;
}

const BLOCK_BADGE: Record<BlockReason, string> = {
  WALL: 'WL',
  OBSTACLE: 'OB',
  CONTESTED: 'CT',
  HEAD_ON: 'HO',
  OCCUPIED: 'OC',
  BEHIND_BLOCKED: 'BB',
};

/** Grid badge for a last-tick result; null for plain MOVED / TURNED / IDLE (no badge). */
export function badgeFor(result: RobotTickResult): BadgeInfo | null {
  switch (result.outcome) {
    case 'BLOCKED':
      return {
        text: result.reason ? BLOCK_BADGE[result.reason] : 'BL',
        glyph: '✕',
        group: 'blocked',
        reached: false,
      };
    case 'WAITING':
      return { text: 'WT', glyph: '…', group: 'waiting', reached: false };
    case 'UNREACHABLE':
      return { text: 'UN', glyph: '!', group: 'unreachable', reached: false };
    case 'ARRIVED':
      return { text: 'AR', glyph: '◎', group: 'arrived', reached: false };
    case 'MOVED':
      return result.reachedGoto ? { text: 'OK', glyph: '✓', group: 'moved', reached: true } : null;
    default:
      return null;
  }
}

const SHORT_REASON: Record<BlockReason, string> = {
  WALL: 'the floor edge',
  OBSTACLE: 'obstacle',
  CONTESTED: 'contested',
  HEAD_ON: 'head-on',
  OCCUPIED: 'occupied',
  BEHIND_BLOCKED: 'blocked behind',
};

/** Tail of a cell aria-label: "last tick: blocked by obstacle"; null when there is no badge. */
export function lastTickAria(result: RobotTickResult): string | null {
  switch (result.outcome) {
    case 'BLOCKED':
      return `last tick: blocked by ${result.reason ? SHORT_REASON[result.reason] : 'something'}`;
    case 'WAITING':
      return 'last tick: waiting';
    case 'UNREACHABLE':
      return 'last tick: unreachable';
    case 'ARRIVED':
      return 'last tick: arrived';
    case 'MOVED':
      return result.reachedGoto ? 'last tick: reached GOTO' : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Cell labels
// ---------------------------------------------------------------------------

export function cellAriaLabel(args: {
  x: number;
  y: number;
  obstacle: boolean;
  robot: Robot | undefined;
  selected: boolean;
  gotoOf: readonly string[];
  last: RobotTickResult | undefined;
}): string {
  const base = args.obstacle
    ? 'obstacle'
    : args.robot
      ? `robot ${args.robot.id} facing ${args.robot.facing}`
      : 'empty';
  const parts = [`Cell ${args.x},${args.y}: ${base}`];
  if (args.selected) {
    parts.push('selected');
  }
  if (args.gotoOf.length > 0) {
    parts.push(`GOTO target of ${args.gotoOf.join(' and ')}`);
  }
  const last = args.last ? lastTickAria(args.last) : null;
  if (last) {
    parts.push(last);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// History lines
// ---------------------------------------------------------------------------

export type LineType =
  | 'FLOOR_CREATED'
  | 'ROBOT_PLACED'
  | 'ROBOT_REMOVED'
  | 'OBSTACLE_SET'
  | 'COMMANDS_QUEUED'
  | 'QUEUE_CLEARED';

export interface EventLine {
  readonly type: LineType;
  readonly glyph: string;
  readonly text: string;
  readonly robot?: string;
}

/** Line for every WorldEvent except TICK_RESOLVED (those become groups). */
export function eventLine(event: Exclude<WorldEvent, { type: 'TICK_RESOLVED' }>): EventLine {
  switch (event.type) {
    case 'FLOOR_CREATED':
      return {
        type: 'FLOOR_CREATED',
        glyph: '▦',
        text: `New floor ${event.width}×${event.height} created. All robots, obstacles and queues were cleared.`,
      };
    case 'ROBOT_PLACED':
      return {
        type: 'ROBOT_PLACED',
        glyph: '+',
        robot: event.id,
        text: event.replaced
          ? `${event.id} moved to ${pos(event)} facing ${event.facing} by placement. Its queue was kept.`
          : `${event.id} placed at ${pos(event)} facing ${event.facing}.`,
      };
    case 'ROBOT_REMOVED':
      return { type: 'ROBOT_REMOVED', glyph: '−', robot: event.id, text: `${event.id} deleted.` };
    case 'OBSTACLE_SET':
      return {
        type: 'OBSTACLE_SET',
        glyph: event.present ? '■' : '□',
        text: event.present
          ? `Obstacle added at ${pos(event)}.`
          : `Obstacle removed at ${pos(event)}.`,
      };
    case 'COMMANDS_QUEUED':
      return {
        type: 'COMMANDS_QUEUED',
        glyph: '›',
        robot: event.id,
        text: `Queued for ${event.id}: ${event.commands.map(commandWord).join(', ')}.`,
      };
    case 'QUEUE_CLEARED':
      return {
        type: 'QUEUE_CLEARED',
        glyph: '✕',
        robot: event.id,
        text: `${event.id}'s queue cleared.`,
      };
  }
}

export interface TickCounts {
  readonly moved: number;
  readonly turned: number;
  readonly blocked: number;
  readonly waiting: number;
  readonly unreachable: number;
  readonly arrived: number;
  readonly idle: number;
}

export function countResults(results: readonly RobotTickResult[]): TickCounts {
  const c = { moved: 0, turned: 0, blocked: 0, waiting: 0, unreachable: 0, arrived: 0, idle: 0 };
  for (const r of results) {
    c[outcomeGroup(r.outcome)]++;
  }
  return c;
}

/** "Tick 12 - 2 moved, 1 turned, 1 blocked (3 idle hidden)" and its empty variants (7.3). */
export function tickSummary(
  tick: number,
  results: readonly RobotTickResult[],
  showIdle: boolean,
): string {
  if (results.length === 0) {
    return `Tick ${tick} - no robots on the floor`;
  }
  const c = countResults(results);
  const order: (keyof TickCounts)[] = [
    'moved',
    'turned',
    'blocked',
    'waiting',
    'unreachable',
    'arrived',
  ];
  const parts = order.filter((k) => c[k] > 0).map((k) => `${c[k]} ${k}`);
  if (showIdle && c.idle > 0) {
    parts.push(`${c.idle} idle`);
  }
  const hidden = !showIdle && c.idle > 0 ? ` (${c.idle} idle hidden)` : '';
  if (parts.length === 0) {
    return `Tick ${tick} - nothing happened${hidden}`;
  }
  return `Tick ${tick} - ${parts.join(', ')}${hidden}`;
}

// ---------------------------------------------------------------------------
// Toasts (5.5)
// ---------------------------------------------------------------------------

export type ClientReason =
  | 'NO_ROBOT_SELECTED'
  | 'OFFLINE'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'FLOOR_RESET'
  | 'ROBOT_REMOVED_REMOTE';

export type ToastReason = RejectionReason | ClientReason | (string & {});

export function rejectionMessage(
  reason: string,
  action: Action | null,
  serverMessage: string,
): string {
  switch (reason) {
    case 'INVALID_SIZE':
      return 'Floor size must be a whole number from 1 to 20 in each direction.';
    case 'INVALID_ID':
      return "That robot ID isn't valid. Robot IDs look like R1, R2, R3.";
    case 'OUT_OF_BOUNDS':
      return 'That cell is outside the floor.';
    case 'CELL_IS_OBSTACLE':
      return "There's an obstacle in that cell. Turn on Edit obstacles to remove it.";
    case 'CELL_OCCUPIED':
      return action && (action.type === 'TOGGLE_OBSTACLE' || action.type === 'SET_OBSTACLE')
        ? "Can't change an obstacle under a robot. Move or delete the robot first."
        : 'A robot is already in that cell.';
    case 'UNKNOWN_ROBOT':
      return 'That robot no longer exists. It may have been deleted in another window.';
    case 'INVALID_COMMAND':
      return "That command couldn't be queued.";
    case 'INVALID_GOTO_TARGET':
      return "GOTO needs a free cell on the floor. Obstacles and cells outside the floor aren't valid targets.";
    default:
      return `Couldn't do that: ${serverMessage}`;
  }
}

export const CLIENT_MESSAGES = {
  NO_ROBOT_SELECTED: 'Select a robot first, then Shift+click a cell to send it there.',
  OFFLINE: "You're offline. Changes are paused until the connection comes back.",
  NETWORK_ERROR: "Couldn't reach the server, so nothing was changed.",
  SERVER_ERROR: "The server couldn't process that request (unexpected error). Nothing was changed.",
} as const;

export const STALE_DETAIL = 'Your view was out of date and has been updated.';

export function floorResetMessage(width: number, height: number): string {
  return `The floor was reset to ${width}×${height}.`;
}

export function robotRemovedRemoteMessage(id: string): string {
  return `${id} was deleted.`;
}

// ---------------------------------------------------------------------------
// Live region (8)
// ---------------------------------------------------------------------------

const ANNOUNCE_BLOCK: Record<BlockReason, string> = {
  WALL: 'floor edge ahead',
  OBSTACLE: 'obstacle ahead',
  CONTESTED: 'contested cell',
  HEAD_ON: 'head-on',
  OCCUPIED: 'robot ahead',
  BEHIND_BLOCKED: 'blocked behind another robot',
};

/** One sentence for a manual Step: "Tick 12: R1 moved to 2,3. R2 blocked, obstacle ahead." */
export function announceTick(tick: number, results: readonly RobotTickResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    switch (r.outcome) {
      case 'MOVED':
        parts.push(`${r.id} moved to ${r.to.x},${r.to.y}${r.reachedGoto ? ', reached GOTO' : ''}.`);
        break;
      case 'TURNED':
        parts.push(`${r.id} turned, now facing ${r.facing}.`);
        break;
      case 'BLOCKED':
        parts.push(`${r.id} blocked, ${r.reason ? ANNOUNCE_BLOCK[r.reason] : 'in the way'}.`);
        break;
      case 'WAITING':
        parts.push(`${r.id} waiting for a path.`);
        break;
      case 'UNREACHABLE':
        parts.push(`${r.id} gave up on its GOTO.`);
        break;
      case 'ARRIVED':
        parts.push(`${r.id} arrived.`);
        break;
      case 'IDLE':
        break;
    }
  }
  return parts.length === 0
    ? `Tick ${tick}: nothing happened.`
    : `Tick ${tick}: ${parts.join(' ')}`;
}
