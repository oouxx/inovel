import iconv from 'iconv-lite';
import { decodeBuffer } from './encoding';

/**
 * ChapterDetector —— 章节识别
 *
 * 设计参考了 Legado/Reader 的「多规则 + 打分选优」思路(独立实现):
 * 1. 读取文件头 512KB,用一组目录规则分别试匹配
 * 2. 按有效匹配数量/平均置信度选出最合适的规则
 * 3. 按块解码全文,在字符串上匹配,再用原始编码回算字节偏移
 * 4. 处理 BOM、CRLF/CR、UTF-16 行边界、前言、目录页重复条目
 *
 * confidence:
 *   >= 0.9  自动确认
 *   0.7~0.9 可能章节
 *   <  0.7  忽略
 */

export interface RawCandidate {
  lineStart: number;
  lineEnd: number;
  title: string;
  confidence: number;
  number: number | null;
}

export interface DetectedChapter {
  chapter_index: number;
  title: string;
  start_offset: number; // 标题行起点(字节)
  end_offset: number; // 下一章标题行起点 或 EOF(字节)
  confidence: number;
}

type NumberKind = 'arabic' | 'chinese' | 'roman';

interface NumberSpec {
  group: number;
  kind: NumberKind;
}

interface TocRule {
  id: string;
  name: string;
  pattern: RegExp;
  base: number;
  numbers?: NumberSpec[];
  titleGroup?: number;
  markerGroup?: number;
  /** 数字标题里的「年/月/日/元」等单位词降权 */
  unitPenalty?: boolean;
  /** 只在其他规则都失败时才启用 */
  fallbackOnly?: boolean;
}

interface Candidate {
  start: number;
  title: string;
  number: number | null;
  confidence: number;
}

const SAMPLE_BYTES = 512 * 1024;
const BLOCK_BYTES = 512 * 1024;
const MIN_CONFIDENCE = 0.7;

// ---------- 中文数字转换 ----------
const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 壹: 1, 贰: 2, 叁: 3, 肆: 4,
  伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
};

export function chineseToNumber(s: string): number | null {
  s = s.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!s) return null;
  // 支持 十/百/千/万 组合,如 十二、一百二十三、二千零一十
  let total = 0;
  let section = 0;
  let current = 0;
  let hasDigit = false;
  for (const ch of s) {
    if (CN_DIGITS[ch] !== undefined) {
      current = CN_DIGITS[ch];
      hasDigit = true;
    } else if (ch === '十') {
      current = current === 0 ? 1 : current;
      section += current * 10;
      current = 0;
      hasDigit = true;
    } else if (ch === '百') {
      current = current === 0 ? 1 : current;
      section += current * 100;
      current = 0;
      hasDigit = true;
    } else if (ch === '千') {
      current = current === 0 ? 1 : current;
      section += current * 1000;
      current = 0;
      hasDigit = true;
    } else if (ch === '万') {
      total = (section + current) * 10000;
      section = 0;
      current = 0;
      hasDigit = true;
    } else {
      return null;
    }
  }
  if (!hasDigit) return null;
  return total + section + current;
}

function romanToInt(s: string): number | null {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

// ---------- 目录规则 ----------
// 允许最多 4 个半角/全角空格或 Tab 作为行首缩进
const LEAD = '^[ \\t\\u3000]{0,4}';
const NUM = '[0-9零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]';
const TITLE_END = '[ \\t\\u3000]*$';
const SEP = '[ \\t\\u3000]{0,3}(?:[:：、\\-—.．][ \\t\\u3000]{0,3})?';

const RULES: TocRule[] = [
  {
    id: 'di',
    name: '第X章',
    pattern: new RegExp(
      `${LEAD}第[ \\t\\u3000]{0,4}(${NUM}{1,12})[ \\t\\u3000]{0,4}` +
        `(章|节(?![课])|回(?![合来事去])|卷|集(?![合和])|部(?![分赛游])|篇(?![张])|话|幕)` +
        `${SEP}(.{0,40})${TITLE_END}`,
      'gm',
    ),
    base: 0.94,
    numbers: [{ group: 1, kind: 'chinese' }],
    markerGroup: 2,
    titleGroup: 3,
  },
  {
    id: 'special',
    name: '特殊章',
    pattern: new RegExp(
      `${LEAD}(楔子|序章|序言|序|引子|前言|自序|尾声|终章|终曲|后记|后序|番外(?:篇)?|外传|特别篇|最终章|大结局)` +
        `(?:${SEP}(.{0,40}))?${TITLE_END}`,
      'gm',
    ),
    base: 0.93,
    titleGroup: 2,
  },
  {
    id: 'en',
    name: 'Chapter/Section',
    pattern: new RegExp(
      `${LEAD}(chapter|chap\\.?|section|part|episode|book)[ \\t\\u3000]*` +
        `([0-9]{1,5}|[ivxlcdm]{1,7})\\b[ \\t\\u3000]{0,3}(?:[:：.\\-—][ \\t\\u3000]{0,3})?` +
        `(.{0,60})${TITLE_END}`,
      'gim',
    ),
    base: 0.93,
    numbers: [
      { group: 2, kind: 'arabic' },
      { group: 2, kind: 'roman' },
    ],
    titleGroup: 3,
  },
  {
    id: 'numSep',
    name: '数字 分隔符 标题',
    pattern: new RegExp(
      `${LEAD}([0-9]{1,5})[ \\t\\u3000]*(?:[、.,．:：\\-—_][ \\t\\u3000]*|[ \\t\\u3000]+)(.{1,40})${TITLE_END}`,
      'gm',
    ),
    base: 0.84,
    numbers: [{ group: 1, kind: 'arabic' }],
    titleGroup: 2,
    unitPenalty: true,
  },
  {
    id: 'volChap',
    name: '卷/章 序号 标题',
    pattern: new RegExp(
      `${LEAD}(卷|章)[ \\t\\u3000]{0,4}(${NUM}{1,8})${SEP}(.{0,40})${TITLE_END}`,
      'gm',
    ),
    base: 0.9,
    numbers: [{ group: 2, kind: 'chinese' }],
    markerGroup: 1,
    titleGroup: 3,
  },
  {
    id: 'cnNumSep',
    name: '中文数字 分隔符 标题',
    pattern: new RegExp(
      `${LEAD}(${NUM}{1,8})[、.,．:：\\-—_][ \\t\\u3000]*(.{1,30})${TITLE_END}`,
      'gm',
    ),
    base: 0.78,
    numbers: [{ group: 1, kind: 'chinese' }],
    titleGroup: 2,
  },
  {
    id: 'body',
    name: '正文 标题',
    pattern: new RegExp(`${LEAD}正文[ \\t\\u3000]{1,4}(.{1,40})${TITLE_END}`, 'gm'),
    base: 0.82,
    titleGroup: 1,
  },
  {
    id: 'bracket',
    name: '括号标题',
    pattern: new RegExp(
      `${LEAD}[【\\[〔〖「『〈［(（](?:第[ \\t\\u3000]{0,4}(${NUM}{1,12})[ \\t\\u3000]{0,4}(?:章|节|回|卷)|` +
        `[Cc]hapter[ \\t\\u3000]*(\\d{1,5}))[^】\\]〕〗」』〉］)）]{0,40}` +
        `[】\\]〕〗」』〉］)）]${TITLE_END}`,
      'gm',
    ),
    base: 0.86,
    numbers: [
      { group: 1, kind: 'chinese' },
      { group: 2, kind: 'arabic' },
    ],
  },
  {
    id: 'titleParen',
    name: '标题(序号)',
    pattern: new RegExp(
      `${LEAD}([^\\n]{1,30})[(（](${NUM}{1,8})[)）]${TITLE_END}`,
      'gm',
    ),
    base: 0.78,
    numbers: [{ group: 2, kind: 'chinese' }],
  },
  {
    id: 'symbol',
    name: '符号标题',
    pattern: new RegExp(`${LEAD}[☆★✦✧◆◇■□●○][^\\n]{1,40}${TITLE_END}`, 'gm'),
    base: 0.72,
  },
  {
    id: 'numOnly',
    name: '纯数字标题',
    pattern: new RegExp(`${LEAD}([0-9]{1,5})[.．、]?[ \\t\\u3000]{0,4}$`, 'gm'),
    base: 0.7,
    numbers: [{ group: 1, kind: 'arabic' }],
    fallbackOnly: true,
  },
];

// ---------- 匹配与置信度 ----------
function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function parseRuleMatch(rule: TocRule, m: RegExpMatchArray): Omit<Candidate, 'start'> | null {
  const title = normalizeTitle(m[0] || '');
  if (!title || title.length > 80) return null;

  let chapterNumber: number | null = null;
  for (const spec of rule.numbers ?? []) {
    const raw = m[spec.group];
    if (!raw) continue;
    if (spec.kind === 'arabic') {
      if (/^\d+$/.test(raw)) chapterNumber = parseInt(raw, 10);
    } else if (spec.kind === 'roman') {
      chapterNumber = romanToInt(raw.toUpperCase());
    } else {
      chapterNumber = chineseToNumber(raw);
    }
    if (chapterNumber != null) break;
  }

  let confidence = rule.base;
  const titlePart = rule.titleGroup != null ? m[rule.titleGroup] : undefined;
  if (titlePart !== undefined) {
    if (titlePart.trim()) confidence += 0.03;
    else confidence -= 0.03;
  }
  if (rule.markerGroup != null && m[rule.markerGroup] === '卷') confidence -= 0.02;
  if (
    rule.unitPenalty &&
    titlePart &&
    /^(年|月|日|号|元|块|岁|页|字|人|个|次|只|条|张|点|分|秒)(?:\s|$)/.test(titlePart.trim())
  ) {
    confidence -= 0.25;
  }
  // 标题以句末标点结尾,大概率是正文句子
  if (/[。!?？]$/.test(title)) confidence -= 0.12;

  return { title, number: chapterNumber, confidence: Math.min(1, Math.max(0.3, confidence)) };
}

function extractCandidates(text: string, rule: TocRule): (Omit<Candidate, 'start'> & { index: number })[] {
  const re = new RegExp(rule.pattern.source, rule.pattern.flags);
  const out: (Omit<Candidate, 'start'> & { index: number })[] = [];
  for (const m of text.matchAll(re)) {
    const parsed = parseRuleMatch(rule, m);
    if (parsed) out.push({ ...parsed, index: m.index ?? 0 });
  }
  return out;
}

function chooseRule(sample: string): TocRule | null {
  const scoreRule = (rule: TocRule) => {
    const list = extractCandidates(sample, rule).filter((c) => c.confidence >= MIN_CONFIDENCE);
    if (!list.length) return null;
    return {
      count: list.length,
      avg: list.reduce((n, c) => n + c.confidence, 0) / list.length,
    };
  };

  let bestRule: TocRule | null = null;
  let bestCount = 0;
  let bestAvg = 0;

  for (const rule of RULES) {
    if (rule.fallbackOnly) continue;
    const score = scoreRule(rule);
    if (!score) continue;
    if (score.count > bestCount || (score.count === bestCount && score.avg > bestAvg + 1e-6)) {
      bestRule = rule;
      bestCount = score.count;
      bestAvg = score.avg;
    }
  }

  if (!bestRule) {
    for (const rule of RULES) {
      if (!rule.fallbackOnly) continue;
      const score = scoreRule(rule);
      if (!score) continue;
      if (score.count > bestCount || (score.count === bestCount && score.avg > bestAvg + 1e-6)) {
        bestRule = rule;
        bestCount = score.count;
        bestAvg = score.avg;
      }
    }
  }

  return bestRule;
}

// ---------- 编码相关的行边界 ----------
function getBomOffset(buf: Buffer, encoding: string): number {
  if (encoding === 'utf-8-bom' && buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return 3;
  }
  return 0;
}

function decodeBlock(buf: Buffer, start: number, end: number, encoding: string): string {
  const enc = encoding === 'utf-8-bom' ? 'utf-8' : encoding;
  return decodeBuffer(buf.subarray(start, end), enc, false);
}

/** 找 from 之后第一个换行,返回换行后的位置;找不到返回 null */
function findLineBreakAfter(buf: Buffer, from: number, encoding: string): number | null {
  const nl = buf.indexOf(0x0a, from);
  if (nl !== -1) return nl + 1;
  const cr = buf.indexOf(0x0d, from);
  if (cr !== -1) return cr + 1;
  return null;
}

/** 从 start 开始取一个尽量接近 BLOCK_BYTES、且落在行边界上的块 */
function nextBlockEnd(buf: Buffer, start: number, size: number, encoding: string): number {
  const target = Math.min(buf.length, start + size);
  if (target >= buf.length) return buf.length;
  return findLineBreakAfter(buf, target, encoding) ?? buf.length;
}

/** 字符串在目标编码下占用的字节数 */
function byteLength(text: string, encoding: string): number {
  if (!text) return 0;
  switch (encoding) {
    case 'gbk':
      return iconv.encode(text, 'gbk').length;
    case 'gb18030':
      return iconv.encode(text, 'gb18030').length;
    case 'big5':
      return iconv.encode(text, 'big5').length;
    default:
      return Buffer.byteLength(text, 'utf8');
  }
}

// ---------- 全文扫描 ----------
function scanBlocks(buf: Buffer, encoding: string, startOffset: number, rule: TocRule): Candidate[] {
  const out: Candidate[] = [];
  let blockStart = startOffset;

  while (blockStart < buf.length) {
    const blockEnd = nextBlockEnd(buf, blockStart, BLOCK_BYTES, encoding);
    if (blockEnd <= blockStart) break;

    const text = decodeBlock(buf, blockStart, blockEnd, encoding);
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let charCursor = 0;
    let byteCursor = blockStart;

    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      if (index > charCursor) {
        byteCursor += byteLength(text.slice(charCursor, index), encoding);
        charCursor = index;
      }
      const parsed = parseRuleMatch(rule, m);
      if (parsed) out.push({ start: byteCursor, ...parsed });
    }

    blockStart = blockEnd;
  }

  return out;
}

// ---------- 后处理 ----------
function adjustBySequence(candidates: Candidate[]) {
  const numbered = candidates.filter((c) => c.number !== null && c.number > 0);
  if (numbered.length < 3) return;

  let inc = 0;
  let total = 0;
  let prev = -Infinity;
  for (const c of numbered) {
    if (c.number! > prev) inc++;
    else if (c.number! === prev) inc += 0.5;
    total++;
    prev = c.number!;
  }
  const ratio = inc / total;
  for (const c of numbered) {
    if (ratio >= 0.7) c.confidence = Math.min(1, c.confidence + 0.04);
    else if (ratio < 0.3) c.confidence = Math.max(0.3, c.confidence - 0.12);
  }
}

/**
 * 去掉开头目录页造成的重复条目。
 * 目录页会先列一遍「第1章…第N章」,正文再出现一遍;仅当第一次出现在文件头部,
 * 且第二次出现距离较远时,丢弃更早的那条。
 */
function dropTocDuplicates(candidates: Candidate[], fileSize: number): Candidate[] {
  const tocZone = Math.min(512 * 1024, Math.max(16 * 1024, fileSize * 0.2));
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.number == null) continue;
    const key = `n:${c.number}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const indexMap = new Map<Candidate, number>();
  candidates.forEach((c, i) => indexMap.set(c, i));

  const drop = new Set<Candidate>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.start - b.start);
    const first = list[0];
    const last = list[list.length - 1];
    const idx = indexMap.get(first) ?? 0;
    const prevStart = idx > 0 ? candidates[idx - 1].start : first.start;
    const nextStart = idx + 1 < candidates.length ? candidates[idx + 1].start : first.start;
    // 目录页条目通常是一组连续、间距很小的标题;正文里的重复章号不会这么密集
    const dense = first.start - prevStart < 120 || nextStart - first.start < 120;
    if (first.start <= tocZone && (dense || last.start - first.start > 500)) drop.add(first);
  }
  return candidates.filter((c) => !drop.has(c));
}

function dedupeSamePosition(candidates: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of candidates) {
    const prev = out[out.length - 1];
    if (prev && prev.start === c.start) {
      if (c.confidence > prev.confidence) out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  return out;
}

// ---------- 主入口 ----------
/**
 * 从 TXT Buffer 中检测章节。
 * 偏移量均为原始文件的字节偏移,阅读时 seek(start) / read(end - start)。
 */
export function detectChapters(buf: Buffer, encoding: string): { chapters: DetectedChapter[]; bestConfidence: number } {
  if (!buf.length) return { chapters: [], bestConfidence: 0 };

  // UTF-16 暂不做分章:交给 scanner 的「全文单章」兜底,避免错误字节偏移
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    return { chapters: [], bestConfidence: 0 };
  }

  const bomOffset = getBomOffset(buf, encoding);
  const sampleEnd = nextBlockEnd(buf, bomOffset, SAMPLE_BYTES, encoding);
  const sample = sampleEnd > bomOffset ? decodeBlock(buf, bomOffset, sampleEnd, encoding) : '';
  const rule = chooseRule(sample);
  if (!rule) return { chapters: [], bestConfidence: 0 };

  let candidates = scanBlocks(buf, encoding, bomOffset, rule);
  if (!candidates.length) return { chapters: [], bestConfidence: 0 };

  candidates.sort((a, b) => a.start - b.start);
  adjustBySequence(candidates);
  candidates = candidates.filter((c) => c.confidence >= MIN_CONFIDENCE);
  candidates = dropTocDuplicates(candidates, buf.length);
  candidates = dedupeSamePosition(candidates);

  if (!candidates.length) return { chapters: [], bestConfidence: 0 };

  const first = candidates[0];
  if (first.start > bomOffset) {
    const preface = decodeBlock(buf, bomOffset, first.start, encoding).trim();
    if (preface) {
      candidates.unshift({
        start: bomOffset,
        title: '前言',
        number: null,
        confidence: 0.5,
      });
    }
  }

  const chapters: DetectedChapter[] = candidates.map((c, i) => ({
    chapter_index: i,
    title: c.title,
    start_offset: c.start,
    end_offset: i + 1 < candidates.length ? candidates[i + 1].start : buf.length,
    confidence: c.confidence,
  }));

  const bestConfidence = chapters.length ? Math.max(...chapters.map((c) => c.confidence)) : 0;
  return { chapters, bestConfidence };
}

/** 兜底:无章节时创建单一"全文"章节 */
export function fallbackSingleChapter(buf: Buffer): DetectedChapter[] {
  return [
    {
      chapter_index: 0,
      title: '全文',
      start_offset: 0,
      end_offset: buf.length,
      confidence: 0,
    },
  ];
}

// 供测试
export const _internals = { RULES, chineseToNumber, iconv, chooseRule, extractCandidates };
