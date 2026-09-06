// ---------- 规则总调度:jsoup / css / xpath / jsonpath / 正则 / js ----------
import { load as cheerioLoad, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { JSONPath } from 'jsonpath-plus';
import { evalJsoupChain, splitTop } from './jsoupRule';
import { evalXPath, isXPathRule } from './xpathMini';
import { runJs, stripJsPrefix, createJavaApi, type JsHost } from './jsRuntime';

export interface RuleEnv {
  $: CheerioAPI;
  json?: unknown;
  rawText: string;
  baseUrl: string;
  sourceKey: string;
  sourceVariable: string;
  setSourceVariable: (v: string) => void;
  loginInfo: Record<string, string>;
  vars: Map<string, string>;
  book: Record<string, any>;
  messages: string[];
  urlVars?: Record<string, any>;
  /** 书源原始 JSON(供 js 中 source.loginUrl 等) */
  sourceRaw?: any;
}

export type RuleItem = { element: Element; json?: unknown } | { element?: Element; json: unknown };

// ---------- 主入口:求值单条规则(字段类) ----------
export function evalRule(env: RuleEnv, ruleStr: string | undefined, scope?: RuleItem): string[] {
  if (!ruleStr || !ruleStr.trim()) return [];
  let rule = ruleStr.trim();
  rule = substituteGet(env, rule);

  // @put:{k:rule} 提取
  const putM = rule.match(/@put:\{(.+?)\}\s*$/);
  if (putM) rule = rule.slice(0, rule.length - putM[0].length).trim();

  // ## 正则链切分
  const parts = splitTop(rule, '##');
  const rulePart = parts[0].trim();
  const regexParts = parts.slice(1);

  let values: string[] = [];
  try {
    values = evalRuleCore(env, rulePart, scope);
  } catch (e: any) {
    env.messages.push(String(e?.message || e));
    return [];
  }

  // @put 赋值
  if (putM) {
    for (const [, k, v] of putM[1].matchAll(/([A-Za-z0-9_]+):([^,{}]+)/g)) {
      const pv = evalRule({ ...env }, v.trim(), scope);
      env.vars.set(k, pv.join('\n'));
    }
  }

  // 正则替换链(支持多段: ##re1##rep1##re2##rep2)
  if (regexParts.length) {
    for (let ri = 0; ri < regexParts.length; ri += 2) {
      const re = replaceTemplates(env, regexParts[ri], {}, false);
      const rep = regexParts[ri + 1] !== undefined ? replaceTemplates(env, regexParts[ri + 1], {}, false) : '';
      try {
        const r = new RegExp(re, 'g');
        values = values.map((v) => v.replace(r, rep));
      } catch {
        env.messages.push(`正则无效: ${re}`);
      }
    }
  }
  return values.map((v) => v.trim()).filter((v) => v !== '');
}

/** 字段规则求值为单个字符串(多结果用 \n 连接) */
export function evalRuleText(env: RuleEnv, rule: string | undefined, scope?: RuleItem): string {
  return evalRule(env, rule, scope).join('\n').trim();
}

// ---------- bookList → 元素/JSON 项列表 ----------
export function evalRuleList(env: RuleEnv, ruleStr: string | undefined): RuleItem[] {
  if (!ruleStr || !ruleStr.trim()) return [];
  let rule = substituteGet(env, ruleStr.trim());

  const items: RuleItem[] = [];
  const push = (r: any) => {
    if (r == null) return;
    if (Array.isArray(r)) {
      for (const x of r) {
        if (x && (x as any).type === 'tag') items.push({ element: x as Element });
        else if (typeof x === 'object') items.push({ json: x });
        else if (x != null) items.push({ json: x });
      }
      return;
    }
    if (typeof r === 'string') {
      // 字符串 → 尝试 JSON → 否则按 HTML 解析为文档
      const j = tryParseJson(r);
      if (Array.isArray(j)) {
        for (const x of j) items.push({ json: x });
        return;
      }
      if (j && typeof j === 'object') {
        items.push({ json: j });
        return;
      }
      if (/<[a-z][\s\S]*>/i.test(r)) {
        const $ = cheerioLoad(r);
        const rootChildren = ($.root().children().toArray() ?? []) as unknown as Element[];
        if (rootChildren.length) for (const e of rootChildren) items.push({ element: e });
        else items.push({ element: ($.root().toArray()[0] as unknown as Element) });
        return;
      }
      items.push({ json: r });
      return;
    }
    if (typeof r === 'object' && (r as any).type === 'tag') items.push({ element: r as Element });
  };

  // <js> 前缀块
  const { code, rest } = stripJsPrefix(rule);
  if (code) {
    const jsResult = runJs(code, makeHost(env, undefined));
    if (rest.trim()) {
      // js 结果为元素数组时直接作为 items;否则转入新内容环境继续求值
      if (Array.isArray(jsResult) && jsResult.length && (jsResult[0] as any)?.type === 'tag') {
        return (jsResult as Element[]).map((e) => ({ element: e }));
      }
      const subEnv = contentEnv(env, jsResult);
      return evalRuleList(subEnv, rest);
    }
    push(jsResult);
    return items;
  }

  const parts = splitTop(rule, '||');
  for (const alt of parts) {
    const trimmed = alt.trim();
    if (!trimmed) continue;
    try {
      const r = evalListCore(env, trimmed);
      if (r && (Array.isArray(r) ? r.length : true)) {
        push(r);
        if (items.length) return items;
      }
    } catch (e: any) {
      env.messages.push(String(e?.message || e));
    }
  }
  return items;
}

function evalListCore(env: RuleEnv, rule: string): any {
  const roots = ((env as any).__elements as Element[] | undefined) ?? docRootElements(env.$);
  if (rule.startsWith(':')) {
    const r = new RegExp(rule.slice(1), 'g');
    return env.rawText.match(r) ?? [];
  }
  if (isXPathRule(rule)) {
    return evalXPath(env.$, rule, roots);
  }
  if (rule.startsWith('$')) {
    const json = env.json ?? tryParseJson(env.rawText);
    if (json === undefined) return [];
    let r = JSONPath({ path: rule, json, wrap: true }) as any[];
    // Legado 语义:匹配值本身是数组时直接展开为列表(如 bookList $.data)
    if (Array.isArray(r) && r.length === 1 && Array.isArray(r[0])) r = r[0];
    return r;
  }
  // jsoup 默认
  const res = evalJsoupChain(env.$, rule, docRootElements(env.$));
  return res.elements;
}

function evalRuleCore(env: RuleEnv, rule: string, scope?: RuleItem): string[] {
  if (rule.startsWith('@js:')) {
    const jsResult = runJs(rule.slice(4), makeHost(env, scope));
    return jsResultToStrings(jsResult);
  }
  // @js: 后缀:先求前段,再执行 js(result = 前段结果)
  const jsSuffix = rule.match(/@js:([\s\S]*)$/);
  if (jsSuffix) {
    const base = rule.slice(0, jsSuffix.index).trim();
    const baseVals = base ? evalRuleCore(env, base, scope) : [env.rawText];
    const jsResult = runJs(jsSuffix[1], makeHost(env, scope, baseVals.join('\n')));
    return jsResultToStrings(jsResult);
  }
  const { code, rest } = stripJsPrefix(rule);
  if (code) {
    const jsResult = runJs(code, makeHost(env, scope));
    if (!rest.trim()) return jsResultToStrings(jsResult);
    const subEnv = contentEnv(env, jsResult);
    return evalRuleText(subEnv, rest).split('\n').filter(Boolean);
  }

  if (rule.startsWith(':')) {
    const r = new RegExp(rule.slice(1), 'g');
    return (env.rawText.match(r) ?? []).map((s) => s);
  }

  const roots = scope?.element ? [scope.element] : ((env as any).__elements as Element[] | undefined) ?? docRootElements(env.$);

  // {{...}} 模板规则(如 bookUrl: /api/book/{{$.book_id}})按作用域 JSON 求值
  if (rule.includes('{{')) {
    const subEnv: RuleEnv = scope?.json !== undefined ? { ...env, json: scope.json } : env;
    const v = replaceTemplates(subEnv, rule, {}, false);
    return v ? [v] : [];
  }

  // 纯中文字面量(如 kind: "禁忌书屋")→ 直接返回字面量
  if (/[\u4e00-\u9fff]/.test(rule) && !/[@.\[#\s\/]/.test(rule)) {
    return [rule];
  }
  const jsonScope = scope ? (scope.json !== undefined ? scope.json : env.json) : env.json;

  if (isXPathRule(rule)) {
    const rs = evalXPath(env.$, rule, scope?.element ? [scope.element] : docRootElements(env.$));
    return Array.isArray(rs) && typeof rs[0] === 'string' ? (rs as string[]) : (rs as Element[]).map((e) => textOfElement(env.$, e));
  }
  if (rule.startsWith('$')) {
    const json = scope?.json !== undefined ? scope.json : jsonScopeOrParse(env);
    if (json === undefined) return [];
    const r = JSONPath({ path: rule, json, wrap: false });
    if (r == null) return [];
    return Array.isArray(r) ? r.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))) : [String(r)];
  }

  // jsoup 默认;json 项作用域时把对象序列化后仍可用 {{}} 模板,但选择器无意义 → 返回空
  if (scope && scope.json !== undefined && scope.element === undefined) {
    return [];
  }
  const res = evalJsoupChain(env.$, rule, roots);
  if (res.isElementResult) {
    // 无 getter:取文本作为字段值(用于字段类规则)
    return res.elements.map((e) => textOfElement(env.$, e)).filter((s) => s.trim() !== '');
  }
  return res.values;
}

// ---------- URL 构建 ----------
export function buildUrlParts(
  env: RuleEnv,
  urlRule: string | undefined,
  urlVars: Record<string, any> = {},
): { url: string; options: Record<string, any> } {
  if (!urlRule || !urlRule.trim()) return { url: '', options: {} };
  let raw = urlRule.trim();
  raw = substituteGet(env, raw);
  raw = replaceTemplates(env, raw, urlVars, false);

  const { code, rest } = stripJsPrefix(raw);
  let base = '';
  if (code) {
    const jsResult = runJs(code, makeHost(env, undefined));
    if (typeof jsResult === 'string' && jsResult.trim()) base = jsResult.trim();
    else base = rest.trim();
  } else {
    base = rest.trim();
  }
  if (!base) return { url: '', options: {} };

  const { url: u0, options } = splitUrlOptionsLoose(base);
  let url = replaceTemplates(env, u0, urlVars, true);
  if (options.body) options.body = replaceTemplates(env, String(options.body), urlVars, false);

  // GET + GBK/Latin1 charset:key 需按目标编码百分号(而非 UTF-8)
  const cs = String(options.charset || '');
  if (cs && /gb|big5/i.test(cs) && !(options.method || '').toUpperCase().startsWith('POST') && urlVars.key) {
    url = reencodeKeyPercent(url, String(urlVars.key), cs);
  }

  // 相对地址 → 绝对
  if (!/^https?:\/\//i.test(url)) {
    if (url.startsWith('//')) url = 'https:' + url;
    else if (url.startsWith('/')) url = env.sourceKey.replace(/\/$/, '') + url;
    else url = resolveRelative(env.baseUrl, url);
  }
  return { url, options };
}

export function extractUrlOptions(url: string): { url: string; options: Record<string, any> } {
  return splitUrlOptionsLoose(url);
}

// ---------- 工具 ----------
import { splitUrlOptions } from '../http';

function splitUrlOptionsLoose(urlStr: string): { url: string; options: Record<string, any> } {
  try {
    const r = splitUrlOptions(urlStr);
    return { url: r.url, options: r.options as Record<string, any> };
  } catch {
    return { url: urlStr, options: {} };
  }
}

function substituteGet(env: RuleEnv, s: string): string {
  return s.replace(/@get:\{([^}]+)\}/g, (_, k) => env.vars.get(k.trim()) ?? '');
}

/** {{key}}/{{page}}/{{$.jsonpath}}/{{book.x}}/{{js 表达式}} */
export function replaceTemplates(
  env: RuleEnv,
  s: string,
  urlVars: Record<string, any>,
  encodeKey: boolean,
): string {
  return s.replace(/\{\{([\s\S]*?)\}\}/g, (_, inner) => {
    const t = String(inner).trim();
    if (t.startsWith('$')) {
      const json = env.json ?? tryParseJson(env.rawText);
      if (json === undefined) return '';
      try {
        const r = JSONPath({ path: t, json, wrap: false });
        if (r == null) return '';
        return Array.isArray(r) ? r.join(',') : String(r);
      } catch {
        return '';
      }
    }
    const bookM = t.match(/^book\.(\w+)$/);
    if (bookM) {
      const v = env.book?.[bookM[1]];
      return v == null ? '' : String(v);
    }
    if (t.startsWith('source.')) return env.sourceKey;
    if (urlVars && t in urlVars) {
      const v = String(urlVars[t]);
      return encodeKey && (t === 'key' || t === 'searchKey') ? encodeURIComponent(v) : v;
    }
    // JS 表达式或多语句
    const javaApi = createJavaApi(makeHost(env, undefined) as any);
    try {
      const fn = new Function('key', 'page', 'searchKey', 'java', 'book', 'baseUrl', 'source', `return (${t});`);
      const r = fn(
        urlVars.key ?? '', urlVars.page ?? 1, urlVars.key ?? '',
        javaApi, env.book, env.baseUrl,
        { getKey: () => env.sourceKey, getVariable: () => env.sourceVariable },
      );
      return r == null ? '' : String(r);
    } catch {
      try {
        const fn2 = new Function(
          'key', 'page', 'searchKey', 'java', 'book', 'baseUrl', 'source',
          `return eval(${JSON.stringify(t)});`,
        );
        const r2 = fn2(
          urlVars.key ?? '', urlVars.page ?? 1, urlVars.key ?? '',
          javaApi, env.book, env.baseUrl,
          { getKey: () => env.sourceKey, getVariable: () => env.sourceVariable },
        );
        return r2 == null ? '' : String(r2);
      } catch {
        return '';
      }
    }
  });
}

export function makeHost(env: RuleEnv, scope?: RuleItem, resultOverride?: string): JsHost {
  let rawText = env.rawText;
  if (scope?.element) {
    rawText = env.$.html(scope.element as never) ?? rawText;
  }
  if (resultOverride !== undefined) rawText = resultOverride;
  return {
    $: scope?.element ? cheerioLoad(rawText) : env.$,
    json: scope?.json !== undefined ? scope.json : env.json,
    rawText,
    baseUrl: env.baseUrl,
    sourceKey: env.sourceKey,
    sourceVariable: env.sourceVariable,
    setSourceVariable: env.setSourceVariable,
    loginInfo: env.loginInfo,
    vars: env.vars,
    book: env.book,
    messages: env.messages,
    sourceRaw: (env as any).sourceRaw,
  };
}

/** js 结果 → 新的内容环境 */
function contentEnv(env: RuleEnv, jsResult: any): RuleEnv {
  const next: RuleEnv = { ...env, messages: env.messages };
  if (jsResult == null) return next;
  if (Array.isArray(jsResult)) {
    const first = jsResult[0];
    if (first && (first as any).type === 'tag') {
      next.$ = env.$; // 元素数组:仍用原文档(子规则按元素选择)
      (next as any).__elements = jsResult;
      return next;
    }
    if (typeof first === 'string') {
      next.rawText = (jsResult as string[]).join('\n');
      next.json = tryParseJson(next.rawText);
      if (/<[a-z][\s\S]*>/i.test(next.rawText)) next.$ = cheerioLoad(next.rawText);
      return next;
    }
    if (typeof first === 'object') {
      next.json = jsResult;
      next.rawText = JSON.stringify(jsResult);
      return next;
    }
  }
  if (typeof jsResult === 'string') {
    next.rawText = jsResult;
    next.json = tryParseJson(jsResult);
    if (/<[a-z][\s\S]*>/i.test(jsResult)) next.$ = cheerioLoad(jsResult);
    return next;
  }
  if (typeof jsResult === 'object') {
    next.json = jsResult;
    next.rawText = JSON.stringify(jsResult);
    return next;
  }
  return next;
}

function jsResultToStrings(jsResult: any): string[] {
  if (jsResult == null) return [];
  if (Array.isArray(jsResult)) {
    return jsResult.map((x) => {
      if (x && (x as any).type === 'tag') return ''; // 元素不给字段值
      if (typeof x === 'object') return JSON.stringify(x);
      return String(x);
    }).filter((s) => s.trim() !== '' && !s.startsWith('[object'));
  }
  if (typeof jsResult === 'object') return [JSON.stringify(jsResult)];
  return [String(jsResult)].filter((s) => s.trim() !== '');
}

function docRootElements($: CheerioAPI): Element[] {
  return ($.root().toArray() ?? []) as unknown as Element[];
}

function textOfElement($: CheerioAPI, e: Element): string {
  return ($(e as never).text() ?? '').trim();
}

function tryParseJson(s: string): unknown {
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function jsonScopeOrParse(env: RuleEnv): unknown {
  return env.json ?? tryParseJson(env.rawText);
}

function resolveRelative(base: string, rel: string): string {
  try {
    return new URL(rel, base).toString();
  } catch {
    return rel;
  }
}

/** 把 URL 中已按 UTF-8 百分号编码的 key 重编码为指定字符集 */
function reencodeKeyPercent(url: string, key: string, charset: string): string {
  try {
    const utf8Percent = encodeURIComponent(key);
    if (!utf8Percent || !url.includes(utf8Percent)) return url;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const iconv = require('iconv-lite');
    const cs = /big5/i.test(charset) ? 'big5' : 'gbk';
    const buf = iconv.encode(key, cs);
    const targetPercent = Array.from(buf as any)
      .map((b: any) => '%' + Number(b).toString(16).toUpperCase().padStart(2, '0'))
      .join('');
    return url.split(utf8Percent).join(targetPercent);
  } catch {
    return url;
  }
}

export { splitTop };