import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ScenarioDef } from '../core/scenarios';
import type { CheckpointStatus, RunView } from '../store/scenario.store';

const BADGE: Record<CheckpointStatus, string> = { pending: '…', pass: '✓', fail: '✗' };
const WORD: Record<CheckpointStatus, string> = {
  pending: 'Pending',
  pass: 'Passed',
  fail: 'Failed',
};
/** Reuses the outcome colors (styles.css [data-group]): pass = moved, fail = blocked, pending = idle. */
const GROUP: Record<CheckpointStatus, string> = { pending: 'idle', pass: 'moved', fail: 'blocked' };

/**
 * Scenario picker (docs/design/UI_SPEC.md, sidebar top): choose a scenario, Load it onto the shared
 * floor, then Play or Step and watch each REPORT's expected lines turn into a pass or a fail.
 * Presentational: ScenarioStore holds the state.
 */
@Component({
  selector: 'app-scenario-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section
    class="panel scenarios"
    data-testid="scenario-panel"
    aria-labelledby="sc-title"
  >
    <h2 class="panel-title" id="sc-title">Scenarios</h2>

    <div class="pick">
      <label class="visually-hidden" for="sc-select">Scenario</label>
      <select
        id="sc-select"
        class="select"
        data-testid="scenario-select"
        [value]="selectedId()"
        [disabled]="loading()"
        (change)="pick($event)"
      >
        <optgroup label="Brief examples">
          @for (s of brief(); track s.id) {
            <option [value]="s.id" [selected]="s.id === selectedId()">{{ s.title }}</option>
          }
        </optgroup>
        <optgroup label="More scenarios">
          @for (s of curated(); track s.id) {
            <option [value]="s.id" [selected]="s.id === selectedId()">{{ s.title }}</option>
          }
        </optgroup>
      </select>
      <button
        type="button"
        class="btn"
        data-testid="btn-load-scenario"
        [disabled]="!connected() || loading()"
        (click)="load.emit()"
      >
        {{ loading() ? 'Loading…' : 'Load' }}
      </button>
      @if (run()) {
        <button
          type="button"
          class="btn"
          data-testid="btn-reload-scenario"
          [disabled]="!connected() || loading()"
          (click)="reload.emit()"
        >
          Reload
        </button>
      }
    </div>

    @if (run(); as r) {
      <p class="title" data-testid="scenario-title" [attr.data-scenario]="r.active.def.id">
        {{ r.active.def.title }}
      </p>
      <p
        class="summary"
        role="status"
        data-testid="scenario-summary"
        [attr.data-state]="summaryState()"
      >
        {{ r.passed }} / {{ r.checkpoints.length }} passed
      </p>
      @if (r.modified) {
        <p class="note" data-testid="scenario-modified">
          The floor was edited after loading, so results may not match.
        </p>
      } @else if (r.passed === 0 && !r.complete && r.checkpoints[0]?.status === 'pending') {
        <p class="note muted" data-testid="scenario-hint">Press Play or Step.</p>
      }
      <ol class="checkpoints">
        @for (c of r.checkpoints; track c.index) {
          <li
            class="checkpoint"
            [attr.data-testid]="'checkpoint-' + c.index"
            [attr.data-status]="c.status"
            [attr.data-group]="group(c.status)"
          >
            <span class="badge"
              ><span aria-hidden="true">{{ badge(c.status) }}</span>
              <span class="visually-hidden">{{ word(c.status) }}</span></span
            >
            <div class="body">
              <p class="after">After tick {{ c.afterTicks }}</p>
              <pre class="lines" data-testid="checkpoint-expected">{{
                c.expected.join(
                  '
'
                )
              }}</pre>
              @if (c.status === 'fail' && c.actual) {
                <p class="after">Actual</p>
                <pre class="lines actual" data-testid="checkpoint-actual">{{
                  c.actual.join(
                    '
'
                  )
                }}</pre>
              }
            </div>
          </li>
        }
      </ol>
    }
  </section>`,
  styles: `
    :host {
      display: block;
    }
    .scenarios {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    p,
    pre {
      margin: 0;
    }
    .pick {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .select {
      flex: 1 1 8rem;
      min-width: 0;
      min-height: var(--control-height);
      padding: 0 var(--space-2);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-2);
      background: var(--color-bg);
      color: var(--color-text);
      font: inherit;
    }
    .select:disabled {
      opacity: 0.5;
    }
    .title {
      font-weight: 700;
    }
    .summary {
      align-self: flex-start;
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-pill);
      font-size: var(--text-sm);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .summary[data-state='passed'] {
      color: var(--outcome-moved-fg);
      background: var(--outcome-moved-bg);
      border-color: var(--outcome-moved-line);
    }
    .summary[data-state='failed'] {
      color: var(--outcome-blocked-fg);
      background: var(--outcome-blocked-bg);
      border-color: var(--outcome-blocked-line);
    }
    .note {
      font-size: var(--text-sm);
    }
    .checkpoints {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      /* A long scenario (six checkpoints) scrolls here instead of squeezing Robots and History. */
      max-height: 14rem;
      overflow: auto;
    }
    .checkpoint {
      display: flex;
      gap: var(--space-2);
      padding: var(--space-2);
      border: 1px solid var(--o-line);
      border-radius: var(--radius-1);
      background: var(--o-bg);
      color: var(--o-fg);
    }
    .badge {
      flex: none;
      width: 1.5rem;
      font-weight: 700;
      text-align: center;
    }
    .body {
      min-width: 0;
    }
    .after {
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .lines {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      white-space: pre-wrap;
    }
    .actual {
      font-weight: 700;
    }
  `,
})
export class ScenarioPanel {
  readonly scenarios = input.required<readonly ScenarioDef[]>();
  readonly selectedId = input.required<string>();
  readonly loading = input(false);
  readonly connected = input.required<boolean>();
  readonly run = input<RunView | null>(null);

  readonly select = output<string>();
  readonly load = output<void>();
  readonly reload = output<void>();

  protected readonly brief = computed(() => this.scenarios().filter((s) => s.group === 'brief'));
  protected readonly curated = computed(() =>
    this.scenarios().filter((s) => s.group === 'curated'),
  );
  protected readonly summaryState = computed(() => {
    const r = this.run();
    if (!r) {
      return 'pending';
    }
    if (r.checkpoints.some((c) => c.status === 'fail')) {
      return 'failed';
    }
    return r.complete ? 'passed' : 'pending';
  });

  protected badge(status: CheckpointStatus): string {
    return BADGE[status];
  }
  protected word(status: CheckpointStatus): string {
    return WORD[status];
  }
  protected group(status: CheckpointStatus): string {
    return GROUP[status];
  }

  protected pick(event: Event): void {
    this.select.emit((event.target as HTMLSelectElement).value);
  }
}
