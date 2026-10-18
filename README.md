# Fleet Floor Simulator

A fleet of warehouse robots sharing one grid floor. Every robot acts at the same time, one tick
at a time, and the engine decides who gets which cell.

> Work in progress. See [docs/STATUS.md](docs/STATUS.md).

## Quick start

```bash
npm install
npm run scenario -- scenarios/brief_a_chain.txt   # CLI scenario runner
npm run verify                                     # every automated check
```

## Layout

| Path | What |
|---|---|
| `packages/engine` | Pure tick engine, GOTO pathfinding, scenario parser/runner (no IO, no framework) |
| `packages/protocol` | REST + socket.io contract shared by the API and the UI |
| `apps/api` | NestJS API, SQLite persistence, server tick loop, real-time gateway |
| `apps/web` | Angular UI |
| `scenarios/` | Scenario files with expected output, run automatically by the tests |

Design decisions: [DECISIONS.md](DECISIONS.md). AI usage: [AI_USAGE.md](AI_USAGE.md).
