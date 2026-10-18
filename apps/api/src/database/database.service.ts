import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';

/** Injection token for the SQLite file path (or ':memory:'). */
export const DB_PATH = Symbol('DB_PATH');

export const IN_MEMORY_DB = ':memory:';

/**
 * Idempotent schema (DECISIONS 6.1). Every statement is IF NOT EXISTS, so running it on
 * every startup is safe and there is no separate migration history to maintain yet.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS floors (
  id             TEXT PRIMARY KEY,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  tick           INTEGER NOT NULL,
  version        INTEGER NOT NULL,
  next_robot_num INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS obstacles (
  floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  x        INTEGER NOT NULL,
  y        INTEGER NOT NULL,
  PRIMARY KEY (floor_id, x, y)
);

CREATE TABLE IF NOT EXISTS robots (
  floor_id           TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  id                 TEXT NOT NULL,
  num                INTEGER NOT NULL,
  x                  INTEGER NOT NULL,
  y                  INTEGER NOT NULL,
  facing             TEXT NOT NULL,
  goto_no_path_ticks INTEGER NOT NULL,
  PRIMARY KEY (floor_id, num)
);

CREATE TABLE IF NOT EXISTS queue_items (
  floor_id  TEXT NOT NULL,
  robot_num INTEGER NOT NULL,
  position  INTEGER NOT NULL,
  kind      TEXT NOT NULL,
  arg_x     INTEGER,
  arg_y     INTEGER,
  PRIMARY KEY (floor_id, robot_num, position),
  FOREIGN KEY (floor_id, robot_num) REFERENCES robots(floor_id, num) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS floor_snapshots (
  floor_id   TEXT PRIMARY KEY REFERENCES floors(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  state_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  floor_id    TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  action_json TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (floor_id, version)
);

CREATE TABLE IF NOT EXISTS events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  floor_id     TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  tick         INTEGER NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_floor_seq ON events (floor_id, seq);
`;

/** Opens (creating the parent directory for file paths) and migrates a database. */
export function openDatabase(path: string): Database.Database {
  const inMemory = path === IN_MEMORY_DB || path === '';
  if (!inMemory) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(inMemory ? IN_MEMORY_DB : path);
  db.pragma('foreign_keys = ON');
  if (!inMemory) {
    db.pragma('journal_mode = WAL');
  }
  db.exec(SCHEMA_SQL);
  return db;
}

/** Owns the connection for the lifetime of the Nest app; app.close() closes it. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Database.Database;

  constructor(@Inject(DB_PATH) path: string) {
    this.db = openDatabase(path);
  }

  onModuleDestroy(): void {
    if (this.db.open) {
      this.db.close();
    }
  }
}
