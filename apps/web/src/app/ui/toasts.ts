import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../store/toast.service';

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    class="region"
    data-testid="toast-region"
    role="region"
    aria-label="Notifications"
  >
    @for (toast of service.toasts(); track toast.id) {
      <div
        class="toast"
        data-testid="toast"
        [attr.role]="toast.kind === 'error' ? 'alert' : 'status'"
        [attr.data-reason]="toast.reason"
        [attr.data-kind]="toast.kind"
        [attr.data-stale]="toast.stale ? 'true' : 'false'"
        [attr.title]="toast.title ?? null"
        (mouseenter)="service.pause(toast.id)"
        (mouseleave)="service.resume(toast.id)"
        (focusin)="service.pause(toast.id)"
        (focusout)="service.resume(toast.id)"
      >
        <span class="icon" aria-hidden="true">{{ toast.kind === 'error' ? '⚠' : 'ℹ' }}</span>
        <div class="body">
          <div data-testid="toast-message">{{ toast.message }}</div>
          @if (toast.stale && toast.detail) {
            <div class="detail" data-testid="toast-detail">{{ toast.detail }}</div>
          }
        </div>
        <button
          type="button"
          class="dismiss"
          data-testid="toast-dismiss"
          aria-label="Dismiss"
          (click)="service.dismiss(toast.id)"
        >
          ✕
        </button>
      </div>
    }
  </div>`,
  styles: `
    .region {
      position: fixed;
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      pointer-events: none;
      left: var(--space-4);
      right: var(--space-4);
      bottom: var(--space-4);
    }
    @media (min-width: 900px) {
      /* Bottom right keeps the connection badge, toolbar and command pad uncovered. */
      .region {
        left: auto;
        bottom: var(--space-4);
        right: var(--space-4);
        width: 380px;
      }
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 2px solid var(--toast-line);
      border-radius: var(--radius-2);
      background: var(--toast-bg);
      color: var(--toast-fg);
      box-shadow: var(--shadow-2);
    }
    .toast[data-kind='error'] {
      --toast-fg: var(--toast-error-fg);
      --toast-bg: var(--toast-error-bg);
      --toast-line: var(--toast-error-line);
    }
    .toast[data-kind='info'] {
      --toast-fg: var(--toast-info-fg);
      --toast-bg: var(--toast-info-bg);
      --toast-line: var(--toast-info-line);
    }
    .icon {
      font-size: 1.25rem;
      line-height: 1.2;
    }
    .body {
      flex: 1;
      min-width: 0;
    }
    .detail {
      margin-top: var(--space-1);
      font-size: var(--text-sm);
      font-style: italic;
    }
    .dismiss {
      min-width: 32px;
      min-height: 32px;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      border-radius: var(--radius-1);
    }
  `,
})
export class Toasts {
  protected readonly service = inject(ToastService);
}
