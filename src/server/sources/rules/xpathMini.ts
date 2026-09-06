// ---------- 迷你 XPath 求值器 ----------
// 只覆盖书源生态常用子集:
//   //tag / * / tag[n] / tag[last()] / tag[-1]
//   tag[@attr='v'] / [@attr] / [a='1' or b='2']
//   /following-sibling::tag / /preceding-sibling::tag
//   结尾取值:/@attr /text() /text
// 基于 cheerio 的 DOM(domhandler)遍历,不引入完整 XPath 依赖。
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export type XResult = Element[] | string[];

interface Step {
  axis: 'child' | 'self' | 'following-sibling' | 'preceding-sibling' | 'descendant';
  name: string; // tag 名或 *
  preds: string[];
}

export function isXPathRule(rule: string): boolean {
  const r = rule.trim();
  return (
    r.startsWith('//') ||
    r.startsWith('/html') ||
    r.startsWith('@XPath:') ||
    r.startsWith('xpath:')
  );
}

export function evalXPath($: CheerioAPI, rule: string, roots: Element[]): XResult {
  let r = rule.trim();
  if (r.startsWith('@XPath:')) r = r.slice(7).trim();
  else if (r.startsWith('xpath:')) r = r.slice(6).trim();

  // 结尾取值
  let resultMode: 'elements' | 'attr' | 'text' = 'elements';
  let attrName = '';
  const textTail = r.match(/\/text\(\)(?:\[\d+\])?$/);
  if (textTail) {
    resultMode = 'text';
    r = r.slice(0, r.length - textTail[0].length);
  } else {
    const attrTail = r.match(/\/@([\w:-]+)$/);
    if (attrTail) {
      resultMode = 'attr';
      attrName = attrTail[1];
      r = r.slice(0, r.length - attrTail[0].length);
    }
  }

  const steps = tokenize(r);
  let nodes: Element[] = r.trim().startsWith('//') ? collectAll($, ':root') : roots.slice();
  let needDescendant = r.trim().startsWith('//');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (needDescendant && i === 0) {
      // 第一个 //step:从所有元素后代中找
      nodes = collectDescendants($, nodes).filter((n) => matchStep($, step, n, nodes));
      needDescendant = false;
      continue;
    }
    const out: Element[] = [];
    const seen = new Set<Element>();
    for (const n of nodes) {
      let cands: Element[];
      switch (step.axis) {
        case 'child':
          cands = elementChildren(n);
          break;
        case 'descendant':
          cands = collectDescendants($, [n]);
          break;
        case 'following-sibling':
          cands = siblingsAfter(n);
          break;
        case 'preceding-sibling':
          cands = siblingsBefore(n);
          break;
        case 'self':
          cands = [n];
          break;
      }
      for (const c of cands) {
        if (matchStep($, step, c, [n]) && !seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
    }
    nodes = out;
    if (!nodes.length) break;
  }

  if (resultMode === 'attr') return nodes.map((n) => n.attribs?.[attrName] ?? '').filter((s) => s !== '');
  if (resultMode === 'text') return nodes.map((n) => nodeText($, n).trim()).filter((s) => s !== '');
  return nodes;
}

function elementChildren(n: Element): Element[] {
  return (n.children || []).filter((c): c is Element => c.type === 'tag');
}
function siblingsAfter(n: Element): Element[] {
  const parent = n.parent as Element | null;
  if (!parent) return [];
  const all = elementChildren(parent);
  const idx = all.indexOf(n);
  return idx >= 0 ? all.slice(idx + 1) : [];
}
function siblingsBefore(n: Element): Element[] {
  const parent = n.parent as Element | null;
  if (!parent) return [];
  const all = elementChildren(parent);
  const idx = all.indexOf(n);
  return idx > 0 ? all.slice(0, idx) : [];
}
function collectAll($: CheerioAPI, sel: string): Element[] {
  const root = $(sel).toArray() as unknown as Element[];
  return root.length ? root : (($(':root').toArray() ?? []) as unknown as Element[]);
}
function collectDescendants($: CheerioAPI, nodes: Element[]): Element[] {
  const out: Element[] = [];
  const walk = (n: Element) => {
    for (const c of elementChildren(n)) {
      out.push(c);
      walk(c);
    }
  };
  for (const n of nodes) walk(n);
  return out;
}

function matchStep($: CheerioAPI, step: Step, node: Element, context: Element[]): boolean {
  if (step.name !== '*' && node.tagName?.toLowerCase() !== step.name.toLowerCase()) return false;
  if (!step.preds.length) return true;
  const siblings = context.length === 1 && step.axis === 'child' ? elementChildren(context[0]) : elementChildren(node.parent as Element || node);
  let position = siblings.indexOf(node) + 1; // 1-based
  for (const p of step.preds) {
    const pp = p.trim();
    if (/^last\(\)$/i.test(pp)) {
      if (position !== siblings.length) return false;
      continue;
    }
    const neg = pp.match(/^-\d+$/);
    if (neg) {
      const fromEnd = Number(pp);
      if (position !== siblings.length + 1 + fromEnd) return false;
      continue;
    }
    if (/^\d+$/.test(pp)) {
      if (position !== Number(pp)) return false;
      continue;
    }
    // or 组合
    if (/\bor\b/i.test(pp)) {
      const parts = pp.split(/\bor\b/i).map((s) => s.trim()).filter(Boolean);
      if (!parts.some((x) => evalAtom($, node, x))) return false;
      continue;
    }
    if (!evalAtom($, node, pp)) return false;
  }
  return true;
}

function evalAtom($: CheerioAPI, node: Element, atom: string): boolean {
  const eq = atom.match(/^@([\w:-]+)\s*=\s*['"]([^'"]*)['"]$/);
  if (eq) return (node.attribs?.[eq[1]] ?? '') === eq[2];
  const has = atom.match(/^@([\w:-]+)$/);
  if (has) return node.attribs?.[has[1]] !== undefined;
  const contains = atom.match(/contains\(@([\w:-]+)\s*,\s*['"]([^'"]*)['"]\)/i);
  if (contains) return (node.attribs?.[contains[1]] ?? '').includes(contains[2]);
  return false;
}

/** 词法切分:按 / 切步骤,尊重 [] 与引号 */
function tokenize(path: string): Step[] {
  let p = path.trim().replace(/^\/+/, '');
  const steps: Step[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  const flush = () => {
    if (cur.trim()) steps.push(parseStep(cur));
    cur = '';
  };
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === '/' && depth === 0) {
      // following-sibling::xx 中的 :: 已在 cur;这里只是步骤分隔
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return steps;
}

function parseStep(raw: string): Step {
  let s = raw.trim();
  let axis: Step['axis'] = 'child';
  const axisM = s.match(/^(following|preceding)-sibling::/);
  if (axisM) {
    axis = axisM[1] === 'following' ? 'following-sibling' : 'preceding-sibling';
    s = s.slice(axisM[0].length);
  } else if (s.startsWith('descendant::')) {
    axis = 'descendant';
    s = s.slice('descendant::'.length);
  } else if (s.startsWith('self::')) {
    axis = 'self';
    s = s.slice(6);
  }
  const preds: string[] = [];
  const predRe = /\[([^\[\]]*)\]/g;
  s = s.replace(predRe, (_, inner) => {
    preds.push(inner);
    return '';
  });
  const name = s.trim() || '*';
  return { axis, name, preds };
}

export function nodeText($: CheerioAPI, n: AnyNode | Element): string {
  return $(n as never).text();
}