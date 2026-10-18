# Status tracker

The single source of truth for **where the work is**. Plan: [PLAN.md](PLAN.md).
Any session resuming this project: read this file first, then PLAN.md, then DECISIONS.md.

**Update protocol:** update this file at the end of every task, every agent hand-off, and every
phase gate. Commit it along with the work it describes.

---

## Current position (paused 2026-10-18)

- **State:** **paused by the user mid-Phase 2.** All agents were shut down gracefully: each one
  committed its work, every branch is merged into `main`, and all agent worktrees and branches are
  removed. No agents are running, and there is nothing to recover from worktrees.
- **Working tree:** clean on `main`. `npm run verify:fast` is green (677 engine tests, typecheck,
  lint, format). `npm test -w @fleet/api` is green (31 passed, 1 skipped on purpose; see below).
- **Phase 2 is done except one item:** the Tester's API integration tests (only `api-boot` exists).
- **Next action when resuming:**
  1. Run the [Resume checklist](#resume-checklist) below.
  2. Spawn a **Tester** (Sonnet, worktree) to finish the Phase 2 API tests, using the
     [remaining-work list](#remaining-phase-2-work-tester) as its brief, then merge and triage.
  3. PM mutation spot-check on the API (as was done for the engine in Phase 1): e.g. drop the
     version check, skip the snapshot upsert, return 200 on rejection, mis-order history. Then
     **Phase 2 gate** with the user.
  4. Phase 3 (see the checklist below and PLAN.md).

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

## Remaining Phase 2 work (Tester)

The Tester was paused with these unwritten. Shared helpers already exist in
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

### Phase 2: GOTO + API (mostly done)
- [x] Dev 1: GOTO (`pathfinding.ts`, `planGotoStep`), CLEAR_QUEUE resets the counter
- [x] Dev 2: NestJS API + SQLite (normalized tables + latest snapshot + actions + events), REST per protocol, `createApp`, `inspectFloor`
- [x] Tester (part 1): 61 GOTO tests + 21 GOTO golden scenarios, all green against the real engine on first run (written black-box); `api-boot.test.ts`
- [x] PM end-to-end smoke on the built server: GOTO detour, 409 rejection, restart persistence
- [ ] **Tester (part 2): API integration tests.** See "Remaining Phase 2 work" above
- [ ] PM: API mutation spot-check
- [ ] **Gate**

### Phase 3: real-time + UI
- [ ] Dev 2: `TickScheduler` (one timer per floor, injected timer for tests) + socket.io `FloorGateway` + `POST play|pause`. Hooks are ready: subscribe the gateway to `FloorsService.committed` (emits `{floor, history}` = `FloorUpdatedPayload`); the scheduler calls `FloorsService.step()`; fill `playing`/`intervalMs` in `FloorsService.toDto` (the only place a FloorDto is built). Register providers in `AppModule.register`.
- [ ] Dev 3: Angular 22 app in `apps/web` per `docs/design/UI_SPEC.md` (test-id catalog in §10). The PM should scaffold `apps/web` and install all deps first (same reason as `apps/api`: no lockfile conflicts between parallel agents).
- [ ] Tester: real-time integration tests (two socket.io clients; `socket.io-client` already installed) + Playwright E2E (Step only, no Play timing; Playwright **not yet installed**). Un-skip the pause test.
- [ ] Designer: review the UI against the spec
- [ ] Root `npm run dev` (API + web together)
- [ ] **Gate:** full `npm run verify` green

### Phase 4: finish
- [ ] CI workflow (`npm ci && npx playwright install --with-deps chromium && npm run verify`); CI runs on Node 22
- [ ] README (setup, run, scenario runner, modules + why, test strategy, real-time manual test plan, what's missing/cut), DECISIONS final pass, AI_USAGE final
- [ ] Interview prep pack (not committed)
- [ ] Push to a new public GitHub repo (**only after the user confirms**, and after the git identity question above)

## Agents

None running. All were shut down gracefully on 2026-10-18 after committing; branches merged and
worktrees removed. Agent IDs can't be resumed from a new session; re-spawn roles with the
template in PLAN.md "Agent briefs" and the role details in PLAN.md "Team and orchestration".

| Role | Last work | Notes for the next brief |
|---|---|---|
| Designer | UI spec + tokens (P1) | Phase 3: review Dev 3's UI against the spec |
| Dev 1 Engine | GOTO (P2) | Engine is complete for Modules core + A |
| Dev 2 Runner+API | API + SQLite (P2) | Phase 3: TickScheduler + gateway; hooks listed above |
| Dev 3 Frontend | not started | Phase 3 |
| Tester | GOTO tests + api-boot (P2, paused) | Finish the "Remaining Phase 2 work" list first |

**Lessons from running agents (apply to future briefs):**
- `npm install` in a worktree touches `package-lock.json` by one line. Tell agents to revert it and never commit it.
- Pre-install every dependency on `main` before spawning parallel agents.
- Have the Tester code against stub contracts; expected failures should be "not implemented" only.
- Use `${B}:path` (with braces) in zsh `git show`, because `$B:a…` is a zsh path modifier.

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
