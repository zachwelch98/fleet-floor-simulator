import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { Action } from '@fleet/engine';
import type { CommandResponse, CommandSuccess, FloorDto, HistoryEntry } from '@fleet/protocol';
import { TickScheduler } from '../realtime/tick-scheduler.js';
import { FloorsService } from './floors.service.js';
import { parseAction } from './parse-action.js';

/** Query values arrive as strings; only plain non-negative decimal integers are accepted. */
function parseNonNegativeInt(name: string, raw: unknown): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) {
    throw new BadRequestException(`Query parameter "${name}" must be a non-negative integer`);
  }
  return Number(raw);
}

/** Global prefix '/api' is applied in createApp, so these routes are /api/floors/... */
@Controller('floors')
export class FloorsController {
  constructor(
    @Inject(FloorsService) private readonly floors: FloorsService,
    @Inject(TickScheduler) private readonly scheduler: TickScheduler,
  ) {}

  @Get(':id')
  getFloor(@Param('id') id: string): FloorDto {
    return this.floors.getFloor(id);
  }

  @Get(':id/history')
  history(
    @Param('id') id: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ): HistoryEntry[] {
    const afterSeq = parseNonNegativeInt('after', after);
    const limitCount = parseNonNegativeInt('limit', limit);
    return this.floors.history(id, {
      ...(afterSeq === undefined ? {} : { after: afterSeq }),
      ...(limitCount === undefined ? {} : { limit: limitCount }),
    });
  }

  @Post(':id/commands')
  @HttpCode(200)
  command(@Param('id') id: string, @Body() body: unknown): CommandSuccess {
    return orConflict(this.floors.execute(id, parseBody(body)));
  }

  @Post(':id/step')
  @HttpCode(200)
  step(@Param('id') id: string): CommandSuccess {
    return orConflict(this.floors.step(id));
  }

  /** Idempotent; session state only: no version bump, no history (DECISIONS 7.5). */
  @Post(':id/play')
  @HttpCode(200)
  play(@Param('id') id: string, @Body() body: unknown): FloorDto {
    this.floors.getFloor(id); // 404 before 400
    this.scheduler.play(id, parseIntervalMs(body));
    return this.floors.getFloor(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string): FloorDto {
    this.floors.getFloor(id);
    this.scheduler.pause(id);
    return this.floors.getFloor(id);
  }
}

/** PlayRequest body: absent/empty → undefined (keep the current interval); otherwise a number. */
function parseIntervalMs(body: unknown): number | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Body must be a JSON object like {"intervalMs": 500}');
  }
  const intervalMs = (body as Record<string, unknown>)['intervalMs'];
  if (intervalMs === undefined) {
    return undefined;
  }
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs)) {
    throw new BadRequestException('"intervalMs" must be a number');
  }
  return intervalMs;
}

/** Engine rejection → 409 with the CommandRejected body (reason, message, authoritative floor). */
function orConflict(result: CommandResponse): CommandSuccess {
  if (!result.ok) {
    throw new HttpException(result, HttpStatus.CONFLICT);
  }
  return result;
}

function parseBody(body: unknown): Action {
  const raw =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['action'] : null;
  const action = parseAction(raw);
  if (action === null) {
    throw new BadRequestException(
      'Body must be {"action": <Action>} with a known action type and correctly typed fields',
    );
  }
  return action;
}
