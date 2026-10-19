import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/index.js';

describe('formatReport', () => {
  it('prints EMPTY for no robots', () => {
    expect(formatReport([])).toEqual(['EMPTY']);
  });

  it('prints one line per robot, sorted by robot number (not by text)', () => {
    const lines = formatReport([
      { id: 'R10', num: 10, x: 4, y: 0, facing: 'WEST' },
      { id: 'R2', num: 2, x: 1, y: 3, facing: 'SOUTH' },
    ]);
    expect(lines).toEqual(['R2 1,3,SOUTH', 'R10 4,0,WEST']);
  });
});
