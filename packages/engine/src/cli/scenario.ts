// CLI: `npm run scenario -- path/to/scenario.txt`. The only engine file allowed to do IO.
// stdout carries REPORT lines and nothing else; all diagnostics go to stderr.
import { readFileSync } from 'node:fs';
import { runScenario } from '../scenario/run.js';

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: npm run scenario -- path/to/scenario.txt\n');
  process.exit(2);
}

let text: string;
try {
  text = readFileSync(path, 'utf8');
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`scenario: cannot read ${path}: ${reason}\n`);
  process.exit(1);
}

const lines = runScenario(text);
process.stdout.write(lines.map((l) => `${l}\n`).join(''));
