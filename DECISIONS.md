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
   - the chain closes into a loop: a loop of 2 is a head-on swap → both `BLOCKED(HEAD_ON)`
     (and anyone behind them `BEHIND_BLOCKED`); a loop of 3 or more → all MOVED.
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

### 2.7 Robot ID priority
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

---

## 6. Persistence

### 6.1 Storage layout
SQLite via better-sqlite3 (synchronous). Per committed action, in one transaction:
- normalized current state: `floors`, `obstacles`, `robots`, `queue_items` (authoritative);
- `floor_snapshots`: the engine state as JSON at that version;
- `events`: the history log.
*Why:* normalized tables are queryable and conventional; the snapshot gives fast loading and a
base for a future timeline (Module C); the event log is the required history. A test checks
that all three rebuild to the same state so they cannot drift.

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
