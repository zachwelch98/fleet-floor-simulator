import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Robot } from '@fleet/engine';

/** Selection panel and on-screen command buttons (UI_SPEC 3.4). Shows no queue. */
@Component({
  selector: 'app-command-pad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section
    class="panel pad"
    data-testid="selection-panel"
    aria-label="Selected robot"
    [attr.data-robot]="selectedRobot()?.id ?? null"
  >
    @if (selectedRobot(); as r) {
      <p class="title" data-testid="selection-title">
        Selected: {{ r.id }} · ({{ r.x }},{{ r.y }}) · facing {{ r.facing }}
      </p>
      <p class="hint muted">Esc to deselect</p>
    } @else {
      <p class="title" data-testid="selection-title">
        No robot selected. Click a robot on the grid or in the list.
      </p>
    }
    <div class="buttons">
      <button
        type="button"
        class="btn"
        data-testid="btn-cmd-left"
        aria-keyshortcuts="ArrowLeft"
        [disabled]="!selectedRobot() || disabled()"
        (click)="command.emit('LEFT')"
      >
        ◀ Left <span class="key" aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        class="btn"
        data-testid="btn-cmd-move"
        aria-keyshortcuts="ArrowUp"
        [disabled]="!selectedRobot() || disabled()"
        (click)="command.emit('MOVE')"
      >
        ▲ Move <span class="key" aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        class="btn"
        data-testid="btn-cmd-right"
        aria-keyshortcuts="ArrowRight"
        [disabled]="!selectedRobot() || disabled()"
        (click)="command.emit('RIGHT')"
      >
        Right ▶ <span class="key" aria-hidden="true">→</span>
      </button>
      <button
        type="button"
        class="btn goto"
        data-testid="btn-goto-mode"
        [attr.aria-pressed]="gotoArmed()"
        [attr.data-armed]="gotoArmed() ? 'true' : 'false'"
        [disabled]="!selectedRobot() || disabled()"
        (click)="toggleGoto.emit()"
      >
        {{ gotoArmed() ? 'GOTO: pick a cell' : '⌖ GOTO…' }}
      </button>
    </div>
  </section>`,
  styles: `
    :host {
      display: block;
    }
    .pad {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    p {
      margin: 0;
    }
    .title {
      font-weight: 700;
    }
    .hint {
      font-size: var(--text-sm);
    }
    .buttons {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-2);
    }
    .btn {
      padding: 0 var(--space-2);
      white-space: nowrap;
    }
    .key {
      color: var(--color-text-muted);
      font-weight: 400;
    }
    .goto {
      grid-column: 1 / -1;
    }
    .goto[aria-pressed='true'] {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-ink);
    }
  `,
})
export class CommandPad {
  readonly selectedRobot = input<Robot | null>(null);
  readonly gotoArmed = input(false);
  readonly disabled = input(false);

  readonly command = output<'MOVE' | 'LEFT' | 'RIGHT'>();
  readonly toggleGoto = output<void>();
}
