import type { INestApplication } from '@nestjs/common';

/**
 * Contract between Dev 2 (implements) and the Tester (uses in integration tests).
 * Owner: Dev 2. Changes go through the PM.
 */
export interface AppOptions {
  /** SQLite file path, or ':memory:' for tests. */
  readonly dbPath: string;
  /** Clock for HistoryEntry.at timestamps. Defaults to () => new Date(). Tests inject a fixed clock. */
  readonly now?: () => Date;
}

/**
 * Builds a fully configured, initialized Nest app (global '/api' prefix, routes per
 * @fleet/protocol, default floor 'main' created at 10x8 if the database has none).
 * Does NOT call listen(); tests use `supertest(app.getHttpServer())`, main.ts calls listen().
 */
export async function createApp(_options: AppOptions): Promise<INestApplication> {
  throw new Error('createApp: not implemented');
}
