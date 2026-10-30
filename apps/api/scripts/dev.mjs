// Dev loop without a bundler: tsc keeps dist/ fresh (it emits the decorator metadata Nest needs), and the
// API restarts each time tsc reports a finished compile.
//
// Restarts follow tsc's own "Found N errors" line rather than a file watcher. Node's --watch-path reacted to the
// local database files in .data/ on Windows, and a recursive fs.watch on dist/ silently stopped firing after
// large rewrites, leaving an old API running. With errors, the running API is kept until they are fixed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Find prisma and tsc even when this script is started without pnpm.
process.env.PATH = [path.resolve('node_modules/.bin'), path.resolve('../../node_modules/.bin'), process.env.PATH].join(path.delimiter);

spawnSync('prisma generate', { stdio: 'inherit', shell: true });
const first = spawnSync('tsc -p tsconfig.build.json', { stdio: 'inherit', shell: true });
if (first.status !== 0) console.error('Type errors found; the server starts once they are fixed.');

const compiler = spawn('tsc -p tsconfig.build.json --watch --preserveWatchOutput', {
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: true,
});

let server = null;
function start() {
  // The IPC channel lets us ask the API to shut down cleanly. On Windows kill() ends a process abruptly,
  // which can damage the local database if it is in the middle of writing.
  server = spawn(process.execPath, ['--env-file-if-exists=../../.env', 'dist/main.js'], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
}
function stopServer(then) {
  if (!server || server.exitCode !== null) return then();
  const running = server;
  running.once('exit', then);
  running.send('shutdown');
  // If it has not stopped after 10 seconds, end it.
  setTimeout(() => running.exitCode === null && running.kill(), 10_000).unref();
}
const restart = () => stopServer(start);

if (!existsSync('dist')) mkdirSync('dist');
let started = false;
let pending = '';
compiler.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  pending += chunk.toString();
  const lines = pending.split(/\r?\n/);
  pending = lines.pop() ?? '';
  for (const line of lines) {
    const found = /Found (\d+) errors?\. Watching for file changes/.exec(line);
    if (!found) continue;
    if (found[1] !== '0') {
      console.log(started ? 'Type errors: keeping the running API until they are fixed.' : 'Type errors: fix them to start the API.');
      continue;
    }
    if (started) console.log('Code changed, restarting the API…');
    started = true;
    restart();
  }
});

function stop() {
  compiler.kill();
  stopServer(() => process.exit(0));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
