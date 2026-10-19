// `npm run dev`: API (tsx watch, :3000) + web (ng serve, :4200, proxies /api and /socket.io).
// Ctrl+C stops both. No extra dependency: two child processes sharing this terminal.
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['run', 'dev', '-w', '@fleet/api']],
  ['web', ['run', 'dev', '-w', '@fleet/web']],
].map(([name, args]) => {
  const child = spawn('npm', [...args, '--loglevel=error'], { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.error(`[dev] ${name} exited (${code ?? 'signal'}); stopping the rest`);
    stopAll();
  });
  return child;
});

function stopAll() {
  for (const child of procs) if (child.exitCode === null) child.kill('SIGTERM');
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
