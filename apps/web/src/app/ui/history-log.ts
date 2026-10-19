import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { HistoryEntry } from '@fleet/protocol';
import { buildBlocks, clockTime, type TickBlock } from '../core/history';

/** Blocks rendered at once; the store keeps everything (UI_SPEC 7.5). */
export const HISTORY_PAGE = 200;

/** Newest-first log: collapsible tick groups plus standalone event lines (UI_SPEC section 7). */
@Component({
  selector: 'app-history-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './history-log.html',
  styleUrl: './history-log.css',
})
export class HistoryLog {
  readonly history = input.required<readonly HistoryEntry[]>();
  readonly showIdle = input(false);
  readonly showIdleChange = output<boolean>();

  protected readonly visible = signal(HISTORY_PAGE);
  /** Tick groups the user collapsed, by seq. Memory-only. */
  protected readonly collapsed = signal<ReadonlySet<number>>(new Set());

  protected readonly view = computed(() =>
    buildBlocks(this.history(), this.showIdle(), this.visible()),
  );

  protected clock = clockTime;

  protected isOpen(block: TickBlock): boolean {
    return !block.empty && !this.collapsed().has(block.seq);
  }

  protected onToggle(block: TickBlock, event: Event): void {
    if (block.empty) {
      return;
    }
    const open = (event.target as HTMLDetailsElement).open;
    const next = new Set(this.collapsed());
    if (open) {
      next.delete(block.seq);
    } else {
      next.add(block.seq);
    }
    if (next.size !== this.collapsed().size) {
      this.collapsed.set(next);
    }
  }

  protected onSummaryClick(block: TickBlock, event: Event): void {
    if (block.empty) {
      event.preventDefault();
    }
  }

  protected expandAll(): void {
    this.collapsed.set(new Set());
  }

  protected collapseAll(): void {
    this.collapsed.set(
      new Set(
        this.history()
          .filter((e) => e.event.type === 'TICK_RESOLVED')
          .map((e) => e.seq),
      ),
    );
  }

  protected showOlder(): void {
    this.visible.update((n) => n + HISTORY_PAGE);
  }

  protected onShowIdle(event: Event): void {
    this.showIdleChange.emit((event.target as HTMLInputElement).checked);
  }
}
