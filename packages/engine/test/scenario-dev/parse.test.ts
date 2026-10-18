import { describe, expect, it } from 'vitest';
import { parseScenarioLine } from '../../src/scenario/parse.js';
import type { Action } from '../../src/types.js';

function action(line: string): Action {
  const parsed = parseScenarioLine(line);
  if (parsed.kind !== 'action')
    throw new Error(`expected action for "${line}", got ${parsed.kind}`);
  return parsed.action;
}

function isInvalid(line: string): boolean {
  return parseScenarioLine(line).kind === 'invalid';
}

describe('skip lines', () => {
  it.each(['', '   ', '\t', '# comment', '   # indented comment', '#PLACE R1 0,0,NORTH', '#'])(
    'skips %j',
    (line) => {
      expect(parseScenarioLine(line)).toEqual({ kind: 'skip' });
    },
  );
});

describe('FLOOR', () => {
  it('parses W,H into CREATE_FLOOR', () => {
    expect(action('FLOOR 4,3')).toEqual({ type: 'CREATE_FLOOR', width: 4, height: 3 });
  });
  it('is case-insensitive and tolerates whitespace', () => {
    expect(action('  floor   4 ,  3  ')).toEqual({ type: 'CREATE_FLOOR', width: 4, height: 3 });
    expect(action('FlOoR 4, 3')).toEqual({ type: 'CREATE_FLOOR', width: 4, height: 3 });
    expect(action('FLOOR\t4,3')).toEqual({ type: 'CREATE_FLOOR', width: 4, height: 3 });
  });
  it('leaves size-range validation to the engine', () => {
    expect(action('FLOOR 0,5')).toEqual({ type: 'CREATE_FLOOR', width: 0, height: 5 });
    expect(action('FLOOR 21,5')).toEqual({ type: 'CREATE_FLOOR', width: 21, height: 5 });
    expect(action('FLOOR -1,5')).toEqual({ type: 'CREATE_FLOOR', width: -1, height: 5 });
  });
  it.each([
    'FLOOR',
    'FLOOR 4',
    'FLOOR 4,',
    'FLOOR ,3',
    'FLOOR 4,3,2',
    'FLOOR 4 3',
    'FLOOR a,b',
    'FLOOR 1.5,3',
    'FLOOR 4,3x',
    'FLOOR 4,3 5,5',
  ])('rejects %j', (line) => {
    expect(isInvalid(line)).toBe(true);
  });
});

describe('OBSTACLE', () => {
  it('parses X,Y into SET_OBSTACLE present:true', () => {
    expect(action('OBSTACLE 2,3')).toEqual({ type: 'SET_OBSTACLE', x: 2, y: 3, present: true });
    expect(action('obstacle 2 , 3')).toEqual({ type: 'SET_OBSTACLE', x: 2, y: 3, present: true });
  });
  it('lets negative integers through (engine rejects them as OUT_OF_BOUNDS)', () => {
    expect(action('OBSTACLE -1,-2')).toEqual({ type: 'SET_OBSTACLE', x: -1, y: -2, present: true });
  });
  it('normalizes -0 to 0', () => {
    const a = action('OBSTACLE -0,0');
    expect(a).toEqual({ type: 'SET_OBSTACLE', x: 0, y: 0, present: true });
    expect(Object.is((a as { x: number }).x, 0)).toBe(true);
  });
  it.each([
    'OBSTACLE',
    'OBSTACLE 1',
    'OBSTACLE 1,2,3',
    'OBSTACLE 1 2',
    'OBSTACLE a,1',
    'OBSTACLE 1.5,2',
    'OBSTACLE 1,2 3',
    'OBSTACLE +1,2',
    'OBSTACLE 1e1,2',
    'OBSTACLE 0x1,2',
    'OBSTACLE R1',
  ])('rejects %j', (line) => {
    expect(isInvalid(line)).toBe(true);
  });
});

describe('PLACE', () => {
  it('parses a canonical line', () => {
    expect(action('PLACE R1 0,0,NORTH')).toEqual({
      type: 'PLACE_ROBOT',
      id: 'R1',
      x: 0,
      y: 0,
      facing: 'NORTH',
    });
  });
  it.each(['NORTH', 'EAST', 'SOUTH', 'WEST'] as const)('accepts facing %s', (facing) => {
    expect(action(`PLACE R2 3,4,${facing}`)).toEqual({
      type: 'PLACE_ROBOT',
      id: 'R2',
      x: 3,
      y: 4,
      facing,
    });
  });
  it('is case-insensitive for keyword, id and facing', () => {
    expect(action('place r3 1,2,west')).toEqual({
      type: 'PLACE_ROBOT',
      id: 'R3',
      x: 1,
      y: 2,
      facing: 'WEST',
    });
    expect(action('PlAcE R3 1,2,EaSt')).toEqual({
      type: 'PLACE_ROBOT',
      id: 'R3',
      x: 1,
      y: 2,
      facing: 'EAST',
    });
  });
  it('tolerates spaces around commas and repeated spaces', () => {
    const expected = { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'EAST' };
    expect(action('PLACE R1 0, 0, EAST')).toEqual(expected);
    expect(action('PLACE R1 0 , 0 , EAST')).toEqual(expected);
    expect(action('PLACE   R1    0,0,EAST   ')).toEqual(expected);
    expect(action('   PLACE R1 0,0,EAST')).toEqual(expected);
    expect(action('PLACE R1 0,0 , EAST')).toEqual(expected);
  });
  it('normalizes robot ids (leading zeros, case)', () => {
    expect(action('PLACE R01 0,0,NORTH')).toMatchObject({ id: 'R1' });
    expect(action('PLACE r007 0,0,NORTH')).toMatchObject({ id: 'R7' });
    expect(action('PLACE R10 0,0,NORTH')).toMatchObject({ id: 'R10' });
  });
  it('lets negative integers through for the engine to reject', () => {
    expect(action('PLACE R1 -1,0,NORTH')).toMatchObject({ x: -1, y: 0 });
  });
  it.each([
    'PLACE',
    'PLACE R1',
    'PLACE R1 0,0',
    'PLACE R1 0,0,',
    'PLACE R1 0,0,N',
    'PLACE R1 0,0,NORTHEAST',
    'PLACE R1 0,0,UP',
    'PLACE R1 0,0,NORTH,EXTRA',
    'PLACE R1 0 0 NORTH',
    'PLACE R1 0,0 NORTH',
    'PLACE R1 a,0,NORTH',
    'PLACE R1 0,b,NORTH',
    'PLACE R1 1.5,0,NORTH',
    'PLACE R0 0,0,NORTH',
    'PLACE R00 0,0,NORTH',
    'PLACE R 0,0,NORTH',
    'PLACE X1 0,0,NORTH',
    'PLACE 1 0,0,NORTH',
    'PLACE R1a 0,0,NORTH',
    'PLACE R-1 0,0,NORTH',
    'PLACE 0,0,NORTH',
    'PLACE R1 0,0,NORTH R2',
  ])('rejects %j', (line) => {
    expect(isInvalid(line)).toBe(true);
  });
});

describe('QUEUE', () => {
  it('parses MOVE/LEFT/RIGHT in order', () => {
    expect(action('QUEUE R1 MOVE LEFT RIGHT MOVE')).toEqual({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'MOVE' }, { kind: 'LEFT' }, { kind: 'RIGHT' }, { kind: 'MOVE' }],
    });
  });
  it('is case-insensitive and tolerates repeated spaces', () => {
    expect(action('  queue   r2   move    Left  RIGHT ')).toEqual({
      type: 'QUEUE_COMMANDS',
      id: 'R2',
      commands: [{ kind: 'MOVE' }, { kind: 'LEFT' }, { kind: 'RIGHT' }],
    });
  });
  it('accepts a single command', () => {
    expect(action('QUEUE R1 MOVE')).toMatchObject({ commands: [{ kind: 'MOVE' }] });
  });
  it('parses GOTO X,Y', () => {
    expect(action('QUEUE R1 GOTO 3,4')).toEqual({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'GOTO', x: 3, y: 4 }],
    });
  });
  it('mixes GOTO with other commands', () => {
    expect(action('QUEUE R1 MOVE GOTO 3,4 LEFT')).toMatchObject({
      commands: [{ kind: 'MOVE' }, { kind: 'GOTO', x: 3, y: 4 }, { kind: 'LEFT' }],
    });
    expect(action('QUEUE R1 GOTO 1,1 GOTO 2,2')).toMatchObject({
      commands: [
        { kind: 'GOTO', x: 1, y: 1 },
        { kind: 'GOTO', x: 2, y: 2 },
      ],
    });
  });
  it('tolerates spaces around the GOTO comma', () => {
    expect(action('QUEUE R1 goto 3, 4 MOVE')).toMatchObject({
      commands: [{ kind: 'GOTO', x: 3, y: 4 }, { kind: 'MOVE' }],
    });
    expect(action('QUEUE R1 GOTO 3 , 4')).toMatchObject({
      commands: [{ kind: 'GOTO', x: 3, y: 4 }],
    });
  });
  it('lets negative GOTO targets through for the engine to reject', () => {
    expect(action('QUEUE R1 GOTO -1,2')).toMatchObject({
      commands: [{ kind: 'GOTO', x: -1, y: 2 }],
    });
  });
  it('normalizes the robot id', () => {
    expect(action('QUEUE R01 MOVE')).toMatchObject({ id: 'R1' });
    expect(action('QUEUE r12 MOVE')).toMatchObject({ id: 'R12' });
  });
  it.each([
    ['unknown command', 'QUEUE R1 JUMP'],
    ['unknown command among valid ones (whole line ignored)', 'QUEUE R1 MOVE JUMP LEFT'],
    ['lowercase unknown', 'QUEUE R1 move jump'],
    ['no commands', 'QUEUE R1'],
    ['no id or commands', 'QUEUE'],
    ['bad id R0', 'QUEUE R0 MOVE'],
    ['bad id X1', 'QUEUE X1 MOVE'],
    ['command in id slot', 'QUEUE MOVE R1'],
    ['GOTO without target', 'QUEUE R1 GOTO'],
    ['GOTO followed by command', 'QUEUE R1 GOTO MOVE'],
    ['GOTO trailing without target', 'QUEUE R1 MOVE GOTO'],
    ['GOTO with one coordinate', 'QUEUE R1 GOTO 3'],
    ['GOTO with three coordinates', 'QUEUE R1 GOTO 1,2,3'],
    ['GOTO non-integer', 'QUEUE R1 GOTO 1.5,2'],
    ['GOTO non-numeric', 'QUEUE R1 GOTO a,b'],
    ['GOTO space-separated coords', 'QUEUE R1 GOTO 3 4'],
    ['stray coordinate token', 'QUEUE R1 MOVE 3,4'],
    ['comma-joined commands', 'QUEUE R1 MOVE,LEFT'],
    ['MOVE with argument-like suffix', 'QUEUE R1 MOVE2'],
    ['partial word', 'QUEUE R1 MOV'],
  ])('rejects the whole line: %s', (_name, line) => {
    expect(isInvalid(line)).toBe(true);
  });
});

describe('TICK', () => {
  it('defaults to 1', () => {
    expect(parseScenarioLine('TICK')).toEqual({ kind: 'tick', count: 1 });
    expect(parseScenarioLine('  tick  ')).toEqual({ kind: 'tick', count: 1 });
  });
  it('parses a positive integer', () => {
    expect(parseScenarioLine('TICK 3')).toEqual({ kind: 'tick', count: 3 });
    expect(parseScenarioLine('tick 10')).toEqual({ kind: 'tick', count: 10 });
    expect(parseScenarioLine('TICK   007')).toEqual({ kind: 'tick', count: 7 });
    expect(parseScenarioLine('TICK 1')).toEqual({ kind: 'tick', count: 1 });
  });
  it('has no upper cap', () => {
    expect(parseScenarioLine('TICK 1000000')).toEqual({ kind: 'tick', count: 1_000_000 });
  });
  it.each([
    'TICK 0',
    'TICK -1',
    'TICK -0',
    'TICK abc',
    'TICK 1.5',
    'TICK 2.0',
    'TICK 3x',
    'TICK 1 2',
    'TICK 1,2',
    'TICK +3',
    'TICK 1e3',
    'TICK 99999999999999999999',
  ])('rejects %j', (line) => {
    expect(isInvalid(line)).toBe(true);
  });
});

describe('REPORT', () => {
  it('parses bare REPORT in any case', () => {
    expect(parseScenarioLine('REPORT')).toEqual({ kind: 'report' });
    expect(parseScenarioLine('  report  ')).toEqual({ kind: 'report' });
    expect(parseScenarioLine('Report')).toEqual({ kind: 'report' });
  });
  it.each(['REPORT R1', 'REPORT 1', 'REPORT now', 'REPORT,'])(
    'rejects extra tokens: %j',
    (line) => {
      expect(isInvalid(line)).toBe(true);
    },
  );
});

describe('unknown input', () => {
  it.each([
    'JUMP',
    'FLOORS 4,3',
    'MOVE',
    'R1 MOVE',
    'PLACE_ROBOT R1 0,0,NORTH',
    '4,3',
    'REMOVE R1',
    'CLEAR R1',
    'GOTO 1,1',
    'TICKS 3',
    'REPORTS',
    '// comment',
    '; comment',
  ])('marks %j invalid', (line) => {
    const parsed = parseScenarioLine(line);
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind === 'invalid') expect(parsed.why.length).toBeGreaterThan(0);
  });
  it('does not treat a trailing inline comment as a comment', () => {
    expect(isInvalid('REPORT # hi')).toBe(true);
    expect(isInvalid('TICK 3 # hi')).toBe(true);
  });
});

describe('purity', () => {
  it('returns equal results for repeated calls and never throws on junk', () => {
    const junk = [
      '\u0000',
      ',,,',
      '   ,  ',
      'PLACE ,,',
      'QUEUE ,',
      'FLOOR ,',
      '\r',
      'ÄÖÜ 1,2',
      'PLACE R1 0,0,NORTH\r',
    ];
    for (const line of junk) {
      expect(() => parseScenarioLine(line)).not.toThrow();
      expect(parseScenarioLine(line)).toEqual(parseScenarioLine(line));
    }
  });
  it('tolerates a trailing carriage return (CRLF files)', () => {
    expect(parseScenarioLine('REPORT\r')).toEqual({ kind: 'report' });
    expect(action('PLACE R1 0,0,EAST\r')).toMatchObject({ type: 'PLACE_ROBOT', facing: 'EAST' });
  });
});
