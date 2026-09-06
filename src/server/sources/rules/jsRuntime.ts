// ---------- @js: 规则运行时(java.* / cookie / source / book 桥接) ----------
import { createDecipheriv, createHash } from 'node:crypto';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { syncFetchText, loadCookies, saveCookies, removeCookies, setCookie, SourceFetchError } from '../http';
import { evalJsoupChain } from './jsoupRule';

export interface JsHost {
  $: CheerioAPI;
  /** 当前 json(若响应为 JSON) */
  json?: unknown;
  /** 原始响应文本 */
  rawText: string;
  baseUrl: string;
  sourceKey: string;
  sourceVariable: string;
  setSourceVariable: (v: string) => void;
  loginInfo: Record<string, string>;
  vars: Map<string, string>;
  book: Record<string, any>;
  messages: string[];
  /** 书源原始 JSON(loginUrl/bookSourceComment 等供 eval 使用) */
  sourceRaw?: any;
}

export type JsJava = Record<string, any>;

/** 构建 java.* API(供 runJs 与 URL 模板表达式共用) */
export function createJavaApi(host: JsHost): JsJava {
  const content = { text: host.rawText, json: host.json };

  const httpGet = (url: string, headers?: Record<string, string>) =>
    strResponse(syncFetchText(String(url), { headers }));
  const httpPost = (url: string, body?: string, headers?: Record<string, string>) =>
    strResponse(
      syncFetchText(String(url), {
        method: 'POST',
        body: typeof body === 'string' ? body : undefined,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(headers || {}),
        },
      }),
    );

  return {
    ajax: (url: string) => syncFetchText(String(url)),
    /** 双语义:get(url, headers?) → HTTP GET;get(key) → 变量 */
    get: (...args: any[]) => {
      if (typeof args[0] === 'string' && (args.length > 1 || looksLikeUrl(args[0]))) {
        return httpGet(args[0], args[1]);
      }
      return host.vars.get(String(args[0])) ?? '';
    },
    post: (url: string, body?: string, headers?: Record<string, string>) => httpPost(url, body, headers),
    put: (k: string, v: any) => {
      host.vars.set(String(k), String(v));
      return '';
    },
    getString: (rule: string, x?: any) => {
      // 简化:支持 $.jsonpath / @get:{} / 普通字符串
      if (typeof rule !== 'string') return String(rule);
      if (rule.startsWith('$.') || rule.startsWith('$[')) {
        return jsonStringPath(content.json ?? tryParse(content.text), rule);
      }
      const gm = rule.match(/^@get:\{(.+?)\}$/);
      if (gm) return host.vars.get(gm[1]) ?? '';
      return rule;
    },
    getElement: (path: string) => {
      // 对当前 HTML 文档执行 jsoup 默认规则,返回元素数组(setContent 后用新文档)
      const doc = loadedDoc ?? host.$;
      return evalJsoupChain(doc, path, collectAll(doc)) as any;
    },
    setContent: (html: string) => {
      content.text = String(html);
      content.json = tryParse(content.text);
      loadedDoc = require_cheerio_load(content.text);
    },
    getContent: () => content.text,
    base64Encode: (s: string) => Buffer.from(String(s), 'utf-8').toString('base64'),
    base64Decode: (s: string) => Buffer.from(String(s), 'base64').toString('latin1'),
    base64DecodeToString: (s: string) => Buffer.from(String(s), 'base64').toString('utf-8'),
    hexDecodeToString: (s: string) => Buffer.from(String(s).replace(/[^0-9a-fA-F]/g, ''), 'hex').toString('utf-8'),
    hexDecodeToBytes: (s: string) => Buffer.from(String(s), 'hex').toString('latin1'),
    timeFormat: (ms: any, fmt = 'yyyy-MM-dd HH:mm') => fmtTime(Number(ms), fmt, 8),
    timeFormatUTC: (ms: any, fmt = 'yyyy-MM-dd HH:mm', zone = 8) => fmtTime(Number(ms), fmt, zone),
    encodeURI: (s: string, enc?: string) => {
      if (enc && /gb/i.test(enc)) {
        const iconv = require('iconv-lite');
        const buf = iconv.encode(String(s), 'gbk');
        return Array.from(buf as any).map((b: any) => '%' + Number(b).toString(16).toUpperCase().padStart(2, '0')).join('');
      }
      return encodeURIComponent(String(s));
    },
    decodeURI: (s: string) => decodeURIComponent(String(s)),
    t2s: (s: any) => s, // 繁→简:未内置字表,原样返回
    s2t: (s: any) => s,
    md5Encode: (s: string) => createHash('md5').update(String(s)).digest('hex'),
    log: (...a: any[]) => console.log('[booksource-js]', ...a),
    toast: (m: any) => host.messages.push(String(m)),
    longToast: (m: any) => host.messages.push(String(m)),
    startBrowserAwait: (url: string, title: string) => {
      host.messages.push(`需要浏览器完成验证:${title || ''} ${url || ''}`);
      throw new SourceFetchError(`该源需要浏览器完成验证(${title || '验证'}),当前环境不支持`, true);
    },
    getVerificationCode: () => {
      throw new SourceFetchError('该源需要人工输入验证码,当前环境不支持', true);
    },
    aesBase64DecodeToString: (data: string, key: string, transformation: string, iv: string) =>
      decryptStr(String(data), key, transformation, iv, 'base64'),
    aesBase64DecodeToByteArray: (data: string, key: string, transformation: string, iv: string) =>
      decryptStr(String(data), key, transformation, iv, 'base64'),
    desBase64DecodeToString: (data: string, key: string, transformation: string, iv: string) =>
      decryptStr(String(data), key, transformation, iv, 'base64'),
    localDb: { get: () => '', put: () => '', delete: () => '' },
    cacheFile: { get: () => '', put: () => '', delete: () => '' },
    cacheDb: { get: () => '', put: () => '', delete: () => '' },
    getFile: (_path: string) => '',
    readFile: (_path: string) => '',
    uid: () => '0',
    androidId: () => '',
    getHost: (url: string) => {
      try {
        return new URL(String(url)).host;
      } catch {
        return '';
      }
    },
  };
}

export function runJs(code: string, host: JsHost): any {
  const java = createJavaApi(host);

  const cookie = {
    getCookie: (url?: string) => cookieStringFor(host.sourceKey, url || host.baseUrl),
    setCookie: (url: string, cookieStr: string) => {
      for (const pair of String(cookieStr).split(';')) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        setCookie(host.sourceKey, pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      saveCookies(host.sourceKey);
      return '';
    },
    removeCookie: (url?: string) => {
      removeCookies(host.sourceKey);
      return '';
    },
    getKey: () => host.sourceKey,
  };

  const source = {
    bookSourceUrl: host.sourceKey,
    getKey: () => host.sourceKey,
    getVariable: () => host.sourceVariable,
    setVariable: (v: string) => {
      host.setSourceVariable(String(v ?? ''));
      return '';
    },
    getLoginInfoMap: () => ({ ...host.loginInfo }),
    getLoginInfo: (k: string) => host.loginInfo[k] ?? '',
    getHeader: () => ({}),
    // 供 eval(String(source.loginUrl)) / eval(String(source.bookSourceComment)) 使用
    loginUrl: host.sourceRaw?.loginUrl ?? '',
    bookSourceComment: host.sourceRaw?.bookSourceComment ?? '',
    variableComment: host.sourceRaw?.variableComment ?? '',
    comment: host.sourceRaw?.bookSourceComment ?? '',
    enabled: true,
  };

  const book = new Proxy(host.book, {
    get(t, p: string) {
      if (p === 'variable') return t['variable'] ?? '';
      if (p === 'getVariable') {
        return (name?: string) => (name === 'custom' ? t['variable'] ?? '' : t['variable_' + name] ?? '');
      }
      if (p === 'setVariable') {
        return (name: string, value: any) => {
          if (name === 'custom') t['variable'] = String(value ?? '');
          else t['variable_' + name] = String(value ?? '');
          return '';
        };
      }
      return t[p];
    },
  });

  const fn = new Function(
    'result', 'baseUrl', 'book', 'source', 'java', 'cookie', 'cookieJar', 'org',
    `return eval(${JSON.stringify(code)});\n`,
  );
  try {
    // Java 风格 String.replaceAll/replaceFirst(仅在本同步调用期间生效)
    const restore = patchJavaStringMethods();
    try {
      return fn(
        host.rawText ?? '', host.baseUrl, book, source, java, cookie, cookie,
        createJsoupShim(host.$),
      );
    } finally {
      restore();
    }
  } catch (e: any) {
    if (e instanceof SourceFetchError) throw e;
    throw new Error(`@js 规则执行失败: ${e?.message || e}`);
  }
}

/** Java 正则风格 replaceAll/replaceFirst:模式按正则处理,支持 (?i) 内联标志与 $1 分组 */
function javaRegexToJs(pattern: string): RegExp {
  let flags = 'g';
  let p = pattern;
  const flagMatch = p.match(/^\(\?([a-z]+)\)/i);
  if (flagMatch) {
    if (/i/.test(flagMatch[1])) flags += 'i';
    if (/m/.test(flagMatch[1])) flags += 'm';
    if (/s/.test(flagMatch[1])) flags += 's';
    p = p.slice(flagMatch[0].length);
  }
  return new RegExp(p, flags);
}

let patchedJavaString = false;
function patchJavaStringMethods(): () => void {
  if (patchedJavaString) return () => {};
  patchedJavaString = true;
  const origReplaceAll = String.prototype.replaceAll;
  const origReplace = String.prototype.replace;
  (String.prototype as any).replaceAll = function (pattern: any, replacement: any) {
    if (typeof pattern === 'string' && !pattern.startsWith('\\b') && /[\\^$\[\]|(){}?*+]|\(\?/.test(pattern)) {
      // Java 语义:模式按正则处理(与 Rhino 一致)
      try {
        return origReplace.call(this, javaRegexToJs(pattern), replacement);
      } catch {
        /* fallthrough */
      }
    }
    return origReplaceAll.apply(this, [pattern, replacement] as any);
  };
  (String.prototype as any).replaceFirst = function (pattern: any, replacement: any) {
    try {
      const re = javaRegexToJs(typeof pattern === 'string' ? pattern : String(pattern));
      const once = new RegExp(re.source, re.flags.replace('g', ''));
      return origReplace.call(this, once, replacement);
    } catch {
      return origReplace.call(this, pattern, replacement);
    }
  };
  return () => {
    String.prototype.replaceAll = origReplaceAll;
    String.prototype.replace = origReplace;
    (String.prototype as any).replaceFirst = undefined;
    patchedJavaString = false;
  };
}

// ---------- org.jsoup.Jsoup 垫片(基于 cheerio 的常用子集) ----------
function createJsoupShim(_$: CheerioAPI): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const load = require('cheerio').load as (h: string) => CheerioAPI;

  function wrapElement(el: any): any {
    const $e = _$(el as never);
    return {
      raw: el,
      html: () => $e.html() ?? '',
      outerHtml: () => _$.html(el as never) ?? '',
      text: () => $e.text() ?? '',
      attr: (name: string, value?: string) => (value !== undefined ? $e.attr(name, value) : $e.attr(name) ?? ''),
      select: (css: string) => wrapCollection($e.find(css)),
      tagName: () => (el as any).tagName ?? '',
      ownText: () => ($e.contents().filter((_i, n) => (n as any).type === 'text').text() ?? '').trim(),
      toString: () => _$.html(el as never) ?? '',
    };
  }

  function wrapCollection(sel: any): any {
    const arr: any[] = typeof sel.toArray === 'function' ? (sel.toArray() as any[]) : [...sel];
    const api: any = {
      isEmpty: () => arr.length === 0,
      size: () => arr.length,
      length: arr.length,
      first: () => (arr.length ? wrapElement(arr[0]) : null),
      last: () => (arr.length ? wrapElement(arr[arr.length - 1]) : null),
      get: (i: number) => wrapElement(arr[i]),
      text: () => arr.map((e) => _$(e as never).text() ?? '').join('\n'),
      html: () => arr.map((e) => _$(e as never).html() ?? '').join('\n'),
      attr: (name: string) => (arr[0] ? (_$(arr[0] as never).attr(name) ?? '') : ''),
      select: (css: string) => {
        const out: any[] = [];
        for (const e of arr) {
          try {
            for (const c of _$(css, e as never).toArray()) out.push(c);
          } catch {}
        }
        return wrapCollection(out as any);
      },
      each: (fn: (i: number, el: any) => void) => {
        arr.forEach((e, i) => fn(i, wrapElement(e)));
        return api;
      },
      toString: () => arr.map((e) => _$.html(e as never) ?? '').join(''),
    };
    return api;
  }

  return {
    jsoup: {
      Jsoup: {
        parse: (html: string) => {
          const $doc = load(String(html ?? ''));
          return wrapCollection($doc.root().children().toArray() as any);
        },
        parseBodyFragment: (html: string) => {
          const $doc = load(String(html ?? ''));
          return wrapCollection($doc.root().children().toArray() as any);
        },
      },
    },
  };
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//.test(String(s)) || String(s).startsWith('/');
}

function strResponse(text: string) {
  return {
    body: () => text,
    string: () => text,
    bytes: () => Buffer.from(text),
    code: () => 200,
    header: (_n: string) => '',
    headers: () => ({}),
    url: () => '',
  };
}

function cookieStringFor(sourceKey: string, url?: string): string {
  const jar = loadCookies(sourceKey);
  if (!url) return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  return Object.entries(jar)
    .filter(([k]) => !k.startsWith('@') && k !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// —— 提取 <js>...</js> 代码块 ——
export function extractJsBlocks(rule: string): { code: string | null; rest: string } {
  const m = rule.match(/^<js>([\s\S]*?)<\/js>/);
  if (!m) return { code: null, rest: rule };
  return { code: m[1], rest: rule.slice(m[0].length) };
}

export function stripJsPrefix(rule: string): { code: string | null; rest: string } {
  let r = rule.trim();
  if (r.startsWith('@js:')) {
    // @js: 后整段是代码(Legado 允许多行)
    return { code: r.slice(4), rest: '' };
  }
  return extractJsBlocks(r);
}

// ---------- 工具 ----------
let loadedDoc: CheerioAPI | null = null;
function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function jsonStringPath(json: unknown, path: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSONPath } = require('jsonpath-plus');
    const r = JSONPath({ path, json, wrap: false });
    if (r == null) return '';
    return Array.isArray(r) ? r.join('\n') : String(r);
  } catch {
    return '';
  }
}

function fmtTime(ms: number, fmt: string, zoneHours: number): string {
  const d = new Date(ms + zoneHours * 3600_000);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return fmt
    .replace(/yyyy/g, String(d.getUTCFullYear()))
    .replace(/MM/g, pad(d.getUTCMonth() + 1))
    .replace(/dd/g, pad(d.getUTCDate()))
    .replace(/HH/g, pad(d.getUTCHours()))
    .replace(/mm/g, pad(d.getUTCMinutes()))
    .replace(/ss/g, pad(d.getUTCSeconds()));
}

function decryptStr(data: string, key: string, transformation: string, iv: string, enc: 'base64'): string {
  const parts = String(transformation || '').split('/');
  const alg = parts[0]?.toUpperCase() || 'AES';
  const mode = (parts[1] || 'CBC').toUpperCase();
  const opensslAlg = `${alg === 'DES' ? 'des' : alg === 'AES' ? 'aes-128' : alg.toLowerCase()}-${mode.toLowerCase()}`;
  const keyBuf = Buffer.from(key, 'utf-8');
  const finalKey = alg === 'DES' ? keyBuf.subarray(0, 8) : keyBuf;
  const ivBuf = iv ? Buffer.from(iv, 'utf-8') : Buffer.alloc(0);
  const decipher = createDecipheriv(opensslAlg, finalKey, ivBuf.length ? ivBuf : undefined as never);
  decipher.setAutoPadding(true);
  const out = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return out.toString('utf-8');
}

let _cheerioLoad: ((html: string) => CheerioAPI) | null = null;
function require_cheerio_load(html: string): CheerioAPI {
  if (!_cheerioLoad) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _cheerioLoad = require('cheerio').load;
  }
  return _cheerioLoad!(html);
}

function collectAll($: CheerioAPI): Element[] {
  return $.root().toArray() as unknown as Element[];
}