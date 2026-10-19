# AI usage

How AI tools were used on this project: what was asked for, accepted, rejected or rewritten,
and why.

## Setup

- **Orchestration:** Claude Code (Opus 5.5) acted as product manager and orchestrator. It wrote the
  plan, the engine/protocol contracts, and DECISIONS.md, and reviewed and integrated all agent work.
- **Implementation agents:** Sonnet 5.5 subagents with fixed roles: a product designer, an engine
  developer, a runner/API developer, a frontend developer, and a tester. The tester wrote tests
  black-box from the brief and DECISIONS.md rather than from the implementation.
- **Code context map:** a parser-generated index of every function signature, kept current by a
  hook, which agents had to consult before calling code they hadn't written.
- **Human role:** I read the brief and made every judgment call on the gaps listed in
  DECISIONS.md, and I reviewed each phase before the next began.

## Log

### Reading the brief
- Asked Claude to assess the brief. It found the Module B battery contradiction (the rule gives
  98, the example says 97) and around 25 gaps. I made the final call on each of them, sometimes
  differently from its recommendation. For example, it recommended "lowest unused" for the next
  robot ID; I chose max + 1 so that new robots never outrank existing ones.

### Phase 0–1: engine, runner, tests, design (four parallel agents)
- **Caught by review: the scenario output would have failed grading.** `npm run scenario` prints
  npm's `> script` banner to stdout. No agent noticed; I checked the exact stdout before writing
  any engine code and fixed it with `.npmrc` (`loglevel=silent`).
- **Correction from an agent, accepted: my own spec was wrong.** The decisions draft said robots
  behind a head-on pair are `BEHIND_BLOCKED` and asked for a 3-robot rotation test. The engine
  agent pointed out that grids are bipartite (every loop is even, so the minimum rotation is 4)
  and that the robot behind a head-on pair always loses a *contest* first. I checked both by hand,
  fixed DECISIONS 2.1/2.7, and told the test agent before it finalized its expectations.
- **Checking that a green test suite actually tests something.** The black-box suite (576 tests,
  written without seeing the engine) passed on the first run against the real engine. I didn't
  take that as proof. I injected six bugs into the engine (rotations treated as swaps, followers
  always moving, highest ID winning contests, MOVE not consumed, no ID normalization, the wrong
  block reason). Each one failed between 2 and 45 tests.
- **Rejected: a test stand-in that outlived its purpose.** The runner agent mocked
  `parseRobotNum` with a fallback copy because the real one didn't exist yet. After the merge I
  removed the mock so the parser tests exercise the real function.
- **Tooling issue found while merging:** ESLint and git in the main checkout were picking up the
  agents' worktrees under `.claude/worktrees/`; they now ignore it. Prettier was not enforced
  (an agent noticed); it is now part of `verify`.

### Phase 2: GOTO and the API (written by Claude as PM; to be reviewed)
- **Independent agreement as evidence.** The GOTO tests (61) and GOTO scenarios (21) were written
  without access to the GOTO implementation, and vice versa. All passed against each other on the
  first merge. Both agents were working from DECISIONS section 3, so this confirms the code matches
  the written decisions, not that the decisions match the brief.
- **Gap between agents, closed by the PM.** The API agent couldn't exercise GOTO through HTTP,
  because GOTO wasn't merged in its worktree. After both merged, Claude ran the built server and
  checked a GOTO detour, a 409 rejection and restart persistence end to end.
- **Accepted, with a decision recorded:** the GOTO agent pointed out that, read literally, the
  brief makes a GOTO robot give up behind another robot in a one-wide corridor (DECISIONS 3.9).
  It was kept, because it is literal and can't deadlock, and listed as future work.

### Phase 2 (API tests) and Phase 3: real time and UI (drafted by Claude as PM; to be reviewed)
- **A green mutation run that wasn't.** To check the 158 new API tests, ten bugs were injected into
  the API one at a time. The first five were caught normally. The next five each "failed 154
  tests", which looked like a strong result. But the identical count across unrelated bugs was
  suspicious, and the unmodified code then failed too. The suite opens one TCP connection per
  request, about 3,800 per run, and back-to-back runs had exhausted the machine's ports. After
  fixing the test setup (one keep-alive connection for the 2,100-request bulk step), the rerun
  caught all ten with plausible counts (1 to 50 failures each).
- **Blind tests, then triage against the spec, not the code.** The real-time tests (46) were
  written without the server code and passed against it on the first merge. The 44 browser tests
  were written without the UI. 41 passed first time. The 3 failures were all in the tests: two
  pressed a key before the robot they meant to command had been placed, and one selector matched
  two history lines. The UI was left alone in all three cases, because the spec says a robot is
  selected only when its placement succeeds.
- **All tests green, still broken.** With every test passing, the design review found that after
  touching the interval slider, the arrow keys kept moving the slider instead of the selected
  robot. The UI agent had stopped grid clicks from taking focus, on purpose, which left focus on
  the slider. It also found a desktop page stretched to 3,300 px by off-screen accessibility text.
  Both are fixed, and the first now has a test.
- **Rejected: a fix that broke an accessibility rule.** While tidying the phone header, the UI
  agent reduced the "Connected" badge to a green dot. The spec's ground rule is "never color
  alone", so that part was reverted. The rest of the change was kept.
- **A mistake by the PM, caught by the build.** While fixing the port issue, Claude added a test
  helper named `stepMany` without checking the context map. A helper with that name already
  existed, and the duplicate export failed to compile. It was renamed. This is exactly the error
  the map exists to prevent; it only helps if it's actually consulted.
- **Accepted, non-idiomatic code.** The contract says joining an unknown floor acks `null`. Nest's
  usual `@SubscribeMessage` handler silently drops a `null` reply, which both the server agent and
  the test agent discovered independently. The plain socket.io handler that replaced it is less
  idiomatic but correct, and the reason is written in a comment and in DECISIONS 8.

<!-- Entries added per phase: what was asked, accepted, rejected/rewritten, and why. -->
