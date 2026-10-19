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
    <span>{{ label() }}</span>
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
