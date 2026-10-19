import { runScenario } from '@fleet/engine';
import { describe, expect, it } from 'vitest';
import { tickResult } from '../testing/mocks';
import { MAX_TRACE_TICKS, SCENARIOS, buildScenario, findScenario, reportLines } from './scenarios';

const BRIEF_IDS = [
  'brief_a_chain',
  'brief_b_headon',
  'brief_c_contest_behind',
  'brief_d_rotation',
  'brief_e_queues',
];

describe('scenario catalogue', () => {
  it('has the five brief examples first, then the curated ones, with unique ids', () => {
    expect(SCENARIOS.map((s) => s.id).slice(0, 5)).toEqual(BRIEF_IDS);
    expect(SCENARIOS.filter((s) => s.group === 'brief')).toHaveLength(5);
    expect(SCENARIOS.filter((s) => s.group === 'curated')).toHaveLength(6);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: the checkpoints rebuild the .expected file and match the engine runner',
    (_id, def) => {
      const expected = def.checkpoints.flatMap((c) => c.expected);
      expect(expected.join('\n') + '\n').toBe(def.expectedText);
      expect(expected).toEqual(runScenario(def.text));
      expect(def.checkpoints.flatMap((c) => c.runner)).toEqual(runScenario(def.text));
      expect(def.checkpoints.every((c) => c.runner.join() === c.expected.join())).toBe(true);
      expect(def.expectedLineMismatch).toBeNull();
    },
  );

  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: steps start with a floor and checkpoints are in tick order',
    (_id, def) => {
      const first = def.trace.steps[0];
      expect(first?.kind === 'action' && first.action.type === 'CREATE_FLOOR').toBe(true);
      const ticks = def.checkpoints.map((c) => c.afterTicks);
      expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
      expect(def.checkpoints.map((c) => c.index)).toEqual(def.checkpoints.map((_, i) => i));
      expect(def.totalTicks).toBe(def.trace.steps.filter((s) => s.kind === 'tick').length);
    },
  );

  it('brief e: its own FLOOR line, queues in file order, two cumulative checkpoints', () => {
    const def = findScenario('brief_e_queues')!;
    const actions = def.trace.steps.flatMap((s) => (s.kind === 'action' ? [s.action] : []));
    expect(actions).toEqual([
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
    expect(def.checkpoints.map((c) => [c.afterTicks, c.expected])).toEqual([
      [3, ['R1 2,2,SOUTH', 'R2 1,1,EAST']],
      [13, ['R1 2,2,SOUTH', 'R2 3,1,EAST']],
    ]);
  });

  it('brief b has no FLOOR line, so Load creates the default 5x5 floor first', () => {
    const def = findScenario('brief_b_headon')!;
    expect(def.trace.steps[0]).toMatchObject({
      kind: 'action',
      action: { type: 'CREATE_FLOOR', width: 5, height: 5 },
    });
    expect(def.trace.steps.filter((s) => s.kind === 'action')).toHaveLength(1 + 4);
  });

  it('builds the scenarios that send commands after the first TICK (goto_two_robots_corridor)', () => {
    const def = findScenario('goto_two_robots_corridor')!;
    expect(def.checkpoints.map((c) => c.afterTicks)).toEqual([1, 4, 5]);
    const kinds = def.trace.steps.map((s) => s.kind);
    const firstTick = kinds.indexOf('tick');
    expect(kinds.slice(firstTick).filter((k) => k === 'action')).toHaveLength(2);
  });

  it('keeps the GOTO command and the obstacles for the routing scenario', () => {
    const def = findScenario('goto_around_obstacle')!;
    const actions = def.trace.steps.flatMap((s) => (s.kind === 'action' ? [s.action] : []));
    expect(actions.filter((a) => a.type === 'SET_OBSTACLE')).toHaveLength(4);
    expect(actions).toContainEqual({
      type: 'QUEUE_COMMANDS',
      id: 'R1',
      commands: [{ kind: 'GOTO', x: 0, y: 2 }],
    });
    expect(def.checkpoints.map((c) => c.afterTicks)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('buildScenario', () => {
  it('drops lines the engine rejects from the steps, and lists them as ignored', () => {
    const def = buildScenario(
      't',
      't',
      'curated',
      'FLOOR 3,3\nPLACE R1 9,9,NORTH\nPLACE R1 0,0,NORTH\nTICK\nREPORT\n',
      'R1 0,0,NORTH\n',
    );
    const actions = def.trace.steps.flatMap((s) => (s.kind === 'action' ? [s.action] : []));
    expect(actions).toEqual([
      { type: 'CREATE_FLOOR', width: 3, height: 3 },
      { type: 'PLACE_ROBOT', id: 'R1', x: 0, y: 0, facing: 'NORTH' },
    ]);
    expect(def.trace.ignored.map((i) => i.line)).toEqual([2]);
  });

  it('counts an EMPTY report as one expected line', () => {
    const def = buildScenario('t', 't', 'curated', 'TICK\nREPORT\n', 'EMPTY\n');
    expect(def.checkpoints).toEqual([
      { index: 0, afterTicks: 1, runner: ['EMPTY'], expected: ['EMPTY'] },
    ]);
  });

  it('uses the runner output as the expected when there is no .expected file', () => {
    const def = buildScenario('t', 't', 'uploaded', 'PLACE R1 0,0,EAST\nTICK\nREPORT\n');
    expect(def.expectedText).toBeUndefined();
    expect(def.checkpoints[0]?.expected).toEqual(['R1 0,0,EAST']);
    expect(def.expectedLineMismatch).toBeNull();
  });

  it('builds scripts the old live model could not: an action after TICK, REPORT before TICK, no REPORT', () => {
    const mid = buildScenario(
      't',
      't',
      'uploaded',
      'PLACE R1 0,0,EAST\nTICK\nQUEUE R1 MOVE\nTICK\nREPORT\n',
    );
    expect(mid.checkpoints).toHaveLength(1);
    expect(mid.checkpoints[0]?.afterTicks).toBe(2);

    const early = buildScenario('t', 't', 'uploaded', 'PLACE R1 0,0,EAST\nREPORT\nTICK\nREPORT\n');
    expect(early.checkpoints.map((c) => c.afterTicks)).toEqual([0, 1]);

    const none = buildScenario('t', 't', 'uploaded', 'PLACE R1 0,0,EAST\nTICK\n');
    expect(none.checkpoints).toEqual([]);
    expect(none.totalTicks).toBe(1);
  });

  it('splits the .expected file by the runner report sizes and flags a line-count mismatch', () => {
    const text = 'PLACE R1 0,0,EAST\nPLACE R2 0,1,EAST\nREPORT\nTICK\nREPORT\n';
    const ok = buildScenario(
      't',
      't',
      'uploaded',
      text,
      'R1 0,0,EAST\nR2 0,1,EAST\nR1 0,0,EAST\nR2 0,1,EAST\n',
    );
    expect(ok.checkpoints.map((c) => c.expected.length)).toEqual([2, 2]);
    expect(ok.expectedLineMismatch).toBeNull();

    const bad = buildScenario('t', 't', 'uploaded', text, 'R1 0,0,EAST\n');
    expect(bad.expectedLineMismatch).toEqual({ expected: 1, runner: 4 });
    expect(bad.checkpoints.map((c) => c.expected.length)).toEqual([1, 0]);
    expect(bad.checkpoints[0]?.runner).toHaveLength(2);
  });

  it('keeps wrong expected lines apart from the runner lines', () => {
    const def = buildScenario(
      't',
      't',
      'uploaded',
      'PLACE R1 0,0,EAST\nTICK\nREPORT\n',
      'R1 9,9,EAST\n',
    );
    expect(def.checkpoints[0]).toMatchObject({
      runner: ['R1 0,0,EAST'],
      expected: ['R1 9,9,EAST'],
    });
  });

  it('records the file name for the runner heading, defaulting to the bundled path', () => {
    expect(buildScenario('x', 't', 'uploaded', '', undefined, 'my file.txt').fileName).toBe(
      'my file.txt',
    );
    expect(findScenario('brief_a_chain')!.fileName).toBe('scenarios/brief_a_chain.txt');
  });

  it('refuses a script with an absurd tick count instead of tracing it', () => {
    expect(() => buildScenario('t', 't', 'uploaded', `TICK ${MAX_TRACE_TICKS + 1}\n`)).toThrow(
      /ticks/,
    );
    expect(buildScenario('t', 't', 'uploaded', 'TICK 1500\nREPORT\n').totalTicks).toBe(1500);
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
