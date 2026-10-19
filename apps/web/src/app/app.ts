import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DEFAULT_FLOOR_ID } from '@fleet/protocol';

/** Placeholder shell from the PM scaffold. Dev 3 replaces it per docs/design/UI_SPEC.md. */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main>
    <h1>Fleet Floor Simulator</h1>
    <p>Floor: {{ floorId }}</p>
  </main>`,
})
export class App {
  protected readonly floorId = DEFAULT_FLOOR_ID;
}
