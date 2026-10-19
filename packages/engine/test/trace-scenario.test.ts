/**
 * traceScenario: the traced scenario runner behind uploads (plan "Upload your own scenario file").
 * Written black-box from the plan: `traceScenario(text)` returns
 *   { reports: string[][]; ignored: { line, text, why }[]; steps: ScriptStep[] }
 * with ScriptStep = { kind: 'action'; action; line } | { kind: 'tick'; line } | { kind: 'report'; index }.
 * `runScenario(text)` must stay equal to `traceScenario(text).reports.flat()`, i.e. the CLI output.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply, createFloorState, parseScenarioLine } from '../src/index.js';
import { formatReport, runScenario, traceScenario } from '../src/scenario/run.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCENARIO_DIR = join(REPO_ROOT, 'scenarios');

type Trace = ReturnType<typeof traceScenario>;
type Step = Trace['steps'][number];

const ticks = (t: Trace): Step[] => t.steps.filter((s) => s.kind === 'tick');
const reportSteps = (t: Trace): Step[] => t.steps.filter((s) => s.kind === 'report');
const actions = (t: Trace): Extract<Step, { kind: 'action' }>[] =>
  t.steps.filter((s): s is Extract<Step, { kind: 'action' }> => s.kind === 'action');

describe('traceScenario: implicit floor', () => {
  it('a file with no FLOOR line starts with CREATE_FLOOR 5,5', () => {
    const t = traceScenario('PLACE R1 0,0,EAST\nREPORT\n');
    expect(t.steps[0]).toMatchObject({
      kind: 'action',
      action: { type: 'CREATE_FLOOR', width: 5, height: 5 },
    });
    expect(t.reports).toEqual([['R1 0,0,EAST']]);
  });

  it('an empty file still starts with the implicit CREATE_FLOOR 5,5 and has nothing else', () => {
    const t = traceScenario('');
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]).toMatchObject({
      kind: 'action',
      action: { type: 'CREATE_FLOOR', width: 5, height: 5 },
    });
    expect(t.reports).toEqual([]);
    expect(t.ignored).toEqual([]);
  });

  it('an explicit FLOOR line is a step carrying its own 1-based line number', () => {
    const t = traceScenario('# c\nFLOOR 3,2\nPLACE R1 0,0,EAST\n');
    const floor = actions(t).find(
      (s) => s.action.type === 'CREATE_FLOOR' && s.action.width === 3 && s.action.height === 2,
    );
    expect(floor).toBeDefined();
    expect(floor?.line).toBe(2);
    expect(t.ignored).toEqual([]);
  });

  it('a mid-script FLOOR is a step at its own line (the world reset is replayed in order)', () => {
    const text = 'FLOOR 3,3\nPLACE R1 0,0,EAST\nREPORT\nFLOOR 4,4\nREPORT\n';
    const t = traceScenario(text);
    const floors = actions(t).filter((s) => s.action.type === 'CREATE_FLOOR');
    expect(floors.map((s) => s.line)).toContain(1);
    expect(floors.map((s) => s.line)).toContain(4);
    // Order is preserved: the second FLOOR comes after the first REPORT step.
    const firstReport = t.steps.findIndex((s) => s.kind === 'report');
    const secondFloor = t.steps.findIndex((s) => s.kind === 'action' && s.line === 4);
    expect(secondFloor).toBeGreaterThan(firstReport);
    expect(t.reports).toEqual([['R1 0,0,EAST'], ['EMPTY']]);
  });
});

describe('traceScenario: TICK expansion', () => {
  it('TICK N expands to N tick steps, all carrying the TICK line', () => {
    const t = traceScenario('FLOOR 3,3\nTICK 4\n');
    const ts = ticks(t);
    expect(ts).toHaveLength(4);
    for (const s of ts) expect(s).toMatchObject({ kind: 'tick', line: 2 });
  });

  it('a bare TICK is one tick step; TICK 007 is seven', () => {
    expect(ticks(traceScenario('TICK\n'))).toHaveLength(1);
    expect(ticks(traceScenario('TICK 007\n'))).toHaveLength(7);
  });

  it('consecutive TICK lines add up, in order, between the other steps', () => {
    // No FLOOR line, so the only action is the implicit CREATE_FLOOR 5,5.
    const t = traceScenario('TICK 2\nREPORT\nTICK\nREPORT\n');
    expect(t.steps.map((s) => s.kind)).toEqual([
      'action', // implicit CREATE_FLOOR
      'tick',
      'tick',
      'report',
      'tick',
      'report',
    ]);
  });

  it('TICK 0, TICK -1, TICK x and TICK 1.5 are ignored (DECISIONS 4.7): no tick steps, listed with line and text', () => {
    const text = [
      'FLOOR 5,5', // 1
      'PLACE R1 0,0,EAST', // 2
      'TICK 0', // 3
      'TICK -1', // 4
      'TICK x', // 5
      'TICK 1.5', // 6
      'TICK 2', // 7
    ].join('\n');
    const t = traceScenario(text);
    expect(ticks(t)).toHaveLength(2);
    expect(t.ignored.map((i) => i.line)).toEqual([3, 4, 5, 6]);
    expect(t.ignored.map((i) => i.text.trim())).toEqual([
      'TICK 0',
      'TICK -1',
      'TICK x',
      'TICK 1.5',
    ]);
    for (const i of t.ignored) expect(i.why.trim().length).toBeGreaterThan(0);
  });

  it('a large TICK still expands (no cap, DECISIONS 4.7)', () => {
    expect(ticks(traceScenario('TICK 2500\n'))).toHaveLength(2500);
  });
});

describe('traceScenario: ignored lines', () => {
  it('engine rejections are not steps; they are listed with the 1-based line and the original text', () => {
    const text = [
      'FLOOR 3,3', // 1
      'PLACE R1 0,0,EAST', // 2
      'PLACE R2 9,9,NORTH', // 3: off the floor
      'QUEUE R7 MOVE', // 4: unknown robot
      'QUEUE R1 MOVE', // 5: fine
      'TICK', // 6
      'REPORT', // 7
    ].join('\n');
    const t = traceScenario(text);

    expect(t.ignored.map((i) => i.line)).toEqual([3, 4]);
    expect(t.ignored[0]?.text.trim()).toBe('PLACE R2 9,9,NORTH');
    expect(t.ignored[1]?.text.trim()).toBe('QUEUE R7 MOVE');
    for (const i of t.ignored) expect(i.why.trim().length).toBeGreaterThan(0);

    const stepLines = actions(t).map((s) => s.line);
    expect(stepLines).not.toContain(3);
    expect(stepLines).not.toContain(4);
    expect(stepLines).toContain(2);
    expect(stepLines).toContain(5);
    expect(t.reports).toEqual([['R1 1,0,EAST']]);
  });

  it('parse errors are listed too: junk keyword, bad facing, bad QUEUE token, trailing comment (DECISIONS 4.5, 4.11)', () => {
    const text = [
      'FLOOR 4,4', // 1
      'FROBNICATE 1,2', // 2
      'PLACE R1 0,0,N', // 3: facing must be a full word
      'PLACE R1 0,0,EAST', // 4
      'QUEUE R1 MOVE JUMP LEFT', // 5: whole line ignored
      'QUEUE R1 MOVE # go', // 6: trailing comment makes it invalid
      'REPORT', // 7
    ].join('\n');
    const t = traceScenario(text);
    expect(t.ignored.map((i) => i.line)).toEqual([2, 3, 5, 6]);
    expect(t.ignored.map((i) => i.text.trim())).toEqual([
      'FROBNICATE 1,2',
      'PLACE R1 0,0,N',
      'QUEUE R1 MOVE JUMP LEFT',
      'QUEUE R1 MOVE # go',
    ]);
    for (const i of t.ignored) expect(i.why.trim().length).toBeGreaterThan(0);
    expect(actions(t).map((s) => s.line)).toEqual(expect.not.arrayContaining([2, 3, 5, 6]));
    // Nothing from the bad QUEUE lines reached the robot.
    expect(t.reports).toEqual([['R1 0,0,EAST']]);
  });

  it('FLOOR outside 1..20 is ignored and the old floor stays (DECISIONS 4.2)', () => {
    const t = traceScenario('FLOOR 3,3\nFLOOR 21,3\nFLOOR 0,5\nPLACE R1 2,2,NORTH\nREPORT\n');
    expect(t.ignored.map((i) => i.line)).toEqual([2, 3]);
    expect(actions(t).filter((s) => s.action.type === 'CREATE_FLOOR' && s.line > 1)).toEqual([]);
    expect(t.reports).toEqual([['R1 2,2,NORTH']]);
  });

  it('comments and blank lines are neither steps nor ignored, but still count for line numbers', () => {
    const text = [
      '# a comment', // 1
      '', // 2
      '   ', // 3
      'FLOOR 3,3', // 4
      '   # indented comment', // 5
      'BOGUS', // 6
      'REPORT', // 7
    ].join('\n');
    const t = traceScenario(text);
    expect(t.ignored.map((i) => i.line)).toEqual([6]);
    expect(actions(t).map((s) => s.line)).toContain(4);
    expect(t.steps.filter((s) => s.kind !== 'report')).toHaveLength(actions(t).length);
    expect(actions(t).filter((s) => s.action.type !== 'CREATE_FLOOR')).toEqual([]);
  });

  it('CRLF and CR line endings number lines the same way as LF', () => {
    const lf = 'FLOOR 3,3\nBOGUS\nPLACE R1 0,0,EAST\nREPORT';
    const base = traceScenario(lf);
    expect(traceScenario(lf.replace(/\n/g, '\r\n'))).toEqual(base);
    expect(traceScenario(lf.replace(/\n/g, '\r'))).toEqual(base);
    expect(base.ignored.map((i) => i.line)).toEqual([2]);
  });

  it('a clean file ignores nothing', () => {
    expect(traceScenario('FLOOR 3,3\nPLACE R1 0,0,EAST\nTICK\nREPORT\n').ignored).toEqual([]);
  });
});

describe('traceScenario: reports', () => {
  it('one string[] per REPORT, in file order, sorted by robot number', () => {
    const text = [
      'FLOOR 4,4',
      'PLACE R2 3,3,WEST',
      'PLACE R1 0,0,EAST',
      'REPORT',
      'QUEUE R1 MOVE',
      'TICK',
      'REPORT',
    ].join('\n');
    const t = traceScenario(text);
    expect(t.reports).toEqual([
      ['R1 0,0,EAST', 'R2 3,3,WEST'],
      ['R1 1,0,EAST', 'R2 3,3,WEST'],
    ]);
  });

  it('REPORT with no robots is ["EMPTY"], including right after a FLOOR that wipes a populated world', () => {
    const t = traceScenario(
      'REPORT\nFLOOR 3,3\nREPORT\nPLACE R1 0,0,EAST\nREPORT\nFLOOR 3,3\nREPORT\n',
    );
    expect(t.reports).toEqual([['EMPTY'], ['EMPTY'], ['R1 0,0,EAST'], ['EMPTY']]);
  });

  it('each REPORT is a report step whose index is its position in `reports`', () => {
    const t = traceScenario('FLOOR 3,3\nREPORT\nTICK\nREPORT\nTICK\nREPORT\n');
    const rs = reportSteps(t);
    expect(rs).toHaveLength(3);
    expect(rs.map((s) => (s.kind === 'report' ? s.index : -1))).toEqual([0, 1, 2]);
    expect(t.reports).toHaveLength(3);
  });

  it('a file with no REPORT has no reports and no report steps', () => {
    const t = traceScenario('FLOOR 3,3\nPLACE R1 0,0,EAST\nTICK 3\n');
    expect(t.reports).toEqual([]);
    expect(reportSteps(t)).toEqual([]);
  });

  it('works for a file whose commands come after the first TICK (mid-script QUEUE)', () => {
    const text = 'FLOOR 5,1\nPLACE R1 0,0,EAST\nTICK\nQUEUE R1 MOVE MOVE\nTICK 2\nREPORT\n';
    const t = traceScenario(text);
    expect(t.reports).toEqual([['R1 2,0,EAST']]);
    const kinds = t.steps.map((s) => s.kind);
    // The QUEUE action sits between the first tick and the next two.
    const q = t.steps.findIndex((s) => s.kind === 'action' && s.line === 4);
    expect(kinds.slice(q - 1, q + 4)).toEqual(['tick', 'action', 'tick', 'tick', 'report']);
  });
});

describe('traceScenario: runScenario is its flattened reports', () => {
  it('runScenario(text) === traceScenario(text).reports.flat() on a mixed, messy file', () => {
    const text =
      'bogus\nFLOOR 3,3\nPLACE R1 0,0,EAST\nPLACE R1 9,9,EAST\nQUEUE R1 MOVE\nTICK 0\nTICK\nREPORT\n';
    expect(runScenario(text)).toEqual(traceScenario(text).reports.flat());
  });
});

// ---------------------------------------------------------------------------------------------
// Sweep over every bundled scenario.
// ---------------------------------------------------------------------------------------------

const names = readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.slice(0, -'.txt'.length))
  .sort();

/** What the CLI prints: the .expected file's lines (the trailing newline is not a line). */
function expectedLines(name: string): string[] {
  const raw = readFileSync(join(SCENARIO_DIR, `${name}.expected`), 'utf8');
  const lines = raw.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

describe('traceScenario sweep over scenarios/*.txt', () => {
  it('finds the bundled scenarios', () => {
    expect(names.length).toBeGreaterThanOrEqual(30);
  });

  describe.each(names)('%s', (name) => {
    const text = readFileSync(join(SCENARIO_DIR, `${name}.txt`), 'utf8');
    const rawLines = text.split(/\r\n|\r|\n/);
    const trace = traceScenario(text);

    it('reports.flat() equals runScenario(text) and the .expected file', () => {
      expect(trace.reports.flat()).toEqual(runScenario(text));
      expect(trace.reports.flat()).toEqual(expectedLines(name));
    });

    it('has one report step per REPORT line, and the first step is a CREATE_FLOOR', () => {
      const reportLines = rawLines.filter((l) => parseScenarioLine(l).kind === 'report').length;
      expect(trace.reports).toHaveLength(reportLines);
      expect(reportSteps(trace)).toHaveLength(reportLines);
      expect(trace.steps[0]).toMatchObject({ kind: 'action', action: { type: 'CREATE_FLOOR' } });
    });

    it('every ignored entry points at a real, non-comment, non-blank line with a reason', () => {
      let prev = 0;
      for (const i of trace.ignored) {
        expect(i.line).toBeGreaterThan(prev); // file order, each line at most once
        prev = i.line;
        expect(i.line).toBeLessThanOrEqual(rawLines.length);
        expect(i.text.trim()).toBe((rawLines[i.line - 1] ?? '').trim());
        expect(parseScenarioLine(i.text).kind).not.toBe('skip');
        expect(i.why.trim().length).toBeGreaterThan(0);
      }
    });

    it('every action step points at an action line, and every tick step at a TICK line', () => {
      const ignoredLines = new Set(trace.ignored.map((i) => i.line));
      for (const s of trace.steps) {
        if (s.kind === 'report') continue;
        expect(ignoredLines.has(s.line)).toBe(false);
        const parsed = parseScenarioLine(rawLines[s.line - 1] ?? '');
        if (s.kind === 'action') {
          // The implicit floor has no real line; every other action step maps to its source line.
          const implicit = s === trace.steps[0] && parsed.kind !== 'action';
          if (!implicit) expect(parsed.kind).toBe('action');
        } else {
          expect(parsed.kind).toBe('tick');
        }
      }
    });

    it('replaying the steps through the engine reproduces every report (what the browser player relies on)', () => {
      let state = createFloorState(5, 5);
      for (const s of trace.steps) {
        if (s.kind === 'action') {
          const r = apply(state, s.action);
          expect(r.ok, `line ${s.line} was recorded as accepted`).toBe(true);
          if (r.ok) state = r.state;
        } else if (s.kind === 'tick') {
          const r = apply(state, { type: 'TICK' });
          expect(r.ok).toBe(true);
          if (r.ok) state = r.state;
        } else {
          expect(formatReport(state.robots)).toEqual(trace.reports[s.index]);
        }
      }
    });
  });
});
