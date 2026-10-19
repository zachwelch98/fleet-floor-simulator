import { Injectable, signal } from '@angular/core';
import type { ToastReason } from '../core/copy';

export interface Toast {
  readonly id: number;
  readonly reason: ToastReason;
  readonly kind: 'error' | 'info';
  readonly message: string;
  readonly detail?: string;
  readonly stale: boolean;
  /** Developer-facing server text, kept in the element title only. */
  readonly title?: string;
}

export interface ToastInput {
  readonly reason: ToastReason;
  readonly kind: 'error' | 'info';
  readonly message: string;
  readonly detail?: string;
  readonly stale?: boolean;
  readonly title?: string;
}

export const MAX_TOASTS = 3;
export const ERROR_TOAST_MS = 6_000;
export const INFO_TOAST_MS = 4_000;

/**
 * Toast list with auto-dismiss (6 s error, 4 s info), pause on hover/focus, a cap of 3 and
 * "identical toast restarts its timer instead of stacking" (UI_SPEC 3.6).
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<readonly Toast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(input: ToastInput): void {
    const existing = this.toasts().find(
      (t) => t.reason === input.reason && t.message === input.message,
    );
    if (existing) {
      this.toasts.update((list) =>
        list.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                stale: input.stale ?? false,
                ...(input.detail ? { detail: input.detail } : {}),
              }
            : t,
        ),
      );
      this.startTimer(existing.id);
      return;
    }
    const toast: Toast = {
      id: this.nextId++,
      reason: input.reason,
      kind: input.kind,
      message: input.message,
      stale: input.stale ?? false,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.title ? { title: input.title } : {}),
    };
    let list = [...this.toasts(), toast];
    while (list.length > MAX_TOASTS) {
      this.clearTimer(list[0]!.id);
      list = list.slice(1);
    }
    this.toasts.set(list);
    this.startTimer(toast.id);
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Hover or keyboard focus inside the toast. */
  pause(id: number): void {
    this.clearTimer(id);
  }

  resume(id: number): void {
    if (this.toasts().some((t) => t.id === id)) {
      this.startTimer(id);
    }
  }

  private startTimer(id: number): void {
    this.clearTimer(id);
    const toast = this.toasts().find((t) => t.id === id);
    if (!toast) {
      return;
    }
    const ms = toast.kind === 'error' ? ERROR_TOAST_MS : INFO_TOAST_MS;
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), ms),
    );
  }

  private clearTimer(id: number): void {
    const t = this.timers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }
}
