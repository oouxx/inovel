/**
 * 释放被占用的端口:找到正在监听该端口的进程并终止。
 *
 * 用法(CLI):
 *   bun run scripts/kill-port.ts 8080 [5173 ...]
 *
 * 作为模块使用:
 *   import { freePorts } from './kill-port';
 *   await freePorts(8080, 5173);
 *
 * 逻辑:lsof 查出监听端口的 PID → SIGTERM 优雅退出(最多等 3s)→
 * 仍存活则 SIGKILL;SIGKILL 后仍占用则以非 0 退出码结束,便于 && 链及时止损。
 */
import { spawnSync } from 'node:child_process';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 返回当前监听指定端口的所有 PID(lsof 不可用或无占用时返回空数组) */
function pidsListeningOn(port: number): number[] {
  try {
    const res = spawnSync('lsof', ['-t', '-i', `:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    // lsof 找不到进程时退出码非 0 且 stdout 为空,属正常情况
    return (res.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'ESRCH' ? false : true; // EPERM 等错误视为仍存活
  }
}

function killAll(pids: number[], signal: NodeJS.Signals | number) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      console.log(`[kill-port]   已向 PID ${pid} 发送 ${signal}`);
    } catch {
      /* 进程可能刚好自行退出 */
    }
  }
}

/** 释放端口:SIGTERM → 等 3s → SIGKILL。返回是否全部释放成功。 */
export async function freePorts(...ports: number[]): Promise<boolean> {
  let ok = true;
  for (const port of ports) {
    let pids = pidsListeningOn(port);
    if (pids.length === 0) {
      console.log(`[kill-port] :${port} 空闲`);
      continue;
    }

    console.log(`[kill-port] :${port} 被 PID ${pids.join(', ')} 占用,发送 SIGTERM...`);
    killAll(pids, 'SIGTERM');

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (pids = pids.filter(alive)).length > 0) {
      await sleep(200);
    }
    pids = pids.filter(alive);

    if (pids.length > 0) {
      console.log(`[kill-port] PID ${pids.join(', ')} 未在 3s 内退出,发送 SIGKILL...`);
      killAll(pids, 'SIGKILL');
      await sleep(300);
      pids = pids.filter(alive);
    }

    if (pids.length > 0) {
      console.error(`[kill-port] ✗ :${port} 仍被 PID ${pids.join(', ')} 占用,释放失败`);
      ok = false;
    } else {
      console.log(`[kill-port] ✓ :${port} 已释放`);
    }
  }
  return ok;
}

if (import.meta.main) {
  const ports = process.argv
    .slice(2)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ports.length === 0) {
    console.error('用法: bun run scripts/kill-port.ts <port> [port...]');
    process.exit(1);
  }
  const ok = await freePorts(...ports);
  if (!ok) process.exit(1);
}