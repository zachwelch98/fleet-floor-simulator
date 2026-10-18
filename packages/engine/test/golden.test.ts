/**
 * Golden scenarios: every scenarios/NAME.txt is run through the real CLI exactly as a grader would
 * (`npm run scenario -- <absolute path>`, cwd = repo root) and its stdout must equal NAME.expected
 * byte for byte, with exit code 0.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCENARIO_DIR = join(REPO_ROOT, 'scenarios');

const files = readdirSync(SCENARIO_DIR).sort();
const scenarios = files.filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -'.txt'.length));

describe('golden scenario directory', () => {
  it('contains the five brief examples and at least 25 more cases', () => {
    for (const name of [
      'brief_a_chain',
      'brief_b_headon',
      'brief_c_contest_behind',
      'brief_d_rotation',
      'brief_e_queues',
    ]) {
      expect(scenarios).toContain(name);
    }
    expect(scenarios.filter((n) => !n.startsWith('brief_')).length).toBeGreaterThanOrEqual(25);
  });

  it('every .expected file belongs to a .txt scenario', () => {
    const orphans = files
      .filter((f) => f.endsWith('.expected'))
      .map((f) => f.slice(0, -'.expected'.length))
      .filter((n) => !scenarios.includes(n));
    expect(orphans).toEqual([]);
  });

  it('every scenario starts with a # comment explaining what it tests', () => {
    for (const name of scenarios) {
      const text = readFileSync(join(SCENARIO_DIR, `${name}.txt`), 'utf8');
      expect(text.startsWith('# '), `${name}.txt should start with a "# " comment`).toBe(true);
    }
  });
});

describe('golden scenarios (real CLI)', () => {
  it.each(scenarios)('%s', (name) => {
    const txtPath = join(SCENARIO_DIR, `${name}.txt`);
    const expectedPath = join(SCENARIO_DIR, `${name}.expected`);
    expect(existsSync(expectedPath), `missing ${name}.expected`).toBe(true);
    const expected = readFileSync(expectedPath, 'utf8');

    const run = spawnSync('npm', ['run', 'scenario', '--', txtPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(run.error, `could not spawn npm: ${String(run.error)}`).toBeUndefined();
    expect(run.status, `exit code (stderr: ${run.stderr})`).toBe(0);
    expect(run.stdout).toBe(expected);
  });
});
