import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DB_PATH, DatabaseService } from './database/database.service.js';
import { FloorRepository } from './floors/floor.repository.js';
import { FloorsController } from './floors/floors.controller.js';
import { CLOCK, FloorsService } from './floors/floors.service.js';
import type { Clock } from './floors/floors.service.js';

export interface AppModuleOptions {
  readonly dbPath: string;
  readonly now: Clock;
}

@Module({})
export class AppModule {
  /**
   * Phase 3 adds TickScheduler and FloorGateway to `providers`; both can inject FloorsService
   * (call `step`, subscribe to `committed`).
   */
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [FloorsController],
      providers: [
        { provide: DB_PATH, useValue: options.dbPath },
        { provide: CLOCK, useValue: options.now },
        DatabaseService,
        FloorRepository,
        FloorsService,
      ],
      exports: [FloorsService],
    };
  }
}
