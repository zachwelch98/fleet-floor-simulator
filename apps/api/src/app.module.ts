import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DB_PATH, DatabaseService } from './database/database.service.js';
import { FloorRepository } from './floors/floor.repository.js';
import { FloorsController } from './floors/floors.controller.js';
import { CLOCK, FloorsService } from './floors/floors.service.js';
import type { Clock } from './floors/floors.service.js';
import { FloorGateway } from './realtime/floor.gateway.js';
import { PlaybackState } from './realtime/playback-state.js';
import { TICK_TIMER, TickScheduler } from './realtime/tick-scheduler.js';
import type { TickTimer } from './tick-timer.js';

export interface AppModuleOptions {
  readonly dbPath: string;
  readonly now: Clock;
  readonly timer: TickTimer;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [FloorsController],
      providers: [
        { provide: DB_PATH, useValue: options.dbPath },
        { provide: CLOCK, useValue: options.now },
        { provide: TICK_TIMER, useValue: options.timer },
        DatabaseService,
        FloorRepository,
        PlaybackState,
        FloorsService,
        TickScheduler,
        FloorGateway,
      ],
      exports: [FloorsService],
    };
  }
}
