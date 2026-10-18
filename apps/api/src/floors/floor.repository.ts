import { Inject, Injectable } from '@nestjs/common';
import type { Action, Command, Facing, FloorState, Robot, WorldEvent } from '@fleet/engine';
import { HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT } from '@fleet/protocol';
import type { HistoryEntry } from '@fleet/protocol';
import { DatabaseService } from '../database/database.service.js';

/** A floor's state together with the version it was committed at. */
export interface LoadedFloor {
  readonly state: FloorState;
  readonly version: number;
}

export interface HistoryQuery {
  /** Return entries with seq > after (oldest first). Omit for the newest `limit` entries. */
  readonly after?: number;
  /** Clamped to [1, HISTORY_MAX_LIMIT]; defaults to HISTORY_DEFAULT_LIMIT. */
  readonly limit?: number;
}

/** Thrown inside the commit transaction when another commit got there first. */
export class VersionConflictError extends Error {
  constructor(
    readonly floorId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Floor "${floorId}" is at version ${actualVersion}, expected ${expectedVersion} (concurrent commit)`,
    );
    this.name = 'VersionConflictError';
  }
}

interface FloorRow {
  width: number;
  height: number;
  tick: number;
  version: number;
  next_robot_num: number;
}
interface RobotRow {
  id: string;
  num: number;
  x: number;
  y: number;
  facing: string;
  goto_no_path_ticks: number;
}
interface QueueRow {
  robot_num: number;
  kind: string;
  arg_x: number | null;
  arg_y: number | null;
}
interface EventRow {
  seq: number;
  floor_id: string;
  version: number;
  tick: number;
  payload_json: string;
  created_at: string;
}

function toEntry(row: EventRow): HistoryEntry {
  return {
    seq: row.seq,
    floorId: row.floor_id,
    version: row.version,
    tick: row.tick,
    event: JSON.parse(row.payload_json) as WorldEvent,
    at: row.created_at,
  };
}

function clampLimit(limit: number | undefined): number {
  const wanted = limit ?? HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(wanted), 1), HISTORY_MAX_LIMIT);
}

/**
 * All SQL lives here. Everything is synchronous (better-sqlite3), so a load followed by a
 * commit with no `await` in between is atomic with respect to every other request.
 */
@Injectable()
export class FloorRepository {
  private readonly db;
  private readonly stmts;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.db = database.db;
    const db = this.db;
    this.stmts = {
      floor: db.prepare(
        'SELECT width, height, tick, version, next_robot_num FROM floors WHERE id = ?',
      ),
      version: db.prepare('SELECT version FROM floors WHERE id = ?'),
      obstacles: db.prepare('SELECT x, y FROM obstacles WHERE floor_id = ? ORDER BY x, y'),
      robots: db.prepare(
        'SELECT id, num, x, y, facing, goto_no_path_ticks FROM robots WHERE floor_id = ? ORDER BY num',
      ),
      queue: db.prepare(
        'SELECT robot_num, kind, arg_x, arg_y FROM queue_items WHERE floor_id = ? ORDER BY robot_num, position',
      ),
      snapshot: db.prepare('SELECT state_json FROM floor_snapshots WHERE floor_id = ?'),
      actions: db.prepare('SELECT action_json FROM actions WHERE floor_id = ? ORDER BY version'),
      upsertFloor: db.prepare(
        `INSERT INTO floors (id, width, height, tick, version, next_robot_num, created_at)
         VALUES (@id, @width, @height, @tick, @version, @nextRobotNum, @at)
         ON CONFLICT (id) DO UPDATE SET width = excluded.width, height = excluded.height,
           tick = excluded.tick, version = excluded.version, next_robot_num = excluded.next_robot_num`,
      ),
      delObstacles: db.prepare('DELETE FROM obstacles WHERE floor_id = ?'),
      delQueue: db.prepare('DELETE FROM queue_items WHERE floor_id = ?'),
      delRobots: db.prepare('DELETE FROM robots WHERE floor_id = ?'),
      insObstacle: db.prepare('INSERT INTO obstacles (floor_id, x, y) VALUES (?, ?, ?)'),
      insRobot: db.prepare(
        'INSERT INTO robots (floor_id, id, num, x, y, facing, goto_no_path_ticks) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),
      insQueue: db.prepare(
        'INSERT INTO queue_items (floor_id, robot_num, position, kind, arg_x, arg_y) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      upsertSnapshot: db.prepare(
        `INSERT INTO floor_snapshots (floor_id, version, state_json) VALUES (?, ?, ?)
         ON CONFLICT (floor_id) DO UPDATE SET version = excluded.version, state_json = excluded.state_json`,
      ),
      insAction: db.prepare(
        'INSERT INTO actions (floor_id, version, action_json, created_at) VALUES (?, ?, ?, ?)',
      ),
      insEvent: db.prepare(
        'INSERT INTO events (floor_id, version, tick, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      historyAfter: db.prepare(
        'SELECT seq, floor_id, version, tick, payload_json, created_at FROM events WHERE floor_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
      ),
      historyNewest: db.prepare(
        'SELECT seq, floor_id, version, tick, payload_json, created_at FROM events WHERE floor_id = ? ORDER BY seq DESC LIMIT ?',
      ),
    };
  }

  exists(floorId: string): boolean {
    return this.stmts.version.get(floorId) !== undefined;
  }

  /** Rebuilds the state from the normalized tables (canonical order), or null if unknown. */
  loadState(floorId: string): LoadedFloor | null {
    const floor = this.stmts.floor.get(floorId) as FloorRow | undefined;
    if (floor === undefined) {
      return null;
    }
    const obstacles = (this.stmts.obstacles.all(floorId) as { x: number; y: number }[]).map(
      (row) => ({ x: row.x, y: row.y }),
    );

    const queues = new Map<number, Command[]>();
    for (const row of this.stmts.queue.all(floorId) as QueueRow[]) {
      const command: Command =
        row.kind === 'GOTO'
          ? { kind: 'GOTO', x: row.arg_x as number, y: row.arg_y as number }
          : { kind: row.kind as 'MOVE' | 'LEFT' | 'RIGHT' };
      const list = queues.get(row.robot_num);
      if (list === undefined) {
        queues.set(row.robot_num, [command]);
      } else {
        list.push(command);
      }
    }

    const robots: Robot[] = (this.stmts.robots.all(floorId) as RobotRow[]).map((row) => ({
      id: row.id,
      num: row.num,
      x: row.x,
      y: row.y,
      facing: row.facing as Facing,
      queue: queues.get(row.num) ?? [],
      gotoNoPathTicks: row.goto_no_path_ticks,
    }));

    return {
      version: floor.version,
      state: {
        width: floor.width,
        height: floor.height,
        obstacles,
        robots,
        nextRobotNum: floor.next_robot_num,
        tick: floor.tick,
      },
    };
  }

  /** The latest stored snapshot (parsed), or null. For consistency checks. */
  loadSnapshot(floorId: string): FloorState | null {
    const row = this.stmts.snapshot.get(floorId) as { state_json: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.state_json) as FloorState);
  }

  /** Every accepted action for the floor in version order. For replay checks. */
  loadActions(floorId: string): Action[] {
    return (this.stmts.actions.all(floorId) as { action_json: string }[]).map(
      (row) => JSON.parse(row.action_json) as Action,
    );
  }

  /**
   * Atomically stores one accepted action: rewrites the floor's normalized rows, upserts the
   * snapshot, appends the action and its events, and bumps the version to expectedVersion + 1.
   * `expectedVersion` 0 means "floor does not exist yet". Throws VersionConflictError (and
   * writes nothing) if the stored version differs.
   */
  commit(
    floorId: string,
    expectedVersion: number,
    action: Action,
    newState: FloorState,
    events: readonly WorldEvent[],
    at: Date,
  ): HistoryEntry[] {
    return this.db.transaction((): HistoryEntry[] => {
      const row = this.stmts.version.get(floorId) as { version: number } | undefined;
      const actual = row?.version ?? 0;
      if (actual !== expectedVersion) {
        throw new VersionConflictError(floorId, expectedVersion, actual);
      }
      const version = expectedVersion + 1;
      const iso = at.toISOString();

      this.stmts.upsertFloor.run({
        id: floorId,
        width: newState.width,
        height: newState.height,
        tick: newState.tick,
        version,
        nextRobotNum: newState.nextRobotNum,
        at: iso,
      });

      this.stmts.delQueue.run(floorId);
      this.stmts.delRobots.run(floorId);
      this.stmts.delObstacles.run(floorId);
      for (const obstacle of newState.obstacles) {
        this.stmts.insObstacle.run(floorId, obstacle.x, obstacle.y);
      }
      for (const robot of newState.robots) {
        this.stmts.insRobot.run(
          floorId,
          robot.id,
          robot.num,
          robot.x,
          robot.y,
          robot.facing,
          robot.gotoNoPathTicks,
        );
        robot.queue.forEach((command, position) => {
          const isGoto = command.kind === 'GOTO';
          this.stmts.insQueue.run(
            floorId,
            robot.num,
            position,
            command.kind,
            isGoto ? command.x : null,
            isGoto ? command.y : null,
          );
        });
      }

      this.stmts.upsertSnapshot.run(floorId, version, JSON.stringify(newState));
      this.stmts.insAction.run(floorId, version, JSON.stringify(action), iso);

      const entries: HistoryEntry[] = [];
      for (const event of events) {
        const result = this.stmts.insEvent.run(
          floorId,
          version,
          newState.tick,
          event.type,
          JSON.stringify(event),
          iso,
        );
        entries.push({
          seq: Number(result.lastInsertRowid),
          floorId,
          version,
          tick: newState.tick,
          event,
          at: iso,
        });
      }
      return entries;
    })();
  }

  /** History per the protocol comment: ascending seq; without `after`, the newest `limit`. */
  history(floorId: string, query: HistoryQuery = {}): HistoryEntry[] {
    const limit = clampLimit(query.limit);
    if (query.after !== undefined) {
      return (this.stmts.historyAfter.all(floorId, query.after, limit) as EventRow[]).map(toEntry);
    }
    const newest = (this.stmts.historyNewest.all(floorId, limit) as EventRow[]).map(toEntry);
    return newest.reverse();
  }
}
