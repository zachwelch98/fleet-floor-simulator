# Plan: Fleet Floor Simulator take-home

## Context
Take-home from `Fleet_Floor_Simulator_Brief.pdf`: build a full-stack simulator of warehouse robots that all act at once on each tick, plus a CLI scenario runner that they grade automatically against hidden scenarios. The 90-min follow-up (walkthrough, live change, finding a planted bug, trade-offs) carries most of the grade. Optimize for a **correct, pure, well-tested engine** and for documented judgment calls, not volume.

Decisions made so far:
- **Language:** TypeScript end to end.
- **Frontend:** Angular.
- **API:** NestJS on Node 22.
- **Database:** SQLite.
- **Modules:** **A (Pathfinding GOTO)** + **D (Real-time multi-user)**.
- **Battery contradiction:** moot, since Module B isn't being built. Still log it in DECISIONS.md as "noticed, not built".
- **Division of work:** a multi-agent team (below), with Claude (Opus 5.5) as product manager and orchestrator. The user reviews at each phase gate.
- **Schedule:** no hard deadline, move fast. CI on GitHub Actions; public repo.

## Team and orchestration
**PM / orchestrator: me, Opus 5.5.** I own the spec, DECISIONS.md, task breakdown, interface contracts, code review of every agent's output, integration, commits, and AI_USAGE.md. I never merge work until `npm run verify` is green.

The others are agents spawned with the Agent tool, `model: "sonnet"` (Sonnet 5.5). Each gets a self-contained brief: the relevant spec excerpt, the DECISIONS entries, the contract files and the directories it owns. Briefs explicitly forbid touching files outside its ownership.

| Role | Owns | Deliverables |
|---|---|---|
| **Product Designer** | `docs/design/`, Angular styles/tokens | UI spec: layout, states (edit mode, selected, blocked badges, conflict toast, disconnected), keyboard map, accessibility. Then reviews the frontend dev's result against the spec. |
| **Dev 1: Engine** | `packages/engine/src` (except `scenario/`) | types, reducer, move resolution, GOTO pathfinding |
| **Dev 2: Runner + API** | `packages/engine/src/scenario`, `src/cli`, `apps/api` | scenario parser/CLI, SQLite repository, REST, TickScheduler, socket.io gateway |
| **Dev 3: Frontend** | `apps/web` | Angular app implementing the designer's spec |
| **Tester** | `packages/engine/test`, `apps/api/test`, `e2e/`, `scenarios/` | the deterministic suite (see "Test strategy"). Writes tests **black-box from the spec and DECISIONS.md**, not from the developers' code, so the tests check the spec independently instead of copying an implementation's mistakes. |

**How the agents work together**
- **Contract first:** before any developer starts, I write `packages/engine/src/types.ts` (State, Action, Event, BlockReason, the `apply` signature) and `apps/api/src/contract.ts` (REST DTOs, socket event names and payloads). Every agent codes against these. A change to a contract goes through me.
- **Parallelism:** agents with disjoint directory ownership run in parallel in the background, each in its own git worktree (`isolation: "worktree"`). I merge the branches in order.
- **Review loop:** for each agent result I read the diff, run `npm run verify`, and either accept, or send corrections back through SendMessage to the same agent so it keeps its context. Notable rejections and catches are logged in AI_USAGE.md.
- **Bug triage:** when the Tester's tests fail against a developer's code, I decide whether the code or the test is wrong, using the spec and DECISIONS. Then I route the fix to that agent and record the ruling in DECISIONS.md if it was a gap in the spec.
- **Code context map (`code-context-map` skill):** this is how everyone keeps track of the changes and avoids calling functions that don't exist.
  - **Bootstrap (Phase 0):** after the scaffold and `npm install`, which puts `typescript` in `node_modules` so `.ts` files are parsed exactly instead of with the `~` regex fallback:
    - `python3 ~/.claude/skills/code-context-map/scripts/toggle.py status` to confirm it's on;
    - then `python3 ~/.claude/skills/code-context-map/scripts/scan_project.py` to build `.claude/context-map.json` and `.md`.
  - **Keeping it current:** the skill's PostToolUse hook re-indexes every file edited through Edit/Write/Bash, including edits made by subagents.
  - **Rule in every agent brief:** "Before writing any call, import or extension of code you didn't write in this task, look up the symbol in `.claude/context-map.md`; for exact parameters, grep `.claude/context-map.json`. If it isn't there, run `scan_project.py --file <path>` or read the source. Never guess a name or signature." Contract files (`types.ts`, `contract.ts`) are indexed first, so every agent starts with exact signatures.
  - **Worktrees:** an agent's edits update the map inside its own worktree. After merging each branch into the main checkout I rerun the full `scan_project.py`, so the map is current before the next phase's briefs go out. I also check the session-start status line for staleness warnings.
  - **PM review:** I use the map's Import graph to check boundaries, for example that `packages/engine` imports nothing from `apps/*` or Node IO and that `apps/web` imports only `types` from the engine. I check cross-module calls (API → `apply`, gateway → service) against the signatures in the map.
  - **Git:** the map files are `.gitignore`d. They are generated tooling state, not part of the deliverable, and ignoring them avoids merge conflicts between worktrees. AI_USAGE.md will mention that the map was used.
- **Commits:** I make readable, scoped commits per accepted piece of work (for example "engine: contested-cell resolution", "test: golden scenarios for chains"), never one squashed commit.

## Repo layout (npm workspaces, single `package-lock`)
```
/package.json            root scripts: scenario, dev, test, lint, build
/packages/engine         pure TS, zero runtime deps (core + GOTO + scenario parser/runner)
  src/types.ts           Floor, Robot, Facing, Command, Action, Event, BlockReason
  src/geometry.ts        facing/turn/step helpers, robot-ID parsing/compare
  src/resolve-moves.ts   simultaneous move resolution (the heart)
  src/pathfinding.ts     BFS for GOTO
  src/engine.ts          apply(state, action) -> { state, events } | { rejected: reason }
  src/scenario/parse.ts  line -> Action | null (pure)
  src/scenario/run.ts    runScenario(text) -> string[] (pure; used by CLI + tests)
  src/cli/scenario.ts    reads file, prints lines (only stdout writer)
  test/                  unit + property tests
/apps/api                NestJS: FloorsController, FloorsService, FloorRepository (better-sqlite3),
                         TickScheduler, FloorGateway (socket.io)
/apps/web                Angular (standalone components + signals), socket.io-client
/scenarios/*.txt + *.expected   golden scenarios, auto-run by tests and CI
README.md  DECISIONS.md  AI_USAGE.md  .github/workflows/ci.yml
```
Root `"scenario": "tsx packages/engine/src/cli/scenario.ts"`, so `npm run scenario -- file.txt` works right after `npm install` with no build step and no extra output on stdout.

## Engine design (the part to defend line by line)
- **State:** `{ width, height, obstacles: Set<"x,y">, robots: Map<id, {id, num, x, y, facing, queue, gotoNoPathTicks}>, nextRobotNum, tick }`. `nextRobotNum` is a high-water mark, so deleting the highest robot doesn't free its ID for reuse. It is immutable from the caller's view; `apply` returns a new state.
- **Single reducer:** `apply(state, action)` for `CreateFloor | PlaceRobot | RemoveRobot | SetObstacle | ToggleObstacle | QueueCommands | ClearQueue | Tick`. Returns events, or `rejected` with a reason code. The API, CLI, history log and real-time conflicts all use this one path, which satisfies "same engine, not a copy".
- **Tick algorithm:**
  1. Pop one command per robot that has a queue. GOTO is peeked, not popped; it is removed only on arrival or give-up.
  2. LEFT/RIGHT → `TURNED`. GOTO → BFS, then face the first step and act as a MOVE; no path → `WAITING`, and the 3rd tick in a row → `UNREACHABLE` and GOTO is removed.
  3. MOVE intents: wall or obstacle → `BLOCKED(WALL|OBSTACLE)`.
  4. Group by target cell: the lowest robot number keeps its intent, the others → `BLOCKED(CONTESTED)`.
  5. Each target cell now has ≤1 incoming robot and each robot ≤1 outgoing move, so the movers form a functional graph. Resolve each one recursively, with memoization and visit states:
     - target empty → MOVED;
     - target held by a robot that isn't moving → `BLOCKED(OCCUPIED)`;
     - target held by a robot that is moving → depends on that robot's result, and a block propagates as `BLOCKED(BEHIND_BLOCKED)`;
     - a loop found during resolution: length 2 → both `BLOCKED(HEAD_ON)`, length ≥3 → all MOVED.
  6. Apply moves, `tick++`, and emit one result per robot: MOVED / TURNED / BLOCKED+reason / WAITING / IDLE.
- **Pathfinding:** run one BFS from the target over free cells; every other robot's current cell is a wall. Pick the neighbour of the robot with the smallest distance, trying them in order N, E, S, W. Deterministic and O(W·H) per robot.
- **Robot IDs:** parse `R<n>` with n ≥ 1 and compare by number. Leading zeros are normalized (`R01` → `R1`); `R0` is rejected.

## Edge-case decisions → DECISIONS.md (one entry each, with reasoning)
**Engine**
- A contest winner that ends up blocked still blocks the losers, as the literal reading says; there's a test for the cycle broken by an outsider.
- Precedence: a wall/obstacle block is decided before the contest, so a robot aimed at a wall never contests a cell.
- Turning and idle robots occupy their cell for the whole tick.

**GOTO**
- Target is an obstacle or off the floor → reject at queue time.
- Already at the target → finishes on that tick with `ARRIVED`, using up the tick.
- A blocked MOVE during GOTO does *not* count toward the 3-tick no-path counter.
- The counter resets on PLACE, and on finding a path.
- Facing after GOTO is the last step's direction.
- GOTO staying at the front of the queue vs "take one command off the front" is noted as an explicit exception.

**Scenario runner**
- `FLOOR` resets the world; any `FLOOR` line, not just the first, is accepted; out-of-range sizes (not 1–20) → ignored.
- Defaults: 5×5 for scenarios, 10×8 in the UI.
- `PLACE` on an existing robot moves it, keeps its queue and resets the GOTO counter. Placing it on its own cell (to change facing) is allowed.
- A `QUEUE` line with any invalid token → the whole line is ignored.
- `TICK 0`, negative or non-numeric N → ignored.
- Whitespace is tolerant; facings must be full words.
- The scenario syntax for GOTO is `QUEUE R1 GOTO 3,4 [more cmds]`.
- `REPORT` with no robots → `EMPTY`.

**UI**
- The next free ID is max + 1 (R1, R3 exist → R4), so a new robot never outranks existing ones in contests.
- Edit-mode click on a robot cell → ignored, with a toast showing the reason.
- Extras beyond the spec, UI and API only (the scenario grammar is unchanged):
  - **Clear queue** (`ClearQueue`);
  - **Delete robot** (`RemoveRobot`); IDs are never reused because the next ID is max + 1;
  - **Reset / new floor W×H** (`CreateFloor`).
  All three go through the reducer, appear in the history log, and are documented as extras.
- History panel: everything is stored; the UI shows one collapsible group per tick and hides IDLE results by default, with a toggle to show them.

**Persistence**
- Play state is not floor state: after a restart, floors come back paused.

**Other**
- Module B's 97 vs 98 conflict is recorded even though B isn't built.

## API + persistence
- **better-sqlite3 directly** (no ORM). Synchronous transactions plus single-threaded Node make each command atomic, and that is what Module D's "exactly one succeeds" relies on.
- **Tables: normalized current state + JSON snapshot + event log** (the user's call):
  - **Normalized, authoritative:**
    - `floors(id, width, height, tick, version, next_robot_num, created_at)`;
    - `obstacles(floor_id, x, y)`;
    - `robots(floor_id, id, num, x, y, facing, goto_no_path_ticks)`;
    - `queue_items(floor_id, robot_id, position, kind, arg_x, arg_y)`.
  - **`floor_snapshots(floor_id, version, tick, state_json)`:** a serialized engine state, written in the same transaction. It's used for fast loading and for the replay check, and it would be the basis for a future Module C (timeline).
  - **`events(id, floor_id, version, tick, type, payload_json, created_at)`:** the history log.
  - Each command is written in one transaction: load → `apply` → rewrite the normalized rows + insert the snapshot + insert the events → `version++`.
  - **Consistency test:** the state rebuilt from the normalized rows, the snapshot JSON, and a replay of the events must all be deep-equal. The trade-off (two representations kept in sync, guarded by a test) goes in DECISIONS.md.
- **REST endpoints:**
  - `GET /floors/:id` → state + version.
  - `GET /floors/:id/events?after=` → history.
  - `POST /floors/:id/commands` with an Action body → 200 with the new state, or 409/422 with `{reason, state}`.
  - `POST /floors` → new floor.
  - `POST /floors/:id/play|pause|step`.
- **Module D:**
  - `FloorGateway` (socket.io) has one room per floor and broadcasts `{version, state, events}` after every committed command or tick.
  - `TickScheduler` holds a `Map<floorId, Timeout>`, so there is only ever one loop per floor; Play from N clients is idempotent; a change of interval restarts that one timer.
  - The client tracks `version` and on a gap reloads through `GET`.
  - Conflicts: the losing request gets the rejection reason plus the authoritative state, shown as a toast, and the UI catches up.

## Angular UI (clear, not fancy)
- **Components:**
  - `FloorGridComponent`: CSS grid with y flipped so (0,0) is bottom-left, robot arrows, obstacle cells, the last tick's result badges, and the GOTO target marker.
  - `ControlsComponent`: Step, Play/Pause, interval slider, edit-mode toggle, new floor.
  - `RobotListComponent`: ID, position, facing, pending queue chips; the selected robot is highlighted.
  - `HistoryLogComponent`: newest first, filter by type.
  - `ConnectionBadge` and a toasts area.
- **Input:** arrow keys and on-screen buttons queue commands; shift-click a cell to send GOTO.
- **State:** a signal-based `FloorStore` service, fed by REST and the socket.

## Going above and beyond (prioritized)
1. **Differential and property tests (fast-check):** a deliberately naive *reference resolver* (fixpoint iteration: start by assuming everyone succeeds, then repeatedly block violations) compared with the real resolver on thousands of random floors. Invariants:
   - no two robots share a cell;
   - no robot ends up off the floor or on an obstacle;
   - the order robots are listed in doesn't change the outcome;
   - running the same input twice gives the same result;
   - every non-GOTO queue shrinks by exactly 1.
2. **Golden scenario suite:** each `scenarios/*.txt` file is paired with `*.expected`. It covers the 5 brief examples plus about 25 edge cases (contest+swap, a cycle broken by a contest, long chains, R2 vs R10, invalid lines, FLOOR reset, GOTO tie-break order / UNREACHABLE / arrival). A Vitest test runs the CLI on each one as a subprocess, which also exercises the `npm run scenario` path.
3. **Replay check:** rebuilding a floor from its event log alone gives exactly the stored snapshot. Proves the history is complete (and is the basis for C, discussed in the README as future work).
4. **Two-client real-time integration test:** an in-process Nest app with 2 socket.io clients, testing a simultaneous same-cell placement, one tick loop with two clients pressing Play, and broadcast ordering. A written manual test plan goes in the README.
5. **CI:** typecheck, lint, engine/API tests, golden scenarios, Angular build, plus a README badge.
6. **Docs:** a diagram of the resolution steps in DECISIONS.md, the "what's missing / with another week" list in the README, and an honest, specific AI_USAGE.md (including review catches).
7. **Interview prep pack** (not committed): an engine walkthrough script, 6–8 likely live-change drills (new BACK/U-turn command, robot removal, diagonal moves, priority by placement order, speed per robot, battery-lite), and debugging drills where the user finds a planted bug in their own repo.

## Test strategy: deterministic and fully automated
**One command:** `npm run verify`. Exit code 0 means pass; anything else means fail. No step needs judgment, by AI or by a human. CI runs exactly the same command.

**How determinism is enforced**
- **Engine:** pure, with no clock, randomness or IO. Robot iteration order is defined (sorted by ID number), and a property test shows that order doesn't affect outcomes.
- **Property tests:** fast-check with a **fixed seed** (`seed: 424242`) and a fixed run count, so CI is reproducible. A failure prints the seed and the shrunk counterexample, which becomes a permanent regression test.
- **Time-based code:** TickScheduler takes an injected clock/timer; tests use Vitest fake timers, never real sleeps.
- **API tests:** run against a fresh in-memory SQLite database (`:memory:`) per test, plus one temp-file database test to check that data survives a restart.
- **Real-time tests:** await specific socket events (with timeouts) instead of sleeping.
- **E2E:** Playwright drives the UI with **Step** only, never Play timing, and checks against `data-testid` selectors. Headless Chromium, retries off, so a flaky test fails loudly instead of passing on retry.

**What `verify` runs, in order**
1. `tsc --noEmit` across the workspaces.
2. ESLint.
3. Engine unit tests (Vitest), organized by rule: walls, obstacles, contests (including R2 vs R10), head-on swaps, chains, a blocked chain head, rotations of 3/4/n, a contest that breaks a loop, a blocked MOVE still being consumed, every result recorded, GOTO tie-break order / UNREACHABLE after 3 ticks / arrival, reducer rejections with reason codes.
4. Differential and property tests: the real resolver vs the naive reference resolver, plus the invariants.
5. **Golden scenarios:** for each `scenarios/*.txt`, spawn `npm run scenario -- file` and require stdout to match `*.expected` byte for byte. Covers the brief's a–e plus 25+ edge files.
6. API integration (supertest): commands (including clear queue, delete robot, new floor), rejections with 409/422, history, state surviving a restart, and the normalized-rows / snapshot / event-replay consistency check.
7. Real-time integration: two socket.io clients against an in-process app. A simultaneous same-cell placement gives exactly one success and one rejection with the reason; Play from both clients leaves exactly one timer; broadcasts arrive in version order.
8. `ng build` + Playwright E2E smoke: place a robot, edit an obstacle, queue with arrow keys, Step, check the grid and history; a two-tab sync check; refresh to check persistence.

`npm run verify:fast` runs steps 1–5 only (engine plus scenarios, a few seconds) for quick checks between agent turns.

## Phases (user review at each gate)
**Phase 0, PM:** `git init`, workspace scaffold (TS strict, ESLint/Prettier, Vitest, Playwright, the `verify` scripts), contract files, a DECISIONS.md draft with all the edge-case rulings above, an AI_USAGE.md stub, and the context-map bootstrap (full scan once the contracts exist).
→ **Gate:** user reviews the contracts and decisions.

**Phase 1, in parallel (worktrees):**
- **Dev 1:** engine core + move resolution.
- **Tester:** engine unit tests, the reference resolver + property tests, and golden scenarios a–e plus edge cases, all written from the spec.
- **Designer:** UI spec.

PM merges, triages failures, iterates until `verify:fast` is green.
→ **Gate**

**Phase 2, in parallel:**
- **Dev 1:** GOTO (Module A).
- **Dev 2:** scenario parser/CLI, then the API + SQLite.
- **Tester:** GOTO tests/scenarios and API integration tests.

→ **Gate:** the scenario runner passes all golden files.

**Phase 3, in parallel:**
- **Dev 2:** TickScheduler + socket.io gateway (Module D).
- **Dev 3:** Angular UI against the designer's spec and the API contract.
- **Tester:** real-time integration tests + Playwright E2E.
- **Designer:** reviews the UI and files fixes.

→ **Gate:** full `verify` green.

**Phase 4, PM:**
- CI workflow (`npm ci && npx playwright install --with-deps chromium && npm run verify`).
- Finalize the README (setup, running, modules and why, test strategy, real-time manual test plan, what's missing), DECISIONS.md and AI_USAGE.md (with concrete agent mistakes caught in review).
- The interview prep pack.
- Push to a new public GitHub repo **only after the user confirms.**

## Verification
- `npm run verify` exits 0 locally and in GitHub Actions, and passes on 3 consecutive runs to confirm it isn't flaky.
- At each gate, a fresh `scan_project.py` shows no `~` (regex fallback) entries for `.ts` files, and the import graph shows no engine → api/web or web → api imports.
- `npm run scenario -- scenarios/brief_a_chain.txt` (and b–e) matches the brief's output exactly.
- Manual sanity check: `npm run dev`, two tabs, Play in both → one loop, live sync, the conflict toast. Restart the API → state and history are intact.

## Agent briefs (template used for every spawned agent)
Spawn with `Agent(subagent_type: "general-purpose", model: "sonnet", isolation: "worktree", run_in_background: true)`. Every brief starts with this shared preamble, then the role-specific task:

```
You are the <ROLE> on the Fleet Floor Simulator team. The PM (orchestrator) reviews and merges your work.
Repo: /Users/zachwelch/Desktop/rohirrim (you are in a git worktree of it).
Read first: CLAUDE.md, docs/PLAN.md (sections relevant to your role), DECISIONS.md, and the contracts
packages/engine/src/types.ts and packages/protocol/src/index.ts.

Rules:
- You own ONLY: <PATHS>. Do not edit anything else. If a contract or another area must change, stop and
  say so in your final report rather than editing it.
- Before writing any call, import or extension of code you didn't write in this task, look the symbol up in
  .claude/context-map.md (grep .claude/context-map.json for exact params). If it's missing, run
  `python3 ~/.claude/skills/code-context-map/scripts/scan_project.py --file <path>` or read the source.
  Never guess a name or signature.
- Follow DECISIONS.md exactly. If you find a case it doesn't cover, pick the most literal reading of the
  brief, implement it, and list it under "New gaps" in your report. Do not silently invent behaviour.
- Match the surrounding code style. No new dependencies without listing them in your report.
- Before finishing, run <CHECK COMMAND> and make it pass. Commit your work in your worktree as small,
  scoped commits ("engine: ...", "test: ...") ending with the Co-Authored-By line from CLAUDE.md conventions.

Final report (your last message), concise:
1. What you built (files), 2. check command output summary, 3. New gaps / deviations,
4. Anything you were unsure about or could not finish.
```

Deviations and progress are tracked in `docs/STATUS.md`.
