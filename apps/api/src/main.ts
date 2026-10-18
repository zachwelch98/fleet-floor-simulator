import 'reflect-metadata';
import { createApp } from './app.factory.js';

// Owner: Dev 2. Env: PORT (default 3000), FLEET_DB (default ./data/fleet.db).
async function main(): Promise<void> {
  const app = await createApp({ dbPath: process.env['FLEET_DB'] ?? './data/fleet.db' });
  await app.listen(Number(process.env['PORT'] ?? 3000));
}

void main();
