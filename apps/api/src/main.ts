import 'reflect-metadata';
import { createApp } from './app.factory.js';

// Owner: Dev 2. Env: PORT (default 3000), FLEET_DB (default ./data/fleet.db, relative to cwd).
async function main(): Promise<void> {
  const dbPath = process.env['FLEET_DB'] ?? './data/fleet.db';
  const port = Number(process.env['PORT'] ?? 3000);
  const app = await createApp({ dbPath });
  // SIGINT/SIGTERM run app.close(), which closes the database cleanly.
  app.enableShutdownHooks();
  await app.listen(port);
  console.error(`Fleet API listening on ${await app.getUrl()} (db: ${dbPath})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
