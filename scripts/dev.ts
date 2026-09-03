import { spawn } from 'node:child_process';

/** 并行启动 server(:8080)与 Vite dev(:5173) */
const procs: any[] = [];

function run(name: string, cmd: string, args: string[]) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown();
  });
  procs.push(child);
}

function shutdown() {
  for (const p of procs) {
    try { p.kill(); } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', 'bun', ['--watch', 'src/server/index.ts']);
run('client', 'bunx', ['vite', '--port', '5173']);