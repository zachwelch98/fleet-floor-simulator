import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { Robot, RobotId, RobotTickResult } from '@fleet/engine';
import {
  chipText,
  facingArrow,
  hueOf,
  outcomeGroup,
  resultLine,
  resultSentenceWithoutId,
  type OutcomeGroup,
} from '../core/copy';

interface LastView {
  readonly glyph: string;
  readonly text: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly group: OutcomeGroup;
}

interface RowView {
  readonly robot: Robot;
  readonly hue: number;
  readonly arrow: string;
  readonly chips: readonly { text: string; kind: string; x: number | null; y: number | null }[];
  readonly last: LastView | null;
}

/** The Robots panel (UI_SPEC section 6): select, queue chips, last tick, clear queue, delete. */
@Component({
  selector: 'app-robot-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './robot-list.html',
  styleUrl: './robot-list.css',
})
export class RobotList {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly robots = input.required<readonly Robot[]>();
  readonly selectedId = input<RobotId | null>(null);
  readonly lastResults = input<ReadonlyMap<RobotId, RobotTickResult>>(new Map());
  readonly nextRobotNum = input(1);
  readonly disabled = input(false);

  readonly select = output<RobotId>();
  readonly clearQueue = output<RobotId>();
  readonly deleteRobot = output<RobotId>();

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private pendingFocus: { deleted: RobotId; target: RobotId | null } | null = null;

  constructor() {
    // Keep the selected row visible inside the scrolling panel (selecting on the grid can pick a hidden one).
    effect(() => {
      const id = this.selectedId();
      if (!id) {
        return;
      }
      afterNextRender(
        () => {
          this.host.nativeElement
            .querySelector<HTMLElement>(`[data-testid="robot-row-${id}"]`)
            ?.scrollIntoView?.({ block: 'nearest' });
        },
        { injector: this.injector },
      );
    });
    // Move focus once the deleted robot has actually left the list (the server answers first).
    effect(() => {
      const list = this.robots();
      const pending = this.pendingFocus;
      if (pending && !list.some((r) => r.id === pending.deleted)) {
        this.pendingFocus = null;
        afterNextRender(
          () => {
            const target = pending.target
              ? this.host.nativeElement.querySelector<HTMLElement>(
                  `[data-testid="robot-select-${pending.target}"]`,
                )
              : this.heading()?.nativeElement;
            target?.focus();
          },
          { injector: this.injector },
        );
      }
    });
  }

  protected readonly rows = computed<readonly RowView[]>(() => {
    const last = this.lastResults();
    const all = Array.from(last.values());
    return this.robots().map((robot) => {
      const result = last.get(robot.id);
      let lastView: LastView | null = null;
      if (result) {
        const line = resultLine(result, all);
        lastView = {
          glyph: line.glyph,
          text: resultSentenceWithoutId(result, line.text),
          outcome: result.outcome,
          reason: result.reason ?? null,
          group: outcomeGroup(result.outcome),
        };
      }
      return {
        robot,
        hue: hueOf(robot.num),
        arrow: facingArrow(robot.facing),
        chips: robot.queue.map((c) => ({
          text: chipText(c),
          kind: c.kind,
          x: c.kind === 'GOTO' ? c.x : null,
          y: c.kind === 'GOTO' ? c.y : null,
        })),
        last: lastView,
      };
    });
  });

  /** Click on the row background selects; the buttons handle themselves. */
  protected onRowClick(id: RobotId, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    this.select.emit(id);
  }

  /** After Delete, focus moves to the next row's select button, else the previous, else the heading. */
  protected onDelete(id: RobotId): void {
    const list = this.robots();
    const index = list.findIndex((r) => r.id === id);
    const neighbor = list[index + 1] ?? list[index - 1];
    this.pendingFocus = { deleted: id, target: neighbor ? neighbor.id : null };
    this.deleteRobot.emit(id);
  }
}
