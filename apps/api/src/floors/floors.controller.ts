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
  constructor(@Inject(FloorsService) private readonly floors: FloorsService) {}

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
