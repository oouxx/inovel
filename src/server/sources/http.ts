// ---------- 书源 HTTP 层:请求 / 编码 / Cookie / 限流 ----------
import { getDb } from '../database';
import iconv from 'iconv-lite';

export interface FetchOptions {
  method?: string;
  body?: string;
  charset?: string;
  headers?: Record<string, string>;
  /** 毫秒 */
  timeout?: number;
  webView?: boolean;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
export const DEFAULT_TIMEOUT = 20_000;

/**
 * 代理说明:书源请求沿用 Bun 默认行为 —— 遵循 http_proxy/https_proxy/NO_PROXY
 * 环境变量(Docker 部署时在 .env 注入,如 bridge 网络下指向 docker0 网关 172.17.0.1:7890)。
 * 注意:Bun 的代理配置在启动时确定,运行时删 env 无效;国内站直连请用 NO_PROXY 或清空代理后启动。
 */

export class SourceFetchError extends Error {
  webView: boolean;
  constructor(message: string, webView = false) {
    super(message);
    this.webView = webView;
  }
}

// ---------- Cookie ----------
const cookieCaches = new Map<string, Record<string, string>>();

export function loadCookies(sourceUrl: string): Record<string, string> {
  if (cookieCaches.has(sourceUrl)) return cookieCaches.get(sourceUrl)!;
  const db = getDb();
  const row = db.query('SELECT cookies FROM source_cookies WHERE source_url = ?').get(sourceUrl) as
    | { cookies: string }
    | undefined;
  let map: Record<string, string> = {};
  if (row) {
    try {
      map = JSON.parse(row.cookies);
    } catch {}
  }
  cookieCaches.set(sourceUrl, map);
  return map;
}

export function saveCookies(sourceUrl: string) {
  const map = cookieCaches.get(sourceUrl);
  if (!map) return;
  const db = getDb();
  db.query(
    `INSERT INTO source_cookies (source_url, cookies, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(source_url) DO UPDATE SET cookies = excluded.cookies, updated_at = excluded.updated_at`,
  ).run(sourceUrl, JSON.stringify(map), Date.now());
}

function mergeSetCookies(url: string, res: Response) {
  const jar = loadCookies(url);
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const parts = line.split(';');
    const pair = parts[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (parts.some((p) => /expires=Thu,\s*01\s+Jan\s+1970/i.test(p))) delete jar[name];
    else jar[name] = value;
  }
}

function cookieHeader(url: string): string {
  const jar = loadCookies(url);
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function setCookie(sourceUrl: string, name: string, value: string) {
  loadCookies(sourceUrl)[name] = value;
}
export function removeCookies(sourceUrl: string) {
  cookieCaches.set(sourceUrl, {});
  saveCookies(sourceUrl);
}
export function getCookieString(sourceUrl: string, url?: string): string {
  const jar = loadCookies(sourceUrl);
  if (!url) return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const host = new URL(url).hostname;
  return Object.entries(jar)
    .filter(([k]) => k.includes(host) || !k.startsWith('http'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ---------- 限流 ----------
const lastRequestAt = new Map<string, number>();
export async function rateLimitDelay(sourceUrl: string, concurrentRate?: string) {
  const ms = parseConcurrentRate(concurrentRate);
  if (!ms || ms <= 0) return 0;
  const last = lastRequestAt.get(sourceUrl) ?? 0;
  const wait = last + ms - Date.now();
  lastRequestAt.set(sourceUrl, Math.max(Date.now(), last + ms));
  if (wait > 0 && wait < 60_000) await Bun.sleep(wait);
  return Math.max(0, wait);
}
function parseConcurrentRate(v?: string): number {
  if (!v) return 0;
  const m = String(v).trim().match(/^(\d+)(?:\/(\d+))?$/);
  if (m) return Number(m[1]); // "1000" 或 "次数/毫秒" 简化为间隔毫秒
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------- 编码 ----------
export function decodeBody(buf: ArrayBuffer, contentType: string | null, overrideCharset?: string): string {
  let charset = (overrideCharset || '').toLowerCase();
  if (!charset && contentType) {
    const m = contentType.match(/charset=["']?([\w-]+)/i);
    if (m) charset = m[1].toLowerCase();
  }
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!charset || charset === 'utf-8' || charset === 'utf8') return text;
  // 从 meta 再嗅探一次(响应头缺失时常见)
  const meta = text.slice(0, 4096).match(/charset=["']?([\w-]+)/i);
  if (meta) charset = meta[1].toLowerCase();
  try {
    if (charset.startsWith('gb')) return iconv.decode(Buffer.from(buf), 'gbk');
    if (charset.startsWith('big')) return iconv.decode(Buffer.from(buf), 'big5');
    if (charset.startsWith('utf-16')) return iconv.decode(Buffer.from(buf), 'utf-16le');
    return text;
  } catch {
    return text;
  }
}

export function encodeBody(body: string, charset?: string): Uint8Array {
  if (!charset || /utf-?8/i.test(charset)) return new TextEncoder().encode(body);
  try {
    if (charset.toLowerCase().startsWith('gb')) return iconv.encode(body, 'gbk');
    if (charset.toLowerCase().startsWith('big')) return iconv.encode(body, 'big5');
  } catch {}
  return new TextEncoder().encode(body);
}

// ---------- 主入口 ----------
export function parseHeaderField(h?: string | Record<string, string>): Record<string, string> {
  if (!h) return {};
  if (typeof h === 'object') return { ...h };
  let s = h.trim();
  if (!s) return {};
  if (s.startsWith('@js:')) {
    // 动态请求头:执行 js 得到对象
    try {
      const obj = new Function('java', 'baseUrl', 'source', `return eval(${JSON.stringify(s.slice(4))});`)({}, '', { getKey: () => '' });
      if (obj && typeof obj === 'object') return { ...obj };
    } catch {}
    return {};
  }
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object') return { ...obj };
  } catch {}
  // 宽松解析:Legado 生态常见 {'k':'v'} 单引号写法
  try {
    // eslint-disable-next-line no-new-func
    const obj = new Function(`return (${s})`)();
    if (obj && typeof obj === 'object') return { ...obj };
  } catch {}
  return {};
}

export function splitUrlOptions(urlStr: string): { url: string; options: FetchOptions } {
  // url,{"method":...} —— 找到第一处 ,{ 分隔
  const m = urlStr.match(/,\s*\{/);
  if (!m || m.index === undefined) return { url: urlStr.trim(), options: {} };
  const url = urlStr.slice(0, m.index).trim();
  const optStr = urlStr.slice(m.index + 1).trim();
  let options: FetchOptions = {};
  try {
    const obj = JSON.parse(optStr);
    if (obj && typeof obj === 'object') options = normalizeOptions(obj);
  } catch {
    try {
      const obj = new Function(`return (${optStr})`)();
      if (obj && typeof obj === 'object') options = normalizeOptions(obj);
    } catch {}
  }
  return { url, options };
}

function normalizeOptions(o: Record<string, unknown>): FetchOptions {
  const out: FetchOptions = {};
  if (typeof o.method === 'string') out.method = o.method.toUpperCase();
  if (typeof o.body === 'string' || typeof o.body === 'number') out.body = String(o.body);
  if (typeof o.charset === 'string') out.charset = o.charset;
  if (o.headers && typeof o.headers === 'object') out.headers = o.headers as Record<string, string>;
  if (typeof o.webView === 'boolean') out.webView = o.webView;
  return out;
}

/** 站点请求(自动合并书源 header / cookie / UA) */
export async function sourceFetch(
  sourceKey: string,
  rawUrl: string,
  extra: FetchOptions = {},
  sourceHeader?: string | Record<string, string>,
): Promise<{ body: string; finalUrl: string; buf: ArrayBuffer }> {
  const { url, options } = splitUrlOptions(rawUrl);
  const opts: FetchOptions = { ...options, ...extra };
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    ...parseHeaderField(sourceHeader),
    ...(opts.headers || {}),
  };
  const hasCookieHeader = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie');
  if (!hasCookieHeader) {
    const ck = cookieHeader(url);
    if (ck) headers['Cookie'] = ck;
  }
  const method = (opts.method || (opts.body ? 'POST' : 'GET')).toUpperCase();
  const init: RequestInit = { method, headers, redirect: 'follow' };
  if (opts.body && method !== 'GET') {
    const enc = encodeBody(opts.body, opts.charset);
    init.body = enc as unknown as BodyInit;
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e: any) {
    clearTimeout(timer);
    const msg = String(e?.message || e);
    // TLS 证书链问题:站点自签/证书链不完整,安卓 WebView 默认宽容,这里降级重试一次
    if (/certificate|TLS|SSL|ERR_/i.test(msg)) {
      try {
        res = await fetch(url, { ...init, tls: { rejectUnauthorized: false } } as any);
      } catch (e2: any) {
        throw new SourceFetchError(`网络请求失败: ${String(e2?.message || e2)}`, false);
      }
    } else {
      throw new SourceFetchError(
        e?.name === 'AbortError' ? `请求超时(${timeout}ms): ${url}` : `网络请求失败: ${msg}`,
        false,
      );
    }
  }
  clearTimeout(timer);

  if (opts.webView) {
    // 不做浏览器自动化:给出明确提示
    throw new SourceFetchError('该源需要 WebView 浏览器验证(人机验证/JS 挑战),当前环境不支持', true);
  }
  const buf = await res.arrayBuffer();
  mergeSetCookies(url, res);
  const body = decodeBody(buf, res.headers.get('content-type'), opts.charset);
  if (!res.ok && !body) {
    throw new SourceFetchError(`HTTP ${res.status}: ${url}`, false);
  }
  // Cloudflare / 人机验证页检测
  const head = body.slice(0, 3000);
  if (
    res.status === 403 ||
    res.status === 503 ||
    head.includes('Just a moment') ||
    head.includes('challenges.cloudflare.com') ||
    head.includes('__cf_chl_')
  ) {
    if (
      head.includes('Just a moment') ||
      head.includes('challenges.cloudflare.com') ||
      head.includes('__cf_chl_') ||
      /cf-browser-verification|cf_chl_prog/i.test(head)
    ) {
      throw new SourceFetchError('站点启用了 Cloudflare 人机验证,需要浏览器环境,当前不支持', true);
    }
    if (!res.ok) throw new SourceFetchError(`HTTP ${res.status}: ${url}`, false);
  }
  // JS 反爬跳转页(如 <title>Redirecting...</title> + 纯脚本)
  if (
    /<title>\s*Redirecting\.\.\.\s*<\/title>/i.test(head) &&
    body.replace(/\s/g, '').length < 6000 &&
    body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '').trim().length < 50
  ) {
    throw new SourceFetchError('站点使用了 JS 反爬跳转(需浏览器执行),当前不支持', true);
  }
  return { body, finalUrl: res.url || url, buf };
}

/**
 * 同步 HTTP —— 供 @js: 规则里的 java.ajax 使用。
 * JS 规则按同步语义编写(Rhino),而 Bun 无同步 fetch,故用子进程兜底。
 */
export function syncFetchText(
  url: string,
  opts: { headers?: Record<string, string>; method?: string; body?: string; timeout?: number } = {},
): string {
  const h = opts.headers || {};
  const method = (opts.method || 'GET').toUpperCase();
  const script = `
const r = await fetch(${JSON.stringify(url)}, {
  method: ${JSON.stringify(method)},
  headers: ${JSON.stringify(h)},
  body: ${JSON.stringify(opts.body ?? null)},
  redirect: 'follow',
  signal: AbortSignal.timeout(${opts.timeout ?? 20_000}),
});
const buf = await r.arrayBuffer();
const ct = r.headers.get('content-type') || '';
let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
const m = ct.match(/charset=["']?([\\w-]+)/i) || text.slice(0, 4096).match(/charset=["']?([\\w-]+)/i);
const cs = (m ? m[1] : 'utf-8').toLowerCase();
if (cs.startsWith('gb') || cs.startsWith('big5')) {
  const iconv = require('iconv-lite');
  text = iconv.decode(Buffer.from(buf), cs.startsWith('big5') ? 'big5' : 'gbk');
}
process.stdout.write(text);
`;
  const proc = Bun.spawnSync({
    cmd: [process.execPath, '-e', script],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: (opts.timeout ?? 20_000) + 5000,
  });
  if (proc.exitCode !== 0) {
    throw new Error(`syncFetch 失败(${proc.exitCode}): ${new TextDecoder().decode(proc.stderr).slice(0, 200)}`);
  }
  return new TextDecoder().decode(proc.stdout);
}