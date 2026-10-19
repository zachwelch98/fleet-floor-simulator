import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ScenarioDef } from '../core/scenarios';
import type { RunView } from '../store/scenario.store';

/**
 * Scenario picker (docs/design/UI_SPEC.md, sidebar top): choose a scenario, Load it onto the shared
 * floor, then Play or Step. Kept compact (heading, select, Load/Reload, one-line summary) so it never
 * crowds Robots and History; the checkpoints are in ScenarioResults, under the floor (DECISIONS 5.7).
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
        @if (uploaded().length > 0) {
          <optgroup label="Uploaded">
            @for (s of uploaded(); track s.id) {
              <option [value]="s.id" [selected]="s.id === selectedId()">{{ s.title }}</option>
            }
          </optgroup>
        }
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

    <div class="files">
      <button
        type="button"
        class="btn btn-small"
        data-testid="btn-upload-scenario"
        aria-label="Upload scenario file"
        [disabled]="loading()"
        (click)="scenarioFile.click()"
      >
        Upload…
      </button>
      <input
        #scenarioFile
        type="file"
        hidden
        aria-label="Scenario file"
        data-testid="input-upload-scenario"
        (change)="chosen($event, 'scenario')"
      />
      @if (selectedIsUpload()) {
        <button
          type="button"
          class="btn btn-small"
          data-testid="btn-attach-expected"
          [attr.aria-label]="
            hasExpected() ? 'Replace expected output file' : 'Attach expected output file'
          "
          [disabled]="loading()"
          (click)="expectedFile.click()"
        >
          Expected…
        </button>
        <input
          #expectedFile
          type="file"
          hidden
          aria-label="Expected output file"
          data-testid="input-upload-expected"
          (change)="chosen($event, 'expected')"
        />
        <button
          type="button"
          class="btn btn-small btn-danger"
          data-testid="btn-remove-upload"
          aria-label="Remove uploaded scenario"
          [disabled]="loading()"
          (click)="removeUpload.emit()"
        >
          Remove
        </button>
      }
    </div>
    @if (uploadError(); as err) {
      <p class="error" role="alert" data-testid="upload-error">
        {{ err }}
        <button
          type="button"
          class="btn btn-small"
          data-testid="btn-dismiss-upload-error"
          (click)="dismissError.emit()"
        >
          Dismiss
        </button>
      </p>
    }

    @if (run(); as r) {
      <p
        class="summary"
        role="status"
        data-testid="scenario-summary"
        [attr.data-state]="summaryState()"
      >
        @if (r.refused) {
          Not run live
        } @else if (r.checkpoints.length === 0) {
          No REPORT lines
        } @else {
          {{ r.passed }} / {{ r.checkpoints.length }} passed
        }
      </p>
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
    p {
      margin: 0;
    }
    .pick {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .files {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .error {
      font-size: var(--text-sm);
      color: var(--color-danger);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
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
  `,
})
export class ScenarioPanel {
  readonly scenarios = input.required<readonly ScenarioDef[]>();
  readonly selectedId = input.required<string>();
  readonly loading = input(false);
  readonly connected = input.required<boolean>();
  readonly run = input<RunView | null>(null);
  readonly uploadError = input<string | null>(null);

  readonly select = output<string>();
  readonly load = output<void>();
  readonly reload = output<void>();
  readonly uploadScenario = output<File>();
  readonly attachExpected = output<File>();
  readonly removeUpload = output<void>();
  readonly dismissError = output<void>();

  protected readonly brief = computed(() => this.scenarios().filter((s) => s.group === 'brief'));
  protected readonly curated = computed(() =>
    this.scenarios().filter((s) => s.group === 'curated'),
  );
  protected readonly uploaded = computed(() =>
    this.scenarios().filter((s) => s.group === 'uploaded'),
  );
  protected readonly selectedUpload = computed(() =>
    this.uploaded().find((s) => s.id === this.selectedId()),
  );
  protected readonly selectedIsUpload = computed(() => this.selectedUpload() !== undefined);
  protected readonly hasExpected = computed(
    () => this.selectedUpload()?.expectedText !== undefined,
  );
  protected readonly summaryState = computed(() => {
    const r = this.run();
    if (!r) {
      return 'pending';
    }
    if (r.refused) {
      return 'pending';
    }
    if (r.checkpoints.some((c) => c.status === 'fail')) {
      return 'failed';
    }
    return r.complete && r.checkpoints.length > 0 ? 'passed' : 'pending';
  });

  protected chosen(event: Event, which: 'scenario' | 'expected'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be picked again
    if (!file) {
      return;
    }
    if (which === 'scenario') {
      this.uploadScenario.emit(file);
    } else {
      this.attachExpected.emit(file);
    }
  }

  protected pick(event: Event): void {
    this.select.emit((event.target as HTMLSelectElement).value);
  }
}
