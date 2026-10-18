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

<!-- Entries added per phase: what was asked, accepted, rejected/rewritten, and why. -->
