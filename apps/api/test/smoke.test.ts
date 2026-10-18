import { describe, expect, it } from 'vitest';
import { apply, createFloorState } from '@fleet/engine';
import { DEFAULT_FLOOR_ID } from '@fleet/protocol';

describe('workspace wiring', () => {
  it('resolves engine and protocol sources', () => {
    expect(DEFAULT_FLOOR_ID).toBe('main');
    expect(apply(createFloorState(2, 2), { type: 'TICK' }).ok).toBe(true);
  });
});
