// ---------- 在线书籍下载:抓取全书 → 写入 TXT → 扫描入库 ----------
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../database';
import { scanLibrary, getNovelsDir } from '../scanner/scanner';
import { getBookInfo, getToc, getChapterContent, MAX_CHAPTERS } from './engine';
import { listSources } from './store';
import type { OnlineDownloadTask } from '../../shared/types';

const tasks = new Map<string, OnlineDownloadTask>();
const MAX_TASKS_KEEP = 40;

let seq = 0;
function newId(): string {
  seq += 1;
  return `dl_${Date.now()}_${seq}`;
}

export function createDownloadTask(sourceUrl: string, bookUrl: string): OnlineDownloadTask {
  const task: OnlineDownloadTask = {
    id: newId(),
    sourceUrl,
    sourceName: sourceUrl,
    bookName: '',
    author: '',
    bookUrl,
    status: 'pending',
    total: 0,
    finished: 0,
    currentTitle: '',
    filePath: null,
    bookId: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    canceled: false,
  };
  tasks.set(task.id, task);
  // 清理旧任务
  if (tasks.size > MAX_TASKS_KEEP) {
    const ids = [...tasks.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [id, t] of ids.slice(0, tasks.size - MAX_TASKS_KEEP)) {
      if (t.status === 'done' || t.status === 'error' || t.status === 'canceled') tasks.delete(id);
    }
  }
  // 后台执行
  runTask(task).catch((e) => {
    task.status = 'error';
    task.error = String(e?.message || e);
    task.finishedAt = Date.now();
  });
  return task;
}

function sanitizeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim().slice(0, 80) || '未命名';
}

/** 规范化章节标题,保证 ChapterDetector 稳定识别(第N章 连续编号) */
function formatChapterLine(index: number, title: string): string {
  const clean = title.replace(/^第[0-9一二三四五六七八九十百千万零两]+\s*[章节卷集部回]\s*/, '').trim();
  const t = clean || title || `第${index + 1}章`;
  return `第${index + 1}章 ${t}`;
}

async function runTask(task: OnlineDownloadTask) {
  task.status = 'running';
  const sessionVars = new Map<string, string>(); // @put/@get 跨阶段共享
  try {
    const info = await getBookInfo(task.sourceUrl, task.bookUrl, sessionVars);
    task.bookName = info.info.name || '未命名';
    task.sourceName = getSourceName(task.sourceUrl);
    const toc = await getToc(task.sourceUrl, info.info.tocUrl, sessionVars, { name: info.info.name, author: info.info.author });
    // 跳过无 url 的卷头行
    const chapters = toc.chapters.filter((ch) => ch.url).slice(0, MAX_CHAPTERS);
    task.total = chapters.length;
    if (!chapters.length) throw new Error('目录为空,无法下载');

    const dir = path.join(getNovelsDir(), '在线');
    mkdirSync(dir, { recursive: true });
    const fileName = sanitizeFileName(info.info.name) + (info.info.author ? ` - ${sanitizeFileName(info.info.author)}` : '') + '.txt';
    const filePath = path.join(dir, fileName);
    task.filePath = filePath;

    const writer = Bun.file(filePath).writer();
    await writer.write(`${info.info.name}\n${info.info.author ? `作者: ${info.info.author}\n` : ''}来源: ${task.sourceUrl}\n\n`);

    let errors = 0;
    for (let i = 0; i < chapters.length; i++) {
      if (task.canceled) break;
      task.currentTitle = chapters[i].title;
      let content = '';
      try {
        const r = await getChapterContent(task.sourceUrl, chapters[i].url, chapters[i].title, info.info.name, info.info.author, sessionVars);
        content = r.content;
        // 正文自带与章节标题相同的首行时去重,避免阅读时标题重复
        const t = chapters[i].title;
        const cleanTitle = t.replace(/^第[0-9一二三四五六七八九十百千万零两]+\s*[章节卷集部回]\s*/, '').trim();
        for (const cand of [t, cleanTitle]) {
          if (cand && content.startsWith(cand)) {
            content = content.slice(cand.length).replace(/^\s*[\r\n]+/, '');
            break;
          }
        }
        if (r.messages.length) task.error = task.error ?? r.messages[0];
      } catch (e: any) {
        errors++;
        content = `(章节下载失败: ${String(e?.message || e).slice(0, 100)})`;
        if (errors >= Math.max(20, Math.ceil(chapters.length * 0.3))) {
          await writer.end();
          throw new Error(`连续失败过多(${errors} 章),已中止:${String(e?.message || e).slice(0, 100)}`);
        }
      }
      await writer.write(`${formatChapterLine(i, chapters[i].title)}\n\n${content}\n\n`);
      task.finished = i + 1;
    }
    await writer.end();

    if (task.canceled) {
      task.status = 'canceled';
      task.finishedAt = Date.now();
    } else {
      task.status = 'done';
      task.finishedAt = Date.now();
    }
    // 触发扫描入库
    await scanLibrary();
    const db = getDb();
    const row = db.query('SELECT id FROM books WHERE file_path = ?').get(filePath) as { id: number } | undefined;
    task.bookId = row?.id ?? null;
    if (errors > 0) {
      task.error = task.error ?? `${errors} 章下载失败(已用占位文本)`;
    }
  } catch (e: any) {
    task.status = 'error';
    task.error = String(e?.message || e);
    task.finishedAt = Date.now();
    // 若已写入部分文件,仍尝试入库
    if (task.filePath && existsSync(task.filePath)) {
      try {
        await scanLibrary();
        const db = getDb();
        const row = db.query('SELECT id FROM books WHERE file_path = ?').get(task.filePath) as { id: number } | undefined;
        task.bookId = row?.id ?? null;
      } catch {}
    }
  }
}

const sourceNameCache = new Map<string, string>();
function getSourceName(sourceUrl: string): string {
  if (sourceNameCache.has(sourceUrl)) return sourceNameCache.get(sourceUrl)!;
  const s = listSources().find((x) => x.bookSourceUrl === sourceUrl);
  const name = s?.bookSourceName || sourceUrl;
  sourceNameCache.set(sourceUrl, name);
  return name;
}

export function listDownloadTasks(): OnlineDownloadTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getDownloadTask(id: string): OnlineDownloadTask | null {
  return tasks.get(id) ?? null;
}

export function cancelDownloadTask(id: string): boolean {
  const t = tasks.get(id);
  if (!t) return false;
  if (t.status === 'pending' || t.status === 'running') {
    t.canceled = true;
  }
  return true;
}