// ---------- 在线书源 API ----------
import { Hono } from 'hono';
import type { OnlineSearchResult, OnlineSourceTestResult, OnlineChapter } from '../../shared/types';
import { mergeSourceBooks, precisionMatch } from '../../shared/search';
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
  getChapterMedia,
  getExplore,
  exploreBooks,
} from '../sources/engine';
import { createDownloadTask, listDownloadTasks, cancelDownloadTask } from '../sources/downloader';
import {
  addOnlineBook,
  deleteOnlineBook,
  getOnlineBook,
  getOnlineBookToc,
  getOnlineProgress,
  listOnlineBooks,
  saveOnlineProgress,
} from '../sources/library';
import { sourceFetchBinary, sourceFetchStream } from '../sources/http';

export const onlineRoutes = new Hono();

// 对齐原版阅读:单源 30s 超时,搜索并发上限 9(MAX_THREAD)
const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_CONCURRENCY = 9;

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

// ---------- 搜索(多源并发;flat=跨源聚合去重排序(对齐原版),grouped=按源分组) ----------
onlineRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const page = Number(c.req.query('page')) || 1;
  const precision = c.req.query('precision') !== '0';
  const grouped = c.req.query('mode') === 'grouped';
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

  const t0 = Date.now();
  const results: OnlineSearchResult[] = [];
  const queue = [...targets];
  const workers = Array.from({ length: Math.min(SEARCH_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift()!;
      const raw = getSourceRaw(url);
      const tt = Date.now();
      try {
        const r = await withTimeout(searchSource(url, q, page), SEARCH_TIMEOUT_MS, raw?.bookSourceName);
        results.push({
          sourceUrl: url,
          sourceName: raw?.bookSourceName ?? url,
          sourceType: r.sourceType,
          error: r.books.length ? null : r.messages.join('; ') || '未搜索到结果',
          costMs: r.costMs,
          books: r.books,
        });
      } catch (e: any) {
        results.push({
          sourceUrl: url,
          sourceName: raw?.bookSourceName ?? url,
          sourceType: 0,
          error: String(e?.message || e).slice(0, 200),
          costMs: Date.now() - tt,
          books: [],
        });
      }
    }
  });
  await Promise.all(workers);

  if (grouped) {
    if (precision) for (const r of results) r.books = r.books.filter((b) => precisionMatch(b, q));
    results.sort((a, b) => {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      return b.books.length - a.books.length;
    });
    return c.json({ results, total: results.reduce((n, r) => n + r.books.length, 0), costMs: Date.now() - t0 });
  }

  // 聚合模式(默认,对齐原版):跨源合并去重 + 分桶排序
  const ok = results.filter((r) => !r.error);
  const { merged, truncated } = mergeSourceBooks(
    ok.map((r) => ({ sourceUrl: r.sourceUrl, sourceName: r.sourceName, sourceType: r.sourceType, books: r.books })),
    q,
    precision,
  );
  return c.json({
    books: merged,
    total: merged.length,
    page,
    hasMore: ok.some((r) => r.books.length > 0),
    processedSources: ok.length,
    totalSources: targets.length,
    failedSources: results.length - ok.length,
    truncated,
    costMs: Date.now() - t0,
  });
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
  const rawDl = getSourceRaw(source);
  if (!rawDl) return c.json({ error: '书源不存在' }, 404);
  const st = Number((rawDl as any).bookSourceType ?? 0) || 0;
  if (st === 1) return c.json({ error: '音频源请在详情页使用「加入书架」在线收听' }, 400);
  if (st === 2) return c.json({ error: '漫画源请在详情页使用「加入书架」在线阅读' }, 400);
  const task = createDownloadTask(source, bookUrl);
  return c.json({ ok: true, task });
});

onlineRoutes.get('/tasks', (c) => c.json({ tasks: listDownloadTasks() }));

onlineRoutes.post('/tasks/:id/cancel', (c) => {
  if (!cancelDownloadTask(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});
// ---------- 在线书架(音频/漫画流式阅读) ----------
onlineRoutes.get('/library', (c) => c.json({ books: listOnlineBooks() }));

onlineRoutes.post('/library', async (c) => {
  const body = await c.req.json().catch(() => null);
  const source = dec(String(body?.source ?? ''));
  const bookUrl = dec(String(body?.bookUrl ?? ''));
  const name = String(body?.name ?? '').trim();
  const author = String(body?.author ?? '').trim();
  const coverUrl = String(body?.coverUrl ?? '').trim();
  const sourceType = Number(body?.sourceType ?? 0) || 0;
  if (!source || !bookUrl || !name) return c.json({ error: '缺少 source / bookUrl / name' }, 400);
  const raw = getSourceRaw(source);
  if (!raw) return c.json({ error: '书源不存在' }, 404);
  try {
    const book = await addOnlineBook(source, bookUrl, name, author, coverUrl, sourceType);
    return c.json({ ok: true, book });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
});

onlineRoutes.get('/library/:id', (c) => {
  const book = getOnlineBook(Number(c.req.param('id')));
  if (!book) return c.json({ error: 'not found' }, 404);
  return c.json({ book, chapters: getOnlineBookToc(book.id) });
});

onlineRoutes.delete('/library/:id', (c) => {
  if (!deleteOnlineBook(Number(c.req.param('id')))) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// ---------- 媒体章节解析(漫画→图片列表 / 音频→音频地址) ----------
const mediaCache = new Map<string, { at: number; kind: string; items: string[] }>();
const MEDIA_TTL = 30 * 60 * 1000;

onlineRoutes.get('/media', async (c) => {
  const source = dec(c.req.query('source') ?? '');
  const url = dec(c.req.query('url') ?? '');
  const title = dec(c.req.query('title') ?? '');
  const name = dec(c.req.query('name') ?? '');
  const author = dec(c.req.query('author') ?? '');
  if (!source || !url) return c.json({ error: '缺少 source / url' }, 400);
  const ck = `${source}|${url}`;
  const hit = mediaCache.get(ck);
  if (hit && Date.now() - hit.at < MEDIA_TTL) {
    return c.json({ kind: hit.kind, items: hit.items, cached: true });
  }
  try {
    const m = await withTimeout(getChapterMedia(source, url, title, name, author), SEARCH_TIMEOUT_MS);
    mediaCache.set(ck, { at: Date.now(), kind: m.kind, items: m.items });
    return c.json(m);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 502);
  }
});

// ---------- 图片代理(防盗链:带源 Referer/Cookie/UA) ----------
onlineRoutes.get('/img', async (c) => {
  const u = dec(c.req.query('u') ?? '');
  const source = dec(c.req.query('source') ?? '');
  const ref = dec(c.req.query('ref') ?? '');
  if (!u) return c.json({ error: '缺少 u' }, 400);
  const raw = getSourceRaw(source);
  if (!raw) return c.json({ error: '书源不存在' }, 404);
  try {
    const r = await sourceFetchBinary(source, u, { timeout: 20_000 }, raw.header as any, ref || undefined);
    if (r.status >= 400) return c.json({ error: `HTTP ${r.status}` }, 502);
    return new Response(r.buf, {
      headers: {
        'Content-Type': r.contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 200) }, 502);
  }
});

// ---------- 音频代理(Range 流式透传) ----------
onlineRoutes.get('/audio', async (c) => {
  const u = dec(c.req.query('u') ?? '');
  const source = dec(c.req.query('source') ?? '');
  const ref = dec(c.req.query('ref') ?? '');
  if (!u) return c.json({ error: '缺少 u' }, 400);
  const raw = getSourceRaw(source);
  if (!raw) return c.json({ error: '书源不存在' }, 404);
  try {
    const range = c.req.header('range') ?? null;
    const res = await sourceFetchStream(source, u, {}, raw.header as any, ref || undefined, range);
    const headers = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 200) }, 502);
  }
});

// ---------- 在线阅读进度 ----------
onlineRoutes.get('/progress/:id', (c) => {
  return c.json({ progress: getOnlineProgress(Number(c.req.param('id'))) });
});

onlineRoutes.put('/progress/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.chapter_index !== 'number') return c.json({ error: 'invalid body' }, 400);
  saveOnlineProgress(id, Math.max(0, Number(body.chapter_index) || 0), Math.max(0, Number(body.position) || 0));
  return c.json({ ok: true });
});
