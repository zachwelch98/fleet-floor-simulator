import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@fleet/protocol';
import { AppModule } from './app.module.js';
import type { TickTimer } from './tick-timer.js';

/**
 * Contract between Dev 2 (implements) and the Tester (uses in integration tests).
 * Owner: Dev 2. Changes go through the PM.
 */
export interface AppOptions {
  /** SQLite file path, or ':memory:' for tests. */
  readonly dbPath: string;
  /** Clock for HistoryEntry.at timestamps. Defaults to () => new Date(). Tests inject a fixed clock. */
  readonly now?: () => Date;
  /**
   * Timer behind Play (one interval per playing floor). Defaults to `realTickTimer`. Tests inject a
   * `ManualTickTimer` (apps/api/src/tick-timer.ts) and call `fire()` instead of waiting.
   * Phase 3: Dev 2 wires this into AppModule.register and the TickScheduler.
   */
  readonly timer?: TickTimer;
}

/** The dev UI (ng serve) origin allowed by CORS. */
export const DEV_UI_ORIGIN = 'http://localhost:4200';

/**
 * Builds a fully configured, initialized Nest app (global '/api' prefix, routes per
 * @fleet/protocol, default floor 'main' created at 10x8 if the database has none).
 * Does NOT call listen(); tests use `supertest(app.getHttpServer())`, main.ts calls listen().
 */
export async function createApp(options: AppOptions): Promise<INestApplication> {
  const app = await NestFactory.create(
    AppModule.register({ dbPath: options.dbPath, now: options.now ?? (() => new Date()) }),
    { logger: ['error', 'warn'] },
  );
  // API_PREFIX is '/api'; Nest wants it without the leading slash.
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.enableCors({ origin: DEV_UI_ORIGIN });
  await app.init();
  return app;
}
