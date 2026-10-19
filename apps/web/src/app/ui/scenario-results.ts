import { ChangeDetectionStrategy, Component, input } from '@angular/core';
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
 * Scenario checkpoints, shown under the floor grid while a run is active: the scenario's title and
 * each REPORT's expected lines turning into a pass or a fail. Lives next to the floor it describes
 * (DECISIONS 5.7); the compact picker and the one-line summary stay in the sidebar.
 * Presentational: ScenarioStore holds the state.
 */
@Component({
  selector: 'app-scenario-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (run(); as r) {
    <section class="panel results" data-testid="scenario-results" aria-labelledby="sr-title">
      <h2 class="panel-title" id="sr-title">Scenario checkpoints</h2>
      <p class="title" data-testid="scenario-title" [attr.data-scenario]="r.active.def.id">
        {{ r.active.def.title }}
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
    </section>
  }`,
  styles: `
    :host {
      display: block;
      margin-top: var(--space-4);
    }
    .results {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    p,
    pre {
      margin: 0;
    }
    .title {
      font-weight: 700;
    }
    .note {
      font-size: var(--text-sm);
    }
    .checkpoints {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      /* Cards wrap to as many columns as the floor column has room for; the column itself scrolls. */
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: var(--space-2);
    }
    .checkpoint {
      /* Containing block for the visually-hidden status word, so nothing escapes the card. */
      position: relative;
      display: flex;
      gap: var(--space-2);
      min-width: 0;
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
export class ScenarioResults {
  readonly run = input<RunView | null>(null);

  protected badge(status: CheckpointStatus): string {
    return BADGE[status];
  }
  protected word(status: CheckpointStatus): string {
    return WORD[status];
  }
  protected group(status: CheckpointStatus): string {
    return GROUP[status];
  }
}
