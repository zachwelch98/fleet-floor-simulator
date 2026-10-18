# Status tracker

The single source of truth for **where the work is**. Plan: [PLAN.md](PLAN.md).
Any session resuming this project: read this file first, then PLAN.md, then DECISIONS.md.

**Update protocol:** update this file at the end of every task, every agent hand-off, and every
phase gate. Commit it along with the work it describes.

---

## Current position

- **Phase:** 0 (PM scaffold), complete, awaiting gate
- **Waiting on:** user review of the contracts and DECISIONS.md (Phase 0 gate)
- **Next action:** after the user approves, start Phase 1. Spawn Dev 1 (engine), Tester, and
  Designer in parallel worktrees, using the brief templates under "Agent briefs" in PLAN.md.

## Phase checklist

### Phase 0: PM scaffold
- [x] git init, npm workspaces, TS 6.0 strict, ESLint (with engine-purity rules), Prettier, Vitest
- [x] Engine contract `packages/engine/src/types.ts` + stubs (`engine.ts`, `geometry.ts`, `scenario/*`, `cli/scenario.ts`)
- [x] Protocol contract `packages/protocol/src/index.ts`
- [x] DECISIONS.md draft, AI_USAGE.md stub, README stub, PLAN.md + STATUS.md in repo, CLAUDE.md
- [x] `npm run typecheck` and `npm run lint` green
- [x] Context map bootstrap (`scan_project.py`): 11 files, all TS entries exact
- [x] Initial commits (718adc2 scaffold, 45f2a97 docs)
- [ ] **Gate:** user approves contracts + decisions

### Phase 1: engine core (parallel)
- [ ] Dev 1: geometry, reducer (all non-TICK actions), move resolution, TICK
- [ ] Tester: engine unit tests, reference resolver + property tests, golden scenarios brief a–e + edge cases
- [ ] Designer: UI spec in `docs/design/`
- [ ] PM: merge, triage, `verify:fast` green
- [ ] **Gate**

### Phase 2: GOTO + runner + API (parallel)
- [ ] Dev 1: GOTO pathfinding (Module A)
- [ ] Dev 2: scenario parser/runner/CLI, then API + SQLite (normalized + snapshot + events)
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
| Designer | n/a | n/a | not started |
| Dev 1 Engine | n/a | n/a | not started |
| Dev 2 Runner+API | n/a | n/a | not started |
| Dev 3 Frontend | n/a | n/a | not started |
| Tester | n/a | n/a | not started |

## Deviations from PLAN.md

- State uses plain sorted arrays (not Map/Set) so it is JSON-serializable and deep-comparable.
- The API/socket contract lives in `packages/protocol`, not `apps/api/src/contract.ts`, so the UI never imports from the API.
- TypeScript pinned to `~6.0.3`: Angular 22 requires `>=6.0 <6.1`, and TS 7 has no JS compiler API (the context map needs one).
- Engine is consumed as built `dist/`; root `typecheck` builds the engine first.
- No `POST /floors`: "new floor W×H" is a `CREATE_FLOOR` action on the existing floor id. Engine rejections return HTTP 409; malformed bodies 400.

## Open issues / blockers

- None.

## Log

- 2026-10-18: plan approved; Phase 0 scaffold built; typecheck and lint green.
- 2026-10-18: context map bootstrapped; Phase 0 committed. Brief PDF is gitignored (employer document, repo will be public).
