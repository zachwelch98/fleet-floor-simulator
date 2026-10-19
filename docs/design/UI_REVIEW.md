# UI review: Fleet Floor Simulator (Angular UI, Dev 3)

Reviewed against `UI_SPEC.md` on branch `worktree-agent-a11f0bd2919eec1d8` (base `17913aa`). I ran the
API and `ng serve` on ports 3400/4500 and drove them with Playwright at 1366×768 and 375×812 (plus 320),
light and dark, with 10×8, 3×3 and 20×20 floors, 17 robots, every last-tick badge outcome, edit mode,
GOTO armed, offline, reconnecting, the New floor dialog, toasts, two tabs, and a keyboard-only pass.
Servers are stopped. Nothing under `apps/` was changed.

## Verdict

Good, and close to shippable. The grid, badges, GOTO markers, queue chips, history copy, toast copy,
stale-conflict toast, live sync between tabs, offline and reconnect, and the dialog all behave as specified,
look clean in both themes, and are readable at 20×20 on a phone (dot badges). Every data-testid I probed
matched the catalog. There are **no blockers**, but there are **three major issues** worth fixing before
the demo: a blank-scrolling page on desktop, arrow keys going to the interval slider after a grid click,
and a cramped Robots/History column. Everything else is minor or polish.

Counts: blocker 0, major 3, minor 7, polish 5.

Screenshots (all in `docs/design/review/`):

1. `01-desktop-10x8-robots-panel.png`: the squeezed Robots panel (finding 3).
2. `02-desktop-20x20-badges-light.png`: every outcome badge, 17 robots, selection ring, GOTO markers.
3. `03-desktop-20x20-badges-dark.png`: the same in dark.
4. `04-desktop-edit-mode.png`: edit mode, dashed border, banner.
5. `05-desktop-toasts-cover-header.png`: three toasts covering the connection badge and toolbar (finding 8).
6. `06-desktop-offline.png`: disconnected state with Reconnect.
7. `07-phone-20x20-light.png`: a 20×20 floor at 375px.
8. `08-phone-toast-dark.png`: a bottom toast on a phone.

## Findings

### Major

**1. The page scrolls into blank space on desktop (spec 1.1: "the page does not scroll on a laptop").**
Repro: 1366×768, floor with ~17 robots, some with queues. `document.scrollingElement.scrollHeight` is 2814
(viewport 768); `scrollTo(0, 800)` really scrolls, showing an empty grey page; `scrollIntoView()` on the History
panel (or Tab onto an offscreen element) scrolls the whole page the same way. Cause: the `Next: `
`.visually-hidden` span in each front queue chip is `position: absolute`. Its nearest positioned ancestor is the
viewport, so it is not clipped by the `overflow: auto` Robots panel and it extends the document to the chip's
unscrolled position. The mobile layout is unaffected (the page scrolls anyway).
Expected: no page scroll at 1366×768 with any robot count.
Fix: add `position: relative` to `.robots` in `ui/robot-list.css` (and to `.log` in `ui/history-log.css`, and
to `.panel` globally in `styles.css` to be safe). Alternative: make `.visually-hidden` in `tokens.css` carry
`top: 0; left: 0` and give every scroll container `position: relative`. Add an E2E assertion:
`document.documentElement.scrollHeight <= innerHeight` at 1366×768 with 17 robots.

**2. After touching the interval slider, a grid click selects a robot but the arrow keys still move the slider (spec 5.2, 8).**
Repro: click or focus `input-interval`, click a robot's cell (R1 becomes selected), press ArrowUp. Result:
no command queued; the slider moves 500 to 600 ms. Cause: cells call `preventDefault()` on `mousedown`
(Dev 3 deviation 12), so the browser never moves focus off the slider, and the spec rule "ignore keys whose
target is a text-entry control" then (correctly) ignores the arrow. Seen with `input-interval`; the same applies to
any focused number input. Selecting a robot by mouse and then arrowing is the main loop of the app, and the
slider is the control people touch right before it (Play, then tune speed, then drive a robot).
Expected: a click on the grid hands the keyboard to the global handler.
Fix: in `FloorGrid.onCell` (or the `(mousedown)` handler), after `preventDefault()`, blur the active element
when it is a text-entry control: `const a = document.activeElement as HTMLElement | null; if (a && a !== document.body && a.matches('input,textarea,select')) a.blur();`.
Add an E2E test: focus slider, click a robot cell, press ArrowUp, expect the queue chip. See also finding 6.

**3. The Robots and History panels are too cramped on a 1366×768 laptop (spec 1.1, 6, 7).**
With just 3 robots the Robots panel (capped at `max-height: 35%` of the sidebar, about 215px) shows barely
one robot row; the "Robots (3)" heading scrolls out of view as soon as a robot is selected (it lives inside the
scrolling panel); History is left with about 200px, of which 110px is its header (title, checkbox, then a second row for
Expand all / Collapse all), leaving three lines of log. See screenshot 1. A robot row is about 140px tall: select
button, queue, last tick, and a buttons row, each on its own line. With a long queue (30 chips) the row grows
to 7.5em more.
Expected: a user can see all of a small fleet's state and the latest tick without scrolling inside two tiny
boxes.
Fix (any subset, in this order): (a) compact the row: put `Clear queue` and `Delete` on the same line as the
select button (icon-only Delete with `aria-label` is acceptable on desktop) and keep the "Last tick" line;
that is about 90px per row. (b) `.robots-wrap { max-height: 45%; min-height: 200px }` and
`.history-wrap { min-height: 200px }` in `app.css`. (c) Make the panel heading sticky
(`.panel-title { position: sticky; top: 0; background: var(--color-surface); }` inside `.robots`).
(d) Put Expand all / Collapse all on the heading row (drop `flex-basis: 100%` in `history-log.css` `.bulk`) or move
them behind a small menu. (e) Cap `.queue` at about 3 lines (`max-height: 5em`).
UI_SPEC 1.1 has been updated to say Robots and History each get at least 200px.

### Minor

**4. The command pad GOTO button does nothing in edit mode (spec 5.1, Dev 3 deviation 4).**
Repro: turn on Edit obstacles with a robot selected; `btn-goto-mode` is enabled, clicking it neither arms GOTO nor
says why. A silent control is worse than a disabled one.
Fix (ruled, now in the spec): pressing GOTO while edit mode is on turns edit mode off and arms GOTO. In the
store: `armGoto()` does `editMode.set(false)` first. (If the developer prefers, disable the button with a
`title="Turn off Edit obstacles first"`; the toggle-off-and-arm behaviour is the better fit with "no hidden
second mode".)

**5. A key pressed while an own PLACE is in flight goes to the previously selected robot (spec 5.1, 5.2).**
Repro (800 ms response delay to exaggerate; same race exists on localhost in a few ms): R1 selected, click an
empty cell, press ArrowUp immediately. R1 receives MOVE; the new robot is selected afterwards; no toast.
Ruling on the brief's question: with nothing selected, a key before the PLACE response doing nothing is
acceptable. With a previous selection it is not, because the command lands on a robot the user was leaving.
Fix (now in the spec, 5.2): while an own `PLACE_ROBOT` is in the FIFO, drop command keys silently. In `FloorStore`
keep a `placing` counter and make `queueCommand` return early (no toast, no request) while it is above zero.

**6. A focused checkbox swallows the arrow keys (spec 5.2).**
Repro: tick "Show idle robots", click a robot, press ArrowUp: nothing happens until focus moves, because
`isTextEntry` treats every `input` as text entry. Only text-like inputs and the range/number inputs need
the exemption. Fix: in `core/keys.ts` `isTextEntry`, return false for `input[type=checkbox]` (and update
`keys.spec.ts`). Spec 5.2 updated.

**7. At 320px wide the page scrolls horizontally by 3px (spec 1.2: no horizontal scroll from 320px).**
`btn-cmd-right` and `btn-goto-mode` in the command pad end at x=323 because of `white-space: nowrap` and the
three-column grid. Fix in `ui/command-pad.ts`: remove `white-space: nowrap` and add `min-width: 0` to
`.btn`; hide `.key` (the arrow hint) under 360px: `@media (max-width: 359px) { .key { display: none } }`.

**8. Desktop toasts cover the connection badge, the New floor button and the top of the command pad (spec 3.6, 1.2).**
Screenshot 5: three toasts at top right sit over "Connected", "New floor…" and the pad title for 6 s. The
connection badge is the one thing the user needs to see when something fails.
Fix: in `ui/toasts.ts` anchor desktop toasts at `top: calc(var(--header-h, 56px) + 56px)` (below the toolbar)
or at the bottom right (`bottom: var(--space-4); right: var(--space-4)`), keeping the mobile bottom placement.
Spec 3.6 updated.

**9. The toolbar jumps when Play is pressed (spec 3.2).** "Playing every 500 ms" appears inline and pushes the
slider, Edit and New floor buttons sideways (the slider track shrinks and Edit and New floor move about 180px). Fix: keep the text in the layout always (`visibility: hidden` when paused)
or move it under the Play button / into the `interval-value` text, e.g. "500 ms · playing".
Spec 3.2 updated.

**10. Touch targets under 44px on a phone (spec 8).** The History `summary` rows are 28px high, the "Show idle
robots" label is 141×32 and its checkbox 18×18. Fix: `summary { min-height: 44px; align-items: center }` and
`.idle { min-height: 44px } .idle input { width: 24px; height: 24px }` inside `@media (max-width: 899px)`.

### Polish

**11. The grid is left-aligned in a 950px column, leaving about 350px of dead space on a 10×8 floor at 1366px.**
Centering the grid horizontally in `.grid-col` (`display: grid; justify-content: center`, keep the status line
left-aligned under it) looks better. The legend can keep its full-column width.

**12. Overlap at small cells.** At 27px cells, side-by-side badges collide (R5/R6 `✕HO ✕HO` touch) and the GOTO
marker's tiny ID label ("R15", "R16") overlaps the crosshair. Both are legible via tooltip and list, so acceptable.
Fix if time: under 30px, hide the marker's ID label unless it is the selected robot's, and use `font-size: 7px` plus
`letter-spacing: -0.02em` on the badge text.

**13. Phone header.** At 375px the connection badge drops to its own row under the title, using a full line. Making
the title row `flex-wrap: nowrap` with the badge shrunk to the dot-only form under 420px keeps the spec's two-line header.

**14. Tap highlight.** Screenshots taken immediately after a tap showed a light-blue flash on the tapped row and
on the armed GOTO button (the settled state is correct: accent fill, white text, 4.5:1+). Set
`-webkit-tap-highlight-color: transparent` in `styles.css` so touch feedback comes only from our own pressed state.

**15. History summary time is bold.** The `<time>` inside the bold summary inherits `font-weight: 700`; set
`summary time { font-weight: 400 }`.

## Rulings on Dev 3's deviations

1. **Armed GOTO + click on another robot selects it and disarms: accept.** It is the only reading that keeps
   "clicking a robot selects it" true. UI_SPEC 5.1 now has an explicit row. Shift-click or Shift+Enter remains the way
   to send a robot to a cell holding a robot.
2. **Last-tick sentence drops the id, capitalized, no final period: accept.** It matches the spec's own examples.
   UI_SPEC 6 now states it.
3. **"(N idle hidden)" when idle is hidden: accept.** With the toggle on, idle is a normal count. UI_SPEC 7.3 now says so.
4. **Selecting any robot disarms GOTO: accept** (spec 5.1 now says so). **Pad GOTO silently does nothing in edit mode: change** (finding 4).
5. **playing/intervalMs adoption rules, slider follows the server only on change and never mid-debounce: accept**
   (verified in two tabs: Play, Pause and interval changes propagate, Step disabling follows). UI_SPEC 3.2 now states it.
6. **Remote FLOOR_CREATED / ROBOT_REMOVED toasts suppressed while an own request of that type is in flight: accept.**
   I saw the remote toasts fire correctly in tab A when tab B acted. The edge case (a remote delete landing during
   your own delete) is harmless. Recorded in UI_SPEC 3.6.
7. **Gap handling details: accept.** Socket gaps resync over REST; own responses apply the authoritative floor even
   with a gap. That is what DECISIONS 7.4 needs and I saw no divergence.
8. **Layout (extra 16px axis-title row/column, status line min-height 48px, desktop grid chrome +20px, ▶/❚❚ via CSS): accept.**
   UI_SPEC 1.1 and 1.3 updated. The 20×20 floor still fits 1366×768 with 27px cells (better than the spec's 22px).
9. **Size limits hardcoded: accept** (they are `FLOOR_SIZE_MIN/MAX` constants in `core/copy.ts`; importing
   `MIN_FLOOR_SIZE`/`MAX_FLOOR_SIZE` from `@fleet/engine` would be tidier but is not required).
10. **Blocker lookup nuance (excludes self, matches by `from` equal to the attempted cell): accept.** The generated
    sentences were correct for HEAD_ON, OCCUPIED and BEHIND_BLOCKED in the 17-robot scenario.
11. **Silent selection clear on stale rejection: accept.** The rejection toast already explains it.
12. **Cell `mousedown` preventDefault: accept the intent (no text selection, no focus jumps), but it causes
    finding 2.** Keep it and blur text-entry controls explicitly.
13. **A keypress before the PLACE response does nothing: acceptable when nothing was selected; not acceptable when a
    previous robot was selected** (finding 5). Selecting on success stays as specified.

## Checked and fine

- Keyboard-only: Tab order is Step, Play, slider, Edit, New floor, one grid stop, then list buttons, then History;
  disabled controls are skipped; every focused control shows a 3px accent ring; WASD, Home/End, Enter and Shift+Enter
  work; Esc disarms, then deselects; the dialog traps focus, focuses Width first, Esc closes and returns focus to New
  floor; Delete moves focus to the next row's select button.
- Arrow commands: Up, Left and Right queue MOVE, LEFT and RIGHT; Down is swallowed; holding a key queued one command.
  The slider keeps its own arrow keys.
- Aria labels read as specified, for example `Cell 14,12: robot R4 facing WEST, selected` and `Cell 16,18: empty, GOTO target of R15`.
  After a manual Step the live region reads "Tick 5: R15 moved to 16,18, reached GOTO. R16 moved to 7,18."
- Toasts: copy matches 5.5; the stale detail appears only when the floor moved under the request (`data-stale="true"`);
  they auto-dismiss after about 6 s.
- Offline: `Reconnecting…` then, after about 40 s, `Offline` with Reconnect, which works after the API returns.
  Mutating controls and the grid are disabled; an arrow key raises the `OFFLINE` toast.
- Dialog: invalid width (25, empty, 1.5) shows the inline error and disables Create; Enter creates; light and dark
  look right; focus returns to the opener.
- Phone 375: no horizontal scroll; 20×20 uses 15px cells with dot badges and stays usable; GOTO armed banner and
  edit banner sit right under the grid; toasts stick to the bottom.
- Contrast: all text and indicators looked fine in both themes (checked visually; token pairs were scripted earlier).

## UI_SPEC edits made

- 1.1: status line is min-height 48px; right column sizes (pad about 170px, Robots and History at least 200px,
  Robots at most 45%, sticky headings).
- 1.3: axis-title row/column and CSS play glyph note.
- 3.2: playback and interval adoption rules; no toolbar reflow when "Playing every N ms" appears.
- 3.6: remote-toast suppression while an own request is in flight; desktop toasts must not cover the header badge or toolbar.
- 5.1: new matrix row for armed + robot click; selecting any robot disarms; pad GOTO in edit mode turns edit off and arms.
- 5.2: command keys dropped while an own PLACE is in flight; blur text-entry controls on grid click; checkbox exempt
  from the text-entry rule.
- 5.4: first Tab lands on the cell that last had focus, else the selected robot's cell, else (0,0).
- 6 (item 3): last-tick sentence form.
- 7.3: idle summary wording.
