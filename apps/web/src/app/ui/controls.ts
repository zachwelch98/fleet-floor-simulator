import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MAX_TICK_INTERVAL_MS, MIN_TICK_INTERVAL_MS } from '@fleet/protocol';

/** Toolbar (UI_SPEC 3.2): Step, Play/Pause, interval, edit-mode switch, New floor. */
@Component({
  selector: 'app-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="toolbar" role="toolbar" aria-label="Simulation controls">
    <div class="group">
      <button
        type="button"
        class="btn"
        data-testid="btn-step"
        [disabled]="playing() || !connected()"
        (click)="step.emit()"
      >
        Step
      </button>
      <button
        type="button"
        class="btn btn-primary play"
        data-testid="btn-play"
        [attr.data-playing]="playing() ? 'true' : 'false'"
        [disabled]="!connected()"
        (click)="onPlayClick()"
      >
        {{ playing() ? 'Pause' : 'Play' }}
      </button>
      <span class="playing muted" [style.visibility]="playing() ? 'visible' : 'hidden'"
        >Playing every {{ intervalMs() }} ms</span
      >
    </div>

    <label class="interval">
      <span>Tick interval</span>
      <input
        type="range"
        data-testid="input-interval"
        [min]="min"
        [max]="max"
        step="100"
        [value]="intervalMs()"
        (input)="onInterval($event)"
      />
      <output data-testid="interval-value">{{ intervalMs() }} ms</output>
    </label>

    <div class="group">
      <button
        type="button"
        class="btn switch"
        data-testid="toggle-edit"
        [attr.aria-pressed]="editMode()"
        [attr.data-on]="editMode() ? 'true' : 'false'"
        (click)="editModeChange.emit(!editMode())"
      >
        <span class="switch-state">{{ editMode() ? 'On' : 'Off' }}</span>
        <span>Edit obstacles</span>
      </button>
      <button
        type="button"
        class="btn"
        data-testid="btn-new-floor"
        [disabled]="!connected()"
        (click)="openNewFloor.emit()"
      >
        New floor…
      </button>
    </div>
  </div>`,
  styles: `
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3) var(--space-5);
      padding: var(--space-2) var(--space-4);
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
    }
    .group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
    }
    /* Always laid out (hidden when paused) so Play never shifts the slider and buttons beside it. */
    .playing {
      min-width: 22ch;
      font-variant-numeric: tabular-nums;
    }
    .play {
      /* "Pause" is wider than "Play": keep the button the same size in both states. */
      min-width: 7.5rem;
    }
    .play::before {
      content: '▶';
    }
    .play[data-playing='true']::before {
      content: '❚❚';
    }
    .interval {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex: 1 1 280px;
      max-width: 520px;
      min-height: var(--control-height);
    }
    .interval input {
      flex: 1;
      min-width: 120px;
      height: var(--control-height);
      accent-color: var(--color-accent);
    }
    output {
      min-width: 6ch;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .switch-state {
      min-width: 3ch;
      padding: 2px var(--space-2);
      border-radius: var(--radius-pill);
      border: 1px solid currentColor;
      font-size: var(--text-xs);
    }
    .switch[aria-pressed='true'] {
      background: var(--color-edit-bg);
      color: var(--color-edit-ink);
      border-color: var(--color-edit);
    }
    .switch[aria-pressed='true']:hover:not(:disabled) {
      background: var(--color-edit-bg);
    }
    @media (max-width: 899px) {
      /* Phones: the Pause label and the slider value already say it; no text to reflow. */
      .playing {
        display: none;
      }
      .group:first-child .btn:not(:last-child) {
        flex: 1;
      }
      .interval {
        flex-basis: 100%;
        max-width: none;
      }
    }
  `,
})
export class Controls {
  readonly playing = input.required<boolean>();
  readonly intervalMs = input.required<number>();
  readonly editMode = input.required<boolean>();
  readonly connected = input.required<boolean>();

  readonly step = output<void>();
  readonly play = output<number>();
  readonly pause = output<void>();
  readonly intervalChange = output<number>();
  readonly editModeChange = output<boolean>();
  readonly openNewFloor = output<void>();

  protected readonly min = MIN_TICK_INTERVAL_MS;
  protected readonly max = MAX_TICK_INTERVAL_MS;

  protected onPlayClick(): void {
    if (this.playing()) {
      this.pause.emit();
    } else {
      this.play.emit(this.intervalMs());
    }
  }

  protected onInterval(event: Event): void {
    this.intervalChange.emit((event.target as HTMLInputElement).valueAsNumber);
  }
}
