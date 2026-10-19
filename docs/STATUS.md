# Status tracker

The single source of truth for **where the work is**. Plan: [PLAN.md](PLAN.md).
Any session resuming this project: read this file first, then PLAN.md, then DECISIONS.md.

**Update protocol:** update this file at the end of every task, every agent hand-off, and every
phase gate. Commit it along with the work it describes.

---

## Current position (2026-10-18)

- **State:** **Phase 4 done except the push.** Phase 3 gate approved. CI workflow, README, DECISIONS
  and AI_USAGE passes committed; prep pack written (not committed).
- **Blocked on the user:** (1) git identity / author email before the public push; (2) reword the
  AI_USAGE entries marked "drafted by Claude"; (3) confirm the push (new public GitHub repo).
  After the push: watch the first CI run and add the badge to the README.
- **Upload scenarios (2026-10-19, branch `worktree-agent-a2962cd797ec8624b`, not merged):** engine
  `traceScenario`; web scenario model on the trace (any file builds); `UploadsStore` (localStorage);
  client-driven script player in `ScenarioStore` (Play/Pause/Step walk the script, interference stops
  the run as "modified"); upload controls, runner output and ignored lines in the UI. DECISIONS 5.8.
  Pending: PM merge with the Tester's `e2e/tests/upload.spec.ts` and engine trace tests, then verify.
  Two existing e2e files were touched: `scenarios.spec.ts` (a Step in another tab now flags the run
  instead of passing it) and `layout.spec.ts` (the spill check ignores zero-size, non-rendered boxes).
- **Grid key (2026-10-19, branch `worktree-agent-a4be14829dce07542`, not merged):** the text legend is
  now `ui/grid-legend.ts`, a collapsible grouped key under the status line that highlights the badges
  on the floor (`LEGEND_BADGES` in `core/copy.ts` is the single source; `.pill` is shared with the grid
  badges). `--grid-chrome-y` and the status-line min-heights recomputed. `e2e/tests/legend.spec.ts`.
  DECISIONS 5.9. Pending: PM review of screenshots and merge.
- **Key column (2026-10-19, branch `worktree-agent-adabd0bff8dd17eac`, not merged):** the key moved
  from under the grid to its own left column from 1200px (key | grid + checkpoints | sidebar);
  under the checkpoints at 900-1199px and on a phone. One legend instance (`.main-col` wrapper,
  `display: contents` from 1200px), `activeBadges` is now a `FloorStore` computed, collapsed key is a
  4.5rem rail with stacked pills (container query), key shown on an empty floor. `--grid-chrome-x`
  reserves the key column. No existing test changed; new specs in `layout.spec.ts` and
  `legend.spec.ts` (verify green: web 167, e2e 119 + 1 skipped). DECISIONS 5.9 addendum. Pending: PM review of screenshots and merge.
- **Shared checkpoints (2026-10-19, on `main`, committed, verify green, not pushed):** the scenario run shows on every
  screen. **Protocol contract change (PM):** `SocketEvents.ScenarioPublish` / `SocketEvents.Scenario`,
  `SharedScenarioRun`, `ScenarioRunPayload`, `MAX_SHARED_SCENARIO_CHARS`. Gateway relays and caches
  the run per floor (cleared when the publisher disconnects); `FloorStore.remoteScenario` /
  `publishScenario`; `ScenarioStore.run` falls back to the shared run (`RunView.remote`). New
  `apps/api/test/api-scenario-relay.test.ts`, store specs, two e2e cases in `scenarios.spec.ts` (the
  multi-tab case now expects the panel in both tabs). DECISIONS 5.10.
- **Test-infra note:** supertest opens one socket per request. Thousands of requests in quick
  succession can exhaust ephemeral ports (EADDRNOTAVAIL). Bulk setup should use
  `stepManyPooled` (keep-alive fetch) in `apps/api/test/support.ts`.

## Resume checklist

```bash
cd /Users/zachwelch/Desktop/rohirrim
git status && git log --oneline | head -5        # expect a clean tree on main
npm install --loglevel=error                      # .npmrc silences npm; pass a loglevel to see errors
npm run verify:fast                               # expect 677 engine tests green
npm test -w @fleet/api                            # expect 31 passed, 1 skipped
python3 ~/.claude/skills/code-context-map/scripts/scan_project.py   # rebuild the (gitignored) context map
git worktree list                                 # expect only the main checkout
```

**Git identity (machine issue, not a repo issue):** `user.email` isn't configured globally.
Git used to auto-detect `zachwelch@MacBook-Air.local` from the hostname, but the hostname
changed mid-session to `Mac.(none)` and commits started failing. The last commits were made with
`GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars set to `Zach <zachwelch@MacBook-Air.local>` to match
the rest of the history. **Ask the user** to set an identity (and decide whether to rewrite the
author email before the public push). Don't set it on their behalf.

## Phase 2 Tester brief (done; kept for reference)

The Tester was briefed with this list. Shared helpers already exist in
`apps/api/test/support.ts` (fixed clock `FIXED_ISO`, `tempDbPath()`/`removeDb()`,
`listenOnLoopback(app)`, request helpers). Write tests **black-box** against
`packages/protocol/src/index.ts`, `apps/api/src/app.factory.ts` and `apps/api/src/testing.ts`.

1. **`apps/api/test/api-commands.test.ts`**:
   - auto-ID PLACE (R1, R2…), QUEUE then step → positions;
   - version +1 per accepted action, including step;
   - a 409 for every reachable `RejectionReason` (a `Record<RejectionReason, Case[]>` so it is
     exhaustive), with body `{ok:false, reason, message, floor}` equal to a prior GET and version
     and history unchanged;
   - 400 for malformed bodies (missing or null action, unknown type, wrong field types, non-JSON,
     text/plain, empty body). An unknown command `kind` is **409 INVALID_COMMAND** (DECISIONS 6.1b);
   - concurrency via `listenOnLoopback(app)`: two simultaneous PLACEs on one cell give one 200 and
     one 409 CELL_OCCUPIED; 10 simultaneous PLACEs on distinct cells give versions 2..11 and R1..R10.
2. **`api-history.test.ts`**:
   - entries ascending by seq, with correct version, tick, payload and `at === FIXED_ISO`;
   - `CommandSuccess.history` equals the GET entries;
   - `after` filtering;
   - `limit` without `after` returns the newest N (ascending); with `after` it returns the oldest N;
   - clamping: default 500, max 2000 (build about 2100 entries in `beforeAll` with a long timeout);
     `limit=0` clamps to 1;
   - non-numeric `after`/`limit` → 400;
   - rejected and malformed commands add no history.
3. **`api-persistence.test.ts`**:
   - temp-file DB, mixed sequence, close, reopen → identical FloorDto and history;
   - seq and version continue after the restart;
   - the auto-ID high-water mark survives (remove R3, then the next auto-placed robot is R4);
   - a split run (restart mid-way) equals an uninterrupted `:memory:` run.
4. **`api-consistency.test.ts`**:
   - a long deterministic mixed sequence (CREATE_FLOOR mid-way, gappy IDs R2/R10, toggles, GOTO
     queues, CLEAR, REMOVE, many steps);
   - at checkpoints, `inspectFloor(app,'main')` gives `fromTables`, `fromSnapshot` and
     `fromReplay` all deep-equal to each other and to the GET state, with the version matching;
   - repeat the check after a restart on a temp file.
5. Don't assert things DECISIONS leaves open. DECISIONS 6.1c now *does* say a no-op `SET_OBSTACLE`
   bumps the version, so it is assertable.
6. **Skipped on purpose:** in `apps/api/test/api-boot.test.ts`, "pause is idempotent…" is
   `it.skip` because play/pause endpoints are Phase 3. **Un-skip it in Phase 3.**

## Phase checklist

### Phase 0: PM scaffold ✅
- [x] Workspaces, TS 6.0 strict, ESLint (engine-purity rules), Prettier, Vitest; contracts; docs; context map
- [x] **Gate** approved 2026-10-18

### Phase 1: engine core ✅
- [x] Dev 1: geometry, reducer, `resolve-moves.ts`, tick
- [x] Dev 2: scenario parser, runner and CLI (pulled forward from Phase 2)
- [x] Tester: 576 tests (unit per rule, reference resolver + 11 properties, 51 golden scenarios via the real CLI). Mutation check: 6/6 injected bugs caught
- [x] Designer: `docs/design/UI_SPEC.md` + `tokens.css` (PM answers in spec §12)
- [x] **Gate** approved 2026-10-18

### Phase 2: GOTO + API ✅
- [x] Dev 1: GOTO (`pathfinding.ts`, `planGotoStep`), CLEAR_QUEUE resets the counter
- [x] Dev 2: NestJS API + SQLite (normalized tables + latest snapshot + actions + events), REST per protocol, `createApp`, `inspectFloor`
- [x] Tester (part 1): 61 GOTO tests + 21 GOTO golden scenarios, all green against the real engine on first run (written black-box); `api-boot.test.ts`
- [x] PM end-to-end smoke on the built server: GOTO detour, 409 rejection, restart persistence
- [x] Tester (part 2): 158 API integration tests (commands incl. exhaustive 409 reasons + concurrency, history, persistence, three-way consistency incl. after restart). No API bugs found
- [x] PM: API mutation spot-check: 10/10 caught (skip version check, skip snapshot upsert, 409→200, history order, `after` off-by-one, limit clamp 0, high-water mark, GOTO counter, version +2 on TICK, skip action log)
- [x] **Gate** approved 2026-10-18

### Phase 3: real-time + UI ✅
- [x] PM: scaffold `apps/web` (deps incl. socket.io-client), `e2e/` workspace (Playwright + Chromium, harness on :3100/:4300, smoke test), `scripts/dev.mjs`, `TickTimer`/`ManualTickTimer` contract + `AppOptions.timer`, DECISIONS 7.5–7.7, protocol: join acks `null` for unknown floor
- [x] Dev 2: `TickScheduler` (one timer per floor via injected `TickTimer`), `PlaybackState` provider (breaks the DI cycle), `POST play|pause`, socket.io `FloorGateway` (raw `client.on` handlers so an unknown-floor join can ack `null`). 27 dev tests. PM smoke with the real timer on the built server: 10 ticks/s at 100 ms, versions contiguous, repeated Play silent, Pause stops.
- [x] Dev 3: Angular UI per UI_SPEC (signal `FloorStore`, transport seam, all §10 test ids, 66 unit tests). First blind E2E run: 41/44; the 3 failures were test-side (2 key-before-selection races, 1 ambiguous locator), fixed by PM → 44/44
- [x] Tester: `api-realtime.test.ts` (46 tests + 1 todo: two floors not creatable via protocol), pause test un-skipped; **all green against Dev 2's gateway on first merge**. 43 Playwright specs in 4 files written blind to the UI (run after Dev 3 merges)
- [x] Designer: `docs/design/UI_REVIEW.md` (0 blocker, 3 major, 7 minor, 5 polish; 8 screenshots), UI_SPEC updated with rulings on Dev 3's deviations
- [x] Dev 3 (fresh agent): all 15 review findings fixed (desktop scrollHeight 3332→768; 320px scrollWidth 323→320; toolbar shift on Play 182px→0), 73 web tests. PM reverted the dot-only phone connection badge (never color alone) and recorded rulings in UI_SPEC §12
- [x] Root `npm run dev` (API + web together)
- [x] Full `npm run verify` green 3 runs in a row (677 engine, 263 API + 1 todo, 73 web, 44 E2E); import boundaries checked
- [x] **Gate** approved 2026-10-18

### Phase 4: finish
- [x] CI workflow `.github/workflows/ci.yml` (Node 22, `npm ci`, Chromium, `npm run verify`, report artifact on failure). Not yet run on GitHub: the local Docker dry-run failed to start (daemon off); lockfile checked for Linux native packages + `npm ci --dry-run` OK
- [x] README rewritten; DECISIONS final pass (6.1d single floor + kept history, §8 timer/socket notes); AI_USAGE Phase 2–3 entries **drafted by Claude, marked for the user to review/reword**
- [x] Interview prep pack in `interview-prep/` (excluded via `.git/info/exclude`): PREP.md (walkthrough, Q&A, 8 live-change drills, debugging method, trade-offs) + `plant-bug.sh` (random planted bug in /tmp/fleet-drill, `--reveal`)
- [ ] Push to a new public GitHub repo (**only after the user confirms**, and after the git identity question above)

## Agents

None running. All Phase 3 branches merged; worktrees removed.
Commits use the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env-var workaround (identity still unresolved).

| Role | Last work | Notes for the next brief |
|---|---|---|
| Designer | P3 done: UI review (merged) | Could re-check the fixes at the gate if wanted |
| Dev 1 Engine | GOTO (P2) | Engine is complete for Modules core + A |
| Dev 2 Runner+API | P3 done: scheduler + gateway (merged) | Gaps it chose: fractional intervalMs rounded; tick error auto-pauses; text/plain body = {} |
| Dev 3 Frontend | P3 done: Angular UI (merged) | 12 spec gaps listed in its report; see DECISIONS at gate |
| Tester | P3 done: real-time (merged, green) + E2E specs (merged, awaiting UI) | E2E assumes tick-group `data-seq` = TICK_RESOLVED seq; stale version recorded at send time |

**Lessons from running agents (apply to future briefs):**
- `npm install` in a worktree touches `package-lock.json` by one line. Tell agents to revert it and never commit it.
- Pre-install every dependency on `main` before spawning parallel agents.
- Have the Tester code against stub contracts; expected failures should be "not implemented" only.
- Use `${B}:path` (with braces) in zsh `git show`, because `$B:a…` is a zsh path modifier.

### Extra: scenario picker (2026-10-19)
- [x] Sidebar picker for the 5 brief examples + 5 curated scenarios: Load replays the setup through the normal command queue (`FloorStore.loadScenario`), checkpoints are read from `TICK_RESOLVED` history (`ScenarioStore`), auto-pause after the last. DECISIONS 5.7. Engine now exports `formatReport`; scenario files are bundled as text via the `loader` option in `apps/web/angular.json` (works for build, typecheck and `ng test`). Tests: 2 engine, 46 web unit, 4 E2E. No contract files changed.

## Deviations from PLAN.md

- State uses plain sorted arrays (not Map/Set), so it is JSON-serializable and deep-comparable.
- The API/socket contract is in `packages/protocol`, so the UI never imports from the API.
- TypeScript is pinned to `~6.0.3`: Angular 22 needs `>=6.0 <6.1`, and TS 7 has no JS compiler API (the context map needs one).
- The engine and protocol are consumed as built `dist/`; root `typecheck` builds both first. API tests alias them to source instead.
- No `POST /floors`: "new floor W×H" is a `CREATE_FLOOR` action on the existing floor id. Engine rejection → 409, malformed body → 400, unknown floor → 404.
- The scenario runner was pulled from Phase 2 into Phase 1.
- Storage keeps only the latest snapshot per floor and adds an `actions` table for exact replay (DECISIONS 6.1).
- The history query gained `limit` (newest-N without `after`).
- Prettier is enforced in `verify` (`format:check`); `*.md` and `scenarios/` are prettier-ignored.

## Open issues / blockers

- **Git identity** isn't configured (see the Resume checklist). The user needs to decide.
- **AI_USAGE.md** is written in the user's voice, but the Phase 0–1 entries describe catches the
  PM (Claude) made. The user was asked to reword them; still pending.

## Log

- 2026-10-18: plan approved; Phase 0 scaffold built.
- 2026-10-18: Phase 0 gate approved; Phase 1 agents spawned (Dev 1, Dev 2, Tester, Designer).
- 2026-10-18: Phase 1 merged: engine, runner, 576 tests, UI spec. Fixes found while merging: npm banner on stdout (`.npmrc`), ESLint walking agent worktrees, Prettier not enforced. DECISIONS 2.7/2.8/4.11.
- 2026-10-18: Phase 1 gate approved. PM scaffolded `apps/api` (deps pre-installed; `createApp`/`inspectFloor` contracts). Phase 2 agents spawned.
- 2026-10-18: Dev 1 GOTO merged (DECISIONS 3.9). Dev 2 API merged (DECISIONS 6.1b/6.1c). PM end-to-end smoke OK.
- 2026-10-18: **Paused by the user.** Tester wrapped up gracefully: GOTO tests + scenarios + api-boot merged; 677 engine tests green; pause test skipped (Phase 3). DECISIONS 3.10. All worktrees/branches removed. Git identity issue noted.
- 2026-10-18: **Phase 2 gate approved.** PM Phase 3 scaffold (web, e2e, dev script, TickTimer contract, DECISIONS 7.5–7.7); verify green. Dev 2, Dev 3, Tester spawned.
- 2026-10-18: Dev 2 merged (scheduler, play/pause, gateway); 216 API tests green; real-timer smoke OK. Worktree dirs can survive `git worktree remove` (ignored node_modules/.DS_Store): `rm -rf` then `git worktree prune`.
- 2026-10-18: Tester merged: 46 real-time tests green vs the real gateway first time; 43 E2E specs pending Dev 3.
- 2026-10-18: Dev 3 merged. E2E 41/44 blind → 44/44 after 3 test fixes. Full verify green 3 runs in a row (flakiness check done; rerun after the Designer fixes).
- 2026-10-18: Designer review merged (3 major: page scroll overflow from visually-hidden spans, slider keeps focus after grid click, cramped Robots panel). Dev 3 spawned for fixes. DECISIONS 7.8.
- 2026-10-18: Dev 3 review fixes merged; PM kept the connection word on phones. Verify green 3×. Awaiting Phase 3 gate.
- 2026-10-18: Phase 3 gate approved. Phase 4: CI, README, DECISIONS/AI_USAGE passes, prep pack. Awaiting the user for identity + push.
- 2026-10-19: Requirements audit. Fixed: `npm run scenario` failed on a relative path when run from any directory but the root (now resolves against INIT_CWD; 2 regression tests). Runner checked on Node 22/24/25, CRLF, no trailing newline, tabs, lowercase. Repo lives in an iCloud-synced Desktop: iCloud recreated deleted files as `name 2.ext` copies and broke `format:check`; deleted. Consider moving the repo off the Desktop.
- 2026-10-19: Scenario picker added (engine `formatReport` export, `core/scenarios.ts`, `FloorStore.loadScenario`, `ScenarioStore`, `ui/scenario-panel.ts`, `e2e/tests/scenarios.spec.ts`, DECISIONS 5.7).
- 2026-10-19: Layout fix (Dev 3): scenario title and checkpoints moved from the sidebar to a `ui/scenario-results.ts` section under the floor; sidebar is `overflow-y:auto` at >= 900px. `e2e/tests/layout.spec.ts` (27 tests) green. DECISIONS 5.7 addendum.
