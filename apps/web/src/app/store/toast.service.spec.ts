import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_TOAST_MS, INFO_TOAST_MS, MAX_TOASTS, ToastService } from './toast.service';

describe('ToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const err = (message: string, reason = 'OUT_OF_BOUNDS') =>
    ({ reason, kind: 'error', message }) as const;

  it('auto-dismisses errors after 6 s and info toasts after 4 s', () => {
    const toasts = new ToastService();
    toasts.show(err('a'));
    toasts.show({ reason: 'FLOOR_RESET', kind: 'info', message: 'b' });
    vi.advanceTimersByTime(INFO_TOAST_MS);
    expect(toasts.toasts().map((t) => t.message)).toEqual(['a']);
    vi.advanceTimersByTime(ERROR_TOAST_MS - INFO_TOAST_MS);
    expect(toasts.toasts()).toHaveLength(0);
  });

  it('keeps at most 3 and drops the oldest', () => {
    const toasts = new ToastService();
    for (const m of ['1', '2', '3', '4']) {
      toasts.show(err(m));
    }
    expect(toasts.toasts()).toHaveLength(MAX_TOASTS);
    expect(toasts.toasts().map((t) => t.message)).toEqual(['2', '3', '4']);
  });

  it('restarts the timer of an identical visible toast instead of stacking', () => {
    const toasts = new ToastService();
    toasts.show(err('same'));
    vi.advanceTimersByTime(5000);
    toasts.show(err('same'));
    expect(toasts.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(toasts.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(toasts.toasts()).toHaveLength(0);
  });

  it('pauses while hovered or focused and restarts on leave', () => {
    const toasts = new ToastService();
    toasts.show(err('hold'));
    const id = toasts.toasts()[0]!.id;
    toasts.pause(id);
    vi.advanceTimersByTime(60_000);
    expect(toasts.toasts()).toHaveLength(1);
    toasts.resume(id);
    vi.advanceTimersByTime(ERROR_TOAST_MS);
    expect(toasts.toasts()).toHaveLength(0);
  });

  it('carries the stale flag and detail', () => {
    const toasts = new ToastService();
    toasts.show({ ...err('x'), stale: true, detail: 'out of date' });
    expect(toasts.toasts()[0]).toMatchObject({ stale: true, detail: 'out of date' });
  });
});
