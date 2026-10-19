# Decisions

Every assumption and design decision, with reasoning. The brief deliberately leaves some
behaviour undefined and contains at least one contradiction; each such case is marked
**[gap]** or **[contradiction]**. Entries tagged *(extra)* go beyond the brief.

Each entry: **Decision**, then *why*, and the alternative considered where there was a real one.

---

## 1. Contradictions found in the brief

### 1.1 Module B battery example vs. its own rule **[contradiction]**
The rule says a blocked MOVE doesn't consume battery. The example (`FLOOR 3,1`, R1 at 0,0 EAST,
`MOVE MOVE MOVE`) expects `R1 97`. Two moves succeed (100 → 98), and the third would leave the
floor, so it is blocked and should cost nothing: **98**.
**Decision:** Module B was not built (see README), so nothing to resolve in code. Had it been
built, we would follow the written rule (98) and document the example as inconsistent, because
an explicit rule is a stronger signal than one worked example.

### 1.2 GOTO stays at the front of the queue vs. "takes exactly one command off the front" **[contradiction, minor]**
**Decision:** GOTO is the one command that is *peeked*, not popped. It is removed on arrival or
when it gives up. Every other command is popped as 1.3 describes. Module A's text is the more
specific rule, so it wins for GOTO.

---

## 2. Tick engine

### 2.1 Resolution order
1. Every robot with a queue takes its front command (GOTO is peeked).
2. LEFT/RIGHT rotate (always succeed). GOTO computes a path and becomes a MOVE in the
   direction of the first step (turning is free), or WAITING/UNREACHABLE if there is no path.
3. MOVE intents whose target is off the floor → `BLOCKED(WALL)`; obstacle → `BLOCKED(OBSTACLE)`.
4. Remaining intents are grouped by target cell; in each group the lowest robot number keeps
   its intent and the others are `BLOCKED(CONTESTED)`.
5. Now every target cell has at most one incoming robot, and every robot at most one outgoing
   move: the movers form a functional graph. Each mover is resolved by following its chain:
   - target cell empty → MOVED;
   - target holds a robot that isn't moving this tick (idle, turning, waiting, or already
     blocked in steps 3–4) → `BLOCKED(OCCUPIED)` / `BLOCKED(BEHIND_BLOCKED)`;
   - target holds a mover → same fate as that mover (if it is blocked, this one is
     `BLOCKED(BEHIND_BLOCKED)`);
   - the chain closes into a loop: a loop of 2 is a head-on swap → both `BLOCKED(HEAD_ON)`;
     a loop of 3 or more → all MOVED.
6. Positions are applied together, the tick counter increments, and one result per robot is
   recorded.

*Why:* walls and obstacles don't depend on other robots, so they are decided first. Contests
come next because "lowest ID wins the right to try" has to happen before following can be
evaluated. After contests, the graph has a simple shape where every case in the brief is either a
chain or a loop, which is easy to reason about and to test.

### 2.2 A contest winner that is then blocked still blocks the losers **[gap]**
Example: a 3-robot rotation where a lower-numbered outsider contests one of the rotation's cells.
The outsider wins the contest, the rotation is broken, and the robot whose cell the outsider
targets can no longer leave, so the outsider is blocked too. Everyone is blocked.
**Decision:** losers stay blocked. *Why:* the brief says the winner wins "the right to try" and
"every other robot aiming at that cell is blocked." A retry for the next-lowest robot would make
resolution iterative and depart from the text.

### 2.3 Which block reason is reported when several apply **[gap]**
**Decision:** the first step in 2.1 that blocks a robot gives its reason: WALL/OBSTACLE, then
CONTESTED, then HEAD_ON / OCCUPIED / BEHIND_BLOCKED. Only the logged reason is affected;
positions are the same either way.

### 2.4 OCCUPIED vs BEHIND_BLOCKED **[gap: reason vocabulary]**
`OCCUPIED`: the robot in front never tried to move (idle, turning, waiting).
`BEHIND_BLOCKED`: the robot in front tried to move and was blocked. Splitting them makes the
history log explain *why* a queue of robots stalled.

### 2.5 Every robot gets a result every tick, including IDLE **[gap]**
"Every tick's result for every robot (moved, turned, blocked plus the reason, or idle) must be
recorded." **Decision:** one `TICK_RESOLVED` event per tick containing a result for every robot,
sorted by robot number. The tick counter advances even when nobody has commands (Step on an idle
floor still counts as a tick).

### 2.6 Robots that turn or idle occupy their cell for the whole tick
A robot that turns doesn't leave its cell, so a robot following it is blocked
(`OCCUPIED`). This follows from rule 4.

### 2.7 Consequences of grid geometry (found while implementing)
- **The smallest possible rotation is 4 robots.** A grid is bipartite, so every closed loop of
  moves has even length. The brief's "three or more" can only ever mean 4, 6, 8, …
- **A robot directly behind a head-on pair is reported `CONTESTED`, not `BEHIND_BLOCKED`.** It
  always aims at the same cell as the pair member facing it, so the contest step blocks one of
  them first. If the follower has the lower number it wins the contest and the swap never
  forms. `BEHIND_BLOCKED` shows up one robot further back.
- **No chain can lead into a loop.** Each loop cell already has its single incoming mover from
  inside the loop, so an outside robot aiming at it would have lost a contest.

### 2.8 Smaller rulings pinned by tests
- `TICK_RESOLVED.tick` is the tick count *after* the tick (the first tick is 1).
- `CREATE_FLOOR` produces a completely fresh world, including `nextRobotNum = 1`. IDs are never
  reused *within* a floor's life; a new floor starts over.
- `TOGGLE_OBSTACLE` emits the same `OBSTACLE_SET` event as `SET_OBSTACLE`, with the new value.
- A malformed ID (`R0`, `X1`) in any action is `INVALID_ID`; a well-formed ID with no robot is
  `UNKNOWN_ROBOT`.
- Two robots aiming at the same obstacle are both `OBSTACLE`, not `CONTESTED` (walls are decided
  first, 2.3).
- A contest winner stuck behind a robot that lost an earlier contest is `BEHIND_BLOCKED`; a
  contest winner stuck behind an idle robot is `OCCUPIED`.

### 2.9 Robot ID priority
Robot priority compares the integer after "R" (R2 beats R10), as the brief says.

---

## 3. Module A: Pathfinding (GOTO X,Y)

### 3.1 Path search
Breadth-first search from the target over cells that are on the floor, not obstacles, and not
occupied by any other robot (as the brief says: "every other robot's current cell" is a wall).
The robot then picks the neighbouring step with the shortest remaining distance, trying NORTH,
EAST, SOUTH, WEST in that order. *Why:* one BFS from the target gives the exact distance from
every cell, so the tie-break is a straightforward comparison rather than a property of BFS
exploration order.

### 3.2 GOTO target is off the floor or an obstacle **[gap]**
**Decision:** rejected when queued (`INVALID_GOTO_TARGET`). In the scenario runner, the whole
QUEUE line is ignored. *Why:* fail fast with a clear reason rather than wait 3 ticks for an
inevitable UNREACHABLE.
A target occupied by another robot *is* accepted: that robot may move away. While it stays
there, there is no path (the target itself is a wall), so after 3 ticks the GOTO is UNREACHABLE.

### 3.3 GOTO to the cell the robot already occupies **[gap]**
**Decision:** finishes on that tick with outcome `ARRIVED`, using up the tick.
*Why:* consistent with "one command per tick"; zero-cost commands would make tick counts
harder to reason about.

### 3.4 What counts toward the 3-tick give-up **[gap]**
**Decision:** only ticks with *no path*. A tick where a path existed but the resulting MOVE was
blocked (contest, head-on, behind a blocked robot) does not count, and finding a path resets the
counter to 0. *Why:* literal reading ("3 ticks in a row with no path"); a robot stuck in traffic
should keep trying.

### 3.5 Counter reset on PLACE
Re-placing a robot resets its GOTO no-path counter (its surroundings changed). Its queue is kept.

### 3.5b CLEAR_QUEUE resets the GOTO counter
Clearing a queue (or a GOTO finishing by arrival or UNREACHABLE) resets `gotoNoPathTicks` to 0,
so a later GOTO always starts with a fresh 3-tick budget.

### 3.6 Facing during GOTO
Turning to face the step is free and sticks even if the MOVE is then blocked. On WAITING
(no path) the facing is unchanged.

### 3.7 A blocked GOTO step
It is still a normal blocked MOVE for that tick (so it is recorded as BLOCKED with a reason), but
the GOTO itself stays at the front of the queue and tries again next tick.

### 3.8 GOTO arrival
When the step moves the robot onto the target, the result is `MOVED` with `reachedGoto: true`
and the GOTO is removed. The next queued command runs on the next tick.

---

### 3.9 Consequence: GOTO robots don't queue up behind each other in a 1-wide corridor
Because every other robot's cell is a wall when planning (brief, literally), a GOTO robot
directly behind another robot in a one-wide corridor has *no path*, even if the robot in front is
about to move away. It waits, and after 3 such ticks its GOTO is dropped as UNREACHABLE. Two
GOTO robots facing each other in such a corridor both give up on tick 3. *Why kept:* this is
exactly what the brief specifies, and it guarantees GOTO never deadlocks forever. A
"traffic-aware" planner (treat robots as passable at a cost, or plan through cells being
vacated) is listed under future work in the README.

### 3.10 Consequences found while testing GOTO
- **A GOTO step can only ever be blocked as `CONTESTED`.** Its target cell is, by construction,
  empty and walkable at planning time, so WALL, OBSTACLE, OCCUPIED, HEAD_ON and BEHIND_BLOCKED
  can't happen to it. The only way to lose the step is another robot claiming the same cell
  with a lower number. For the same reason a GOTO robot can never be part of a rotation loop.
- GOTO tick results carry the GOTO command itself in `command`. `ARRIVED` (already on target)
  has no `reachedGoto` flag; `WAITING`, `UNREACHABLE` and `ARRIVED` leave `to == from` and the
  facing unchanged.
- Creating the default floor at first boot goes through `CREATE_FLOOR` like any other action, so
  history starts with a `FLOOR_CREATED` entry at version 1.

## 4. Scenario runner

### 4.1 FLOOR resets the world **[gap]**
Any `FLOOR W,H` line, not just the first, creates a fresh, empty floor (robots, obstacles,
queues and tick count cleared). *Why:* the brief says FLOOR *creates* the floor. It also lets one
file hold several independent cases. Alternatives were to accept only the first FLOOR, or to resize
and keep whatever fits.

### 4.2 FLOOR outside 1–20 **[gap]**
Ignored as an invalid line; the previous floor (or the 5×5 default) stays.

### 4.3 Commands before any FLOOR
Run on the default 5×5 floor (as the brief says).

### 4.4 PLACE on an existing robot keeps its queue **[gap]**
The brief only says "move it to the new spot." **Decision:** position and facing change; queue is
kept; GOTO counter resets. Placing a robot on its own current cell (to change facing) is allowed,
since that cell is not occupied by *another* robot. If the new spot is invalid, the line is
ignored and the robot stays where it was.

### 4.5 QUEUE with any invalid token **[gap]**
`QUEUE R1 MOVE JUMP LEFT`: **the whole line is ignored.** *Why:* the brief says invalid *lines*
are ignored; applying a line partially is surprising and hard to debug.

### 4.6 Robot ID spelling **[gap]**
Case-insensitive (`r1` = `R1`). Leading zeros are normalized (`R01` = `R1`). `R0` is invalid
(there is no robot 0; IDs start at R1).

### 4.7 TICK N
N must be a positive integer. `TICK 0`, negative, or non-numeric → invalid line, ignored. No upper
cap.

### 4.8 Whitespace and spelling
Leading/trailing whitespace and repeated spaces are tolerated, and so are spaces around commas
(`PLACE R1 0, 0, EAST`). Facings must be full words (`NORTH`, not `N`). Commands are
case-insensitive.

### 4.9 OBSTACLE on a robot or an existing obstacle
On a robot: ignored (brief). On an existing obstacle: no-op.

### 4.10 GOTO syntax
`QUEUE R1 GOTO 3,4` and it can be mixed: `QUEUE R1 MOVE GOTO 3,4 LEFT`.

### 4.11 Comments and numbers
Only lines whose first non-blank character is `#` are comments. A trailing `# ...` on a command
line makes that line invalid (it is not stripped). Integers are plain decimal (`-?\d+`): `+3`,
`1e3`, `0x1`, and `2.0` are invalid; leading zeros are fine (`TICK 007` = 7). `TICK` and `REPORT`
with extra tokens are invalid.

### 4.12 REPORT with no robots
Prints `EMPTY` (brief). Output contains only REPORT lines; nothing else goes to stdout.

---

## 5. UI behaviour

### 5.1 Default floor
10×8 in the UI (brief 1.1), 5×5 in scenarios (brief 1.5). Different contexts, not a contradiction.

### 5.2 Next free robot ID: max + 1 **[gap]**
If R1 and R3 exist, the next click places R4. A high-water mark is kept, so deleting robots never
frees an ID for reuse. *Why:* a newly placed robot never outranks existing robots in contests,
and an ID always means the same robot in the history log.

### 5.3 Edit mode click on a robot
Ignored (brief); the UI shows a toast with the reason.

### 5.4 Arrow keys
Up = MOVE, Left = LEFT, Right = RIGHT. Down does nothing (the brief defines no binding).

### 5.5 Extras *(extra)*
Clear a robot's queue, delete a robot, and reset the floor to a new W×H. UI and API only; the
scenario grammar is unchanged. All go through the same engine reducer and appear in history.

### 5.6 History panel
Every event is stored. The UI groups events per tick (collapsible) and hides IDLE results by
default, with a toggle to show them.

### 5.7 Scenario picker: load by replaying the file's setup *(extra)*
The sidebar can load one of the five brief examples or a few curated scenarios onto the shared
floor, then Play or Step runs it and a checkpoint panel shows each `REPORT` turning into a pass or a
fail. **Decision:** Load is a client-side sequence of ordinary actions (`CREATE_FLOOR`,
`SET_OBSTACLE`, `PLACE_ROBOT` with explicit id and facing, `QUEUE_COMMANDS`) sent through the same
FIFO as every other command. No new endpoint and no change to the engine or protocol contracts.
*Why:* the server stays the only authority, other tabs see the floor reset and the setup arrive live
(Module D), and the history shows exactly what happened.
- **Implicit 5×5.** A file with no `FLOOR` line (brief b, c, d) gets `CREATE_FLOOR 5,5` first, the
  scenario default (1.5), because the shared floor is normally 10×8.
- **Setup only before the first `TICK`.** *(Superseded by 5.8: the script player sends later
  commands between ticks, so any file builds.)* Lines the engine rejects are dropped, as the runner
  ignores them.
- **Checkpoints.** *(5.8 reads them from the floor after each step instead of the server history,
  and replaces the auto-pause: Play ends by itself when the script does.)* The `.expected` file is
  cut per `REPORT` by the runner's report sizes, and a test checks it matches the engine runner.
- **Local to the tab.** The panel lives in the tab that pressed Load. A change to the floor from
  elsewhere stops the run as "edited, results may not match"; a `FLOOR_CREATED` from elsewhere ends it.
- **Bundling:** the files in `scenarios/` are imported as text through the esbuild `loader` option
  in `apps/web/angular.json`, so the picker and the golden tests share one copy.
- **Addendum (layout):** the first version put the title and every checkpoint in the sidebar. With
  a six-checkpoint run the panel grew to 330-420px and pushed Robots and History below the fold,
  where the sidebar clipped them. Two rulings: (1) the sidebar keeps only the compact picker (heading,
  select, Load/Reload, the "n / m passed" badge); the title and checkpoints are a "Scenario
  checkpoints" section (`ui/scenario-results.ts`) under the floor and legend, shown while a run is
  active, because results belong next to the floor they describe and that column already scrolls.
  (2) At >= 900px the sidebar is a scroll container, so if the panes ever cannot all fit it scrolls
  as one column instead of clipping; Robots and History keep their 200px minimums (UI_SPEC 1.1).
  The sidebar's width and position do not depend on the floor size. `e2e/tests/layout.spec.ts`
  guards all of this at 1280x720, 1440x900 and 390x844.

### 5.8 Uploaded scenarios and the client-side script player *(extra)*
Any `.txt` scenario, under any file name, can be uploaded from the Scenarios pane. The page shows what
`npm run scenario -- <file>` prints for it, then Play runs the same script on the live floor and checks
each `REPORT`. The CLI already takes any path, so it is unchanged. **Decisions:**
- **One traced runner.** `traceScenario(text)` (engine, `scenario/run.ts`) runs the file through
  `apply` and returns the REPORT blocks, the ignored lines (parse errors with `invalid.why`, engine
  rejections with the engine's message, each with its 1-based line number) and the replayable steps:
  the accepted actions, one `tick` per tick (`TICK N` is N steps) and a marker per REPORT, starting
  with `CREATE_FLOOR` (the implicit 5x5 one unless the first accepted step is a `FLOOR` line).
  `runScenario` is `traceScenario(...).reports.flat()`, so the CLI output and the golden tests are
  unchanged. Built-in and uploaded scenarios use the same model (`buildScenario`).
- **Mid-script commands work.** Load sends the actions up to the first tick and reads any REPORT
  before it straight from the floor. Play and Step then drive the script from this tab: Step sends the
  actions before the next tick, the tick (one server Step), and reads the REPORTs that follow it;
  Play does that once per tick interval (the slider). Actions after the last tick are flushed with that
  step. The server's own Play is never used during an unfinished run, so pacing and command order are
  exact. Pause stops between steps; with no unfinished run, Play, Pause and Step are the server's.
- **REPORTs are read from the floor the tab holds right after the previous answer**, not from the
  history, so a missed socket frame cannot change a result.
- **Interference.** If an answer's floor version is not the previous version + 1, or the floor changes
  or server Play starts from elsewhere while the run is unfinished, the run stops and is marked
  "modified" (the existing note). A refused command stops it as "failed". A new floor created from
  elsewhere still ends the run. A finished run is not flagged by later edits.
- **Expected file.** Optional (`.expected`, attached per upload). Without it the runner's output is
  the expected. With it, each checkpoint compares live against the file, and a checkpoint where the
  runner differs from the file is marked "Runner ≠ expected". A total line-count mismatch is a
  warning on the scenario, not an error (the blocks are cut by the runner's report sizes).
- **Invalid lines** are listed (line number, text, reason) in a collapsible "Ignored lines (n)"; the
  run goes ahead, as the runner does.
- **Limits.** Over 1,000 ticks the live run is refused with a note (the floor is left alone; runner
  output and checks still show, live "not run"). Uploads are 64 KB per file, 20 uploads, and a script
  with over 20,000 ticks is refused outright (tracing it would freeze the tab).
- **Storage.** Uploads live in `localStorage` (`fleet.scenarioUploads.v1`), every read and write in a
  try/catch, so with storage blocked or full they stay in memory for the session. Uploads are per
  browser, not shared between users.

### 5.9 The key under the floor *(UI behaviour, extra)*
The one-line text legend in the status line is replaced by a grouped visual key (`ui/grid-legend.ts`).
**Decisions:**
- **One table.** `LEGEND_BADGES` (`core/copy.ts`) lists every badge the floor can show (the six
  block reasons WL OB CT HO OC BB, then WT UN AR OK). `badgeFor` reads the same table, so the grid
  and the key cannot drift apart; a unit test checks every block reason and badge-producing outcome
  is in the key.
- **Real symbols.** Groups "On the grid" (robot token, hatched obstacle, solid and dashed GOTO ring),
  "Blocked last tick" and "GOTO last tick". Badges are drawn with the same pill as the grid (the
  global `.pill` class in `styles.css`), a little larger.
- **Highlights what is on the floor now.** Entries whose code is on a badge of a robot that is on
  the grid get `data-active="true"` (outline); while at least one is active the other pills dim to
  55%. Only the pill dims, the text keeps full contrast. With none active everything is at full
  strength. Collapsed, the summary reads "Key · CT, BB on the floor".
- **Collapsible, remembered.** A `<details>`, open by default; the choice is kept in `localStorage`
  (`fleet.legendOpen.v1`), every access in a try/catch, open when storage is blocked or unreadable.
- **Placement.** The status line holds only the banners and the empty-floor hint. The key is its own
  block below it (not shown on an empty floor, as the legend was not), so banners no longer replace
  or shift it; scenario checkpoints follow. It reserves nothing in `--grid-chrome-y`: the grid is
  sized without it and the already-scrolling grid column holds the key. From 1200px the status line
  is one banner line (30px); between 900 and 1199px, where a banner wraps next to the sidebar, it
  reserves two (50px). At 1280x720 a 20x20 floor's cells are 1px larger than before.
- **Addendum (key column).** Under the floor the key pushed the scenario checkpoints below the
  fold at 1280x720, so it moved to its own column. *(Supersedes "Placement" above and the hide-on-empty rule.)*
  - **From 1200px: three columns**, key | grid + checkpoints | sidebar (`--key-w` 15rem, tokens.css).
    The key column scrolls on its own, like the grid column. The three groups stack in it and every
    entry wraps. The scenario checkpoints sit directly under the status line, with nothing between.
  - **900-1199px: two columns**, as before. The key is in the grid column, **under the checkpoints**
    (that column scrolls as one). A third column would not fit next to the 360px sidebar.
  - **Under 900px (phone): stacked**, grid, checkpoints, key, sidebar.
  - **One `<app-grid-legend>`**, rendered by the app shell inside `.main-col` after the grid column.
    Below 1200px `.main-col` is a flex column. From 1200px it is `display: contents` and the key and
    grid columns are placed by `grid-column`. No `matchMedia`, no second instance, so the open or
    collapsed state cannot drift.
  - **Collapsed, the key is a slim rail** (`--key-rail-w` 4.5rem, set with
    `.layout:has(.key-col details:not([open]))`): "Key" and the codes on the floor as stacked pills.
    The grid column takes the width back. The key reshapes itself with a container query (rail
    pills at under 6rem), so it needs no knowledge of the breakpoint. The "Key · CT, BB on the
    floor" text stays in the summary, visually hidden in the rail, for screen readers and tests.
  - **The key shows on an empty floor too**, so the column never disappears and nothing jumps.
  - **Grid sizing:** from 1200px `--grid-chrome-x` adds `--key-w` and one more gap, so cells shrink
    to fit and never overflow (e2e checks a 20x20 floor from 390 to 1440px, key open and collapsed).
    At 1280x720 and 1440x900 the 20x20 cells are unchanged (25.4px and 34.4px, both height-limited).
    The key reserves nothing vertically.

---

## 6. Persistence

### 6.1 Storage layout
SQLite via better-sqlite3 (synchronous). Per committed action, in one transaction:
- **normalized current state** (authoritative): `floors`, `obstacles`, `robots`, `queue_items`;
- **`floor_snapshots`**: the engine state as JSON. Only the *latest* snapshot per floor is kept
  (upserted). Keeping one per version would grow by ~36k rows/hour at the fastest Play speed;
  periodic snapshots would be the base for a future timeline (Module C);
- **`actions`**: every accepted action (the input), keyed by floor and version;
- **`events`**: the history log (the output) shown in the UI.
*Why:* normalized tables are queryable and conventional; the snapshot gives fast loading;
storing the *actions* makes the history replayable. Folding `apply` over the actions from an
empty world must reproduce the current state exactly. A test checks that tables, snapshot and
replay are deep-equal, so the three can never drift apart.
Rejected actions are not stored (they changed nothing); the rejected client is told why.

### 6.1b API validation split: shape → 400, meaning → 409
The API checks only the *shape* of a request by hand (type tag, field types, facing spelling,
commands is an array of objects with a string `kind`). Anything shaped right goes to the engine,
which is the single authority on *meaning*: out-of-range numbers, bad robot IDs, empty command
lists, and unknown command kinds come back as 409 with the engine's `RejectionReason`. Unknown
extra keys are dropped. *Why:* the rules live in one place (the engine) and the scenario runner
and API can't disagree.

### 6.1c Successful no-ops still commit
A successful action that changes nothing (e.g. `SET_OBSTACLE` on an existing obstacle) still
bumps the version and is stored as an action, with no history events. *Why:* "version increments
by exactly 1 per accepted action" stays a simple invariant, and replay stays exact.

### 6.1d One floor in the UI; "new floor" recreates it **[gap]**
The brief describes one floor. The API is floor-id aware (every route takes `:id`, and the tests
use that), but the UI works on a single floor, `main`, created at 10×8 on first start. "New floor
W×H" is a `CREATE_FLOOR` action on that same floor, not a `POST /floors`: it replaces robots,
obstacles, queues and the ID counter, and **keeps the history log**, which records the reset as a
`FLOOR_CREATED` entry. *Why:* the history is the audit trail of the floor, and keeping one id
means every open tab simply receives the reset as an ordinary update. The cost is that two floors
can't be compared side by side; that belongs with Module C (fork), which wasn't built.

### 6.2 Play state is not persisted **[gap]**
After a server restart every floor comes back paused. *Why:* play/pause is a session control,
not floor state; resuming silently after a crash would move robots with nobody watching.

---

## 7. Module D: Multiple users in real time

### 7.1 Server is the only clock
One `TickScheduler` timer per floor. Play from any number of clients is idempotent; changing the
interval restarts that one timer.

### 7.2 Conflicting changes
Node handles one request at a time and each command is a synchronous SQLite transaction, so
commands are applied in arrival order. Of two simultaneous placements on the same cell, the first
to arrive succeeds and the second is rejected (`CELL_OCCUPIED`) with the authoritative floor in
the response. The UI shows the reason and replaces its state.

### 7.3 Edits during Play
Allowed. They are serialized between ticks the same way.

### 7.4 Client catch-up
Every broadcast carries the floor version. A client that sees a version gap reloads the floor
over REST.

### 7.5 Play and pause are session state, not actions **[gap]**
`POST play|pause` never bumps the floor version and never writes history (consistent with 6.2).
They broadcast `floor:playback` to the room only when `playing` or `intervalMs` actually changes;
a repeated Play with the same interval (or a repeated Pause) is a silent no-op that still returns
200 with the current FloorDto. Play while playing with a *different* interval restarts the one
timer at the new interval. `intervalMs` is clamped to `[MIN_TICK_INTERVAL_MS, MAX_TICK_INTERVAL_MS]`;
a non-number `intervalMs` (or a non-object body) is 400. An omitted body means "current interval".
`intervalMs` is kept per floor while paused, so the next Play without a value reuses it; it resets
to `DEFAULT_TICK_INTERVAL_MS` on restart (6.2).

### 7.6 Ticks from Play are ordinary commits
Each timer firing calls the same `step` as `POST /step`: one TICK action, version +1, history, and
one `floor:updated` broadcast. `POST /step` is still accepted while playing (the UI disables its
button, the server does not refuse it; 7.3). `CREATE_FLOOR` while playing keeps playing.

### 7.7 Broadcast rules
`floor:updated` goes to every socket in the floor's room, the sender's included, once per committed
action, in commit (version) order. Rejected or malformed commands broadcast nothing. Joining an
unknown floor acks `null` and joins no room (the protocol's ack type becomes `FloorDto | null`).
A socket may be in several rooms; `floor:leave` for a room it is not in is a no-op.

### 7.8 Play and join input details
- A fractional `intervalMs` is rounded to an integer, then clamped, so `FloorDto.intervalMs` is
  always a whole number.
- A missing, empty, `{}` or non-JSON (`text/plain`) Play body means "keep the current interval".
  An array body or a non-finite `intervalMs` (string, null, boolean) is 400.
- A `floor:join` whose payload is not an object with a string `floorId` acks `null`.
- If a scheduled tick ever throws, that floor is paused (and `floor:playback` is broadcast)
  instead of crashing the process. Not expected to happen: TICK is never rejected.
- UI-side rulings (selection, GOTO arming, key handling during an own PLACE,
  remote-change toasts, playback adoption) live in `docs/design/UI_SPEC.md` (§3.2, 3.6, 5.1, 5.2),
  updated after the Designer's review (`docs/design/UI_REVIEW.md`).

---

## 8. Engineering decisions

- **Pure engine.** `apply(state, action) → {state, events} | rejection`. No IO, clock, or
  randomness; enforced by ESLint rules on `packages/engine/src`. The scenario CLI, API, and tests
  all call the same function.
- **Plain-data state.** Arrays sorted in a canonical order instead of Map/Set, so state is
  JSON-serializable and deep-equality is meaningful.
- **TypeScript 6.0** is pinned repo-wide because Angular 22 requires `>=6.0 <6.1`.
- **`@fleet/protocol` package** for REST/socket types, so the UI never imports from the API app.
- **`.npmrc` sets `loglevel=silent`.** `npm run scenario -- file` otherwise prints npm's
  `> script` banner to **stdout**, which would break exact-output grading. The trade-off is quieter
  `npm install` output; errors from scripts still go to stderr.
- **Injected tick timer.** The `TickScheduler` takes a `TickTimer` (`apps/api/src/tick-timer.ts`).
  Production uses `setInterval`; tests inject `ManualTickTimer` and call `fire()`, so real-time
  tests never sleep and "one timer per floor" is directly assertable.
- **Plain socket.io handlers for join/leave** instead of Nest's `@SubscribeMessage`: Nest drops a
  `null` return value, and joining an unknown floor must ack `null` (7.7).
