import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOADS, MAX_UPLOAD_BYTES, UPLOADS_KEY, UploadsStore } from './uploads.store';

const SCRIPT = 'FLOOR 4,3\nPLACE R1 0,0,EAST\nQUEUE R1 MOVE\nTICK\nREPORT\n';

function make(): UploadsStore {
  TestBed.resetTestingModule();
  return TestBed.inject(UploadsStore);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UploadsStore', () => {
  it('adds a scenario named after the file, with a stable id', () => {
    const store = make();
    const def = store.add('my floor test.txt', SCRIPT)!;
    expect(def.id).toBe('upload:my-floor-test-txt-1');
    expect(def.title).toBe('my floor test.txt');
    expect(def.group).toBe('uploaded');
    expect(def.fileName).toBe('my floor test.txt');
    expect(def.checkpoints).toHaveLength(1);
    expect(store.uploads().map((u) => u.id)).toEqual([def.id]);

    const second = store.add('notes', SCRIPT)!;
    expect(second.id).toBe('upload:notes-2');
    store.remove(def.id);
    expect(store.add('another', SCRIPT)!.id).toBe('upload:another-3'); // ids are not reused
  });

  it('keeps uploads across a reload, with the attached expected file', () => {
    const store = make();
    const def = store.add('a.txt', SCRIPT)!;
    store.attachExpected(def.id, 'R1 1,0,EAST\n');

    const reloaded = make();
    const [again] = reloaded.uploads();
    expect(again?.id).toBe(def.id);
    expect(again?.expectedText).toBe('R1 1,0,EAST\n');
    expect(again?.checkpoints[0]?.expected).toEqual(['R1 1,0,EAST']);
  });

  it('Remove deletes it from the list and from storage', () => {
    const store = make();
    const def = store.add('a.txt', SCRIPT)!;
    store.remove(def.id);
    expect(store.uploads()).toEqual([]);
    expect(make().uploads()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(UPLOADS_KEY) ?? '{}')).toEqual({ uploads: [] });
  });

  it('refuses a file over 64 KB with an inline error, and keeps nothing', () => {
    const store = make();
    const big = '# '.padEnd(MAX_UPLOAD_BYTES + 1, 'x');
    expect(store.add('big.txt', big)).toBeNull();
    expect(store.error()).toMatch(/larger than 64 KB/);
    expect(store.uploads()).toEqual([]);
    expect(store.add('ok.txt', SCRIPT)).not.toBeNull();
    expect(store.error()).toBeNull();
  });

  it('refuses the 21st upload', () => {
    const store = make();
    for (let i = 0; i < MAX_UPLOADS; i++) {
      expect(store.add(`f${i}.txt`, SCRIPT)).not.toBeNull();
    }
    expect(store.add('one-too-many.txt', SCRIPT)).toBeNull();
    expect(store.error()).toMatch(/up to 20 uploads/);
    expect(store.uploads()).toHaveLength(MAX_UPLOADS);
  });

  it('refuses a binary file and a script with an absurd tick count', () => {
    const store = make();
    expect(store.add('bin', 'FLOOR 3,3\u0000')).toBeNull();
    expect(store.error()).toMatch(/text file/);
    expect(store.add('slow.txt', 'TICK 999999999\n')).toBeNull();
    expect(store.error()).toMatch(/too many ticks/);
  });

  it('works in memory when localStorage throws on every access', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    const store = make();
    expect(store.uploads()).toEqual([]);
    const def = store.add('a.txt', SCRIPT)!;
    expect(store.uploads().map((u) => u.id)).toEqual([def.id]);
    expect(store.attachExpected(def.id, 'R1 1,0,EAST\n')).not.toBeNull();
    store.remove(def.id);
    expect(store.uploads()).toEqual([]);
  });

  it('works when the localStorage property itself throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    try {
      const store = make();
      expect(store.add('a.txt', SCRIPT)).not.toBeNull();
      expect(store.uploads()).toHaveLength(1);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      }
    }
  });

  it('ignores corrupt stored data', () => {
    localStorage.setItem(UPLOADS_KEY, '{not json');
    expect(make().uploads()).toEqual([]);
    localStorage.setItem(UPLOADS_KEY, JSON.stringify({ uploads: [{ id: 5 }, 'x', null] }));
    expect(make().uploads()).toEqual([]);
    localStorage.setItem(UPLOADS_KEY, JSON.stringify({ uploads: 'nope' }));
    expect(make().uploads()).toEqual([]);
  });
});
