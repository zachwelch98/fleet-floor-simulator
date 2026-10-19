import { describe, expect, it } from 'vitest';
import { entry, floorState, robot, tickResult } from '../testing/mocks';
import { buildBlocks, deriveLastResults, mergeHistory } from './history';

const created = (seq: number) => entry(seq, { type: 'FLOOR_CREATED', width: 10, height: 8 });
const tick = (seq: number, n: number, ids: string[], outcome: 'MOVED' | 'IDLE' = 'MOVED') =>
  entry(
    seq,
    { type: 'TICK_RESOLVED', tick: n, results: ids.map((id) => tickResult(id, { outcome })) },
    n,
  );
const placed = (seq: number, id: string) =>
  entry(seq, { type: 'ROBOT_PLACED', id, x: 0, y: 0, facing: 'NORTH', replaced: false });

describe('mergeHistory', () => {
  it('appends newer entries and reports only the added ones', () => {
    const { merged, added } = mergeHistory([created(1)], [placed(2, 'R1'), placed(3, 'R2')]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(added.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('dedupes by seq and keeps the list sorted when entries arrive out of order', () => {
    const base = [created(1), placed(3, 'R2')];
    const { merged, added } = mergeHistory(base, [placed(3, 'R2'), placed(2, 'R1'), created(1)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(added.map((e) => e.seq)).toEqual([2]);
  });

  it('returns the same array when nothing is new', () => {
    const base = [created(1)];
    expect(mergeHistory(base, [created(1)]).merged).toBe(base);
    expect(mergeHistory(base, []).merged).toBe(base);
  });
});

describe('deriveLastResults', () => {
  const state = floorState({ robots: [robot('R1', 0, 0), robot('R2', 1, 0)] });

  it('returns nothing without a tick', () => {
    expect(deriveLastResults([created(1), placed(2, 'R1')], state).size).toBe(0);
  });

  it('uses the newest TICK_RESOLVED only', () => {
    const results = deriveLastResults(
      [created(1), tick(2, 1, ['R1']), tick(3, 2, ['R1', 'R2'])],
      state,
    );
    expect([...results.keys()]).toEqual(['R1', 'R2']);
  });

  it('drops a robot placed or removed after the tick, keeps the others', () => {
    const history = [created(1), tick(2, 1, ['R1', 'R2']), placed(3, 'R2')];
    expect([...deriveLastResults(history, state).keys()]).toEqual(['R1']);
    const removed = [
      created(1),
      tick(2, 1, ['R1', 'R2']),
      entry(3, { type: 'ROBOT_REMOVED', id: 'R1' }),
    ];
    expect([...deriveLastResults(removed, state).keys()]).toEqual(['R2']);
  });

  it('drops everything after a FLOOR_CREATED that follows the tick', () => {
    expect(deriveLastResults([tick(1, 1, ['R1']), created(2)], state).size).toBe(0);
  });

  it('ignores a placement that happened before the tick', () => {
    const history = [placed(1, 'R1'), tick(2, 1, ['R1'])];
    expect(deriveLastResults(history, state).has('R1')).toBe(true);
  });

  it('drops robots that are not on the floor any more', () => {
    const only = floorState({ robots: [robot('R2', 1, 0)] });
    expect([...deriveLastResults([tick(1, 1, ['R1', 'R2'])], only).keys()]).toEqual(['R2']);
  });
});

describe('buildBlocks', () => {
  it('orders blocks newest first and puts standalone lines between tick groups', () => {
    const history = [created(1), tick(2, 1, ['R1']), placed(3, 'R2'), tick(4, 2, ['R1', 'R2'])];
    const { blocks, hasMore } = buildBlocks(history, false, 200);
    expect(blocks.map((b) => `${b.kind}:${b.seq}`)).toEqual([
      'tick:4',
      'line:3',
      'tick:2',
      'line:1',
    ]);
    expect(hasMore).toBe(false);
  });

  it('hides idle lines unless asked, counting them in the summary suffix', () => {
    const history = [
      entry(
        2,
        {
          type: 'TICK_RESOLVED',
          tick: 5,
          results: [
            tickResult('R1', { outcome: 'MOVED', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } }),
            tickResult('R2', { outcome: 'IDLE' }),
            tickResult('R3', { outcome: 'IDLE' }),
          ],
        },
        5,
      ),
    ];
    const hidden = buildBlocks(history, false, 10).blocks[0];
    if (hidden?.kind !== 'tick') throw new Error('expected a tick block');
    expect(hidden.summary).toBe('Tick 5 - 1 moved (2 idle hidden)');
    expect(hidden.lines.map((l) => l.robot)).toEqual(['R1']);

    const shown = buildBlocks(history, true, 10).blocks[0];
    if (shown?.kind !== 'tick') throw new Error('expected a tick block');
    expect(shown.summary).toBe('Tick 5 - 1 moved, 2 idle');
    expect(shown.lines.map((l) => l.robot)).toEqual(['R1', 'R2', 'R3']);
  });

  it('marks all-idle and robot-less ticks as empty groups', () => {
    const idle = buildBlocks([tick(1, 5, ['R1', 'R2', 'R3'], 'IDLE')], false, 10).blocks[0];
    if (idle?.kind !== 'tick') throw new Error('expected a tick block');
    expect(idle.empty).toBe(true);
    expect(idle.summary).toBe('Tick 5 - nothing happened (3 idle hidden)');
    const none = buildBlocks([tick(1, 6, [])], false, 10).blocks[0];
    if (none?.kind !== 'tick') throw new Error('expected a tick block');
    expect(none.empty).toBe(true);
    expect(none.summary).toBe('Tick 6 - no robots on the floor');
  });

  it('caps the number of blocks and reports that more exist', () => {
    const history = Array.from({ length: 5 }, (_, i) => placed(i + 1, `R${i + 1}`));
    const { blocks, hasMore } = buildBlocks(history, false, 2);
    expect(blocks.map((b) => b.seq)).toEqual([5, 4]);
    expect(hasMore).toBe(true);
  });
});
