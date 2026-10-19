import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ConnectionState } from '../store/floor.store';

const LABEL: Record<ConnectionState, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Offline',
};

/** Dot glyph AND a word, never color alone (UI_SPEC 3.5). */
@Component({
  selector: 'app-connection-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" data-testid="conn-status" [attr.data-state]="state()">
    <span class="dot" aria-hidden="true">●</span>
    <span class="label">{{ label() }}</span>
  </span>`,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      font-size: var(--text-sm);
      font-weight: 600;
      white-space: nowrap;
    }
    .dot {
      color: var(--color-text-muted);
    }
    /* Phones: the normal "Connected" state shrinks to the dot (the word stays for screen readers);
       Reconnecting and Offline keep their words. */
    @media (max-width: 419px) {
      .badge {
        position: relative;
      }
      .badge[data-state='connected'] {
        gap: 0;
      }
      .badge[data-state='connected'] .label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    }
    [data-state='connected'] .dot {
      color: var(--conn-connected);
    }
    [data-state='reconnecting'] .dot {
      color: var(--conn-reconnecting);
    }
    [data-state='disconnected'] .dot {
      color: var(--conn-disconnected);
    }
  `,
})
export class ConnectionBadge {
  readonly state = input.required<ConnectionState>();
  protected readonly label = computed(() => LABEL[this.state()]);
}
