import { formatRobotId, parseRobotNum } from '../geometry.js';
import { FACINGS } from '../types.js';
import type { Action, Command, Facing, RobotId } from '../types.js';

/**
 * One parsed scenario line.
 * - `action`: an engine action to apply (FLOOR, OBSTACLE, PLACE, QUEUE).
 * - `tick`: advance N ticks (N >= 1).
 * - `report`: print positions.
 * - `skip`: blank line or comment.
 * - `invalid`: unparseable; the runner ignores it and keeps going.
 */
export type ScenarioLine =
  | { readonly kind: 'action'; readonly action: Action }
  | { readonly kind: 'tick'; readonly count: number }
  | { readonly kind: 'report' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'invalid'; readonly why: string };

const INTEGER = /^-?\d+$/;

function invalid(why: string): ScenarioLine {
  return { kind: 'invalid', why };
}

/** Integer token (negatives allowed; the engine rejects them as out of bounds). */
function parseInt10(token: string): number | null {
  if (!INTEGER.test(token)) return null;
  const n = Number(token);
  if (!Number.isSafeInteger(n)) return null;
  return n === 0 ? 0 : n; // normalize "-0"
}

/** "X,Y" (already upper-cased, spaces around commas already removed). */
function parsePair(token: string): { x: number; y: number } | null {
  const parts = token.split(',');
  if (parts.length !== 2) return null;
  const x = parseInt10(parts[0] ?? '');
  const y = parseInt10(parts[1] ?? '');
  if (x === null || y === null) return null;
  return { x, y };
}

function parseRobotId(token: string): RobotId | null {
  const num = parseRobotNum(token);
  return num === null ? null : formatRobotId(num);
}

function parseFacing(token: string): Facing | null {
  return FACINGS.find((f) => f === token) ?? null;
}

/**
 * Pure, case-insensitive parser for a single line. Owner: Dev 2.
 * Rules: DECISIONS.md section 4 (whitespace, comma spacing, ID normalization,
 * integer-only coordinates, all-or-nothing QUEUE lines).
 */
export function parseScenarioLine(line: string): ScenarioLine {
  const text = line.trim();
  if (text === '' || text.startsWith('#')) return { kind: 'skip' };

  // Tolerate spaces around commas, then split on runs of whitespace.
  const tokens = text.toUpperCase().replace(/\s*,\s*/g, ',').split(/\s+/);
  const keyword = tokens[0];
  const args = tokens.slice(1);

  switch (keyword) {
    case 'FLOOR': {
      if (args.length !== 1) return invalid('FLOOR expects W,H');
      const size = parsePair(args[0] ?? '');
      if (!size) return invalid('FLOOR size must be two integers');
      return { kind: 'action', action: { type: 'CREATE_FLOOR', width: size.x, height: size.y } };
    }
    case 'OBSTACLE': {
      if (args.length !== 1) return invalid('OBSTACLE expects X,Y');
      const cell = parsePair(args[0] ?? '');
      if (!cell) return invalid('OBSTACLE coordinates must be two integers');
      return { kind: 'action', action: { type: 'SET_OBSTACLE', x: cell.x, y: cell.y, present: true } };
    }
    case 'PLACE': {
      if (args.length !== 2) return invalid('PLACE expects Rn X,Y,FACING');
      const id = parseRobotId(args[0] ?? '');
      if (id === null) return invalid('bad robot id');
      const parts = (args[1] ?? '').split(',');
      if (parts.length !== 3) return invalid('PLACE expects X,Y,FACING');
      const x = parseInt10(parts[0] ?? '');
      const y = parseInt10(parts[1] ?? '');
      if (x === null || y === null) return invalid('PLACE coordinates must be integers');
      const facing = parseFacing(parts[2] ?? '');
      if (facing === null) return invalid('bad facing');
      return { kind: 'action', action: { type: 'PLACE_ROBOT', id, x, y, facing } };
    }
    case 'QUEUE': {
      if (args.length < 2) return invalid('QUEUE expects Rn and at least one command');
      const id = parseRobotId(args[0] ?? '');
      if (id === null) return invalid('bad robot id');
      const commands: Command[] = [];
      for (let i = 1; i < args.length; i++) {
        const token = args[i];
        if (token === 'MOVE' || token === 'LEFT' || token === 'RIGHT') {
          commands.push({ kind: token });
        } else if (token === 'GOTO') {
          const target = parsePair(args[i + 1] ?? '');
          if (!target) return invalid('GOTO expects X,Y');
          commands.push({ kind: 'GOTO', x: target.x, y: target.y });
          i++; // consume the coordinate token
        } else {
          return invalid(`unknown command ${token ?? ''}`);
        }
      }
      return { kind: 'action', action: { type: 'QUEUE_COMMANDS', id, commands } };
    }
    case 'TICK': {
      if (args.length === 0) return { kind: 'tick', count: 1 };
      if (args.length > 1) return invalid('TICK takes at most one argument');
      const count = parseInt10(args[0] ?? '');
      if (count === null || count < 1) return invalid('TICK count must be a positive integer');
      return { kind: 'tick', count };
    }
    case 'REPORT':
      return args.length === 0 ? { kind: 'report' } : invalid('REPORT takes no arguments');
    default:
      return invalid('unknown keyword');
  }
}
