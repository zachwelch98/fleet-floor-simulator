import { FACINGS } from '@fleet/engine';
import type { Action, Command, Facing } from '@fleet/engine';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && (FACINGS as readonly string[]).includes(value);
}

function parseCommand(raw: unknown): Command | null {
  if (!isObject(raw)) {
    return null;
  }
  switch (raw['kind']) {
    case 'MOVE':
    case 'LEFT':
    case 'RIGHT':
      return { kind: raw['kind'] };
    case 'GOTO':
      return isNumber(raw['x']) && isNumber(raw['y'])
        ? { kind: 'GOTO', x: raw['x'], y: raw['y'] }
        : null;
    default:
      // A well-formed object with an unknown kind is a semantic error: the engine rejects it
      // as INVALID_COMMAND (409). Anything without a string `kind` is a shape error (400).
      return typeof raw['kind'] === 'string' ? ({ kind: raw['kind'] } as unknown as Command) : null;
  }
}

function parseCommands(raw: unknown): Command[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const commands: Command[] = [];
  for (const item of raw) {
    const command = parseCommand(item);
    if (command === null) {
      return null;
    }
    commands.push(command);
  }
  return commands;
}

/**
 * Validates the *shape* of an untrusted action (right type tag, right field types) and returns
 * a clean copy, or null if malformed. Unknown extra keys are dropped. Values are not judged:
 * out-of-range sizes or coordinates, malformed robot IDs, empty command lists and unknown
 * command kinds are the engine's call and come back as 409 rejections with a reason.
 */
export function parseAction(raw: unknown): Action | null {
  if (!isObject(raw)) {
    return null;
  }
  switch (raw['type']) {
    case 'CREATE_FLOOR':
      return isNumber(raw['width']) && isNumber(raw['height'])
        ? { type: 'CREATE_FLOOR', width: raw['width'], height: raw['height'] }
        : null;
    case 'PLACE_ROBOT': {
      const { id, x, y, facing } = raw;
      if (!isNumber(x) || !isNumber(y) || !isFacing(facing)) {
        return null;
      }
      if (id === undefined) {
        return { type: 'PLACE_ROBOT', x, y, facing };
      }
      return typeof id === 'string' ? { type: 'PLACE_ROBOT', id, x, y, facing } : null;
    }
    case 'REMOVE_ROBOT':
      return typeof raw['id'] === 'string' ? { type: 'REMOVE_ROBOT', id: raw['id'] } : null;
    case 'SET_OBSTACLE':
      return isNumber(raw['x']) && isNumber(raw['y']) && typeof raw['present'] === 'boolean'
        ? { type: 'SET_OBSTACLE', x: raw['x'], y: raw['y'], present: raw['present'] }
        : null;
    case 'TOGGLE_OBSTACLE':
      return isNumber(raw['x']) && isNumber(raw['y'])
        ? { type: 'TOGGLE_OBSTACLE', x: raw['x'], y: raw['y'] }
        : null;
    case 'QUEUE_COMMANDS': {
      const commands = parseCommands(raw['commands']);
      return typeof raw['id'] === 'string' && commands !== null
        ? { type: 'QUEUE_COMMANDS', id: raw['id'], commands }
        : null;
    }
    case 'CLEAR_QUEUE':
      return typeof raw['id'] === 'string' ? { type: 'CLEAR_QUEUE', id: raw['id'] } : null;
    case 'TICK':
      return { type: 'TICK' };
    default:
      return null;
  }
}
