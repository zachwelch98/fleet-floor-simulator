# UI spec: Fleet Floor Simulator

Audience: the frontend developer (Angular 22, standalone components + signals) and the tester
(Playwright). Companion file: [`tokens.css`](tokens.css) (colors, spacing, cell sizing).
Sources of truth: `packages/engine/src/types.ts`, `packages/protocol/src/index.ts`,
`DECISIONS.md` (2.3-2.5, 3, 5, 7), `docs/PLAN.md`.

The brief says "clear and usable, not pixel-perfect". So: calm neutral surfaces, one accent color,
native elements (`button`, `input type=range`, `input type=number`, `dialog`, `details`), no
component library. "Must" is load-bearing for tests or accessibility; "should" is polish a dev may trim.
Priorities: **P1** = needed for the E2E suite and the brief; **P2** = polish.

---

## 0. Ground rules

1. **The engine is the only judge.** The UI never pre-validates world rules (occupied cell,
   obstacle, GOTO target, ...). It sends the action and shows the `RejectionReason` it gets back.
   One rulebook; the Module D conflict path is the normal error path.
2. **No optimistic updates.** The UI changes only when the server answers (`CommandSuccess`) or a
   socket `floor:updated` arrives, whichever is first. Apply a floor only if its `version` is greater
   than the one held; ignore older or equal ones (this dedupes the HTTP response against the socket echo).
3. **One request at a time per client.** Outgoing commands go through a FIFO so two quick key
   presses (`MOVE` then `LEFT`) cannot reach the server out of order.
4. **Success is silent, failure is loud.** No success toasts for the user's own actions: the grid,
   the robot's queue and the history already show them. Every rejection produces a toast.
5. **Color is never the only signal.** Everything color-coded also has a glyph, shape or text.
6. UI-only preferences (selected robot, edit mode, GOTO armed, show-idle toggle, collapsed groups)
   live in memory and reset on refresh. Only server state survives a refresh.

---

## 1. Layout

Breakpoint: **900px**. Below = stacked "mobile" layout; at or above = two-column "desktop".
Design targets: 375px phone, 1366×768 laptop. No horizontal page scroll from 320px up.
Use `<meta name="viewport" content="width=device-width, initial-scale=1">`; never block zoom.

### 1.1 Desktop (>= 900px)

```
+------------------------------------------------------------------------------------------+
| Fleet Floor Simulator        10×8 · Tick 12                           (*) Connected      |  header
+------------------------------------------------------------------------------------------+
| [ Step ] [ ▶ Play ]  Interval --------o------- 500 ms     [Off] Edit obstacles [New floor…]|  toolbar
+----------------------------------------------------------+-------------------------------+
|  y                                                       | Selected: R2 · (4,5) · EAST   |
|  7  .   .   .   .   .   .   .   .   .   .               | [◀ Left] [▲ Move] [Right ▶]   |
|  6  .   .   #   .   .   .   .   .   .   .               | [⌖ GOTO…]     Esc: deselect   |
|  5  .   .   #   .   ▶R2 .   .   .   .   .               +-------------------------------+
|  4  .   .   .   .   .   .   .   .   .   .               | Robots (3)                    |
|  3  .   ▲R1 .   .   .   .   (+)  .   .   .              | +---------------------------+ |
|  2  .   .   .   .   .   .   .   .   .   .               | | ■ R1  (2,3)  ▲ NORTH      | |
|  1  .   .   .   .   .   .   .   .   .   .               | | [▲ Move] [◀ Left]         | |
|  0  .   .   .   .   .   .   .   .   .   .               | | Last tick: Moved (2,2)→.. | |
|     0   1   2   3   4   5   6   7   8   9   x           | | [Clear queue] [Delete]    | |
|  EDIT MODE: click a cell to add or remove an obstacle.   | +---------------------------+ |
|  (this line = banner when active, otherwise the legend)  | | ■ R2 (4,5) ▶ EAST Selected| |
|                                                          | | Queue empty               | |
|                                                          | +---------------------------+ |
|                                                          +-------------------------------+
|                                                          | History     [ ] Show idle     |
|                                                          | [Expand all] [Collapse all]   |
|                                                          | ▼ Tick 12 - 1 moved, 1 blocked|
|                                                          |    R1 moved (2,2) → (2,3).    |
|                                                          |    R2 blocked at (4,5): ...   |
|                                                          |  R2 queued: MOVE, LEFT        |
|                                                          | ▼ Tick 11 - 2 moved           |
+----------------------------------------------------------+-------------------------------+
```

`#` = obstacle, `(+)` = GOTO target marker, `▲▶` = robots with facing arrows, `y` / `x` = axis titles.

- Left column (flexible): the grid with axes, and below it one reserved **status line** (min-height 48px, enough for a two-line banner or legend) that shows the edit banner, or the GOTO banner, or otherwise the legend. Because the line is always reserved, toggling edit mode never resizes the grid. The offline banner (rare) renders between toolbar and grid and may shift the layout.
- Right column (fixed 360px, `--sidebar-w`): selection panel / command pad on top (about 170px with its hint line), the Robots panel, and History. Robots and History each get at least 200px; Robots takes at most 45% of the remaining height. Panel headings stay visible while the panel body scrolls. Each panel scrolls inside itself; the page does not scroll on a laptop.
- The command pad sits in the sidebar so the grid column only has to spare height for header, toolbar, axis and status line. The clamp in `tokens.css` then gives a 20×20 floor cells of about 22px on a 1366×768 laptop (no scrolling) and a 10×8 floor cells up to 56px.

### 1.2 Mobile (< 900px, designed at 375px)

Single column, in this order. Page scrolls vertically only.

```
+---------------------------------+
| Fleet Floor      (*) Connected  |  header
| 10×8 · Tick 12                  |
+---------------------------------+
| [   Step   ] [  ▶ Play  ]       |  44px-high buttons
| Interval ------o----- 500 ms    |  full-width slider
| [Off] Edit obstacles [New floor]|
+---------------------------------+
|  y                              |
|  7 . . . . . . . . . .         |
|  6 . . # . . . . . . .         |  cell = (100vw - gutters - axis) / columns
|  5 . . # . ▶R2 . . . . .       |  (about 32px for 10 columns, 16px for 20)
|  ...                            |
|  0 . . . . . . . . . .         |
|    0 1 2 3 4 5 6 7 8 9  x      |
| (status line: banner or legend) |
+---------------------------------+
| Selected: R2 (4,5) facing EAST  |  selection panel
| [◀ Left] [▲ Move] [Right ▶]     |  3 equal 44px buttons
| [ ⌖ GOTO… ]                     |
+---------------------------------+
| Robots (3)                      |
|  R1 (2,3) ▲ NORTH               |
|  queue: [▲ Move] [◀ Left]       |
|  Last tick: ...                 |
|  [Clear queue] [Delete]         |
|  R2 ...                         |
+---------------------------------+
| History           [ ] Show idle |
| ▼ Tick 12 ...                   |
+---------------------------------+
```

- Gutter 16px (`--space-4`); nothing wider than `100%`. Toolbar items wrap; buttons keep >= 44×44px touch targets.
- The grid wrapper has `max-width: 100%; overflow: auto` as a last-resort safety net (20 columns on a 320px screen hits the 12px minimum cell). It must not trigger from 320px up for any floor size.
- Cells on a 20-column phone grid are about 16px, small to tap. Accepted: the Robots list is the always-reachable way to select a robot, and GOTO on a phone uses the **GOTO…** button (5.3) since there is no Shift key.
- Toasts stick to the bottom of the viewport on mobile and the top right on desktop.

### 1.3 Grid sizing rules

- `--cell-size` comes from the `.floor-grid` rule in `tokens.css`; the grid element sets `--cols` and `--rows` inline from `state.width/height`.
- Axis gutters are `--axis-size` (24px), outside the cells. The axis titles "x" and "y" take one extra 16px row (below the x labels) and column (left of the y labels); the desktop grid chrome is therefore about 20px taller than the first estimate. ▶ / ❚❚ on the Play button may be CSS `::before` glyphs. Gridlines are 1px `--color-cell-line`. Cells are square.

---

## 2. Client state the UI needs

A signal-based `FloorStore`. Everything here is received or derived; there is no hidden state.

| Name | Kind | Notes |
|---|---|---|
| `floor: FloorDto \| null` | server | from `GET /floors/main`, `floor:updated`, command responses, `floor:playback` |
| `history: HistoryEntry[]` | server | `GET .../history?after=0` on load; then appended from the `history` array of every response/broadcast; dedupe by `seq`; keep sorted by `seq` |
| `connection` | socket | `'connected' \| 'reconnecting' \| 'disconnected'`, see 3.5 |
| `selectedId: RobotId \| null` | UI | cleared automatically if that robot no longer exists |
| `editMode: boolean` | UI | |
| `gotoArmed: boolean` | UI | only true while a robot is selected and edit mode is off |
| `showIdle: boolean` | UI | default false |
| `intervalMs: number` | UI + server | slider value; adopts `floor.intervalMs` and `floor:playback` from the server |
| `toasts` | UI | |
| `lastResults: Map<RobotId, RobotTickResult>` | **derived** | below |
| `loadState` | UI | `'loading' \| 'ready' \| 'error'` |

**Deriving `lastResults`** (`FloorDto` carries no per-robot results, and this must survive a refresh
and work in a second tab): find the newest `TICK_RESOLVED` entry `T` in `history`. For each result in
`T.event.results`, keep it unless (a) a `ROBOT_PLACED` or `ROBOT_REMOVED` for that id, or any
`FLOOR_CREATED`, exists with `seq > T.seq`, or (b) the robot is not in `floor.state.robots`.
Everything that shows "last tick" (grid badge, robot row, cell label) reads this one map.

**Attempted (blocked) cell** `T`, used in copy: `from` plus the unit step of `result.facing`
(`facing` is the facing at the end of the tick, which for a blocked MOVE/GOTO step is the direction tried).
**Blocker robot** `B`: in the same tick's `results`, the robot whose `from` equals `T`, if any.

---

## 3. Components

Standalone components reading the store through signals. "Inputs" = what the component needs;
"Outputs" = the user intents it raises (the store/service turns them into HTTP calls).
Names are suggestions; **the test ids are the contract**.

### 3.1 App shell (`AppComponent`)

Header (title, `floor-size`, `tick-counter`, ConnectionBadge), toolbar, main area, global key handler,
toast region, live region, NewFloorDialog.

States:
- **Loading** (`loadState=loading`): centered text "Loading floor…" (`app-loading`); controls hidden.
- **Load error** (`loadState=error`): "Can't reach the server." plus a **Retry** button (`btn-retry`) (`app-error`).
- **Ready**: everything below.
- `floor-size` shows "10×8"; `tick-counter` shows "Tick 12" with `data-tick="12"`, always `floor.state.tick`.

### 3.2 `ControlsComponent` (toolbar)

Inputs: `playing`, `intervalMs`, `editMode`, `connected`.
Outputs: `step`, `play(intervalMs)`, `pause`, `intervalChange(ms)`, `editModeChange(bool)`, `openNewFloor`.

| Control | Element | Behavior |
|---|---|---|
| Step | `<button>` "Step" (`btn-step`) | `POST /step`. Disabled while playing or not connected. |
| Play / Pause | `<button>` (`btn-play`, `data-playing`) | Text "Play" with a ▶ glyph when paused, "Pause" with a ❚❚ glyph when playing. Paused: `POST /play` with `{intervalMs}`. Playing: `POST /pause`. Disabled when not connected. |
| Interval | `<input type=range min=100 max=5000 step=100>` (`input-interval`) + text `interval-value` ("500 ms") | Label "Tick interval". Left = fast. Paused: only changes the local value (sent with the next Play). Playing: also re-sends `/play` with the new value, debounced 300 ms (the server restarts its one timer). Adopts the server's `playing` and `intervalMs` only from a load/resync, `floor:updated`, `floor:playback` and the play/pause responses; it never jumps mid-debounce (a pending local change wins until its `/play` returns). The toolbar must not reflow when the "Playing every N ms" text appears: reserve its width or put it where it cannot push the controls. |
| Edit obstacles | `<button aria-pressed>` styled as a switch (`toggle-edit`, `data-on`) | Label "Edit obstacles" plus state text "On" / "Off". Turning it on disarms GOTO. |
| New floor | `<button>` "New floor…" (`btn-new-floor`) | Opens NewFloorDialog. Disabled when not connected. |

States: *paused*; *playing* (Step disabled, text beside Play reads "Playing every 500 ms");
*edit on* (banner, 3.3); *offline* (every mutating control disabled, 3.5).
Grid clicks and commands stay allowed while playing (DECISIONS 7.3).

### 3.3 `FloorGridComponent`

Inputs: `state` (width, height, obstacles, robots), `selectedId`, `editMode`, `gotoArmed`, `lastResults`, `disabled` (offline).
Outputs: `cellActivate({x, y, shift})` for click, tap, Enter/Space. The shell resolves it with the matrix in 5.1.
Rendering: section 4. States:

- **Empty floor** (no robots, no obstacles): normal grid plus `grid-hint` in the status line: "Click a cell to place a robot. Turn on Edit obstacles to draw walls."
  Status line priority, highest first: `goto-banner`, `edit-banner`, `grid-hint`, `grid-legend`. Only one is in the DOM at a time.
- **Edit mode on**: `edit-banner` in the status line under the grid (it replaces the legend while active): "Edit mode: click a cell to add or remove an obstacle. Robots can't be clicked here." Grid has a dashed `--color-edit` border (`data-edit-mode="true"`), cursor `cell`.
- **Robot selected**: that robot has the selection ring; its cell has `aria-selected="true"`.
- **GOTO armed**: `goto-banner` (same status line): "GOTO: click the cell R2 should go to. Esc cancels." Cursor `crosshair`.
- **Playing**: no visual change to the grid (Play button and tick counter carry it).
- **Offline**: grid at 60% opacity, `data-disabled="true"`, `pointer-events: none`, offline banner shown.
- **Last-tick badges** and **GOTO markers**: 4.3, 4.4.

### 3.4 `RobotListComponent` and `CommandPad`

**`RobotListComponent`** — Inputs: `robots`, `selectedId`, `lastResults`, `nextRobotNum`, `disabled`.
Outputs: `select(id)`, `clearQueue(id)`, `deleteRobot(id)`. Details in section 6.
Empty state (`robot-list-empty`): "No robots yet. Click an empty cell on the grid to place R{nextRobotNum}."

**`CommandPad`** (`selection-panel`; an addition to the component list in PLAN.md) — Inputs: `selectedRobot | null`, `gotoArmed`, `disabled`.
Outputs: `command('MOVE' | 'LEFT' | 'RIGHT')`, `toggleGoto`.
- Nothing selected (empty state): "No robot selected. Click a robot on the grid or in the list." Buttons shown but disabled.
- Selected: `selection-title` "Selected: R2 · (4,5) · facing EAST", plus the hint "Esc to deselect".
- Buttons, each >= 44px high, with label, glyph and key hint: `btn-cmd-left` "◀ Left" (key ←), `btn-cmd-move` "▲ Move" (key ↑), `btn-cmd-right` "Right ▶" (key →), `btn-goto-mode` "⌖ GOTO…" (`aria-pressed`, `data-armed`). When armed its label becomes "GOTO: pick a cell" and it is highlighted; pressing it again disarms.
- Disabled when nothing is selected or when offline.
- Shows no queue (to avoid duplicate `queue-*` elements): the queue lives in the robot row.

### 3.5 `ConnectionBadge`

`conn-status` with `data-state`. Always a dot glyph AND a word:

| `data-state` | Text | When | Effect |
|---|---|---|---|
| `connected` | "Connected" | socket connected and the floor room joined | normal |
| `reconnecting` | "Reconnecting…" | first connect pending, or the connection dropped and socket.io is retrying | mutating controls disabled; `offline-banner`: "Connection lost. Retrying… Changes are paused." Data kept, dimmed |
| `disconnected` | "Offline" | server closed the socket, or retries exhausted | same, banner says "You're offline." and shows a **Reconnect** button (`btn-reconnect`) |

On every transition back to `connected`: re-join the room, refetch `GET /floors/main` and
`GET .../history?after=<lastSeq>`, replace state (catch-up). The selection survives if that robot still exists.
`offline-banner` has `role="status"`.

### 3.6 `Toasts`

Container `toast-region` (`role="region"`, `aria-label="Notifications"`). Each toast `toast`:

- Attributes: `data-reason` (a `RejectionReason` or a client reason, see 5.5), `data-kind="error|info"`, `data-stale="true|false"`.
- Children: `toast-message`, optional `toast-detail`, `toast-dismiss` (a button with an ✕ and `aria-label="Dismiss"`).
- Error toasts have `role="alert"`; info toasts `role="status"`. Each shows an icon plus text.
- Auto-dismiss after 6 s (error) or 4 s (info). Hover or keyboard focus inside pauses the timer.
- At most 3 visible; a 4th removes the oldest. An identical toast (same reason and message) already visible restarts its timer instead of stacking.
- **Stale detail**: if the rejection response's `floor.version` is greater than the floor version the client held when it *sent* the request, add `toast-detail` "Your view was out of date and has been updated." and `data-stale="true"`. This is Module D's "told why, and catches up". The authoritative `floor` from a rejection is always applied (rule 0.2).
- A remote `FLOOR_RESET` / `ROBOT_REMOVED_REMOTE` toast is suppressed while this client's own request of the same type is in flight (the own response already tells the story).
- Desktop toasts must not cover the header connection badge or the toolbar: anchor them to the bottom right of the viewport (over the sidebar's lower area), or below the toolbar. Mobile keeps the bottom.
- Never steals focus.

### 3.7 `NewFloorDialog`

Native `<dialog>` opened with `showModal()` (`dialog-new-floor`). Title "New floor".
- Fields: `input-floor-width` (label "Width", number, min 1, max 20, step 1) and `input-floor-height` ("Height"), prefilled with the current size; the first field is focused on open.
- Body: "This clears all robots, obstacles and queues. The history log is kept."
- Buttons: `btn-floor-create` ("Create floor", primary), `btn-floor-cancel` ("Cancel").
- Validation (native constraint API plus inline `floor-dialog-error`: "Enter whole numbers from 1 to 20."): Create is disabled while invalid. If the server still answers `INVALID_SIZE`, show its toast and keep the dialog open.
- Enter submits, Esc cancels, focus returns to `btn-new-floor`. On success the dialog closes and the selection clears; edit mode stays as it was.
- No second "are you sure" step: the body text is the warning.

---

## 4. Grid rendering

DOM order matches reading order (top row first):

```
div.floor-grid  role=grid  data-testid=floor-grid  aria-label="Floor grid, 10 columns by 8 rows"
  div role=row            (y = height-1, the TOP row)
    div role=gridcell  data-testid=cell-0-7 ...
    ...
  div role=row            (y = 0, the BOTTOM row)
div.axis-x  aria-hidden   x labels 0..W-1 below the columns   (axis-x-{x})
div.axis-y  aria-hidden   y labels H-1..0 left of the rows    (axis-y-{y})
```

Each row is `display: grid; grid-template-columns: repeat(var(--cols), var(--cell-size))`.
Emitting rows in descending y is what puts **(0,0) at the bottom left** (y grows north).
Axis labels sit outside `role=grid` and are `aria-hidden` (every cell label already contains its coordinates).
Axis label font scales with the cell (`clamp(8px, 40% of the cell, 12px)`); all labels always render.
Axis titles "x" and "y" sit at the arrow ends of the axes.

### 4.1 Cell

`cell-{x}-{y}` is the `gridcell`. Square, 1px gridline, `--color-cell` background.

Attributes: `data-x`, `data-y`, `data-obstacle="true|false"` (always); `data-robot="R2"` (**absent** when no robot);
`data-goto-target="R1,R3"` (absent when none); `aria-label` (section 8); `aria-selected="true"` only on the selected robot's cell; `tabindex` (roving, 5.4).

| State | Look | Non-color signal |
|---|---|---|
| Empty | `--color-cell` | none needed |
| Obstacle | `--color-obstacle` fill with a diagonal hatch (repeating-linear-gradient) | the hatch; `aria-label` says "obstacle" |
| Robot | robot token (4.2) | ID text plus arrow |
| Hover (edit mode, GOTO armed, or a free cell) | 2px inset `--color-hover` outline | cursor change |
| Keyboard focus | 3px inset `--color-focus` ring, always visible | the ring |

Cells use `container-type: inline-size`. When a cell is narrower than 24px: hide the "R" prefix of robot IDs (the number stays) and shrink badges to a dot (the full information is still in the tooltip, `aria-label` and the Robots list).

### 4.2 Robot token

`robot-{id}` (for example `robot-R2`) is a child of its cell, fills the cell minus a 3px inset, with rounded corners.
- Fill: the robot's hue `--robot-1..8` chosen by `(num - 1) % 8`, text in `--robot-ink`. The ID text is **always** shown: `<span class="robot-id-prefix">R</span><span>2</span>` (the prefix is hidden by CSS under 24px but stays in the DOM, so `textContent` is always "R2").
- Facing arrow: an inline SVG triangle (`aria-hidden`) in the upper part of the token, rotated by facing: NORTH 0°, EAST 90°, SOUTH 180°, WEST 270°. No animation.
- Attributes: `data-id`, `data-facing`, `data-selected="true|false"`, `data-x`, `data-y`.
- **Selected**: 3px `--color-selected` outline with 2px offset (outside the token) plus a 2px inner border in `--color-bg`. The ring is neutral ink (near-black in light theme, white in dark), independent of the robot's hue, and differs in shape from the keyboard focus ring (which is inset in the cell).
- Tooltip: `title="R2 at (4,5) facing EAST"`.

### 4.3 GOTO target marker

For each robot, the **first GOTO in its queue** (if any) gets a marker in the target cell.
`goto-target-{id}` (for example `goto-target-R2`), with `data-x`, `data-y`, `data-state="active|pending"`:

| `data-state` | Meaning | Look |
|---|---|---|
| `active` | the GOTO is the front command; the robot is heading there | solid 2px ring in the robot's hue plus a crosshair "+" in the middle |
| `pending` | the GOTO is queued behind other commands | dashed 2px ring, no crosshair |

The marker carries a tiny ID label in its top-left corner ("R2") so markers can be told apart. The selected robot's marker is drawn at full strength with a 3px ring; others at 70% opacity.
Two markers in one cell nest (the second inset by 3px). Markers are `pointer-events: none`, above the cell background and below robot tokens.
Later GOTOs in the same queue are not drawn (they show as chips in the queue, section 6).
The marker disappears as soon as that GOTO leaves the queue (arrived, unreachable, queue cleared, robot deleted).
Tooltips: `R2 is heading here (GOTO 5,5)` / `R2 will head here after its other commands`.
The cell's `data-goto-target` lists the ids with a marker there, ascending by robot number.

### 4.4 Last-tick badge

From `lastResults` (section 2). `badge-{id}` sits inside the robot's cell, top right, overlapping the token edge.
Attributes: `data-outcome`, `data-reason` (BLOCKED only), `data-reached="true"` (reached-GOTO only), `title` = the full result sentence (7.4).
Only noteworthy outcomes get a badge:

| Outcome | Badge text | Glyph | Color group |
|---|---|---|---|
| BLOCKED / WALL | `WL` | ✕ | blocked |
| BLOCKED / OBSTACLE | `OB` | ✕ | blocked |
| BLOCKED / CONTESTED | `CT` | ✕ | blocked |
| BLOCKED / HEAD_ON | `HO` | ✕ | blocked |
| BLOCKED / OCCUPIED | `OC` | ✕ | blocked |
| BLOCKED / BEHIND_BLOCKED | `BB` | ✕ | blocked |
| WAITING | `WT` | … | waiting |
| UNREACHABLE | `UN` | ! | unreachable |
| ARRIVED | `AR` | ◎ | arrived |
| MOVED with `reachedGoto` | `OK` | ✓ | moved |
| plain MOVED, TURNED, IDLE | **no badge** | | the move or turn is visible; the Robots list still shows them |

A badge stays until the next tick, or until that robot is re-placed or deleted, or the floor is recreated (this is exactly the `lastResults` rule).
Under 24px cells it shrinks to a 7px dot (text hidden; `title` and the list remain).

### 4.5 Legend

*Superseded by DECISIONS 5.9: the legend is now a collapsible grouped key block under the status line (`grid-legend`), built from `LEGEND_BADGES`. The text below is the original design.*

A one-line legend in the status line under the grid, shown when no banner is active (`grid-legend`; on mobile it wraps to several lines):
"▲ robot (arrow = facing) · hatched = obstacle · ring = GOTO target (solid = heading there, dashed = queued) · badge = last tick: WL wall, OB obstacle, CT contested, HO head-on, OC occupied, BB blocked behind, WT waiting, UN unreachable, AR arrived, OK reached GOTO."

---

## 5. Interaction spec

### 5.1 Pointer matrix (cell click or tap)

"Robot here" = the cell holds a robot in the *current local state*. "Selected" = `selectedId != null`.

| Mode | Modifier | Cell | Action |
|---|---|---|---|
| Normal | none | empty | Send `PLACE_ROBOT {x, y, facing:'NORTH'}` (no `id`; the server assigns the next one). On success, **select the new robot** (found in the response's `ROBOT_PLACED` history entry). |
| Normal | none | robot, not selected | Select it. If GOTO was armed, disarm first. |
| Normal | none | the selected robot | Deselect. |
| Normal | none | obstacle | Send `PLACE_ROBOT` anyway; the server answers `CELL_IS_OBSTACLE` → toast. |
| Normal | Shift | any cell, a robot selected | Send `QUEUE_COMMANDS {id: selectedId, commands:[{kind:'GOTO', x, y}]}`. |
| Normal | Shift | any cell, nothing selected | Toast `NO_ROBOT_SELECTED`. No request. |
| Normal, GOTO armed | none | empty cell or obstacle | Same as Shift-click, then disarm. |
| Normal, GOTO armed | none | a robot (any robot, including the selected one) | Select that robot and disarm; no GOTO is sent. (Clicking a robot always means "select". To send a robot to a cell a robot occupies, use Shift-click or Shift+Enter.) |
| Edit | any (Shift ignored) | not a robot | Send `TOGGLE_OBSTACLE {x, y}`. |
| Edit | any | robot | Send `TOGGLE_OBSTACLE` anyway; the server answers `CELL_OCCUPIED` → toast (DECISIONS 5.3: ignored, with the reason shown). |
| Offline | any | any | Nothing is sent; toast `OFFLINE`. (The grid has `pointer-events: none`; this is only reachable from the keyboard.) |

Other pointer actions:
- Robot row click: select, or deselect if already selected. The Clear and Delete buttons inside the row do not select.
- `btn-clear-queue-{id}`: send `CLEAR_QUEUE {id}`. Disabled while that queue is empty.
- `btn-delete-robot-{id}`: send `REMOVE_ROBOT {id}`. No confirmation (a robot is cheap to re-place; its ID is not reused, as the history shows). If it was selected, the selection clears.
- `btn-cmd-move|left|right`: send `QUEUE_COMMANDS {id: selectedId, commands:[{kind}]}`.
- `btn-goto-mode`: toggle `gotoArmed`. Pressing it while edit mode is on turns edit mode off and arms GOTO (the two modes are exclusive; a silent no-op is not allowed).
- Selecting any robot (grid, list or placement) disarms GOTO.
- `btn-step`: `POST /step`. `btn-play`: `POST /play` or `/pause`.
- Turning edit mode on disarms GOTO; it does not deselect.
- The selection also clears when the selected robot disappears (deleted here or elsewhere) or the floor is recreated.

### 5.2 Keyboard

One `keydown` listener on `document`. **Ignore the event entirely** when any of these hold: `event.defaultPrevented`;
Ctrl, Meta or Alt pressed; a modal `dialog` is open; or the event target is a text-entry control: `input` (every type except `checkbox`,
so `range`, `number` and `text` are included; a focused checkbox must not swallow the arrow keys), `textarea`, `select`, or `[contenteditable]`. (The interval slider uses the arrow keys
itself; this rule is what stops them from also queuing commands.)

| Key | Condition | Effect |
|---|---|---|
| ↑ Arrow Up | a robot is selected | `preventDefault`; queue `MOVE` |
| ← Arrow Left | a robot is selected | `preventDefault`; queue `LEFT` |
| → Arrow Right | a robot is selected | `preventDefault`; queue `RIGHT` |
| ↓ Arrow Down | a robot is selected | `preventDefault`; nothing else (no binding, DECISIONS 5.4; stops the page scrolling under a selection) |
| Arrow keys | nothing selected | nothing, and no `preventDefault` (the page scrolls normally), except the grid cursor rule in 5.4 |
| any arrow with `event.repeat` | | ignored: holding a key must not flood the queue |
| Escape | GOTO armed | disarm |
| Escape | otherwise, a robot is selected | deselect |
| Escape | otherwise | nothing (it does not close toasts) |
| Enter / Space | focus is on a grid cell | same as a click on that cell; **Shift+Enter** = Shift-click |

Arrow-key commands while offline: nothing is sent; toast `OFFLINE`. Commands never move focus.

A command key pressed while this client's own `PLACE_ROBOT` is in flight is dropped silently (no toast). The new robot is selected only when the placement succeeds, so a key pressed earlier has no valid target, and it must never go to the previously selected robot.

A click on a grid cell never leaves focus on a text-entry control: if the interval slider or another input has focus, blur it on cell activation (cells swallow `mousedown`, so the browser will not move focus itself). Otherwise the next arrow key would move the slider instead of queuing a command.

### 5.3 GOTO on touch and keyboard

Shift-click is mouse-only, so the same feature is reachable with `btn-goto-mode` (press "GOTO…", then pick the target
cell) and with the keyboard (focus a cell, Shift+Enter). All three send the identical GOTO `QUEUE_COMMANDS`.

### 5.4 Grid keyboard navigation (P2)

The grid is a single tab stop (roving `tabindex`: one cell has `0`, the others `-1`); the first Tab into it lands on the cell that last had focus, else the selected robot's cell, else (0,0).
- `W A S D` always move the focused cell up / left / down / right (clamped to the floor).
- Arrow keys move the focused cell **only when no robot is selected**. With a robot selected they queue commands (5.2).
- Enter / Space activates, Shift+Enter is GOTO, Home / End jump to the first / last cell of the row.

### 5.5 Rejections and other toasts: exact copy

One row per `RejectionReason` in `types.ts`. The toast text comes from this table (keyed by reason, and by the attempted
action where shown). The server's `message` is developer-facing: do not display it (it may go in the element's `title`).

| Reason | Toast message (exact) | Typical trigger |
|---|---|---|
| `INVALID_SIZE` | Floor size must be a whole number from 1 to 20 in each direction. | New floor with a bad size (the dialog normally prevents it) |
| `INVALID_ID` | That robot ID isn't valid. Robot IDs look like R1, R2, R3. | Defensive; the UI never types IDs |
| `OUT_OF_BOUNDS` | That cell is outside the floor. | Click after another user shrank the floor |
| `CELL_IS_OBSTACLE` | There's an obstacle in that cell. Turn on Edit obstacles to remove it. | Placing a robot on an obstacle |
| `CELL_OCCUPIED` (action `PLACE_ROBOT`) | A robot is already in that cell. | Two users place into one cell at once; the loser sees this plus the stale detail |
| `CELL_OCCUPIED` (action `TOGGLE_OBSTACLE`) | Can't change an obstacle under a robot. Move or delete the robot first. | Edit-mode click on a robot |
| `UNKNOWN_ROBOT` | That robot no longer exists. It may have been deleted in another window. | Command to a robot another user deleted |
| `INVALID_COMMAND` | That command couldn't be queued. | Defensive |
| `INVALID_GOTO_TARGET` | GOTO needs a free cell on the floor. Obstacles and cells outside the floor aren't valid targets. | Shift-click on an obstacle |
| any other value | Couldn't do that: {server message} | Forward-compatible fallback |

Client-only reasons (same toast component and the same `data-reason` attribute):

| `data-reason` | Kind | Message (exact) | Trigger |
|---|---|---|---|
| `NO_ROBOT_SELECTED` | error | Select a robot first, then Shift+click a cell to send it there. | Shift-click with nothing selected |
| `OFFLINE` | error | You're offline. Changes are paused until the connection comes back. | Any send attempt while not connected |
| `NETWORK_ERROR` | error | Couldn't reach the server, so nothing was changed. | fetch failed or timed out |
| `SERVER_ERROR` | error | The server couldn't process that request (unexpected error). Nothing was changed. | HTTP 400 or 5xx without a `CommandRejected` body |
| `FLOOR_RESET` | info | The floor was reset to {W}×{H}. | A *remote* `FLOOR_CREATED` arrives |
| `ROBOT_REMOVED_REMOTE` | info | {id} was deleted. | The selected robot is removed by a *remote* change |

A rejection always applies the `floor` it carries (catch-up). Nothing is retried automatically.

---

## 6. Robot list and queues

`robot-list` is a `<ul>` of rows ordered by robot number (the state order). Heading: "Robots (n)".

Row `robot-row-{id}` (`<li>`) with `data-selected`, `data-x`, `data-y`, `data-facing`. Top to bottom:

1. **Select button** `robot-select-{id}`: a full-width `<button>` with a color swatch, bold ID, "(x,y)", and arrow glyph plus facing word ("▲ NORTH"). `aria-pressed` reflects selection. A click anywhere else in the row (except the two buttons below) does the same.
2. **Queue** `queue-{id}`: an `<ol>` (`data-length="n"`, `aria-label="Pending commands for R2"`), always present even when empty, with one `<li data-testid="queue-item">` chip per command, front first.
   - Chip text: `▲ Move`, `◀ Left`, `Right ▶`, `⌖ GOTO 3,4` (tests may match "Move", "Left", "Right", "GOTO 3,4").
   - Attributes: `data-kind="MOVE|LEFT|RIGHT|GOTO"`, `data-index`, `data-front="true|false"`; for GOTO also `data-x`, `data-y`.
   - The front chip has a heavier border and the visually hidden prefix "Next: ". A GOTO at the front also shows the small text "heading there".
   - Empty queue: the `<ol>` has no children and a sibling `queue-empty-{id}` reads "Queue empty". (So `queue-item` counts are exact.)
   - No truncation: chips wrap; after about 5 lines the queue area scrolls.
3. **Last result** `last-result-{id}` (`data-outcome`, `data-reason`): "Last tick: " + glyph + the 7.4 sentence without the leading robot id, capitalized and without the final period (for example "✕ Blocked at (3,4): obstacle at (3,5)", "▶ Moved (2,3) → (2,4)"). With no result yet: "Last tick: no result yet" and no `data-outcome`.
4. Buttons: `btn-clear-queue-{id}` "Clear queue" (disabled when the queue is empty) and `btn-delete-robot-{id}` "Delete" (danger style, icon plus text). `aria-label`s include the ID ("Clear queue for R2").

Selected row: 3px `--color-selected` left border, `--color-surface-2` background and a visible "Selected" tag.
After Delete, focus moves to the next row's select button, else the previous one, else the "Robots" heading.

---

## 7. History panel

`HistoryLogComponent`, root `history-log`. Inputs: `history`, `showIdle`. Output: `showIdleChange`.

### 7.1 Header

Heading "History"; `toggle-show-idle` (native checkbox, label "Show idle robots", default unchecked); `btn-history-expand-all` and `btn-history-collapse-all`.

### 7.2 Structure (newest first)

The log is a list of **blocks** ordered by `seq` descending:

- **Tick group** per `TICK_RESOLVED`: a `<details open>` element `history-tick-{n}` (`n` = the event's `tick`, the tick count after resolving) with `data-tick`, `data-seq`, `data-open`.
  Its `<summary>` (`history-tick-toggle-{n}`) reads **"Tick {n}"** plus counts, e.g. "Tick 12 - 2 moved, 1 turned, 1 blocked (3 idle hidden)", and a muted time.
  Inside: one line per robot result, sorted by robot number.
- **Standalone line** for every other event (placement, obstacle edit, queued commands, queue clear, delete, floor creation), shown between tick groups.
  With newest-first ordering, edits made after tick 11 and before tick 12 sit above the Tick 11 group and below the Tick 12 group. A burst of edits is a run of standalone lines in descending `seq`.

Every line (standalone or in a group) is a `history-entry` with `data-type`, `data-seq`, `data-robot` (when there is one), and for results `data-outcome` and `data-reason`.
`data-type` is one of `FLOOR_CREATED`, `ROBOT_PLACED`, `ROBOT_REMOVED`, `OBSTACLE_SET`, `COMMANDS_QUEUED`, `QUEUE_CLEARED`, or `TICK_RESULT` (one result line inside a group).
A line = glyph + sentence (7.4) + muted time `HH:MM:SS` in a `<time datetime="at">` element.

Tick groups are **expanded by default** when they arrive; a user's collapse is remembered per `seq` for the session.
`n` can repeat after a *New floor* because the tick count restarts; test code should use `data-seq` or `.last()` when it matters. A `FLOOR_CREATED` line separates the eras.

### 7.3 IDLE handling (DECISIONS 5.6)

All results are stored and counted. `IDLE` result lines are **not rendered** unless `toggle-show-idle` is on (absent from the DOM, not just hidden by CSS).
Summary counts always include idle. With the toggle off, idle is not listed as a count but appended as "(N idle hidden)" ("Tick 1 - 2 moved (1 idle hidden)"); with the toggle on it is an ordinary count ("Tick 1 - 2 moved, 1 idle").
A tick group with no visible lines still renders its summary, not expandable, with `data-empty="true"`:
"Tick 5 - nothing happened (3 idle hidden)", or "Tick 5 - no robots on the floor" when `results` is empty.

### 7.4 Line copy (exact templates)

`(x,y)` is a position. `{w}×{h}` uses the multiplication sign. Facings and command names stay uppercase, as in the engine.

**WorldEvent lines**

| Event | Glyph | Text |
|---|---|---|
| `FLOOR_CREATED` | ▦ | `New floor {w}×{h} created. All robots, obstacles and queues were cleared.` |
| `ROBOT_PLACED`, `replaced:false` | + | `{id} placed at (x,y) facing {FACING}.` |
| `ROBOT_PLACED`, `replaced:true` | + | `{id} moved to (x,y) facing {FACING} by placement. Its queue was kept.` |
| `ROBOT_REMOVED` | − | `{id} deleted.` |
| `OBSTACLE_SET`, `present:true` | ■ | `Obstacle added at (x,y).` |
| `OBSTACLE_SET`, `present:false` | □ | `Obstacle removed at (x,y).` |
| `COMMANDS_QUEUED` | › | `Queued for {id}: MOVE, LEFT, GOTO 3,4.` (comma-separated; one command: `Queued for {id}: MOVE.`) |
| `QUEUE_CLEARED` | ✕ | `{id}'s queue cleared.` |

**Tick group summary** (`TICK_RESOLVED`): `Tick {n}` then " - " and, joined by ", ", the non-zero counts in this order:
`{k} moved`, `{k} turned`, `{k} blocked`, `{k} waiting`, `{k} unreachable`, `{k} arrived`, `{k} idle` (idle suffix rule in 7.3).
Empty `results`: `Tick {n} - no robots on the floor`.

**Result lines** (`TICK_RESULT`). `T` and `B` are derived as in section 2.

| Outcome | Glyph | Text |
|---|---|---|
| `MOVED` | ▶ | `{id} moved (x,y) → (x,y).` |
| `MOVED` + `reachedGoto` | ✓ | `{id} moved (x,y) → (x,y) and reached its GOTO target.` |
| `TURNED` | ↻ | `{id} turned LEFT, now facing {FACING}.` or `{id} turned RIGHT, now facing {FACING}.` |
| `BLOCKED` | ✕ | `{id} blocked at (x,y): {reason text}.` plus ` Its GOTO stays queued.` when the command was a GOTO |
| `WAITING` | … | `{id} waiting: no path to (gx,gy) this tick.` |
| `UNREACHABLE` | ! | `{id} gave up on GOTO (gx,gy): no path for 3 ticks in a row. The GOTO was removed.` |
| `ARRIVED` | ◎ | `{id} is already at (gx,gy): GOTO complete.` |
| `IDLE` | – | `{id} idle (nothing queued).` |

**Block reason text** (`BlockReason`), inserted after "blocked at (x,y): ". The code follows in a muted `<span class="code">`, e.g. `R2 blocked at (3,4): obstacle at (3,5). OBSTACLE`.

| Reason | Badge | Text |
|---|---|---|
| `WALL` | WL | `the floor edge is ahead` |
| `OBSTACLE` | OB | `obstacle at T(x,y)` |
| `CONTESTED` | CT | `a lower-numbered robot also wants T(x,y) and has priority` |
| `HEAD_ON` | HO | `head-on with {B} at T(x,y); robots can't swap cells` (no `B` found: `head-on with the robot at T(x,y); robots can't swap cells`) |
| `OCCUPIED` | OC | `{B} is standing at T(x,y) and didn't move` (no `B`: `a robot is standing at T(x,y) and didn't move`) |
| `BEHIND_BLOCKED` | BB | `{B} ahead at T(x,y) was also blocked` (no `B`: `the robot ahead at T(x,y) was also blocked`) |

Examples: `R2 blocked at (3,4): obstacle at (3,5).` and `R3 blocked at (1,1): R1 is standing at (1,2) and didn't move.`
The same sentence is the badge `title`; the Robots list "Last tick" line uses it without the leading robot id.

### 7.5 Volume and empty state

Render only the newest **200 blocks**; `btn-history-older` ("Show 200 older") appears below them. The store keeps everything.
Empty state (`history-empty`): "Nothing has happened yet. Click a cell to place a robot, then press Step."

---

## 8. Accessibility

- **Grid semantics**: `role="grid"` on `floor-grid` (`aria-label="Floor grid, 10 columns by 8 rows"`), `role="row"` per row, `role="gridcell"` per cell.
  Cell `aria-label` templates (coordinates are `x,y`, origin bottom left):
  - `Cell 3,4: empty`
  - `Cell 3,4: obstacle`
  - `Cell 3,4: robot R2 facing EAST`
  - appended when applicable, comma-separated: `, selected`; `, GOTO target of R1` (or `of R1 and R3`); `, last tick: blocked by obstacle` (the short reason words: `the floor edge`, `obstacle`, `contested`, `head-on`, `occupied`, `blocked behind`; for other outcomes `last tick: waiting`, `unreachable`, `arrived`, `reached GOTO`).
  - Example: `Cell 3,4: robot R2 facing EAST, selected, last tick: blocked by obstacle`.
- Roving tabindex (5.4); `aria-selected` on the selected robot's cell; `aria-disabled="true"` on the grid when offline.
- **Live region** (`live-region`, visually hidden, `role="status"`, `aria-live="polite"`): announces the sentence of each new non-tick history entry and, after a **manual Step**, one summary sentence of the non-idle results (e.g. "Tick 12: R1 moved to 2,3. R2 blocked, obstacle ahead."). While **playing**, individual ticks are NOT announced (a 100 ms tick would flood a screen reader); announce "Playing" on play and "Paused at tick {n}" on pause.
  Error toasts are `role="alert"`; info toasts `role="status"`.
- **Focus**: every interactive element has a visible 3px `--color-focus` ring (never remove an outline without a replacement). The dialog uses the native focus trap and returns focus to its opener. Toasts never take focus. Pointer selection does not move focus.
- **Color is never the only signal**: robot = ID text + arrow; selected = ring shape + "Selected" tag + `aria-pressed`; obstacle = hatch + label; GOTO = ring shape (solid/dashed) + ID label; outcomes = glyph + text; connection = dot + word; edit mode = banner + "On/Off" text; toasts = icon + text.
- **Contrast**: text >= 4.5:1; UI boundaries and icons >= 3:1, in both themes. The token pairs were checked with a script (results in the header comment of `tokens.css`).
- **Touch targets**: buttons and the slider >= 44px high on mobile. Grid cells can be smaller on large floors (documented limitation).
- **Motion**: only 120 ms color/outline transitions, set to 0 under `prefers-reduced-motion`.
- **Zoom/reflow**: works at 200% zoom (collapses to the stacked layout).
- Native elements first (`button`, `details`, `dialog`, `input`); ARIA only where listed.

---

## 9. Module D behavior the UI must show

1. **Live sync**: another tab's change arrives as `floor:updated`; grid, lists and history update with no toast (the history log is the notification).
2. **Conflict**: when this client's request is rejected and the rejection's `floor.version` is greater than the version it held at send time, the toast has `data-stale="true"` and the "out of date" detail line, and the floor is replaced by the authoritative one.
3. **Gap detection**: if a broadcast's `version` is more than 1 above the held version, refetch the floor and the history after the last `seq` before applying (DECISIONS 7.4).
4. **Reconnect**: see 3.5. While offline nothing mutating is possible; read-only data stays visible, dimmed.
5. **Remote destructive changes**: a remote `FLOOR_CREATED` clears the selection (edit mode stays) and shows the info toast `FLOOR_RESET`; a remote deletion of the selected robot clears the selection and shows `ROBOT_REMOVED_REMOTE`.
6. **Shared playback**: `floor:playback` updates `btn-play` (`data-playing`), the interval slider and Step's disabled state in every tab.

---

## 10. `data-testid` catalog

`{id}` is the full canonical robot ID including the letter (`R2`, never `2`). `{x}`, `{y}`, `{n}` are integers.
"Absent" means the attribute is not rendered at all. Boolean-ish data attributes are the strings `"true"` / `"false"`.

### App shell and header

| Test id | Element | Attrs / notes |
|---|---|---|
| `app-loading` | text while loading | |
| `app-error` | load-failure message | |
| `btn-retry` | retry the load | inside `app-error` |
| `floor-size` | header text "10×8" | `data-width`, `data-height` |
| `tick-counter` | header text "Tick 12" | `data-tick="12"` (= `state.tick`) |
| `conn-status` | connection badge | `data-state="connected\|reconnecting\|disconnected"` |
| `btn-reconnect` | manual reconnect | only when `disconnected` |
| `offline-banner` | banner under the toolbar | present only when the state is not `connected` |
| `live-region` | visually hidden aria-live region | text = latest announcement |

### Toolbar and dialog

| Test id | Element | Attrs / notes |
|---|---|---|
| `btn-step` | Step | `disabled` while playing or offline |
| `btn-play` | Play / Pause | `data-playing="true\|false"`; text "Play" / "Pause" |
| `input-interval` | range input | `value` = ms (100..5000, step 100) |
| `interval-value` | text "500 ms" | |
| `toggle-edit` | edit-mode switch button | `aria-pressed`, `data-on="true\|false"` |
| `btn-new-floor` | opens the dialog | |
| `dialog-new-floor` | `<dialog>` | `open` attribute while shown |
| `input-floor-width`, `input-floor-height` | number inputs | |
| `floor-dialog-error` | inline validation text | present only when invalid |
| `btn-floor-create`, `btn-floor-cancel` | dialog buttons | create is `disabled` when invalid |

### Grid

| Test id | Element | Attrs / notes |
|---|---|---|
| `floor-grid` | the grid | `data-width`, `data-height`, `data-edit-mode`, `data-goto-armed`, `data-disabled` |
| `cell-{x}-{y}` | one cell | `data-x`, `data-y`, `data-obstacle="true\|false"`, `data-robot="{id}"` (absent if none), `data-goto-target="{id},{id}"` (absent if none), `aria-selected="true"` (selected robot's cell only), `aria-label` per section 8 |
| `robot-{id}` | robot token in the grid | `data-id`, `data-facing="NORTH\|EAST\|SOUTH\|WEST"`, `data-selected`, `data-x`, `data-y`; `textContent` = the id |
| `badge-{id}` | last-tick badge on the grid | `data-outcome`, `data-reason` (BLOCKED only), `data-reached="true"` (reached-GOTO only); **absent** for plain MOVED / TURNED / IDLE |
| `goto-target-{id}` | GOTO marker | `data-state="active\|pending"`, `data-x`, `data-y`; absent if the robot has no GOTO queued |
| `axis-x-{x}`, `axis-y-{y}` | axis labels | text = the number |
| `edit-banner` | edit-mode banner | present only while edit mode is on |
| `goto-banner` | GOTO-armed banner | present only while armed |
| `grid-hint` | empty-floor hint | present only with no robots and no obstacles |
| `grid-legend` | legend text | |

### Command pad

| Test id | Element | Attrs / notes |
|---|---|---|
| `selection-panel` | the panel | `data-robot="{id}"` (absent when nothing is selected) |
| `selection-title` | "Selected: R2 · (4,5) · facing EAST" | or "No robot selected…" |
| `btn-cmd-move`, `btn-cmd-left`, `btn-cmd-right` | queue MOVE / LEFT / RIGHT | `disabled` when nothing selected or offline |
| `btn-goto-mode` | arm GOTO | `aria-pressed`, `data-armed` |

### Robots

| Test id | Element | Attrs / notes |
|---|---|---|
| `robot-list` | the list | |
| `robot-list-empty` | empty-state text | present only with zero robots |
| `robot-row-{id}` | one row | `data-selected`, `data-x`, `data-y`, `data-facing` |
| `robot-select-{id}` | the row's select button | `aria-pressed` |
| `queue-{id}` | `<ol>` of pending commands | `data-length="n"`; always present, even when empty |
| `queue-item` | one chip; many per queue, **not** suffixed | `data-kind="MOVE\|LEFT\|RIGHT\|GOTO"`, `data-index`, `data-front`, `data-x` / `data-y` (GOTO only) |
| `queue-empty-{id}` | "Queue empty" text | present only when the queue is empty |
| `last-result-{id}` | last-tick line | `data-outcome` (absent until a result exists), `data-reason` (BLOCKED only) |
| `btn-clear-queue-{id}` | clear queue | `disabled` when the queue is empty |
| `btn-delete-robot-{id}` | delete robot | |

Chips: `page.getByTestId('queue-R2').getByTestId('queue-item')`.

### History

| Test id | Element | Attrs / notes |
|---|---|---|
| `history-log` | panel root | |
| `history-empty` | empty-state text | only when there are no entries |
| `toggle-show-idle` | checkbox | `checked` = idle lines shown (default off) |
| `btn-history-expand-all`, `btn-history-collapse-all` | bulk toggles | |
| `history-tick-{n}` | one tick group (`<details>`) | `data-tick`, `data-seq`, `data-open`, `data-empty="true"` when no visible lines. `n` can repeat after New floor: use `data-seq` or `.last()` |
| `history-tick-toggle-{n}` | the `<summary>` | text "Tick 12 - 2 moved, …" |
| `history-entry` | one log line, standalone or inside a group | `data-type` (`FLOOR_CREATED`, `ROBOT_PLACED`, `ROBOT_REMOVED`, `OBSTACLE_SET`, `COMMANDS_QUEUED`, `QUEUE_CLEARED`, `TICK_RESULT`), `data-seq`, `data-robot` (when applicable), `data-outcome` / `data-reason` (results) |
| `btn-history-older` | show older blocks | only when more than 200 blocks exist |

IDLE `history-entry` lines (`data-outcome="IDLE"`) are in the DOM only while `toggle-show-idle` is checked.
The newest block is first in DOM order.

### Toasts

| Test id | Element | Attrs / notes |
|---|---|---|
| `toast-region` | container | |
| `toast` | one toast | `data-reason` (a `RejectionReason`, or `NO_ROBOT_SELECTED`, `OFFLINE`, `NETWORK_ERROR`, `SERVER_ERROR`, `FLOOR_RESET`, `ROBOT_REMOVED_REMOTE`), `data-kind="error\|info"`, `data-stale` |
| `toast-message` | main text | exact strings in 5.5 |
| `toast-detail` | second line | only when `data-stale="true"` |
| `toast-dismiss` | dismiss button | |

### Quick reference for test authors

- Is (3,4) an obstacle? `cell-3-4` → `data-obstacle`. Which robot is on it? `data-robot`.
- Where is R2 and which way does it face? `robot-R2` → `data-x`, `data-y`, `data-facing`.
- Is R2 selected? `robot-R2` → `data-selected`.
- R2's queue? `queue-R2` → children `queue-item` → `data-kind`.
- Why did a tick block R2? `history-tick-{n}` → `history-entry[data-robot="R2"]` → `data-reason`; or `badge-R2` → `data-reason`.
- Which toast? `toast` → `data-reason`.

---

## 11. Design decisions (beyond the brief and DECISIONS.md)

| # | Decision | Why |
|---|---|---|
| 1 | Auto-select the robot the user just placed (own placement only) | Place then arrow keys is the fastest loop; "click a robot selects it" is unchanged. |
| 2 | Clicking the selected robot again deselects | Phones have no Escape key. |
| 3 | `btn-goto-mode` and Shift+Enter as alternatives to Shift-click | No Shift on touch; keyboard users need a path. The same action is sent. |
| 4 | Edit mode keeps arrow keys and the pad working | Edit mode only changes what grid clicks do; no hidden second mode. |
| 5 | Step is disabled while playing | Avoids a double-tick feel; Play is shared, so the control matches everyone's reality. |
| 6 | Interval changes while playing re-send `/play`, debounced 300 ms | Matches "a change of interval restarts that one timer"; no extra endpoint. |
| 7 | No client-side pre-validation of world rules | One rulebook (the engine); conflicts and ordinary errors share one tested path. |
| 8 | No optimistic updates; one in-flight command at a time, FIFO | Authoritative state, no rollback code, command order guaranteed. |
| 9 | Ignore `event.repeat` for arrow keys | Holding a key must not queue 30 MOVEs. |
| 10 | Down arrow is swallowed (no page scroll) only while a robot is selected | The page does not jump under a selection; keys scroll normally otherwise. |
| 11 | Last-tick results derived from history, not from `FloorDto` | Works after refresh and in a second tab, no contract change. |
| 12 | Grid badges only for BLOCKED / WAITING / UNREACHABLE / ARRIVED / reached-GOTO; the list shows every outcome | Keeps the grid readable; plain moves and turns are already visible. |
| 13 | Only a robot's first GOTO is drawn on the grid (solid = active, dashed = queued) | At most one marker per robot; later GOTOs remain visible as queue chips. |
| 14 | Selected ring is neutral ink; robot hues cycle through 8 colors with the ID always printed | Selection never depends on hue; no color-only signals. |
| 15 | `CommandPad` / selection panel added as a component | PLAN lists seven; the pad needs a home that is neither toolbar nor list. |
| 16 | Queue chips are not truncated | Tests and users see the exact queue. |
| 17 | History: groups expanded by default, newest first, standalone lines above the group they follow, 200-block render cap | Simple to test, nothing hides the latest activity, DOM stays small. Tick numbers can repeat after New floor, so groups carry `data-seq`. |
| 18 | Block copy names the blocker robot when derivable from the same tick's results | "R3 is standing at (1,2)" beats "OCCUPIED" alone. |
| 19 | A rejection toast gets a "view was out of date" line when the response floor is newer than the version at send time | Implements "told why and catches up" without a contract change. |
| 20 | No success toasts; info toasts only for *remote* destructive changes | Own actions are visible; remote ones are the only surprises. |
| 21 | An identical visible toast restarts its timer instead of stacking; max 3 | Rapid repeated clicks don't bury the screen. |
| 22 | Offline: mutating controls disabled, data dimmed rather than hidden | Reading stale data is useful; sending is not. |
| 23 | No confirmation for Delete robot or New floor (the dialog states what is cleared); history survives New floor | Fewer dialogs; effects are visible and cheap to redo. |
| 24 | UI prefs (selection, edit mode, show-idle, collapsed groups) are memory-only | Deterministic E2E; nothing to migrate. |
| 25 | Light/dark follow `prefers-color-scheme`, no manual toggle | Less UI; the tokens already support both. |
| 26 | Grid keyboard navigation (roving tabindex, WASD) is P2 | Arrow keys are taken by robot commands; WASD resolves the clash but is polish. |
| 27 | The live region does not announce ticks while playing | A 100 ms tick would flood a screen reader; announce play and pause only. |
| 28 | Breakpoint 900px, sidebar 360px | Two columns fit a 1366px laptop with a 20-column grid; below that, stacking wins. |
| 29 | A legend line under the grid | Badge abbreviations need a key, and touch has no hover tooltips. |
| 30 | `{id}` in all test ids includes the "R" | Matches `RobotId` exactly, so tests build ids straight from engine values. |
| 32 | One reserved "status line" under the grid shows banner, hint or legend (priority in 3.3) | Toggling edit mode or GOTO never resizes the grid or shifts the cells under the pointer. |
| 33 | On desktop the command pad sits in the sidebar, on mobile under the grid | Frees vertical space so a 20×20 floor fits a laptop; on a phone the pad belongs right under the thing it controls. |
| 31 | No history type filter beyond Show idle | DECISIONS 5.6 asks only for the idle toggle; PLAN's "filter by type" is left out to save time. |

---

## 12. Open questions for the PM

1. **History at load**: the UI needs the history (at least the newest `TICK_RESOLVED` and everything after it) on load to rebuild last-tick badges. Is `GET /history?after=0` unbounded? A `limit` / `before` option would help on long-running floors; until then the UI loads it all.
2. **Edit-mode click on a robot**: this spec assumes `TOGGLE_OBSTACLE` on a robot's cell is rejected with `CELL_OCCUPIED`. Please confirm in the engine; another reason would need another copy row.
3. **`CREATE_FLOOR` and `tick`**: does it reset `state.tick` to 0? The spec assumes yes (tick numbers in history then repeat; handled by `data-seq`).
4. **Blocked results**: the spec assumes `to == from` for a BLOCKED result and derives the attempted cell from `facing`. Confirm.
5. **Socket reconnect policy**: left to the developers; suggestion is 10 attempts with backoff, then `disconnected` plus the Reconnect button.
6. **Auto-select after placing** relies on `CommandSuccess.history` containing the `ROBOT_PLACED` entry (it does in the protocol).

### PM answers (2026-10-18)

1. **History at load:** the protocol now bounds it. `GET /history?limit=N` without `after` returns
   the newest N entries (ascending; default 500, max 2000). The UI loads `?limit=500` at start; if
   the newest `TICK_RESOLVED` is not in that window, there are simply no last-tick badges.
   Incremental catch-up uses `?after=SEQ`.
2. **Edit-mode click on a robot:** confirmed. The engine rejects `TOGGLE_OBSTACLE` on a robot's
   cell with `CELL_OCCUPIED`.
3. **`CREATE_FLOOR` resets `state.tick` to 0:** confirmed. Use `data-seq` as specified.
4. **BLOCKED results have `to == from`:** confirmed, and `facing` is the direction attempted (a
   GOTO turn sticks even when the step is blocked).
5. **Reconnect:** accepted as suggested (10 attempts with backoff, then `disconnected` +
   Reconnect).
6. **Auto-select after placing:** confirmed; `CommandSuccess.history` includes `ROBOT_PLACED`.

All 33 design decisions in section 11 are accepted.

**PM rulings after the Phase 3 review fixes (2026-10-18):**
- The connection badge keeps its word at every width, including "Connected" on phones (§3.5,
  rule 0: never color alone). At 320px the header wraps to three lines; that is accepted.
- "Playing every N ms" is hidden below 900px so it can't reflow the phone toolbar; the Pause
  label and the interval value carry the state there. Accepted.
- Desktop toasts sit bottom right and may cover the end of the History panel for their lifetime.
  Accepted.
