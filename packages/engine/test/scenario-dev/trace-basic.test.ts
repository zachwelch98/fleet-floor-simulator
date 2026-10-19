import { describe, expect, it } from 'vitest';
import { runScenario, traceScenario } from '../../src/scenario/run.js';

describe('traceScenario (basics, real engine)', () => {
  it('puts the implicit 5x5 floor first when the file has no FLOOR line', () => {
    const t = traceScenario('PLACE R1 0,0,EAST\nTICK\nREPORT\n');
    expect(t.steps[0]).toEqual({
      kind: 'action',
      action: { type: 'CREATE_FLOOR', width: 5, height: 5 },
      line: 0,
    });
    expect(t.steps.map((s) => s.kind)).toEqual(['action', 'action', 'tick', 'report']);
  });

  it('keeps a leading FLOOR line as the first step, without an implicit one', () => {
    const t = traceScenario('# c\nFLOOR 4,3\nTICK\n');
    expect(t.steps).toEqual([
      { kind: 'action', action: { type: 'CREATE_FLOOR', width: 4, height: 3 }, line: 2 },
      { kind: 'tick', line: 3 },
    ]);
  });

  it('expands TICK N into N tick steps and numbers reports in order', () => {
    const t = traceScenario('TICK 3\nREPORT\nTICK\nREPORT\n');
    expect(t.steps.filter((s) => s.kind === 'tick')).toHaveLength(4);
    expect(t.steps.filter((s) => s.kind === 'report')).toEqual([
      { kind: 'report', index: 0 },
      { kind: 'report', index: 1 },
    ]);
    expect(t.reports).toEqual([['EMPTY'], ['EMPTY']]);
  });

  it('lists parse errors and engine rejections with line numbers, and keeps only accepted actions', () => {
    const t = traceScenario('BOGUS\nPLACE R1 9,9,NORTH\nPLACE R1 0,0,NORTH\nREPORT\n');
    expect(t.ignored.map((i) => [i.line, i.text])).toEqual([
      [1, 'BOGUS'],
      [2, 'PLACE R1 9,9,NORTH'],
    ]);
    expect(t.ignored[0]?.why).toBe('unknown keyword');
    expect(t.ignored[1]?.why.length).toBeGreaterThan(0);
    expect(t.steps.filter((s) => s.kind === 'action')).toHaveLength(2); // floor + the good PLACE
    expect(t.reports).toEqual([['R1 0,0,NORTH']]);
  });

  it('runScenario is the flattened reports', () => {
    const text = 'FLOOR 4,3\nPLACE R1 0,0,EAST\nQUEUE R1 MOVE\nTICK\nREPORT\nTICK\nREPORT\n';
    expect(runScenario(text)).toEqual(traceScenario(text).reports.flat());
  });
});
