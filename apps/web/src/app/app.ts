import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { decideKey } from './core/keys';
import { FloorStore } from './store/floor.store';
import { ScenarioStore } from './store/scenario.store';
import { CommandPad } from './ui/command-pad';
import { ConnectionBadge } from './ui/connection-badge';
import { Controls } from './ui/controls';
import { FloorGrid } from './ui/floor-grid';
import { HistoryLog } from './ui/history-log';
import { NewFloorDialog } from './ui/new-floor-dialog';
import { RobotList } from './ui/robot-list';
import { ScenarioPanel } from './ui/scenario-panel';
import { Toasts } from './ui/toasts';

/** App shell (UI_SPEC 3.1): header, loading/error/ready states, global keys, live region. */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommandPad,
    ConnectionBadge,
    Controls,
    FloorGrid,
    HistoryLog,
    NewFloorDialog,
    RobotList,
    ScenarioPanel,
    Toasts,
  ],
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly store = inject(FloorStore);
  protected readonly scenarios = inject(ScenarioStore);
  protected readonly newFloorOpen = signal(false);

  ngOnInit(): void {
    void this.store.init();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const action = decideKey(event, {
      hasSelection: this.store.selectedId() !== null,
      gotoArmed: this.store.gotoArmed(),
      modalOpen: document.querySelector('dialog[open]') !== null,
    });
    if (!action) {
      return;
    }
    switch (action.type) {
      case 'command':
        event.preventDefault();
        void this.store.queueCommand(action.kind);
        break;
      case 'swallow':
        event.preventDefault();
        break;
      case 'disarm':
        this.store.disarmGoto();
        break;
      case 'deselect':
        this.store.select(null);
        break;
    }
  }
}
