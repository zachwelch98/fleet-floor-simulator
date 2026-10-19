import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MAX_LIVE_TICKS } from '../core/scenarios';
import type { CheckpointStatus, RunView } from '../store/scenario.store';

const BADGE: Record<CheckpointStatus, string> = { pending: '…', pass: '✓', fail: '✗', na: '–' };
const WORD: Record<CheckpointStatus, string> = {
  pending: 'Pending',
  pass: 'Passed',
  fail: 'Failed',
  na: 'Not run live',
};
/** Reuses the outcome colors (styles.css [data-group]): pass = moved, fail = blocked, pending = idle. */
const GROUP: Record<CheckpointStatus, string> = {
  pending: 'idle',
  pass: 'moved',
  fail: 'blocked',
  na: 'idle',
};

/** The file name as a shell would need it: quoted only when it has characters the shell would split on. */
export function shellName(fileName: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(fileName)
    ? fileName
    : `'${fileName.replace(/'/g, `'\\''`)}'`;
}

/**
 * Scenario results, shown under the floor grid while a run is active: the scenario's title, the
 * runner's own output (what `npm run scenario` prints), the lines it ignored, and each REPORT as
 * expected / live / (runner when it differs), turning into a pass or a fail. Lives next to the
 * floor it describes (DECISIONS 5.7, 5.8); the compact picker and the one-line summary stay in the
 * sidebar. Presentational: ScenarioStore holds the state.
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
      @if (r.refused) {
        <p class="note" data-testid="scenario-refused">
          This script has {{ r.active.def.totalTicks }} ticks, more than the {{ maxTicks }} a live
          run plays, so the floor was left alone. The runner's output and checks are below.
        </p>
      } @else if (r.modified) {
        <p class="note" data-testid="scenario-modified">
          The floor was edited after loading, so the run stopped and results may not match.
        </p>
      } @else if (r.failed) {
        <p class="note" data-testid="scenario-failed">
          A command was refused or the connection dropped, so the run stopped.
        </p>
      } @else if (r.passed === 0 && !r.complete && r.checkpoints[0]?.status === 'pending') {
        <p class="note muted" data-testid="scenario-hint">Press Play or Step.</p>
      }
      @if (r.active.def.expectedLineMismatch; as m) {
        <p class="note" data-testid="expected-line-count">
          The expected file has {{ m.expected }} lines, but the runner prints {{ m.runner }}.
        </p>
      }

      <div class="runner" data-testid="runner-output">
        <p class="after">Runner output</p>
        <p class="cmd" data-testid="runner-command">
          <code>npm run scenario -- {{ shellName(r.active.def.fileName) }}</code>
        </p>
        <pre class="lines" data-testid="runner-lines">{{ runnerText(r) }}</pre>
      </div>

      @if (r.active.def.trace.ignored.length > 0) {
        <details class="ignored" data-testid="ignored-lines">
          <summary>Ignored lines ({{ r.active.def.trace.ignored.length }})</summary>
          <ul>
            @for (i of r.active.def.trace.ignored; track i.line) {
              <li data-testid="ignored-line">
                <span class="after">Line {{ i.line }}</span>
                <code>{{ i.text }}</code>
                <span class="why">{{ i.why }}</span>
              </li>
            }
          </ul>
        </details>
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
              <p class="after">
                {{ c.afterTicks === 0 ? 'Before the first tick' : 'After tick ' + c.afterTicks }}
              </p>
              <p class="after">Expected</p>
              <pre class="lines" data-testid="checkpoint-expected">{{ c.expected.join(nl) }}</pre>
              @if (c.live) {
                <p class="after">Live</p>
                <pre
                  class="lines live"
                  data-testid="checkpoint-actual"
                  [class.differs]="c.status === 'fail'"
                  >{{ c.live.join(nl) }}</pre>
              }
              @if (c.runnerDiffers) {
                <p class="after mark" data-testid="checkpoint-runner-differs">Runner ≠ expected</p>
                <pre class="lines" data-testid="checkpoint-runner">{{ c.runner.join(nl) }}</pre>
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
    pre,
    ul {
      margin: 0;
    }
    .title {
      font-weight: 700;
    }
    .note {
      font-size: var(--text-sm);
    }
    .runner {
      min-width: 0;
    }
    .cmd code,
    .ignored code {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
    .runner .lines {
      padding: var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-1);
      background: var(--color-bg);
      user-select: all;
    }
    .ignored summary {
      cursor: pointer;
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .ignored ul {
      list-style: none;
      padding: 0;
      display: grid;
      gap: var(--space-1);
      margin-top: var(--space-1);
    }
    .ignored li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      font-size: var(--text-sm);
    }
    .why {
      color: var(--color-text-muted, inherit);
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
    .mark {
      text-decoration: underline;
    }
    .lines {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      white-space: pre-wrap;
    }
    .live {
      font-weight: 700;
    }
  `,
})
export class ScenarioResults {
  readonly run = input<RunView | null>(null);

  protected readonly nl = '\n';
  protected readonly maxTicks = MAX_LIVE_TICKS;
  protected readonly shellName = shellName;

  protected badge(status: CheckpointStatus): string {
    return BADGE[status];
  }
  protected word(status: CheckpointStatus): string {
    return WORD[status];
  }
  protected group(status: CheckpointStatus): string {
    return GROUP[status];
  }
  protected runnerText(r: RunView): string {
    const lines = r.active.def.trace.reports.flat();
    return lines.length === 0 ? '(no output: the script has no REPORT)' : lines.join('\n');
  }
}
