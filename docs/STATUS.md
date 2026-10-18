# Status tracker

The single source of truth for **where the work is**. Plan: [PLAN.md](PLAN.md).
Any session resuming this project: read this file first, then PLAN.md, then DECISIONS.md.

**Update protocol:** update this file at the end of every task, every agent hand-off, and every
phase gate. Commit it along with the work it describes.

---

## Current position

- **Phase:** 1 (engine core), agents running
- **Waiting on:** 4 background agents (Dev 1, Dev 2, Tester, Designer) to report
- **Next action:** as each reports: review the diff in its worktree, merge its branch into main in the order
  Dev 1 → Dev 2 → Tester → Designer, rescan the context map, run `npm run verify:fast`, triage
  failures (code or test wrong? decide from the spec and DECISIONS) and route fixes back to the same agent.
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
- [ ] Dev 1: geometry, reducer (all non-TICK actions), move resolution, TICK (GOTO execution deferred to Phase 2)
- [x] Dev 2: scenario parser/runner/CLI, merged 3d50466 (**pulled forward from Phase 2** so golden tests can pass at this gate)
- [ ] Tester: engine unit tests, reference resolver + property tests, golden scenarios brief a–e + edge cases
- [ ] Designer: UI spec in `docs/design/`
- [ ] PM: merge, triage, `verify:fast` green
- [ ] **Gate**

### Phase 2: GOTO + runner + API (parallel)
- [ ] Dev 1: GOTO pathfinding (Module A)
- [ ] Dev 2: API + SQLite (normalized + snapshot + events)
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
| Designer | a35ce8417110865b7 | auto worktree | P1 running: UI_SPEC.md + tokens.css |
| Dev 1 Engine | a434bd38ee907bcef | auto worktree | P1 running: geometry, reducer, resolve-moves, tick |
| Dev 2 Runner+API | a5454986fc9265830 | worktree-agent-a5454986fc9265830 | P1 done, merged. TODO after Dev 1 merge: drop parseRobotNum vi.mock in test/scenario-dev/parse.test.ts |
| Dev 3 Frontend | n/a | n/a | not started (Phase 3) |
| Tester | a05a5fb07ec04efec | auto worktree | P1 running: unit, property, golden suite |

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
