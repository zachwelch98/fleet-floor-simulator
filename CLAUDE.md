# Fleet Floor Simulator: session guide

Take-home project (brief: `Fleet_Floor_Simulator_Brief.pdf`).

**Resuming work? Read in this order:**
1. `docs/STATUS.md`: current phase, next action, agents, blockers.
2. `docs/PLAN.md`: the approved plan (team roles, architecture, test strategy, phases).
3. `DECISIONS.md`: every ruling on gaps in the brief. Don't re-decide these; change one only with the user.

**Rules**
- Update `docs/STATUS.md` at the end of every task, agent hand-off, and phase gate.
- The engine contract (`packages/engine/src/types.ts`) and protocol contract (`packages/protocol/src/index.ts`) change only through the PM, and only with a STATUS.md note.
- Before calling code you didn't write in this session, look it up in `.claude/context-map.md` (code-context-map skill). Never guess names or signatures.
- `npm run verify` must be green before merging or committing a phase. `npm run verify:fast` is for quick checks.
- Commits are small and scoped. Push to GitHub only when the user confirms.
- Implementation agents run on Sonnet (`model: "sonnet"`); the PM session runs on Opus.
