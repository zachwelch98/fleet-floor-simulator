import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { LEGEND_BADGES, type LegendBadge } from '../core/copy';

/** localStorage key for the key's open / closed state (DECISIONS 5.9). */
export const LEGEND_OPEN_KEY = 'fleet.legendOpen.v1';

/** The browser's storage, or null when it is missing or blocked (private window, site data off). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether the key starts open: the remembered choice, and open when nothing readable is stored. */
export function readLegendOpen(): boolean {
  try {
    return storage()?.getItem(LEGEND_OPEN_KEY) !== 'closed';
  } catch {
    return true;
  }
}

export function writeLegendOpen(open: boolean): void {
  try {
    storage()?.setItem(LEGEND_OPEN_KEY, open ? 'open' : 'closed');
  } catch {
    // Storage is blocked or full: the choice just isn't remembered.
  }
}

const BADGE_GROUPS = [
  {
    id: 'blocked',
    title: 'Blocked last tick',
    entries: LEGEND_BADGES.filter((e) => e.group === 'blocked'),
  },
  {
    id: 'goto',
    title: 'GOTO last tick',
    entries: LEGEND_BADGES.filter((e) => e.group !== 'blocked'),
  },
] as const;

/**
 * The key under the floor: what the robot, obstacle and GOTO-ring symbols mean, and every
 * last-tick badge, drawn with the same pill the grid uses. Badges on the floor right now are
 * highlighted (`active`), the rest dim while at least one is. Open by default; the choice is
 * remembered in localStorage. Presentational: FloorGrid works out `active`.
 */
@Component({
  selector: 'app-grid-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<details
    class="key"
    data-testid="grid-legend"
    [attr.data-has-active]="activeList().length > 0 ? 'true' : 'false'"
    [open]="open()"
    (toggle)="onToggle($event)"
  >
    <summary data-testid="legend-summary">
      Key
      @if (activeList().length > 0) {
        <span class="on" data-testid="legend-on-floor">· {{ activeCodes() }} on the floor</span>
      }
    </summary>
    <div class="groups">
      <section class="group" aria-labelledby="key-grid">
        <h3 id="key-grid">On the grid</h3>
        <ul>
          <li data-testid="legend-robot">
            <span class="chip" aria-hidden="true">▲</span>
            <span class="text"
              ><span class="label">Robot</span>
              <span class="detail">the arrow shows facing</span></span
            >
          </li>
          <li data-testid="legend-obstacle">
            <span class="swatch" aria-hidden="true"></span>
            <span class="text"
              ><span class="label">Obstacle</span> <span class="detail">hatched cell</span></span
            >
          </li>
          <li data-testid="legend-goto-active">
            <span class="ring" aria-hidden="true"></span>
            <span class="text"
              ><span class="label">GOTO target</span>
              <span class="detail">solid ring: heading there</span></span
            >
          </li>
          <li data-testid="legend-goto-pending">
            <span class="ring dashed" aria-hidden="true"></span>
            <span class="text"
              ><span class="label">GOTO target</span>
              <span class="detail">dashed ring: queued behind other commands</span></span
            >
          </li>
        </ul>
      </section>
      @for (g of badgeGroups; track g.id) {
        <section class="group" [attr.aria-labelledby]="'key-' + g.id">
          <h3 [id]="'key-' + g.id">{{ g.title }}</h3>
          <ul>
            @for (e of g.entries; track e.text) {
              <li
                [attr.data-testid]="'legend-' + e.text"
                [attr.data-code]="e.text"
                [attr.data-group]="e.group"
                [attr.data-active]="isActive(e) ? 'true' : 'false'"
              >
                <span class="pill" aria-hidden="true"
                  ><span>{{ e.glyph }}</span
                  ><span>{{ e.text }}</span></span
                >
                <span class="text"
                  ><span class="label">{{ e.label }}</span>
                  <span class="detail">{{ e.detail }}</span></span
                >
              </li>
            }
          </ul>
        </section>
      }
    </div>
  </details>`,
  styles: `
    :host {
      display: block;
      margin-top: var(--space-2);
    }
    .key {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-2);
      background: var(--color-surface);
      padding: var(--space-1) var(--space-3);
      font-size: var(--text-sm);
    }
    summary {
      cursor: pointer;
      min-height: 28px;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: 700;
    }
    .on {
      font-weight: 600;
      color: var(--color-text-muted);
    }
    .groups {
      display: grid;
      /* Groups sit side by side when the floor column is wide, and stack on a phone. */
      grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
      gap: var(--space-2) var(--space-4);
      padding: var(--space-1) 0 var(--space-2);
    }
    .group {
      min-width: 0;
    }
    h3 {
      margin: 0 0 var(--space-1);
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-text-muted);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 2px;
    }
    li {
      display: grid;
      grid-template-columns: 3.25rem minmax(0, 1fr);
      align-items: center;
      gap: var(--space-2);
      padding: 2px var(--space-1);
      border-radius: var(--radius-1);
      line-height: 1.25;
    }
    .detail {
      color: var(--color-text-muted);
    }
    .label {
      font-weight: 600;
      margin-right: var(--space-1);
    }

    /* Badge entries: the key's pills are bigger than the grid's, otherwise identical (.pill). */
    li[data-code] .pill {
      --pill-size: var(--text-xs);
      --pill-line: 16px;
      --pill-gap: 3px;
      justify-self: start;
      padding: 0 var(--space-2);
    }
    li[data-active='true'] {
      background: var(--color-surface-2);
      outline: 2px solid var(--o-line);
      outline-offset: -1px;
    }
    /* Dim the others only while something is on the floor. The text keeps full contrast. */
    .key[data-has-active='true'] li[data-active='false'] .pill {
      opacity: 0.55;
    }

    /* Grid symbols, same tokens as the floor: robot token, obstacle hatch, GOTO ring. */
    .chip {
      justify-self: start;
      width: 1.5rem;
      height: 1.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-1);
      background: var(--robot-1);
      color: var(--robot-ink);
      font-size: var(--text-xs);
      font-weight: 700;
    }
    .swatch {
      justify-self: start;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: var(--radius-1);
      background: var(--obstacle-hatch);
    }
    .ring {
      --hue: var(--robot-1);
      justify-self: start;
      width: 1.5rem;
      height: 1.5rem;
      border: 2px solid var(--hue);
      border-radius: var(--radius-1);
      opacity: 0.7;
    }
    .ring.dashed {
      border-style: dashed;
    }
  `,
})
export class GridLegend {
  /** Badge codes on the floor now (WL, CT, ...). */
  readonly active = input<ReadonlySet<string>>(new Set());

  protected readonly badgeGroups = BADGE_GROUPS;
  protected readonly open = signal(readLegendOpen());

  /** The active codes in key order, so the summary reads the same as the key. */
  protected readonly activeList = computed(() =>
    LEGEND_BADGES.filter((e) => this.active().has(e.text)).map((e) => e.text),
  );
  protected readonly activeCodes = computed(() => this.activeList().join(', '));

  protected isActive(e: LegendBadge): boolean {
    return this.active().has(e.text);
  }

  protected onToggle(event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open === this.open()) {
      // The echo of our own `[open]` binding (the browser fires `toggle` for it too): nothing changed.
      return;
    }
    this.open.set(open);
    writeLegendOpen(open);
  }
}
