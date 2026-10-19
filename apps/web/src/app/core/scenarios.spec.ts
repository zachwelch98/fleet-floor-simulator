import { runScenario } from '@fleet/engine';
import { describe, expect, it } from 'vitest';
import { tickResult } from '../testing/mocks';
import { SCENARIOS, buildScenario, findScenario, reportLines } from './scenarios';

const BRIEF_IDS = [
  'brief_a_chain',
  'brief_b_headon',
  'brief_c_contest_behind',
  'brief_d_rotation',
  'brief_e_queues',
];

describe('scenario catalogue', () => {
  it('has the five brief examples first, then five curated ones, with unique ids', () => {
    expect(SCENARIOS.map((s) => s.id).slice(0, 5)).toEqual(BRIEF_IDS);
    expect(SCENARIOS.filter((s) => s.group === 'brief')).toHaveLength(5);
    expect(SCENARIOS.filter((s) => s.group === 'curated')).toHaveLength(5);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: the checkpoints rebuild the .expected file and match the engine runner',
    (_id, def) => {
      const lines = def.checkpoints.flatMap((c) => c.expected);
      expect(lines.join('\n') + '\n').toBe(def.expected);
      expect(lines).toEqual(runScenario(def.text));
    },
  );

  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: setup starts with a floor and checkpoints are in tick order',
    (_id, def) => {
      expect(def.setup[0]?.type).toBe('CREATE_FLOOR');
      expect(def.setup.filter((a) => a.type === 'CREATE_FLOOR')).toHaveLength(1);
      expect(def.setup.some((a) => a.type === 'TICK')).toBe(false);
      const ticks = def.checkpoints.map((c) => c.afterTicks);
      expect(ticks[0]).toBeGreaterThanOrEqual(1);
      expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    },
  );

  it('brief e: its own FLOOR line, queues in file order, two cumulative checkpoints', () => {
    const def = findScenario('brief_e_queues')!;
    expect(def.setup).toEqual([
      { type: 'CREATE_FLOOR', width: 4, height: 3 },
      { type: 'PLACE_ROBOT', id: 'R2', x: 0, y: 0, facing: 'NORTH' },
      { type: 'PLACE_ROBOT', id: 'R1', x: 3, y: 2, facing: 'WEST' },
      {
        type: 'QUEUE_COMMANDS',
        id: 'R2',
        commands: [
          { kind: 'MOVE' },
          { kind: 'RIGHT' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
          { kind: 'MOVE' },
        ],
      },
      { type: 'QUEUE_COMMANDS', id: 'R1', commands: [{ kind: 'MOVE' }, { kind: 'LEFT' }] },
    ]);
    expect(def.checkpoints).toEqual([
      { afterTicks: 3, expected: ['R1 2,2,SOUTH', 'R2 1,1,EAST'] },
      { afterTicks: 13, expected: ['R1 2,2,SOUTH', 'R2 3,1,EAST'] },
    ]);
  });

  it('brief b has no FLOOR line, so Load creates the default 5x5 floor first', () => {
    const def = findScenario('brief_b_headon')!;
    expect(def.setup[0]).toEqual({ type: 'CREATE_FLOOR', width: 5, height: 5 });
    expect(def.setup).toHaveLength(1 + 4);
  });

  it('keeps the GOTO command and the obstacles for the routing scenario', () => {
    const def = findScenario('goto_around_obstacle')!;
    expect(def.setup.filter((a) => a.type === 'SET_OBSTACLE')).toHaveLength(4);
    expect(def.setup).toContainEqual({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'GOTO', x: 0, y: 2 }],
    });
    expect(def.checkpoints.map((c) => c.afterTicks)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('buildScenario', () => {
  it('drops lines the engine rejects, like the runner does', () => {
    const def = buildScenario(
      't',
      't',
      'curated',
      'FLOOR 3,3\nPLACE R1 9,9,NORTH\nPLACE R1 0,0,NORTH\nTICK\nREPORT\n',
      'R1 0,0,NORTH\n',
    );
    expect(def.setup).toEqual([
      { type: 'CREATE_FLOOR', width: 3, height: 3 },
      { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'NORTH' },
    ]);
  });

  it('counts an EMPTY report as one expected line', () => {
    const def = buildScenario('t', 't', 'curated', 'TICK\nREPORT\n', 'EMPTY\n');
    expect(def.checkpoints).toEqual([{ afterTicks: 1, expected: ['EMPTY'] }]);
    expect(def.setup).toEqual([{ type: 'CREATE_FLOOR', width: 5, height: 5 }]);
  });

  it('throws on an action after the first TICK (Play cannot inject it mid-run)', () => {
    const text = 'PLACE R1 0,0,EAST\nTICK\nQUEUE R1 MOVE\nTICK\nREPORT\n';
    expect(() => buildScenario('t', 't', 'curated', text, 'R1 0,0,EAST\n')).toThrow(
      /after the first TICK/,
    );
  });

  it('throws on a REPORT before any TICK, a file without REPORT, or a mismatched .expected', () => {
    expect(() => buildScenario('t', 't', 'curated', 'PLACE R1 0,0,EAST\nREPORT\n', 'x\n')).toThrow(
      /before the first TICK/,
    );
    expect(() => buildScenario('t', 't', 'curated', 'TICK\n', '')).toThrow(/no REPORT/);
    expect(() =>
      buildScenario('t', 't', 'curated', 'PLACE R1 0,0,EAST\nTICK\nREPORT\n', 'R1 0,0,EAST\nR2\n'),
    ).toThrow(/.expected file has 2 lines/);
  });
});

describe('reportLines', () => {
  it('prints the end cell and facing of each result, sorted by robot number', () => {
    const lines = reportLines([
      tickResult('R10', { outcome: 'MOVED', to: { x: 4, y: 0 }, facing: 'WEST' }),
      tickResult('R2', { outcome: 'TURNED', to: { x: 1, y: 3 }, facing: 'SOUTH' }),
    ]);
    expect(lines).toEqual(['R2 1,3,SOUTH', 'R10 4,0,WEST']);
  });

  it('prints EMPTY when the tick had no robots', () => {
    expect(reportLines([])).toEqual(['EMPTY']);
  });
});
