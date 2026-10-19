import { describe, expect, it } from 'vitest';
import { tickResult } from '../testing/mocks';
import {
  badgeFor,
  cellAriaLabel,
  eventLine,
  rejectionMessage,
  resultLine,
  resultSentenceWithoutId,
} from './copy';

describe('resultLine', () => {
  it('describes an obstacle block with the attempted cell and keeps the code separate', () => {
    const r = tickResult('R2', {
      outcome: 'BLOCKED',
      reason: 'OBSTACLE',
      from: { x: 3, y: 4 },
      to: { x: 3, y: 4 },
      facing: 'NORTH',
    });
    const line = resultLine(r, [r]);
    expect(line.text).toBe('R2 blocked at (3,4): obstacle at (3,5).');
    expect(line.code).toBe('OBSTACLE');
    expect(resultSentenceWithoutId(r, line.text)).toBe('Blocked at (3,4): obstacle at (3,5)');
  });

  it('names the blocker robot from the same tick, and falls back without one', () => {
    const r3 = tickResult('R3', {
      outcome: 'BLOCKED',
      reason: 'OCCUPIED',
      from: { x: 1, y: 1 },
      to: { x: 1, y: 1 },
      facing: 'NORTH',
    });
    const r1 = tickResult('R1', {
      outcome: 'IDLE',
      from: { x: 1, y: 2 },
      to: { x: 1, y: 2 },
    });
    expect(resultLine(r3, [r1, r3]).text).toBe(
      "R3 blocked at (1,1): R1 is standing at (1,2) and didn't move.",
    );
    expect(resultLine(r3, [r3]).text).toBe(
      "R3 blocked at (1,1): a robot is standing at (1,2) and didn't move.",
    );
  });

  it('adds the GOTO note, and covers moves, turns, waiting, giving up, arrival and idle', () => {
    const blockedGoto = tickResult('R1', {
      outcome: 'BLOCKED',
      reason: 'CONTESTED',
      command: { kind: 'GOTO', x: 5, y: 5 },
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      facing: 'EAST',
    });
    expect(resultLine(blockedGoto, [blockedGoto]).text).toBe(
      'R1 blocked at (0,0): a lower-numbered robot also wants (1,0) and has priority. Its GOTO stays queued.',
    );
    const goto = { kind: 'GOTO', x: 4, y: 4 } as const;
    expect(
      resultLine(
        tickResult('R1', { outcome: 'MOVED', from: { x: 2, y: 2 }, to: { x: 2, y: 3 } }),
        [],
      ).text,
    ).toBe('R1 moved (2,2) → (2,3).');
    expect(
      resultLine(
        tickResult('R1', {
          outcome: 'MOVED',
          reachedGoto: true,
          from: { x: 2, y: 2 },
          to: { x: 2, y: 3 },
        }),
        [],
      ).text,
    ).toBe('R1 moved (2,2) → (2,3) and reached its GOTO target.');
    expect(
      resultLine(
        tickResult('R1', { outcome: 'TURNED', command: { kind: 'RIGHT' }, facing: 'EAST' }),
        [],
      ).text,
    ).toBe('R1 turned RIGHT, now facing EAST.');
    expect(resultLine(tickResult('R1', { outcome: 'WAITING', command: goto }), []).text).toBe(
      'R1 waiting: no path to (4,4) this tick.',
    );
    expect(resultLine(tickResult('R1', { outcome: 'UNREACHABLE', command: goto }), []).text).toBe(
      'R1 gave up on GOTO (4,4): no path for 3 ticks in a row. The GOTO was removed.',
    );
    expect(resultLine(tickResult('R1', { outcome: 'ARRIVED', command: goto }), []).text).toBe(
      'R1 is already at (4,4): GOTO complete.',
    );
    expect(resultLine(tickResult('R1', { outcome: 'IDLE' }), []).text).toBe(
      'R1 idle (nothing queued).',
    );
  });
});

describe('badgeFor', () => {
  it('only badges noteworthy outcomes', () => {
    expect(badgeFor(tickResult('R1', { outcome: 'BLOCKED', reason: 'HEAD_ON' }))?.text).toBe('HO');
    expect(badgeFor(tickResult('R1', { outcome: 'WAITING' }))?.text).toBe('WT');
    expect(badgeFor(tickResult('R1', { outcome: 'UNREACHABLE' }))?.text).toBe('UN');
    expect(badgeFor(tickResult('R1', { outcome: 'ARRIVED' }))?.text).toBe('AR');
    expect(badgeFor(tickResult('R1', { outcome: 'MOVED', reachedGoto: true }))).toMatchObject({
      text: 'OK',
      reached: true,
    });
    expect(badgeFor(tickResult('R1', { outcome: 'MOVED' }))).toBeNull();
    expect(badgeFor(tickResult('R1', { outcome: 'TURNED' }))).toBeNull();
    expect(badgeFor(tickResult('R1', { outcome: 'IDLE' }))).toBeNull();
  });
});

describe('copy', () => {
  it('builds cell aria labels in the documented order', () => {
    expect(
      cellAriaLabel({
        x: 3,
        y: 4,
        obstacle: false,
        robot: {
          id: 'R2',
          num: 2,
          x: 3,
          y: 4,
          facing: 'EAST',
          queue: [],
          gotoNoPathTicks: 0,
        },
        selected: true,
        gotoOf: ['R1', 'R3'],
        last: tickResult('R2', { outcome: 'BLOCKED', reason: 'OBSTACLE' }),
      }),
    ).toBe(
      'Cell 3,4: robot R2 facing EAST, selected, GOTO target of R1 and R3, last tick: blocked by obstacle',
    );
    expect(
      cellAriaLabel({
        x: 0,
        y: 0,
        obstacle: true,
        robot: undefined,
        selected: false,
        gotoOf: [],
        last: undefined,
      }),
    ).toBe('Cell 0,0: obstacle');
  });

  it('writes history lines', () => {
    expect(
      eventLine({
        type: 'COMMANDS_QUEUED',
        id: 'R1',
        commands: [{ kind: 'MOVE' }, { kind: 'GOTO', x: 3, y: 4 }],
      }).text,
    ).toBe('Queued for R1: MOVE, GOTO 3,4.');
    expect(eventLine({ type: 'FLOOR_CREATED', width: 10, height: 8 }).text).toBe(
      'New floor 10×8 created. All robots, obstacles and queues were cleared.',
    );
    expect(
      eventLine({ type: 'ROBOT_PLACED', id: 'R2', x: 1, y: 2, facing: 'WEST', replaced: true })
        .text,
    ).toBe('R2 moved to (1,2) facing WEST by placement. Its queue was kept.');
  });

  it('picks rejection copy by reason and action', () => {
    expect(rejectionMessage('UNKNOWN_ROBOT', null, 'x')).toBe(
      'That robot no longer exists. It may have been deleted in another window.',
    );
    expect(rejectionMessage('NEW_REASON', null, 'boom')).toBe("Couldn't do that: boom");
  });
});
