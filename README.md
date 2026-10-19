# Fleet Floor Simulator

A fleet of warehouse robots sharing one grid floor. Commands wait in per-robot queues; on every
tick all robots act at once, and a pure engine decides who gets which cell. NestJS + SQLite on the
server, Angular in the browser, and a CLI scenario runner that calls the same engine.

**Modules built:** A (GOTO pathfinding) and D (multiple users in real time).

- [DECISIONS.md](DECISIONS.md): every gap and contradiction in the brief and how it was resolved.
- [AI_USAGE.md](AI_USAGE.md): how AI was used, and where it was wrong.
- [docs/design/UI_SPEC.md](docs/design/UI_SPEC.md): the UI spec the frontend was built and tested against.

---

## Setup

Requires **Node 22.22+** (Angular 22's minimum) and npm 10+.

```bash
npm install
npx playwright install chromium   # once, only for the E2E part of `npm run verify`
```

## Run the app

```bash
npm run dev
```

Starts the API on `http://localhost:3000` and the UI on **http://localhost:4200** (the dev server
proxies `/api` and `/socket.io` to the API). Ctrl+C stops both. The database is
`apps/api/data/fleet.db` (override with `FLEET_DB=/path/to.db`); delete it to start over.

Open two tabs to see Module D: changes, ticks and Play/Pause sync live between them.

**Controls**

| Action | How |
|---|---|
| Place a robot (facing NORTH, next ID) | click an empty cell |
| Select a robot | click it, or click its row in the Robots list |
| Queue MOVE / LEFT / RIGHT | ↑ / ← / → (or the on-screen pad) |
| GOTO | Shift-click a cell with a robot selected, or "GOTO…" then click a cell |
| Toggle obstacles | turn on "Edit obstacles", then click cells |
| Advance | Step (one tick), or Play / Pause with the interval slider |
| Clear a queue / delete a robot / new floor | buttons in the robot row / toolbar |
| Cancel GOTO, then deselect | Esc |

The grid is keyboard-navigable: Tab into it, move the cursor with WASD (or the arrows when no robot
is selected), Enter to click, Shift+Enter to GOTO.

## Scenario runner

```bash
npm run scenario -- scenarios/brief_a_chain.txt
```

Reads the file, applies each line through the engine's `apply` (the same function the API uses),
and prints every `REPORT` to stdout and nothing else. Invalid lines are skipped silently.
`GOTO X,Y` is accepted in `QUEUE` lines. `scenarios/` holds 72 scenarios, each with a `.expected`
file: the brief's five examples plus edge cases (contests, chains, rotations, a contest breaking a
rotation, R2 vs R10, FLOOR resets, parser tolerance, GOTO tie-breaks and UNREACHABLE). The test
suite runs every one through the real CLI and compares stdout byte for byte.

## Verify

```bash
npm run verify        # everything CI runs: typecheck, lint, format, build, all tests, E2E
npm run verify:fast   # typecheck, lint, format, engine tests + golden scenarios (~20 s)
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, installs Chromium and runs `npm run verify` on Node 22.

---

## Why modules A and D

The brief weights the engine's correctness most, so I picked the two modules that put the most
pressure on it and on the server's authority over it:

- **A (GOTO)** lives inside the engine. A GOTO step becomes an ordinary MOVE and goes through the
  same simultaneous resolution, so it deepens the core instead of sitting beside it. It's pure and
  deterministic, so it can be tested as thoroughly as the core (unit, property and golden tests).
- **D (real time)** tests the other half of the design: one server-side clock, atomic commands, and
  conflict handling. These fall out naturally from a synchronous SQLite transaction per command on
  single-threaded Node, which made it possible to do D properly rather than approximately.

**Not built:**
- **B (battery)** is mostly bookkeeping on top of MOVE, and its example contradicts its own rule
  (DECISIONS 1.1).
- **C (timeline/fork)** is the most natural next step, because the storage already makes it cheap
  (see "With another week").

## Architecture

```
packages/engine     pure TypeScript: types, apply(state, action), move resolution, BFS, scenario parser/runner
packages/protocol   REST DTOs + socket.io event names/payloads (the only thing the UI and API share)
apps/api            NestJS: FloorsController → FloorsService → FloorRepository (better-sqlite3)
                    TickScheduler (one timer per floor) + FloorGateway (socket.io rooms)
apps/web            Angular 22 (standalone, signals, zoneless): FloorStore + components
e2e                 Playwright specs against the built API and the dev UI
scenarios           *.txt + *.expected golden files
```

**The engine** (`packages/engine/src`) has no IO, clock, randomness or framework. ESLint rules
enforce this, so a violation fails `verify`. `apply(state, action)` returns the new state plus
events, or a rejection reason. A tick resolves in a fixed order:
1. Rotations and GOTO planning.
2. Walls and obstacles.
3. Contests: lowest robot number wins.
4. Following through the resulting chains and loops: a 2-loop is a head-on swap, a loop of 3 or
   more rotates.

This is in `resolve-moves.ts`, documented step by step in DECISIONS 2.1. State is plain sorted
arrays, so it serializes and deep-compares cleanly.

**A command on the server** is `load → apply → commit` with no `await` in between, inside one
SQLite transaction:
1. Rewrite the normalized rows (floors, obstacles, robots, queue items).
2. Upsert the latest JSON snapshot.
3. Append the action and its events.
4. Bump the version.

Node runs one request at a time, so two simultaneous placements on one cell are applied in arrival
order: one gets 200, the other 409 `CELL_OCCUPIED` with the authoritative floor in the body. After
the commit, the floor and its new history entries are broadcast to the floor's socket.io room.

**The UI** keeps one signal-based store, fed by REST responses and socket broadcasts. It applies
only newer versions, dedupes history by sequence number, and refetches if it sees a version gap or
reconnects.

## Tests

| Layer | Count | What |
|---|---|---|
| Engine unit | ~575 | one file per rule: walls, contests (incl. R2 vs R10), head-on, following/chains, rotations, interactions, reducer rejections, scenario parser, GOTO (tie-break order, waiting, UNREACHABLE after 3, arrival) |
| Engine property | 17 properties | the real resolver vs. a deliberately naive fixpoint **reference resolver** on random floors; plus no shared cells, nothing off-floor or on obstacles, listing order irrelevant, determinism; 6 more for GOTO. Fixed seed (424242) |
| Golden scenarios | 72 | every `scenarios/*.txt` through the real `npm run scenario` CLI, stdout compared byte for byte |
| API integration | 263 (+1 todo) | every 409 reason (a `Record<RejectionReason, …>`, so a new reason fails to compile), 400s, history paging/clamping, restart persistence, **three-way consistency** (normalized rows = snapshot = replay of the action log = GET) after every step of a 55-action sequence |
| Real-time | 46 of the above | two socket.io clients; one timer however many clients press Play; exactly one winner per contested cell; broadcasts in version order. Uses an injected manual timer, so no sleeps |
| Web unit | 73 | store catch-up, gap handling, history dedupe, last-tick derivation, stale-conflict toasts, keyboard rules |
| E2E (Playwright) | 44 | placing, editing, queueing with keys, Step, GOTO, every block badge and history sentence, rejection toasts, two-tab sync, refresh persistence, new-floor dialog |

**Keeping the tests honest:**
- **Black-box authorship.** The tests were written from the brief and DECISIONS.md, not from the
  code. A separate agent wrote them without seeing the implementation (see AI_USAGE.md).
- **Mutation checks.** Bugs were injected on purpose to confirm the suites catch them: 6/6 in the
  engine, 10/10 in the API.
- **Determinism.** Everything is deterministic: fixed seeds, an injected clock and timer, and E2E
  that uses Step only, never Play timing. Retries are off.

### How Module D is tested, and what isn't automated

**Automated:**
- **Same-cell race.** Two clients race PLACE on one cell: exactly one 200, one 409 with the
  winner's floor, and each client receives exactly one broadcast. Repeated 5 times.
- **One timer.** Both clients press Play: one interval exists. Each manual timer fire gives one
  tick, broadcast to both clients in version order.
- **Play/pause semantics.** Play with a new interval restarts the one timer. A repeated Play or
  Pause is silent. Neither ever changes the version.
- **Shutdown and restart.** Closing the app stops every timer. After a restart the floor comes back
  paused.
- **UI conflict path (E2E).** A request is intercepted so another client places first. The toast
  says why and is marked stale, and the view catches up without a refresh.

**Manual plan** for what automation doesn't cover well (real timing, real networks):
1. Two browsers (not just tabs), Play at 100 ms in one: both tick together. Press Play in the other
   too: the tick counter still advances once per interval, not twice.
2. While playing, place and queue robots from both: no lost or duplicated history lines.
3. Stop the API mid-Play: both tabs show "Reconnecting…" and disable mutating controls. Restart it:
   both reconnect, catch up, and show the floor paused (play state is deliberately not persisted,
   DECISIONS 6.2).
4. Throttle one tab to "Slow 3G" in DevTools and click the same cell in both: the slow one gets the
   "out of date" toast and catches up.
5. Close a tab while playing: the loop keeps running for the other (the server owns the clock).

## What's missing, and what I'd do with another week

- **Module C (timeline/fork).** Every accepted action is stored in order, and the latest snapshot
  is kept per floor. Scrubbing would replay actions from the nearest snapshot. With snapshots every
  N versions, the cost is O(N) replay per seek and O(versions/N) storage. Forking copies the action
  prefix to a new floor id. The replay-consistency test already proves replay gives the exact
  stored state.
- **Module B.** Not built. The contradiction is resolved on paper in DECISIONS 1.1.
- **Multiple floors in the UI.** The API is floor-id aware, but there is no `POST /floors`. "New
  floor" recreates floor `main`. The test for floor independence is a `todo`.
- **GOTO in narrow corridors.** Read literally, the brief makes a GOTO robot treat other robots as
  walls, so in a one-wide corridor it waits and eventually gives up instead of following. That is
  kept on purpose (DECISIONS 3.9). The obvious improvement is to plan through robots that are moving
  away.
- **History growth.** History is paged (limit and after), but never compacted. Old events would
  need archiving at scale.
- **Auth, multi-user identity, rate limiting**: out of scope.
- **Production serving.** The UI runs from `ng serve` in dev. A production build would have the API
  serve `apps/web/dist` statically.
