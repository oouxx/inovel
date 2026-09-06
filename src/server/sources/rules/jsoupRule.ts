// ---------- Legado「jsoup 默认」规则求值器 ----------
// 语法(class.name.0@tag.a.0@text / #id / .class / tag.a[-1:0] / textNodes / 属性名 等)
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

interface Token {
  kind: 'class' | 'id' | 'tag' | 'children' | 'text' | 'self';
  name: string;
  /** 排除的下标或范围 */
  exclude?: number[];
  index?: number;
  range?: [number, number];
  /** [-1:0] → 反转全部 */
  reverse?: boolean;
}

const GETTERS = new Set(['text', 'textNodes', 'html', 'ownText', 'all', 'children', 'content', 'json', 'allText']);

export interface JsoupResult {
  elements: Element[];
  values: string[];
  isElementResult: boolean;
}

/** 求值一条 jsoup 默认规则。roots 为初始作用域。 */
export function evalJsoupChain($: CheerioAPI, rule: string, roots: Element[]): JsoupResult {
  // 规则级 `-` 前缀 = 反转结果列表
  let reverseAll = false;
  let trimmedRule = rule.trim();
  if (trimmedRule.startsWith('-') && /^-[a-zA-Z]/.test(trimmedRule)) {
    reverseAll = true;
    trimmedRule = trimmedRule.slice(1);
  }
  // || 兜底(顶层切分,尊重 [] 引号)
  const alts = splitTop(trimmedRule, '||');
  let lastErr: unknown = null;
  for (const alt of alts) {
    try {
      const r = evalJsoupSingle($, alt.trim(), roots);
      if (r.values.length || r.elements.length) {
        return reverseAll ? reverseResult(r) : r;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (alts.length > 1 && lastErr) throw lastErr;
  return { elements: [], values: [], isElementResult: false };
}

function reverseResult(r: JsoupResult): JsoupResult {
  if (r.isElementResult) return { ...r, elements: r.elements.slice().reverse() };
  return { ...r, values: r.values.slice().reverse() };
}

function evalJsoupSingle($: CheerioAPI, rule: string, roots: Element[]): JsoupResult {
  // && 拼接(顶层)
  const parts = splitTop(rule, '&&');
  if (parts.length > 1) {
    const out = parts.map((p) => evalJsoupSingle($, p.trim(), roots));
    const isEl = out.every((o) => o.isElementResult);
    if (isEl) return { elements: out.flatMap((o) => o.elements), values: [], isElementResult: true };
    return { elements: [], values: out.flatMap((o) => (o.isElementResult ? o.elements.map((e) => textOf($, e)) : o.values)), isElementResult: false };
  }

  let chain = rule.trim();
  if (!chain) return { elements: roots, values: roots.map((e) => textOf($, e)), isElementResult: false };

  // @css: 前缀 → 直接 CSS 选择器
  let cssPrefix = false;
  if (chain.startsWith('@css:')) {
    cssPrefix = true;
    chain = chain.slice(5).trim();
  }

  // 顶层按 @ 切链(尊重 [] 引号)
  const steps = splitTop(chain, '@').map((s) => s.trim()).filter(Boolean);
  if (!steps.length) return { elements: roots, values: [], isElementResult: false };

  let scope = roots;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isLast = i === steps.length - 1;

    if (i === 0 && cssPrefix) {
      // css: 整段是选择器,后续 step 为 getter;作用域为元素时限定在元素内
      const selected = scopeIsDoc(scope)
        ? (($(steps[0]).toArray() ?? []) as unknown as Element[])
        : (scope.flatMap((e) => ($(steps[0], e as never).toArray() ?? [])) as unknown as Element[]);
      if (isLast) return { elements: selected, values: [], isElementResult: true };
      scope = selected;
      continue;
    }

    // @js: 后缀由上层 analyzeRule 处理,这里提前结束
    if (step.startsWith('js:')) {
      break;
    }

    // getter?
    if (isLast && isGetter(step)) {
      return finalize($, scope, step);
    }
    // @ 链末段:属性名(href/src/data-xxx/content...)或裸标签,Legado 语义优先按属性处理
    if (isLast && looksLikeAttr(step)) {
      return finalize($, scope, step);
    }

    // 选择器 token(可能带空格 → 后代;含 > 或 Legado token 解析失败时按 CSS 处理)
    const subTokens = step.split(/\s+/).filter(Boolean);
    let current = scope;
    let isFirst = true;
    if (step.includes('>')) {
      current = cssSelectScoped($, step, scope);
      isFirst = false;
    } else {
      for (const st of subTokens) {
        const tok = parseToken(st);
        if (!tok) {
          if (isFirst && isLast) {
            // 整段可能是属性名
            return finalize($, scope, step);
          }
          continue;
        }
        current = applyToken($, tok, current, isFirst);
        isFirst = false;
      }
      // Legado token 解析后为空 → 回退为整段 CSS 选择器(如 .l-m1 a 相对自身命中)
      if (!current.length && subTokens.length) {
        const cssRes = cssSelectScoped($, step, scope);
        if (cssRes.length) current = cssRes;
      }
    }
    scope = current;
    if (!scope.length && !isLast) {
      return { elements: [], values: [], isElementResult: false };
    }
  }

  return { elements: scope, values: [], isElementResult: true };
}

function cssSelectScoped($: CheerioAPI, css: string, scope: Element[]): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  if (scopeIsDoc(scope)) {
    try {
      for (const c of $(css).toArray() as unknown as Element[]) {
        if (!seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
    } catch {}
    return out;
  }
  for (const e of scope) {
    try {
      for (const c of $(css, e as never).toArray() as unknown as Element[]) {
        if (!seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
    } catch {}
  }
  return out;
}

function finalize($: CheerioAPI, elements: Element[], getter: string): JsoupResult {
  const values: string[] = [];
  switch (getter) {
    case 'text':
      for (const e of elements) values.push(textOf($, e));
      break;
    case 'textNodes': {
      for (const e of elements) {
        const nodes: string[] = [];
        collectTextNodes(e, nodes);
        values.push(nodes.join('\n').trim());
      }
      break;
    }
    case 'ownText': {
      for (const e of elements) {
        values.push((e.children || [])
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.data)
          .join('')
          .trim());
      }
      break;
    }
    case 'html':
      for (const e of elements) values.push($(e as never).html() ?? '');
      break;
    case 'all':
      for (const e of elements) values.push($.html(e as never) ?? '');
      break;
    case 'children': {
      const els = elements.flatMap((e) => elementChildren(e));
      return { elements: els, values: [], isElementResult: true };
    }
    case 'json':
      for (const e of elements) values.push(textOf($, e));
      break;
    default: {
      // 属性 getter;元素没有该属性时退化为文本
      const hasAttr = elements.length > 0 && elements.every((e) => e.attribs && e.attribs[getter] !== undefined);
      if (hasAttr) for (const e of elements) values.push(e.attribs[getter] ?? '');
      else for (const e of elements) values.push(textOf($, e));
    }
  }
  return { elements, values: values.filter((v) => v !== ''), isElementResult: false };
}

function elementChildren(e: Element): Element[] {
  return (e.children || []).filter((c): c is Element => c.type === 'tag');
}

function textOf($: CheerioAPI, e: Element): string {
  return ($(e as never).text() ?? '').trim();
}

function collectTextNodes(e: Element, out: string[]) {
  for (const c of e.children || []) {
    if (c.type === 'text') {
      const t = (c as any).data;
      if (t && t.trim()) out.push(t);
    } else if (c.type === 'tag' && !['script', 'style'].includes((c as Element).tagName.toLowerCase())) {
      collectTextNodes(c as Element, out);
    }
  }
}

// ---------- token 解析 ----------
function isGetter(s: string): boolean {
  return GETTERS.has(s);
}
function looksLikeAttr(s: string): boolean {
  return /^[\w:-]+$/.test(s) && !/^(class|id|tag|children|text)\b/.test(s);
}
function isSelectorToken(s: string): boolean {
  return /^(class\.|id\.|tag\.|children|text\.|\.|#)/.test(s) || /^[a-zA-Z][\w-]*$/.test(s);
}

function parseToken(token: string): Token | null {
  let s = token.trim();
  if (!s) return null;

  // children[0]
  if (s === 'children' || s.startsWith('children[')) {
    const t: Token = { kind: 'children', name: '' };
    applyModifierTo(t, s.replace(/^children/, ''));
    return t;
  }
  // text.xxx
  if (s.startsWith('text.')) {
    const t: Token = { kind: 'text', name: '' };
    let rest = s.slice(5);
    const modMatch = rest.match(/(\.!?-?\d+(?::\d+)?|\[\s*-?\d+\s*(?::\s*-?\d+\s*)?\])$/);
    if (modMatch) {
      applyModifierTo(t, modMatch[1]);
      rest = rest.slice(0, rest.length - modMatch[0].length);
    }
    t.name = rest;
    return t;
  }
  // class.xxx / .xxx
  let m = s.match(/^(?:class)\.([^.![]+)/);
  if (m) {
    const t: Token = { kind: 'class', name: m[1] };
    applyModifierTo(t, s.slice(m[0].length));
    return t;
  }
  if (s.startsWith('.')) {
    m = s.match(/^\.([^.![]+)/);
    if (m) {
      const t: Token = { kind: 'class', name: m[1] };
      applyModifierTo(t, s.slice(m[0].length));
      return t;
    }
  }
  // id.xxx / #xxx
  m = s.match(/^(?:id)\.([^.![]+)/);
  if (m) {
    const t: Token = { kind: 'id', name: m[1] };
    applyModifierTo(t, s.slice(m[0].length));
    return t;
  }
  if (s.startsWith('#')) {
    m = s.match(/^#([^.![]+)/);
    if (m) {
      const t: Token = { kind: 'id', name: m[1] };
      applyModifierTo(t, s.slice(m[0].length));
      return t;
    }
  }
  // tag.xxx / xxx
  m = s.match(/^(?:tag)\.([^.![]+)/);
  const name = m ? m[1] : s.match(/^([a-zA-Z][\w-]*|\*)/)?.[0];
  if (!name) return null;
  const t: Token = { kind: 'tag', name };
  applyModifierTo(t, m ? s.slice(m[0].length) : s.slice(name.length));
  return t;
}

function applyModifierTo(t: Token, suffix: string) {
  let s = suffix.trim();
  if (!s) return;
  // !N / !N:M / !-1
  let m = s.match(/^\.?!\s*(-?\d+)(?::(-?\d+))?/);
  if (m) {
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    const ex: number[] = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) ex.push(i);
    t.exclude = [...(t.exclude ?? []), ...ex];
    s = s.slice(m[0].length);
  }
  // [N:M] 或 [-1:0]
  m = s.match(/^\[\s*(-?\d+)\s*:\s*(-?\d+)\s*\]/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a < 0 && b === 0) t.reverse = true;
    else t.range = [a, b];
    s = s.slice(m[0].length);
  }
  // .N 或 [N]
  m = s.match(/^\.?\s*(-?\d+)$/) || s.match(/^\[\s*(-?\d+)\s*\]$/);
  if (m) {
    t.index = Number(m[1]);
    s = s.slice(m[0].length);
  }
  // 剩余忽略
}

function cssForToken(t: Token): string {
  switch (t.kind) {
    case 'class':
      return `[class~=${cssQuote(t.name)}]`;
    case 'id':
      return `[id=${cssQuote(t.name)}]`;
    case 'tag':
      return t.name === '*' ? '*' : t.name.toLowerCase();
    default:
      return '*';
  }
}
function cssQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function applyToken($: CheerioAPI, tok: Token, scope: Element[], isFirstSelector: boolean): Element[] {
  let selected: Element[];
  if (tok.kind === 'children') {
    selected = scope.flatMap((e) => elementChildren(e));
  } else if (tok.kind === 'text') {
    const kw = tok.name;
    selected = scope.flatMap((e) => elementChildren(e)).filter((e) => textOf($, e).includes(kw));
  } else {
    const css = cssForToken(tok);
    if (isFirstSelector && scopeIsDoc(scope)) {
      selected = ($(css).toArray() ?? []) as unknown as Element[];
    } else {
      const out: Element[] = [];
      const seen = new Set<Element>();
      for (const e of scope) {
        for (const c of $(css, e as never).toArray() as unknown as Element[]) {
          if (!seen.has(c)) {
            seen.add(c);
            out.push(c);
          }
        }
      }
      selected = out;
    }
  }
  if (tok.exclude?.length) selected = selected.filter((_, i) => !tok.exclude!.includes(i));
  if (tok.reverse) selected = selected.slice().reverse();
  if (tok.range) {
    const [a, b] = tok.range;
    const len = selected.length;
    const start = a < 0 ? len + a : a;
    const end = b < 0 ? len + b : b;
    selected = selected.slice(Math.max(0, start), Math.max(start, end));
  }
  if (tok.index !== undefined) {
    const i = tok.index < 0 ? selected.length + tok.index : tok.index;
    selected = i >= 0 && i < selected.length ? [selected[i]] : [];
  }
  return selected;
}

function scopeIsDoc(scope: Element[]): boolean {
  // 文档根 scope 来自 $().root(),其 type 为 'root'
  return scope.length === 1 && scope[0] && (scope[0] as any).type === 'root';
}

// ---------- 顶层切分(尊重 [] {} 引号) ----------
export function splitTop(rule: string, sep: string): string[] {
  const out: string[] = [];
  let depthSq = 0;
  let depthCurly = 0;
  let depthParen = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < rule.length; i++) {
    const ch = rule[i];
    if (quote) {
      cur += ch;
      if (ch === quote && rule[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[') depthSq++;
    else if (ch === ']') depthSq--;
    else if (ch === '{') depthCurly++;
    else if (ch === '}') depthCurly--;
    else if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    if (
      depthSq === 0 && depthCurly === 0 && depthParen === 0 && !quote &&
      rule.startsWith(sep, i)
    ) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}