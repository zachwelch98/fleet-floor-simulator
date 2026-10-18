# Status tracker

The single source of truth for **where the work is**. Plan: [PLAN.md](PLAN.md).
Any session resuming this project: read this file first, then PLAN.md, then DECISIONS.md.

**Update protocol:** update this file at the end of every task, every agent hand-off, and every
phase gate. Commit it along with the work it describes.

---

## Current position

- **Phase:** 2 (GOTO + API), agents running
- **Waiting on:** Tester (GOTO + API integration tests); Dev 1 and Dev 2 merged
- **Next action:** as each reports, review → merge (Dev 1, Dev 2, then Tester) → rescan map → `npm run verify:fast`
  plus `npm test -w @fleet/api` → triage failures → mutation spot-check (as in Phase 1) → Phase 2 gate.
- **If this session died mid-phase:** the agents' work lives in their worktree branches (`git worktree list`,
  `git branch`). Inspect each branch's commits and either merge them or re-spawn the role with the same brief.

## Phase checklist

### Phase 0: PM scaffold
- [x] git init, npm workspaces, TS 6.0 strict, ESLint (with engine-purity rules), Prettier, Vitest
- [x] Engine contract `packages/engine/src/types.ts` + stubs (`engine.ts`, `geometry.ts`, `scenario/*`, `cli/scenario.ts`)
- [x] Protocol contract `packages/protocol/src/index.ts`
- [x] DECISIONS.md draft, AI_USAGE.md stub, README stub, PLAN.md + STATUS.md in repo, CLAUDE.md
- [x] `npm run typecheck` and `npm run lint` green
- [x] Context map bootstrap (`scan_project.py`): 11 files, all TS entries exact
- [x] Initial commits (718adc2 scaffold, 45f2a97 docs)
- [x] **Gate:** user approved contracts + decisions (2026-10-18)

### Phase 1: engine core (parallel)
- [x] Dev 1: geometry, reducer, move resolution, TICK, merged (GOTO hook `planGotoStep` in engine.ts throws until Phase 2)
- [x] Dev 2: scenario parser/runner/CLI, merged 3d50466 (**pulled forward from Phase 2** so golden tests can pass at this gate)
- [x] Tester: 576 tests (unit per rule, reference resolver + 11 properties, 51 golden scenarios via real CLI), merged; all green on first run; mutation check: 6/6 injected bugs caught
- [x] Designer: UI spec + tokens merged (`docs/design/UI_SPEC.md`, `tokens.css`); PM answers appended to spec §12
- [x] PM: merge, triage, `verify:fast` green
- [x] **Gate** (user approved 2026-10-18)

### Phase 2: GOTO + runner + API (parallel)
- [x] Dev 1: GOTO pathfinding (Module A), merged; 595 engine tests green
- [x] Dev 2: API + SQLite, merged; 18 API tests; PM smoke on built server: GOTO detour, rejection, restart persistence OK
- [ ] Tester: GOTO tests/scenarios, API integration tests (incl. consistency check)
- [ ] **Gate:** all golden scenarios pass via `npm run scenario`

### Phase 3: real-time + UI (parallel)
- [ ] Dev 2: TickScheduler + socket.io gateway (Module D)
- [ ] Dev 3: Angular UI per design spec
- [ ] Tester: real-time integration tests + Playwright E2E
- [ ] Designer: UI review
- [ ] **Gate:** full `npm run verify` green

### Phase 4: finish
- [ ] CI workflow
- [ ] README / DECISIONS / AI_USAGE final
- [ ] Interview prep pack (not committed)
- [ ] Push to GitHub (**only after the user confirms**)

## Agents

| Role | Agent name/id | Worktree/branch | Status |
|---|---|---|---|
| Designer | a35ce8417110865b7 | worktree-agent-a35ce8417110865b7 | P1 done, merged. Phase 3: reviews Dev 3's UI |
| Dev 1 Engine | aaf3ab90be8c8d6ca | worktree-agent-aaf3ab90be8c8d6ca | P2 done, merged |
| Dev 2 Runner+API | a3ff83292a4b28fa1 | worktree-agent-a3ff83292a4b28fa1 | P2 done, merged. Phase 3 hooks: FloorsService.committed Observable, step(), toDto playback fields |
| Dev 3 Frontend | n/a | n/a | not started (Phase 3) |
| Tester | aad7c6b78ad97bce8 | auto worktree | P2 running: GOTO + API tests (P1 agent a05a5fb07ec04efec done) |

Agent ids can be resumed with SendMessage only from the session that spawned them. A new session should re-spawn.
Owned paths per role are listed in each brief (summarized in PLAN.md "Team and orchestration").

## Deviations from PLAN.md

- State uses plain sorted arrays (not Map/Set) so it is JSON-serializable and deep-comparable.
- The API/socket contract lives in `packages/protocol`, not `apps/api/src/contract.ts`, so the UI never imports from the API.
- TypeScript pinned to `~6.0.3`: Angular 22 requires `>=6.0 <6.1`, and TS 7 has no JS compiler API (the context map needs one).
- Engine is consumed as built `dist/`; root `typecheck` builds the engine first.
- No `POST /floors`: "new floor W×H" is a `CREATE_FLOOR` action on the existing floor id. Engine rejections return HTTP 409; malformed bodies 400.

## Open issues / blockers

- None.
- `npm run scenario` printed npm's banner to stdout; fixed with `.npmrc` `loglevel=silent` (commit 2208097).

## Log

- 2026-10-18: plan approved; Phase 0 scaffold built; typecheck and lint green.
- 2026-10-18: context map bootstrapped; Phase 0 committed. Brief PDF is gitignored (employer document, repo will be public).
- 2026-10-18: Phase 0 gate approved. Phase 1 started: Dev 1, Dev 2 (runner pulled forward), Tester, Designer spawned in parallel worktrees (Sonnet).
- 2026-10-18: Dev 2 runner merged (3d50466). ESLint now ignores .claude/** (it was linting agent worktrees).
- 2026-10-18: Dev 1 engine merged; 164 dev tests green; CLI reproduces brief examples d and e. Prettier now enforced in verify (`format:check`). DECISIONS 2.7 added (grid geometry: min rotation 4, head-on follower is CONTESTED).
- 2026-10-18: Designer spec merged. Protocol change: history query gains `limit` (newest-N when no `after`), HISTORY_DEFAULT_LIMIT 500 / MAX 2000.
- 2026-10-18: Tester suite merged: 576/576 green, 51 golden scenarios through the real CLI. Mutation check 6/6 caught. DECISIONS 2.8 (pinned small rulings). Phase 1 complete.
- 2026-10-18: Phase 1 gate approved. PM scaffolded apps/api (all deps pre-installed; contracts app.factory.ts createApp + testing.ts inspectFloor). DECISIONS 6.1 revised (actions table for replay; latest-only snapshot), 3.5b added. Phase 2 agents spawned.
- 2026-10-18: Dev 1 GOTO merged (DECISIONS 3.9 corridor consequence). Dev 2 API merged (DECISIONS 6.1b validation split, 6.1c no-op commits). PM end-to-end smoke on built server OK.
