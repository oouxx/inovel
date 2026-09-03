import { spawn } from 'node:child_process';
import { freePorts } from './kill-port';

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

// 启动前清掉残留的上一次实例,避免 8080/5173 被旧进程占用
if (!(await freePorts(8080, 5173))) {
  console.error('[dev] 端口释放失败,请手动处理后重试: bun run ports:free');
  process.exit(1);
}

run('server', 'bun', ['--watch', 'src/server/index.ts']);
run('client', 'bunx', ['vite', '--port', '5173']);