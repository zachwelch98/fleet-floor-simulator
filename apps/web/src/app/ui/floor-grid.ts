import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { FloorState, Robot, RobotId, RobotTickResult } from '@fleet/engine';
import {
  activeBadgeCodes,
  badgeFor,
  cellAriaLabel,
  hueOf,
  resultLine,
  type BadgeInfo,
  type OutcomeGroup,
} from '../core/copy';
import { blurTextEntry } from '../core/keys';
import { GridLegend } from './grid-legend';

export interface GridCellActivation {
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
}

interface MarkerView {
  readonly id: RobotId;
  readonly hue: number;
  readonly state: 'active' | 'pending';
  readonly x: number;
  readonly y: number;
  readonly selected: boolean;
  readonly title: string;
}

interface BadgeView extends BadgeInfo {
  readonly id: RobotId;
  readonly outcome: string;
  readonly reason: string | null;
  readonly title: string;
  readonly group: OutcomeGroup;
}

interface CellView {
  readonly x: number;
  readonly y: number;
  readonly obstacle: boolean;
  readonly robot: Robot | null;
  readonly hue: number;
  readonly robotSelected: boolean;
  readonly robotTitle: string;
  readonly gotoAttr: string | null;
  readonly markers: readonly MarkerView[];
  readonly badge: BadgeView | null;
  readonly label: string;
}

interface RowView {
  readonly y: number;
  readonly cells: readonly CellView[];
}

const ROTATION = { NORTH: 0, EAST: 90, SOUTH: 180, WEST: 270 } as const;

/**
 * The floor (UI_SPEC sections 3.3, 4, 8). Rows are emitted from y = height - 1 down to 0, so
 * (0,0) sits at the bottom left. Everything shown comes from `state` and `lastResults`.
 */
@Component({
  selector: 'app-floor-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GridLegend],
  templateUrl: './floor-grid.html',
  styleUrl: './floor-grid.css',
})
export class FloorGrid {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly state = input.required<FloorState>();
  readonly selectedId = input<RobotId | null>(null);
  readonly editMode = input(false);
  readonly gotoArmed = input(false);
  readonly lastResults = input<ReadonlyMap<RobotId, RobotTickResult>>(new Map());
  readonly disabled = input(false);

  readonly cellActivate = output<GridCellActivation>();

  protected readonly rotation = ROTATION;
  private readonly focusCell = signal<{ x: number; y: number } | null>(null);

  protected readonly empty = computed(
    () => this.state().robots.length === 0 && this.state().obstacles.length === 0,
  );

  /** Badge codes on the floor now (from the robots that are here), for the key's highlight. */
  protected readonly activeBadges = computed(() =>
    activeBadgeCodes(this.state().robots, this.lastResults()),
  );

  protected readonly xLabels = computed(() =>
    Array.from({ length: this.state().width }, (_, i) => i),
  );
  protected readonly yLabels = computed(() =>
    Array.from({ length: this.state().height }, (_, i) => this.state().height - 1 - i),
  );

  protected readonly gridLabel = computed(
    () => `Floor grid, ${this.state().width} columns by ${this.state().height} rows`,
  );

  /** The one cell with tabindex 0: last focused, else the selected robot's cell, else (0,0). */
  private readonly rovingCell = computed(() => {
    const s = this.state();
    const clamp = (c: { x: number; y: number }) => ({
      x: Math.min(Math.max(c.x, 0), s.width - 1),
      y: Math.min(Math.max(c.y, 0), s.height - 1),
    });
    const focused = this.focusCell();
    if (focused) {
      return clamp(focused);
    }
    const sel = this.selectedId();
    const robot = sel ? s.robots.find((r) => r.id === sel) : undefined;
    return robot ? { x: robot.x, y: robot.y } : { x: 0, y: 0 };
  });

  protected readonly rows = computed<readonly RowView[]>(() => {
    const s = this.state();
    const selectedId = this.selectedId();
    const last = this.lastResults();
    const results = Array.from(last.values());
    const key = (x: number, y: number) => y * 1000 + x;

    const obstacles = new Set(s.obstacles.map((o) => key(o.x, o.y)));
    const robots = new Map(s.robots.map((r) => [key(r.x, r.y), r]));

    // The first GOTO of each robot's queue gets a marker (4.3); robots are ascending by number.
    const markers = new Map<number, MarkerView[]>();
    for (const r of s.robots) {
      const idx = r.queue.findIndex((c) => c.kind === 'GOTO');
      const cmd = idx >= 0 ? r.queue[idx] : undefined;
      if (!cmd || cmd.kind !== 'GOTO') {
        continue;
      }
      const active = idx === 0;
      const marker: MarkerView = {
        id: r.id,
        hue: hueOf(r.num),
        state: active ? 'active' : 'pending',
        x: cmd.x,
        y: cmd.y,
        selected: r.id === selectedId,
        title: active
          ? `${r.id} is heading here (GOTO ${cmd.x},${cmd.y})`
          : `${r.id} will head here after its other commands`,
      };
      const k = key(cmd.x, cmd.y);
      markers.set(k, [...(markers.get(k) ?? []), marker]);
    }

    const rows: RowView[] = [];
    for (let y = s.height - 1; y >= 0; y--) {
      const cells: CellView[] = [];
      for (let x = 0; x < s.width; x++) {
        const k = key(x, y);
        const robot = robots.get(k) ?? null;
        const here = markers.get(k) ?? [];
        const result = robot ? last.get(robot.id) : undefined;
        const info = result ? badgeFor(result) : null;
        const selected = robot !== null && robot.id === selectedId;
        cells.push({
          x,
          y,
          obstacle: obstacles.has(k),
          robot,
          hue: robot ? hueOf(robot.num) : 0,
          robotSelected: selected,
          robotTitle: robot ? `${robot.id} at (${robot.x},${robot.y}) facing ${robot.facing}` : '',
          gotoAttr: here.length > 0 ? here.map((m) => m.id).join(',') : null,
          markers: here,
          badge:
            result && info
              ? {
                  ...info,
                  id: result.id,
                  outcome: result.outcome,
                  reason: result.reason ?? null,
                  title: resultLine(result, results).text,
                }
              : null,
          label: cellAriaLabel({
            x,
            y,
            obstacle: obstacles.has(k),
            robot: robot ?? undefined,
            selected,
            gotoOf: here.map((m) => m.id),
            last: result,
          }),
        });
      }
      rows.push({ y, cells });
    }
    return rows;
  });

  protected tabindex(cell: CellView): number {
    const r = this.rovingCell();
    return r.x === cell.x && r.y === cell.y ? 0 : -1;
  }

  protected onCell(cell: CellView, event: MouseEvent): void {
    // Cells swallow mousedown, so focus never leaves the slider by itself (UI_SPEC 5.2).
    blurTextEntry();
    this.cellActivate.emit({ x: cell.x, y: cell.y, shift: event.shiftKey });
  }

  protected onFocus(cell: CellView): void {
    this.focusCell.set({ x: cell.x, y: cell.y });
  }

  /** Grid keyboard navigation (5.4); arrows only move focus while no robot is selected. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="gridcell"]');
    if (!target) {
      return;
    }
    const x = Number(target.dataset['x']);
    const y = Number(target.dataset['y']);
    const noSelection = this.selectedId() === null;
    let dx = 0;
    let dy = 0;
    let toX: number | null = null;
    switch (event.key) {
      case 'w':
      case 'W':
        dy = 1;
        break;
      case 'a':
      case 'A':
        dx = -1;
        break;
      case 's':
      case 'S':
        dy = -1;
        break;
      case 'd':
      case 'D':
        dx = 1;
        break;
      case 'ArrowUp':
        if (!noSelection) return;
        dy = 1;
        break;
      case 'ArrowLeft':
        if (!noSelection) return;
        dx = -1;
        break;
      case 'ArrowDown':
        if (!noSelection) return;
        dy = -1;
        break;
      case 'ArrowRight':
        if (!noSelection) return;
        dx = 1;
        break;
      case 'Home':
        toX = 0;
        break;
      case 'End':
        toX = this.state().width - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.cellActivate.emit({ x, y, shift: event.shiftKey });
        return;
      default:
        return;
    }
    event.preventDefault();
    const s = this.state();
    const nx = toX ?? Math.min(Math.max(x + dx, 0), s.width - 1);
    const ny = Math.min(Math.max(y + dy, 0), s.height - 1);
    this.focusCell.set({ x: nx, y: ny });
    this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="cell-${nx}-${ny}"]`)?.focus();
  }
}
