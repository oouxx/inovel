// ---------- 在线书源 API ----------
import { Hono } from 'hono';
import type { OnlineSearchResult, OnlineSourceTestResult, OnlineChapter } from '../../shared/types';
import {
  listSources,
  importSources,
  deleteSource,
  setSourceEnabled,
  getSourceRaw,
  setSourceRespondTime,
} from '../sources/store';
import {
  searchSource,
  getBookInfo,
  getToc,
  getChapterContent,
  getExplore,
  exploreBooks,
} from '../sources/engine';
import { createDownloadTask, listDownloadTasks, cancelDownloadTask } from '../sources/downloader';

export const onlineRoutes = new Hono();

const SEARCH_TIMEOUT_MS = 25_000;
const SEARCH_CONCURRENCY = 4;

function dec(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label = ''): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`超时(${ms}ms)${label ? `: ${label}` : ''}`)), ms)),
  ]);
}

// ---------- 书源管理 ----------
onlineRoutes.get('/sources', (c) => c.json({ sources: listSources() }));

onlineRoutes.post('/sources/import', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);
  let text: string | null = null;
  if (typeof body.text === 'string' && body.text.trim()) {
    text = body.text;
  } else if (typeof body.url === 'string' && body.url.trim()) {
    try {
      const res = await fetch(body.url.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return c.json({ error: `下载书源失败: HTTP ${res.status}` }, 502);
      text = await res.text();
    } catch (e: any) {
      return c.json({ error: `下载书源失败: ${String(e?.message || e).slice(0, 120)}` }, 502);
    }
  }
  if (!text) return c.json({ error: '请提供 url 或 text' }, 400);
  const result = importSources(text);
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json({ ok: true, ...result });
});

onlineRoutes.delete('/sources/:url', (c) => {
  const url = dec(c.req.param('url'));
  if (!deleteSource(url)) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

onlineRoutes.patch('/sources/:url', async (c) => {
  const url = dec(c.req.param('url'));
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') return c.json({ error: 'invalid body' }, 400);
  if (!getSourceRaw(url)) return c.json({ error: 'not found' }, 404);
  setSourceEnabled(url, body.enabled);
  return c.json({ ok: true });
});

/** 书源连通性测试:实际执行一次搜索 */
onlineRoutes.post('/sources/test', async (c) => {
  const body = await c.req.json().catch(() => null);
  const sourceUrl = dec(String(body?.sourceUrl ?? ''));
  const keyword = (String(body?.keyword ?? '我').trim() || '我').slice(0, 30);
  const raw = getSourceRaw(sourceUrl);
  if (!raw) return c.json({ error: 'not found' }, 404);
  const t0 = Date.now();
  try {
    const r = await withTimeout(searchSource(sourceUrl, keyword), SEARCH_TIMEOUT_MS, raw.bookSourceName);
    const costMs = Date.now() - t0;
    setSourceRespondTime(sourceUrl, costMs);
    const result: OnlineSourceTestResult = {
      sourceUrl,
      sourceName: raw.bookSourceName,
      ok: r.books.length > 0,
      count: r.books.length,
      costMs,
      sample: r.books[0]?.name ?? '',
      error: r.books.length ? null : '未搜索到结果(规则或站点可能已失效)',
    };
    return c.json(result);
  } catch (e: any) {
    const result: OnlineSourceTestResult = {
      sourceUrl,
      sourceName: raw.bookSourceName,
      ok: false,
      count: 0,
      costMs: Date.now() - t0,
      sample: '',
      error: String(e?.message || e).slice(0, 200),
    };
    return c.json(result);
  }
});

// ---------- 搜索(多源并发) ----------
onlineRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const page = Number(c.req.query('page')) || 1;
  const sourcesParam = c.req.query('sources');
  if (!q) return c.json({ error: '缺少搜索词' }, 400);

  const all = listSources().filter((s) => s.enabled);
  let targets: string[];
  if (sourcesParam && sourcesParam !== 'all') {
    const wanted = new Set(sourcesParam.split(',').map((s) => dec(s.trim())));
    targets = all.filter((s) => wanted.has(s.bookSourceUrl)).map((s) => s.bookSourceUrl);
  } else {
    targets = all.map((s) => s.bookSourceUrl);
  }
  if (!targets.length) return c.json({ error: '没有已启用的书源,请先导入' }, 400);

  const results: OnlineSearchResult[] = [];
  const queue = [...targets];
  const workers = Array.from({ length: Math.min(SEARCH_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift()!;
      const raw = getSourceRaw(url);
      const t0 = Date.now();
      try {
        const r = await withTimeout(searchSource(url, q, page), SEARCH_TIMEOUT_MS, raw?.bookSourceName);
        results.push({
          sourceUrl: url,
          sourceName: raw?.bookSourceName ?? url,
          error: r.books.length ? null : r.messages.join('; ') || '未搜索到结果',
          costMs: r.costMs,
          books: r.books,
        });
      } catch (e: any) {
        results.push({
          sourceUrl: url,
          sourceName: raw?.bookSourceName ?? url,
          error: String(e?.message || e).slice(0, 200),
          costMs: Date.now() - t0,
          books: [],
        });
      }
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;
    return b.books.length - a.books.length;
  });
  return c.json({ results, total: results.reduce((n, r) => n + r.books.length, 0) });
});

// ---------- 详情 ----------
onlineRoutes.get('/book', async (c) => {
  const source = dec(c.req.query('source') ?? '');
  const bookUrl = dec(c.req.query('bookUrl') ?? '');
  if (!source || !bookUrl) return c.json({ error: '缺少 source / bookUrl' }, 400);
  try {
    const r = await withTimeout(getBookInfo(source, bookUrl), SEARCH_TIMEOUT_MS);
    return c.json(r);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
});

// ---------- 目录(预览,带缓存) ----------
const tocCache = new Map<string, { at: number; chapters: OnlineChapter[] }>();
const TOC_TTL = 10 * 60 * 1000;

onlineRoutes.get('/toc', async (c) => {
  const source = dec(c.req.query('source') ?? '');
  const bookUrl = dec(c.req.query('bookUrl') ?? '');
  if (!source || !bookUrl) return c.json({ error: '缺少 source / bookUrl' }, 400);
  const cacheKey = `${source}|${bookUrl}`;
  const cached = tocCache.get(cacheKey);
  if (c.req.query('refresh') !== '1' && cached && Date.now() - cached.at < TOC_TTL) {
    return c.json({ chapters: cached.chapters, cached: true });
  }
  try {
    const sessionVars = new Map<string, string>();
    const info = await withTimeout(getBookInfo(source, bookUrl, sessionVars), SEARCH_TIMEOUT_MS);
    const r = await withTimeout(getToc(source, info.info.tocUrl, sessionVars), 60_000, '目录抓取');
    tocCache.set(cacheKey, { at: Date.now(), chapters: r.chapters });
    if (tocCache.size > 60) {
      const oldest = [...tocCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) tocCache.delete(oldest[0]);
    }
    return c.json({ chapters: r.chapters, messages: r.messages });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
});

// ---------- 试读单章 ----------
onlineRoutes.get('/content', async (c) => {
  const source = dec(c.req.query('source') ?? '');
  const url = dec(c.req.query('url') ?? '');
  const title = dec(c.req.query('title') ?? '试读');
  if (!source || !url) return c.json({ error: '缺少 source / url' }, 400);
  try {
    const r = await withTimeout(getChapterContent(source, url, title), SEARCH_TIMEOUT_MS);
    return c.json(r);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
});

// ---------- 发现 ----------
onlineRoutes.get('/explore', async (c) => {
  const source = dec(c.req.query('source') ?? '');
  if (!source) return c.json({ error: '缺少 source' }, 400);
  const raw = getSourceRaw(source);
  if (!raw) return c.json({ error: '书源不存在' }, 404);
  if (!raw.enabledExplore) return c.json({ categories: [], messages: [], disabled: true });
  try {
    const r = await getExplore(source);
    return c.json(r);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
});

onlineRoutes.get('/explore/books', async (c) => {
  const source = dec(c.req.query('source') ?? '');
  const catUrl = dec(c.req.query('url') ?? '');
  const page = Number(c.req.query('page')) || 1;
  if (!source || !catUrl) return c.json({ error: '缺少 source / url' }, 400);
  try {
    const r = await withTimeout(exploreBooks(source, catUrl, page), SEARCH_TIMEOUT_MS);
    return c.json(r);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
});

// ---------- 下载 ----------
onlineRoutes.post('/download', async (c) => {
  const body = await c.req.json().catch(() => null);
  const source = dec(String(body?.source ?? ''));
  const bookUrl = dec(String(body?.bookUrl ?? ''));
  if (!source || !bookUrl) return c.json({ error: '缺少 source / bookUrl' }, 400);
  if (!getSourceRaw(source)) return c.json({ error: '书源不存在' }, 404);
  const task = createDownloadTask(source, bookUrl);
  return c.json({ ok: true, task });
});

onlineRoutes.get('/tasks', (c) => c.json({ tasks: listDownloadTasks() }));

onlineRoutes.post('/tasks/:id/cancel', (c) => {
  if (!cancelDownloadTask(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});