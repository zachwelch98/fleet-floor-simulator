import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FLOOR_SIZE_MAX, FLOOR_SIZE_MIN } from '../core/copy';
import { FloorStore } from '../store/floor.store';

function parseSize(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }
  const n = Number(raw);
  return n >= FLOOR_SIZE_MIN && n <= FLOOR_SIZE_MAX ? n : null;
}

/** "New floor…" modal (UI_SPEC 3.7): native <dialog>, native focus trap and Esc handling. */
@Component({
  selector: 'app-new-floor-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<dialog
    #dlg
    data-testid="dialog-new-floor"
    aria-labelledby="new-floor-title"
    (close)="closed.emit()"
  >
    <form (submit)="onSubmit($event)" novalidate>
      <h2 id="new-floor-title">New floor</h2>
      <p>This clears all robots, obstacles and queues. The history log is kept.</p>
      <div class="fields">
        <label>
          <span>Width</span>
          <input
            #widthInput
            type="number"
            data-testid="input-floor-width"
            [min]="min"
            [max]="max"
            step="1"
            required
            [value]="width()"
            (input)="width.set($any($event.target).value)"
          />
        </label>
        <label>
          <span>Height</span>
          <input
            type="number"
            data-testid="input-floor-height"
            [min]="min"
            [max]="max"
            step="1"
            required
            [value]="height()"
            (input)="height.set($any($event.target).value)"
          />
        </label>
      </div>
      @if (!valid()) {
        <p class="error" role="alert" data-testid="floor-dialog-error">
          Enter whole numbers from 1 to 20.
        </p>
      }
      <div class="actions">
        <button type="button" class="btn" data-testid="btn-floor-cancel" (click)="close()">
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          data-testid="btn-floor-create"
          [disabled]="!valid() || pending()"
        >
          Create floor
        </button>
      </div>
    </form>
  </dialog>`,
  styles: `
    dialog {
      width: min(92vw, 420px);
      padding: var(--space-5);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-2);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-2);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.5);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    h2,
    p {
      margin: 0;
    }
    .fields {
      display: flex;
      gap: var(--space-4);
    }
    label {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      font-weight: 600;
    }
    input {
      width: 7em;
      min-height: var(--control-height);
      padding: 0 var(--space-3);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-1);
      background: var(--color-bg);
      color: var(--color-text);
      font: inherit;
    }
    .error {
      color: var(--color-danger);
      font-weight: 600;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-3);
    }
  `,
})
export class NewFloorDialog {
  private readonly store = inject(FloorStore);
  private readonly injector = inject(Injector);

  readonly open = input(false);
  readonly closed = output<void>();

  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly widthInput = viewChild.required<ElementRef<HTMLInputElement>>('widthInput');

  protected readonly min = FLOOR_SIZE_MIN;
  protected readonly max = FLOOR_SIZE_MAX;
  protected readonly width = signal('10');
  protected readonly height = signal('8');
  protected readonly pending = signal(false);
  protected readonly valid = computed(
    () => parseSize(this.width()) !== null && parseSize(this.height()) !== null,
  );

  constructor() {
    effect(() => {
      const wantOpen = this.open();
      const dialog = this.dlg().nativeElement;
      if (wantOpen && !dialog.open) {
        untracked(() => this.show(dialog));
      } else if (!wantOpen && dialog.open) {
        this.close();
      }
    });
  }

  protected close(): void {
    const dialog = this.dlg().nativeElement;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      this.closed.emit();
    }
  }

  private show(dialog: HTMLDialogElement): void {
    const state = this.store.state();
    if (state) {
      this.width.set(String(state.width));
      this.height.set(String(state.height));
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    afterNextRender(() => this.widthInput().nativeElement.focus(), { injector: this.injector });
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const w = parseSize(this.width());
    const h = parseSize(this.height());
    if (w === null || h === null || this.pending()) {
      return;
    }
    this.pending.set(true);
    try {
      if (await this.store.createFloor(w, h)) {
        this.close();
      }
    } finally {
      this.pending.set(false);
    }
  }
}
