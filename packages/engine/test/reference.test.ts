/**
 * Self-check of the naive reference resolver. It does not touch the real engine, so these tests
 * pass even while `apply` is a stub; they make sure the oracle used by properties.test.ts agrees
 * with the brief's examples and DECISIONS before it is trusted to judge anything.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Command, Facing } from '../src/types.js';
import { refTick, type RefState } from './reference/reference-tick.js';

const FACING: Record<string, Facing> = { '^': 'NORTH', '>': 'EAST', v: 'SOUTH', '<': 'WEST' };

/** Same ASCII format as helpers.fromMap, but building the reference state directly. */
function refMap(map: string, queues: Record<string, string>): RefState {
  const rows = map
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(/\s+/));
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const state: RefState = { width, height, obstacles: [], robots: [] };
  rows.forEach((row, rowIdx) => {
    const y = height - 1 - rowIdx;
    row.forEach((tok, x) => {
      if (tok === '.') return;
      if (tok === '#') {
        state.obstacles.push({ x, y });
        return;
      }
      const m = /^R(\d+)([\^>v<])$/.exec(tok);
      if (!m) throw new Error(`bad token ${tok}`);
      const id = `R${m[1]}`;
      const queue: Command[] = (queues[id] ?? '')
        .split(/\s+/)
        .filter((t) => t)
        .map((t) => ({ kind: t as 'MOVE' | 'LEFT' | 'RIGHT' }));
      state.robots.push({
        id,
        num: Number(m[1]),
        x,
        y,
        facing: FACING[m[2] as string] as Facing,
        queue,
      });
    });
  });
  state.robots.sort((a, b) => a.num - b.num);
  return state;
}

function run(map: string, queues: Record<string, string>) {
  const { state, results } = refTick(refMap(map, queues));
  const pos = Object.fromEntries(state.robots.map((r) => [r.id, `${r.x},${r.y},${r.facing}`]));
  const out = Object.fromEntries(
    results.map((r) => [r.id, r.outcome === 'BLOCKED' ? `BLOCKED(${r.reason})` : r.outcome]),
  );
  return { pos, out };
}

const mv = (...ids: string[]) => Object.fromEntries(ids.map((i) => [i, 'MOVE']));

describe('reference resolver agrees with the brief and DECISIONS', () => {
  it('brief a: chain', () => {
    expect(run('R1> R2> R3> . .', mv('R1', 'R2', 'R3')).pos).toEqual({
      R1: '1,0,EAST',
      R2: '2,0,EAST',
      R3: '3,0,EAST',
    });
  });

  it('brief b: head-on', () => {
    const r = run('R1> R2<', mv('R1', 'R2'));
    expect(r.pos).toEqual({ R1: '0,0,EAST', R2: '1,0,WEST' });
    expect(r.out).toEqual({ R1: 'BLOCKED(HEAD_ON)', R2: 'BLOCKED(HEAD_ON)' });
  });

  it('brief c: contested cell with a follower', () => {
    const r = run('R1> . R2< R3<', mv('R1', 'R2', 'R3'));
    expect(r.pos).toEqual({ R1: '1,0,EAST', R2: '2,0,WEST', R3: '3,0,WEST' });
    expect(r.out).toEqual({ R1: 'MOVED', R2: 'BLOCKED(CONTESTED)', R3: 'BLOCKED(BEHIND_BLOCKED)' });
  });

  it('brief d: rotation', () => {
    const r = run('R2> R3v\nR1^ R4<', mv('R1', 'R2', 'R3', 'R4'));
    expect(r.pos).toEqual({ R1: '0,1,NORTH', R2: '1,1,EAST', R3: '1,0,SOUTH', R4: '0,0,WEST' });
  });

  it('R2 beats R10', () => {
    expect(run('R10> . R2<', mv('R2', 'R10')).out).toEqual({
      R2: 'MOVED',
      R10: 'BLOCKED(CONTESTED)',
    });
  });

  it('contest winner breaks a rotation: everyone blocked', () => {
    const r = run('R3> R4v .\nR2^ R5< R1<', mv('R1', 'R2', 'R3', 'R4', 'R5'));
    expect(r.out).toEqual({
      R1: 'BLOCKED(BEHIND_BLOCKED)',
      R2: 'BLOCKED(BEHIND_BLOCKED)',
      R3: 'BLOCKED(BEHIND_BLOCKED)',
      R4: 'BLOCKED(CONTESTED)',
      R5: 'BLOCKED(BEHIND_BLOCKED)',
    });
  });

  it('DECISIONS 2.7: follower behind a head-on pair', () => {
    expect(run('R1> R2< R3<', mv('R1', 'R2', 'R3')).out).toEqual({
      R1: 'BLOCKED(HEAD_ON)',
      R2: 'BLOCKED(HEAD_ON)',
      R3: 'BLOCKED(CONTESTED)',
    });
    expect(run('R2> R3< R1<', mv('R1', 'R2', 'R3')).out).toEqual({
      R1: 'BLOCKED(BEHIND_BLOCKED)',
      R2: 'BLOCKED(CONTESTED)',
      R3: 'BLOCKED(BEHIND_BLOCKED)',
    });
  });

  it('idle and turning robots occupy their cell (OCCUPIED), obstacles and walls come first', () => {
    expect(run('R1> R2> R3> .', { R1: 'MOVE', R2: 'MOVE' }).out).toEqual({
      R1: 'BLOCKED(BEHIND_BLOCKED)',
      R2: 'BLOCKED(OCCUPIED)',
      R3: 'IDLE',
    });
    expect(run('. R1v .\nR2> # R3<\n. . .', mv('R1', 'R2', 'R3')).out).toEqual({
      R1: 'BLOCKED(OBSTACLE)',
      R2: 'BLOCKED(OBSTACLE)',
      R3: 'BLOCKED(OBSTACLE)',
    });
    expect(run('R1^', mv('R1')).out).toEqual({ R1: 'BLOCKED(WALL)' });
  });

  it('turns: LEFT from NORTH is WEST, RIGHT from NORTH is EAST', () => {
    expect(run('R1^ R2^', { R1: 'LEFT', R2: 'RIGHT' }).pos).toEqual({
      R1: '0,0,WEST',
      R2: '1,0,EAST',
    });
  });

  it('the reference never produces a collision on random boards (oracle sanity)', () => {
    const cell = fc.record({
      x: fc.integer({ min: 0, max: 3 }),
      y: fc.integer({ min: 0, max: 3 }),
      facing: fc.constantFrom<Facing>('NORTH', 'EAST', 'SOUTH', 'WEST'),
      kind: fc.constantFrom<'MOVE' | 'LEFT' | 'RIGHT'>('MOVE', 'MOVE', 'LEFT', 'RIGHT'),
    });
    fc.assert(
      fc.property(fc.array(cell, { maxLength: 12 }), (cells) => {
        const used = new Set<string>();
        const state: RefState = { width: 4, height: 4, obstacles: [], robots: [] };
        cells.forEach((c, i) => {
          const k = `${c.x},${c.y}`;
          if (used.has(k)) return;
          used.add(k);
          state.robots.push({
            id: `R${i + 1}`,
            num: i + 1,
            x: c.x,
            y: c.y,
            facing: c.facing,
            queue: [{ kind: c.kind }],
          });
        });
        const next = refTick(state).state;
        const after = new Set(next.robots.map((r) => `${r.x},${r.y}`));
        expect(after.size).toBe(next.robots.length);
      }),
    );
  });
});
