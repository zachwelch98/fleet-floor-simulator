// CLI: `npm run scenario -- path/to/scenario.txt`. The only engine file allowed to do IO.
import { readFileSync } from 'node:fs';
import { runScenario } from '../scenario/run.js';

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: npm run scenario -- path/to/scenario.txt\n');
  process.exit(2);
}

const lines = runScenario(readFileSync(path, 'utf8'));
process.stdout.write(lines.map((l) => `${l}\n`).join(''));
