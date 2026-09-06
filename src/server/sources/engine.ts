// ---------- 书源引擎:搜索 / 详情 / 目录 / 正文 / 发现 ----------
import { load as cheerioLoad } from 'cheerio';
import { JSONPath } from 'jsonpath-plus';
import { sourceFetch, rateLimitDelay, SourceFetchError } from './http';
import { getSourceRaw, getSourceVariable, setSourceVariable, getLoginInfo } from './store';
import {
  evalRule,
  evalRuleText,
  evalRuleList,
  buildUrlParts,
  makeHost,
  type RuleEnv,
} from './rules/analyzeRule';
import { runJs, stripJsPrefix } from './rules/jsRuntime';
import type { RawBookSource } from './types';
import type { OnlineSearchBook, OnlineBookInfo, OnlineChapter, OnlineExploreCategory } from '../../shared/types';

export const MAX_TOC_PAGES = 40;
export const MAX_CHAPTERS = 30_000;
const MAX_CONTENT_PAGES = 50;

export class SourceEngineError extends Error {
  needWebView: boolean;
  constructor(message: string, needWebView = false) {
    super(message);
    this.needWebView = needWebView;
  }
}

interface Ctx {
  raw: RawBookSource;
  key: string;
  variable: string;
  loginInfo: Record<string, string>;
  messages: string[];
  vars: Map<string, string>;
  book: Record<string, any>;
}

function loadCtx(sourceUrl: string): Ctx {
  const raw = getSourceRaw(sourceUrl);
  if (!raw) throw new SourceEngineError('书源不存在');
  if ((raw as any).bookSourceType === 1) throw new SourceEngineError('音频书源暂不支持');
  if ((raw as any).bookSourceType === 2) throw new SourceEngineError('图片/漫画书源暂不支持(当前阅读器仅支持文字)');
  return {
    raw,
    key: raw.bookSourceUrl,
    variable: getSourceVariable(sourceUrl),
    loginInfo: getLoginInfo(sourceUrl),
    messages: [],
    vars: new Map(),
    book: {},
  };
}

function makeEnv(ctx: Ctx, rawText: string, baseUrl: string, vars?: Map<string, string>): RuleEnv {
  return {
    $: cheerioLoad(rawText || '<html></html>'),
    json: tryJson(rawText),
    rawText,
    baseUrl,
    sourceKey: ctx.key,
    sourceVariable: ctx.variable,
    setSourceVariable: (v) => {
      ctx.variable = v;
      setSourceVariable(ctx.key, v);
    },
    loginInfo: ctx.loginInfo,
    vars: vars ?? ctx.vars,
    book: ctx.book,
    messages: ctx.messages,
    sourceRaw: ctx.raw,
  };
}

function tryJson(s: string): unknown {
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function absoluteUrl(base: string, url: string): string {
  const u = (url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  try {
    return new URL(u, base).toString();
  } catch {
    return base.replace(/\/$/, '') + '/' + u.replace(/^\/+/, '');
  }
}

async function fetchPage(ctx: Ctx, url: string, options: Record<string, any>) {
  await rateLimitDelay(ctx.key, ctx.raw.concurrentRate);
  try {
    return await sourceFetch(ctx.key, url, options as any, ctx.raw.header as any);
  } catch (e: any) {
    if (e instanceof SourceFetchError && e.webView) {
      throw new SourceEngineError('该源需要 WebView 浏览器验证(人机验证/JS 挑战),当前环境不支持', true);
    }
    throw new SourceEngineError(String(e?.message || e));
  }
}

// ---------- 搜索 ----------
export async function searchSource(
  sourceUrl: string,
  key: string,
  page = 1,
): Promise<{ books: OnlineSearchBook[]; messages: string[]; costMs: number }> {
  const t0 = Date.now();
  const ctx = loadCtx(sourceUrl);
  if (!ctx.raw.searchUrl) throw new SourceEngineError('书源未配置搜索地址');
  if (ctx.raw.enabled === false) throw new SourceEngineError('书源已禁用');

  const env0 = makeEnv(ctx, '', ctx.key);
  const { url, options } = buildUrlParts(env0, ctx.raw.searchUrl, { key, searchKey: key, page });
  if (!url) throw new SourceEngineError('搜索地址构建失败');

  const res = await fetchPage(ctx, url, options);
  const env = makeEnv(ctx, res.body, res.finalUrl);
  const rule = ctx.raw.ruleSearch ?? {};

  const items = evalRuleList(env, rule.bookList);
  const books: OnlineSearchBook[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const name = evalRuleText(env, rule.name, item);
    const author = evalRuleText(env, rule.author, item);
    const bookUrlRaw = evalRuleText(env, rule.bookUrl, item);
    if (!name && !bookUrlRaw) continue;
    const bookUrl = absoluteUrl(res.finalUrl, (bookUrlRaw.split('\n')[0] ?? '').trim());
    const dedupeKey = name ? `n:${name}|${author}` : `u:${bookUrl}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    books.push({
      name,
      author,
      kind: evalRuleText(env, rule.kind, item),
      intro: evalRuleText(env, rule.intro, item),
      coverUrl: absoluteUrl(res.finalUrl, evalRuleText(env, rule.coverUrl, item)),
      latestChapter: evalRuleText(env, rule.lastChapter, item),
      bookUrl,
      wordCount: evalRuleText(env, rule.wordCount, item),
    });
    if (books.length >= 30) break;
  }
  if (!books.length && !ctx.messages.length) {
    throw new SourceEngineError('未搜索到结果(书源规则或站点可能已失效)');
  }
  return { books, messages: ctx.messages, costMs: Date.now() - t0 };
}

// ---------- 详情 ----------
export async function getBookInfo(
  sourceUrl: string,
  bookUrl: string,
  sessionVars?: Map<string, string>,
): Promise<{ info: OnlineBookInfo; messages: string[] }> {
  const ctx = loadCtx(sourceUrl);
  const res = await fetchPage(ctx, bookUrl, {});
  let env = makeEnv(ctx, res.body, res.finalUrl, sessionVars);
  const rule = ctx.raw.ruleBookInfo ?? {};

  if (rule.init) {
    env = applyInit(env, rule.init);
  }

  const intro =
    evalRuleText(env, rule.intro).replace(/\n{3,}/g, '\n\n') ||
    (rule.intro ? '' : evalRuleText(env, "//meta[@name='description']/@content") || evalRuleText(env, "//meta[@property='og:description']/@content"));
  const tocUrlRaw = evalRuleText(env, rule.tocUrl);
  // 书名兜底:规则缺失或为空时取 og:title / meta[name=description] / <title>
  let name = evalRuleText(env, rule.name) || ctx.book.name || '';
  if (!name) {
    name =
      evalRuleText(env, "//meta[@property='og:title']/@content") ||
      evalRuleText(env, "//meta[@name='description']/@content") ||
      (env.$('title').first().text() ?? '').replace(/\s*[-–|]\s*[^-–|]*$/, '').trim();
  }
  let author = evalRuleText(env, rule.author);
  if (!author) {
    author = evalRuleText(env, "//meta[@name='author']/@content");
  }
  const info: OnlineBookInfo = {
    name,
    author,
    kind: evalRuleText(env, rule.kind),
    intro,
    coverUrl: absoluteUrl(res.finalUrl, evalRuleText(env, rule.coverUrl)),
    latestChapter: evalRuleText(env, rule.lastChapter),
    bookUrl,
    wordCount: evalRuleText(env, rule.wordCount),
    tocUrl: tocUrlRaw ? absoluteUrl(res.finalUrl, tocUrlRaw.split('\n')[0]) : bookUrl,
  };
  return { info, messages: ctx.messages };
}

function applyInit(env: RuleEnv, initRule: string): RuleEnv {
  const { code, rest } = stripJsPrefix(initRule.trim());
  if (code) {
    const r = runJs(code, makeHost(env, undefined));
    return envFromJsResult(env, r);
  }
  const rule = rest.trim();
  if (!rule) return env;
  if (rule.startsWith('$')) {
    const json = env.json ?? tryJson(env.rawText);
    if (json === undefined) return env;
    const r = JSONPath({ path: rule, json, wrap: false });
    if (r == null) return env;
    return { ...env, json: r };
  }
  if (rule.startsWith(':')) return env;
  // jsoup → 取首个元素作为新文档
  try {
    const items = evalRuleList(env, rule);
    const first = items[0];
    if (first?.element) {
      const html = env.$.html(first.element as never) ?? '';
      return { ...env, $: cheerioLoad(html), rawText: html, json: tryJson(html) };
    }
  } catch {}
  return env;
}

function envFromJsResult(env: RuleEnv, jsResult: any): RuleEnv {
  const next = { ...env };
  if (typeof jsResult === 'string' && jsResult.trim()) {
    next.rawText = jsResult;
    next.json = tryJson(jsResult);
    next.$ = cheerioLoad(jsResult);
  } else if (jsResult != null && typeof jsResult === 'object') {
    next.json = jsResult;
    next.rawText = JSON.stringify(jsResult);
  }
  return next;
}

// ---------- 目录 ----------
export async function getToc(
  sourceUrl: string,
  tocUrl: string,
  sessionVars?: Map<string, string>,
  bookInfo?: { name?: string; author?: string },
): Promise<{ chapters: OnlineChapter[]; messages: string[] }> {
  const ctx = loadCtx(sourceUrl);
  if (bookInfo?.name) ctx.book.name = bookInfo.name;
  if (bookInfo?.author) ctx.book.author = bookInfo.author;
  const rule = ctx.raw.ruleToc ?? {};
  if (!rule.chapterList) throw new SourceEngineError('书源未配置目录规则');

  const chapters: OnlineChapter[] = [];
  const visited = new Set<string>();
  let url = tocUrl;
  let pages = 0;

  while (url && pages < MAX_TOC_PAGES && chapters.length < MAX_CHAPTERS) {
    if (visited.has(url)) break;
    visited.add(url);
    const res = await fetchPage(ctx, url, {});
    const env = makeEnv(ctx, res.body, res.finalUrl, sessionVars);
    const items = evalRuleList(env, rule.chapterList);
    for (const item of items) {
      const title = evalRuleText(env, rule.chapterName, item);
      const urlRaw = evalRuleText(env, rule.chapterUrl, item);
      if (!urlRaw && !title) continue;
      chapters.push({
        title: title || '未知章节',
        url: absoluteUrl(res.finalUrl, (urlRaw.split('\n')[0] ?? '').trim()),
        updateTime: evalRuleText(env, rule.updateTime, item) || undefined,
        isVip: evalRuleText(env, rule.isVip, item) === 'true' ? true : undefined,
      });
      if (chapters.length >= MAX_CHAPTERS) break;
    }
    // 下一页目录
    let nextUrl = '';
    if (rule.nextTocUrl) {
      const nextVals = evalRule(env, rule.nextTocUrl);
      nextUrl =
        nextVals.map((s) => absoluteUrl(res.finalUrl, s.split('\n')[0])).find((u) => u && !visited.has(u)) ?? '';
    }
    url = nextUrl;
    pages++;
  }
  if (!chapters.length && !ctx.messages.length) {
    throw new SourceEngineError('未解析到目录(书源规则或站点可能已失效)');
  }
  const seen = new Set<string>();
  const out = chapters.filter((c) => {
    if (!c.url) return true;
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
  return { chapters: out, messages: ctx.messages };
}

// ---------- 正文 ----------
export async function getChapterContent(
  sourceUrl: string,
  chapterUrl: string,
  chapterTitle: string,
  bookName = '',
  author = '',
  sessionVars?: Map<string, string>,
): Promise<{ content: string; messages: string[] }> {
  const ctx = loadCtx(sourceUrl);
  const rule = ctx.raw.ruleContent ?? {};
  if (!rule.content) throw new SourceEngineError('书源未配置正文规则');

  ctx.book.name = bookName;
  ctx.book.author = author;
  ctx.book.durChapterTitle = chapterTitle;

  let content = '';
  const visited = new Set<string>();
  let url = chapterUrl;
  let pages = 0;

  while (url && pages < MAX_CONTENT_PAGES) {
    if (visited.has(url)) break;
    visited.add(url);
    const { url: u, options } = splitFetchOptions(url);
    const res = await fetchPage(ctx, u, options);
    const env = makeEnv(ctx, res.body, res.finalUrl, sessionVars);
    const part = evalRuleText(env, rule.content);
    if (part) content += (content ? '\n' : '') + part;
    if (rule.replaceRegex) content = applyReplaceRegex(content, rule.replaceRegex);
    if (!rule.nextContentUrl) break;
    const nextVals = evalRule(env, rule.nextContentUrl);
    const next = nextVals.map((s) => absoluteUrl(res.finalUrl, s.split('\n')[0])).find(Boolean) ?? '';
    if (!next || visited.has(next)) break;
    url = next;
    pages++;
  }

  if (!content.trim() && !ctx.messages.length) {
    throw new SourceEngineError('未解析到正文(章节可能需要登录/VIP,或规则失效)');
  }
  return { content: content.trim(), messages: ctx.messages };
}

function splitFetchOptions(url: string): { url: string; options: Record<string, any> } {
  const m = url.match(/,\s*\{[\s\S]*\}\s*$/);
  if (!m || m.index === undefined) return { url, options: {} };
  try {
    return { url: url.slice(0, m.index), options: JSON.parse(url.slice(m.index + 1)) };
  } catch {
    try {
      return { url: url.slice(0, m.index), options: new Function(`return (${url.slice(m.index + 1)})`)() };
    } catch {
      return { url, options: {} };
    }
  }
}

function applyReplaceRegex(content: string, replaceRegex: string): string {
  let r = replaceRegex.trim();
  if (r.startsWith('##')) r = r.slice(2);
  const parts = r.split('##');
  try {
    const re = new RegExp(parts[0], 'g');
    return content.replace(re, parts[1] ?? '');
  } catch {
    return content;
  }
}

// ---------- 发现 ----------
export async function getExplore(sourceUrl: string): Promise<{ categories: OnlineExploreCategory[]; messages: string[] }> {
  const ctx = loadCtx(sourceUrl);
  const raw = ctx.raw.exploreUrl;
  if (!raw) return { categories: [], messages: [] };
  const categories: OnlineExploreCategory[] = [];
  const push = (t: any, u: any) => {
    if (!t && !u) return;
    categories.push({ title: String(t ?? '').trim(), url: String(u ?? '').trim() });
  };
  const tryParseArr = (s: string): any[] | null => {
    try {
      const j = JSON.parse(s.trim());
      return Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  };

  const { code, rest } = stripJsPrefix(raw.trim());
  if (code) {
    const env = makeEnv(ctx, '', ctx.key);
    try {
      const r = runJs(code, makeHost(env, undefined));
      const arr = Array.isArray(r) ? r : tryParseArr(String(r));
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (it && typeof it === 'object') push(it.title, it.url);
        }
      }
    } catch (e: any) {
      ctx.messages.push(`发现页规则执行失败: ${String(e?.message || e).slice(0, 120)}`);
    }
    if (!categories.length && rest.trim()) parseLines(rest.trim(), push);
    return { categories, messages: ctx.messages };
  }

  const trimmed = rest.trim() || raw.trim();
  const arr = tryParseArr(trimmed);
  if (arr) {
    for (const it of arr) {
      if (it && typeof it === 'object' && ('title' in it || 'url' in it)) push(it.title, it.url);
    }
    return { categories, messages: ctx.messages };
  }
  parseLines(trimmed, push);
  return { categories, messages: ctx.messages };
}

function parseLines(text: string, push: (t: any, u: any) => void) {
  for (const line of text.split(/\n+/)) {
    const l = line.trim();
    if (!l) continue;
    const i = l.indexOf('::');
    if (i > 0) push(l.slice(0, i), l.slice(i + 2));
  }
}
// ---------- 发现:分类书籍列表 ----------
export async function exploreBooks(
  sourceUrl: string,
  catUrl: string,
  page = 1,
): Promise<{ books: OnlineSearchBook[]; messages: string[] }> {
  const ctx = loadCtx(sourceUrl);
  const rule = ctx.raw.ruleExplore ?? {};
  if (!rule.bookList) throw new SourceEngineError('书源未配置发现规则');

  const env0 = makeEnv(ctx, '', ctx.key);
  const { url, options } = buildUrlParts(env0, catUrl, { page });
  if (!url) throw new SourceEngineError('发现地址构建失败');

  const res = await fetchPage(ctx, url, options);
  const env = makeEnv(ctx, res.body, res.finalUrl);
  const items = evalRuleList(env, rule.bookList);
  const books: OnlineSearchBook[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const name = evalRuleText(env, rule.name, item);
    const author = evalRuleText(env, rule.author, item);
    const bookUrlRaw = evalRuleText(env, rule.bookUrl, item);
    if (!name && !bookUrlRaw) continue;
    const bookUrl = absoluteUrl(res.finalUrl, (bookUrlRaw.split('\n')[0] ?? '').trim());
    const dedupeKey = name ? `n:${name}|${author}` : `u:${bookUrl}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    books.push({
      name,
      author: evalRuleText(env, rule.author, item),
      kind: evalRuleText(env, rule.kind, item),
      intro: evalRuleText(env, rule.intro, item),
      coverUrl: absoluteUrl(res.finalUrl, evalRuleText(env, rule.coverUrl, item)),
      latestChapter: evalRuleText(env, rule.lastChapter, item),
      bookUrl,
      wordCount: evalRuleText(env, rule.wordCount, item),
    });
    if (books.length >= 50) break;
  }
  return { books, messages: ctx.messages };
}
