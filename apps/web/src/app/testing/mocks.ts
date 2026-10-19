/** Test doubles and builders. Only imported by *.spec.ts; excluded from the app build. */
import { vi } from 'vitest';
import type { Action, Facing, FloorState, Robot, RobotTickResult, WorldEvent } from '@fleet/engine';
import type { FloorDto, HistoryEntry } from '@fleet/protocol';
import type {
  CommandOutcome,
  FloorApi,
  FloorSocket,
  HistoryQuery,
  SocketHandlers,
} from '../core/transport';

export function robot(id: string, x: number, y: number, over: Partial<Robot> = {}): Robot {
  return {
    id,
    num: Number(id.slice(1)),
    x,
    y,
    facing: 'NORTH' as Facing,
    queue: [],
    gotoNoPathTicks: 0,
    ...over,
  };
}

export function floorState(over: Partial<FloorState> = {}): FloorState {
  return {
    width: 10,
    height: 8,
    obstacles: [],
    robots: [],
    nextRobotNum: 1,
    tick: 0,
    ...over,
  };
}

export function floorDto(over: Partial<FloorDto> = {}): FloorDto {
  return {
    id: 'main',
    version: 1,
    state: floorState(),
    playing: false,
    intervalMs: 500,
    ...over,
  };
}

export function entry(seq: number, event: WorldEvent, tick = 0): HistoryEntry {
  return {
    seq,
    floorId: 'main',
    version: seq,
    tick,
    event,
    at: '2026-10-18T12:00:00.000Z',
  };
}

export function tickResult(
  id: string,
  over: Partial<RobotTickResult> & Pick<RobotTickResult, 'outcome'>,
): RobotTickResult {
  return {
    id,
    command: null,
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    facing: 'NORTH',
    ...over,
  };
}

export class MockApi implements FloorApi {
  getFloor = vi.fn<() => Promise<FloorDto>>();
  getHistory = vi.fn<(q: HistoryQuery) => Promise<HistoryEntry[]>>();
  sendAction = vi.fn<(a: Action) => Promise<CommandOutcome>>();
  step = vi.fn<() => Promise<CommandOutcome>>();
  play = vi.fn<(ms?: number) => Promise<FloorDto>>();
  pause = vi.fn<() => Promise<FloorDto>>();
}

export class MockSocket implements FloorSocket {
  handlers!: SocketHandlers;
  connect = vi.fn((handlers: SocketHandlers) => {
    this.handlers = handlers;
  });
  join = vi.fn(async (): Promise<FloorDto | null> => null);
  reconnect = vi.fn();
  close = vi.fn();
}

/** Resolve pending microtasks and promise chains. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
