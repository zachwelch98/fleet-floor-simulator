import { describe, expect, it } from 'vitest';
import { blurTextEntry, decideKey, type KeyContext, type KeyInput } from './keys';

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  hasSelection: true,
  gotoArmed: false,
  modalOpen: false,
  ...over,
});
const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  repeat: false,
  defaultPrevented: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: document.body,
  ...over,
});

describe('decideKey', () => {
  it('maps arrows to commands only while a robot is selected', () => {
    expect(decideKey(key('ArrowUp'), ctx())).toEqual({ type: 'command', kind: 'MOVE' });
    expect(decideKey(key('ArrowLeft'), ctx())).toEqual({ type: 'command', kind: 'LEFT' });
    expect(decideKey(key('ArrowRight'), ctx())).toEqual({ type: 'command', kind: 'RIGHT' });
    expect(decideKey(key('ArrowUp'), ctx({ hasSelection: false }))).toBeNull();
  });

  it('swallows Arrow Down under a selection and ignores it otherwise', () => {
    expect(decideKey(key('ArrowDown'), ctx())).toEqual({ type: 'swallow' });
    expect(decideKey(key('ArrowDown'), ctx({ hasSelection: false }))).toBeNull();
  });

  it('does not queue on key repeat', () => {
    expect(decideKey(key('ArrowUp', { repeat: true }), ctx())).toEqual({ type: 'swallow' });
  });

  it('disarms GOTO first, then deselects, then does nothing', () => {
    expect(decideKey(key('Escape'), ctx({ gotoArmed: true }))).toEqual({ type: 'disarm' });
    expect(decideKey(key('Escape'), ctx())).toEqual({ type: 'deselect' });
    expect(decideKey(key('Escape'), ctx({ hasSelection: false }))).toBeNull();
  });

  it('ignores modified keys, handled events, open dialogs and text-entry targets', () => {
    expect(decideKey(key('ArrowUp', { ctrlKey: true }), ctx())).toBeNull();
    expect(decideKey(key('ArrowUp', { metaKey: true }), ctx())).toBeNull();
    expect(decideKey(key('ArrowUp', { altKey: true }), ctx())).toBeNull();
    expect(decideKey(key('ArrowUp', { defaultPrevented: true }), ctx())).toBeNull();
    expect(decideKey(key('ArrowUp'), ctx({ modalOpen: true }))).toBeNull();
    for (const type of ['range', 'number', 'text']) {
      const input = document.createElement('input');
      input.type = type;
      expect(decideKey(key('ArrowLeft', { target: input }), ctx())).toBeNull();
    }
    expect(
      decideKey(key('ArrowLeft', { target: document.createElement('select') }), ctx()),
    ).toBeNull();
    expect(
      decideKey(key('ArrowLeft', { target: document.createElement('textarea') }), ctx()),
    ).toBeNull();
  });

  it('does not treat a focused checkbox as text entry', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(decideKey(key('ArrowUp', { target: box }), ctx())).toEqual({
      type: 'command',
      kind: 'MOVE',
    });
  });

  it('still acts when a button has focus', () => {
    expect(decideKey(key('ArrowUp', { target: document.createElement('button') }), ctx())).toEqual({
      type: 'command',
      kind: 'MOVE',
    });
  });
});

describe('blurTextEntry', () => {
  it('blurs a focused slider or text input but leaves buttons alone', () => {
    const slider = document.createElement('input');
    slider.type = 'range';
    const button = document.createElement('button');
    document.body.append(slider, button);
    slider.focus();
    expect(document.activeElement).toBe(slider);
    blurTextEntry();
    expect(document.activeElement).not.toBe(slider);
    button.focus();
    blurTextEntry();
    expect(document.activeElement).toBe(button);
    slider.remove();
    button.remove();
  });
});
