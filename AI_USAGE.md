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

<!-- Entries added per phase: what was asked, accepted, rejected/rewritten, and why. -->
