import iconv from 'iconv-lite';
import { decodeBuffer } from './encoding';

/**
 * ChapterDetector —— 独立的章节识别模块
 *
 * 在字节层面按 \n 分行(任何中文编码中 \n/\r 都不会出现在多字节字符内部),
 * 仅对行首片段做快速预筛,命中后再解码整行,计算 confidence。
 *
 * confidence:
 *   >= 0.9  自动确认
 *   0.7~0.9 可能章节
 *   <  0.7  忽略
 */

export interface RawCandidate {
  lineStart: number; // 该行在文件中的字节起点
  lineEnd: number; // 行尾(含换行)
  title: string; // 规范化标题
  confidence: number;
  number: number | null; // 解析出的章号
}

export interface DetectedChapter {
  chapter_index: number;
  title: string;
  start_offset: number; // 标题行起点(字节)
  end_offset: number; // 下一章标题行起点 或 EOF(字节)
  confidence: number;
}

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
  let section = 0; // 万以下累计
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

// ---------- 匹配规则 ----------

// 第X章 / 第X节 / 第X回 / 第X卷 / 第X篇 / 第X集
const RE_DI = /^第\s*([0-9零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖]+)\s*(章|节|回|卷|篇|集)\s*[:：、\-—\s.]?\s*(.*)$/;
// Chapter 12 / CHAPTER XII / 第 X 章(英文风格)
const RE_EN = /^(chapter|chap\.?|section)\s+(\d{1,5}|[ivxlcdm]{1,7})\b\s*[:：.\-—]?\s*(.*)$/i;
// 001、001. 001、 001 标题
const RE_NUM = /^(\d{1,5})\s*[、.,．:：\-—]?\s+(.+)$/; // 需要分隔符或空格 + 标题
const RE_NUM_ONLY = /^(\d{1,5})$/;
// 特殊章
const RE_SPECIAL =
  /^(楔子|序章|序言|序|引子|前言|自序|尾声|终章|终曲|后记|后序|番外|外传|特别篇|最终章|大结局)(\s*[:：.\-—]?\s*.*)?$/;
// 第X章 的规范化(供输出)
function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function parseLine(line: string): Omit<RawCandidate, 'lineStart' | 'lineEnd'> | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return null; // 标题行不应太长

  let m: RegExpExecArray | null;

  if ((m = RE_DI.exec(trimmed))) {
    const num = chineseToNumber(m[1]);
    const hasTitle = (m[3] || '').trim().length > 0;
    let conf = 0.94;
    if (hasTitle) conf += 0.04; // 0.98
    if (/^(章|节|回)$/.test(m[2]) && num !== null) conf += 0.0; // 已含
    if (m[2] === '卷') conf -= 0.04; // 卷可能是分卷
    if (/[\u4e00-\u9fff]/.test(m[3] || '') === false && !hasTitle) conf -= 0.02;
    return { title: normalizeTitle(trimmed), confidence: conf, number: num };
  }

  if ((m = RE_EN.exec(trimmed))) {
    const hasTitle = (m[3] || '').trim().length > 0;
    const num = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : romanToInt(m[2].toUpperCase());
    let conf = hasTitle ? 0.93 : 0.9;
    return { title: normalizeTitle(trimmed), confidence: conf, number: num };
  }

  if (RE_SPECIAL.test(trimmed)) {
    return { title: normalizeTitle(trimmed), confidence: 0.92, number: null };
  }

  if ((m = RE_NUM.exec(trimmed))) {
    // 001 标题 / 12. 标题 —— 数字 + 分隔 + 标题
    const titlePart = (m[2] || '').trim();
    if (!titlePart) return null;
    // 标题部分若过长或含大量标点,降分
    let conf = 0.76;
    if (titlePart.length <= 30 && /[\u4e00-\u9fff]/.test(titlePart)) conf += 0.06;
    if (/^[、.．]$/.test(m[0].slice(m[1].length, m[1].length + 1).trim())) conf += 0.04;
    return { title: normalizeTitle(trimmed), confidence: Math.min(conf, 0.88), number: parseInt(m[1], 10) };
  }

  if ((m = RE_NUM_ONLY.exec(trimmed))) {
    const num = parseInt(m[1], 10);
    if (num >= 1 && num <= 99999) {
      return { title: normalizeTitle(trimmed), confidence: 0.7, number: num };
    }
    return null;
  }

  return null;
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

// ---------- 快速预筛(字节层面) ----------
// 常见候选行首字节签名,避免对几十万行逐一 iconv 解码
function quickMatch(head: Buffer, encoding: string): boolean {
  if (head.length === 0) return false;
  const b0 = head[0];
  // ASCII 开头:数字 / Chapter / 楔子等中文不会出现
  if (b0 < 0x80) {
    return (b0 >= 0x30 && b0 <= 0x39) || b0 === 0x63 || b0 === 0x43; // 0-9 / c / C
  }
  // 非 ASCII:各编码 "第/序/楔/引/尾/终/后/番/外/卷" 首字节不同,直接放行由 parseLine 过滤
  return true;
}

const HEAD_BYTES = 18;

export interface DetectOptions {
  encoding: string;
  /** 额外校验:每章最小正文字节数,用于过滤密集误报 */
}

/**
 * 从 TXT Buffer 中检测章节。
 * 偏移量均为原始文件的字节偏移,阅读时 seek(start) / read(end - start)。
 */
export function detectChapters(buf: Buffer, encoding: string): { chapters: DetectedChapter[]; bestConfidence: number } {
  const candidates: RawCandidate[] = [];

  // ---- 逐行扫描(字节层面)----
  let lineStart = 0;
  let pos = 0;
  const n = buf.length;
  let prevNum: number | null = null;

  const pushCandidate = (ls: number, le: number, line: string) => {
    const parsed = parseLine(line);
    if (!parsed) return;
    // 行首缩进惩罚
    const lead = line.length - line.trimStart().length;
    let confidence = parsed.confidence;
    if (lead > 0) confidence -= 0.12;
    // 标题行含句末标点(。!?)降分
    if (/[。!?？!]/.test(parsed.title)) confidence -= 0.25;
    candidates.push({ lineStart: ls, lineEnd: le, ...parsed, confidence });
  };

  while (pos <= n) {
    const nl = buf.indexOf(0x0a, pos);
    const lineEndWithNl = nl === -1 ? n : nl + 1; // 含 \n
    const contentEnd = nl === -1 ? n : nl; // 不含 \n(\r 保留在行内,parseLine trim)
    if (contentEnd >= lineStart) {
      const head = buf.subarray(lineStart, Math.min(lineStart + HEAD_BYTES, contentEnd));
      if (quickMatch(head, encoding)) {
        const raw = buf.subarray(lineStart, contentEnd);
        const line = decodeLine(raw, encoding);
        pushCandidate(lineStart, lineEndWithNl, line);
      }
    }
    if (nl === -1) break;
    lineStart = lineEndWithNl;
    pos = lineEndWithNl;
  }

  if (candidates.length === 0) {
    return { chapters: [], bestConfidence: 0 };
  }

  // ---- 后处理:序号连续性验证 ----
  adjustBySequence(candidates);

  // ---- 置信度过滤 ----
  const high = candidates.filter((c) => c.confidence >= 0.9);
  const mid = candidates.filter((c) => c.confidence >= 0.7 && c.confidence < 0.9);
  let chosen = [...high];
  // 高置信候选很少时,保留"可能章节"候选(数字序号型书籍)
  if (high.length < 5) chosen = chosen.concat(mid);
  else {
    // 高置信充足时,仅保留与序号序列一致的 mid 候选
    const highNums = new Set(high.map((c) => c.number).filter((x): x is number => x !== null));
    chosen = chosen.concat(mid.filter((c) => c.number !== null && highNums.has(c.number)));
  }
  chosen.sort((a, b) => a.lineStart - b.lineStart);

  // 去重:同一行只保留一个(已排序,不可能重复;但相邻行连续误报需过滤)
  // 若相邻候选间隔正文 < 40 字节且前一个 confidence 更低,丢弃低者
  const deduped: RawCandidate[] = [];
  for (const c of chosen) {
    const prev = deduped[deduped.length - 1];
    if (prev && c.lineStart - prev.lineEnd < 40) {
      if (c.confidence > prev.confidence) deduped[deduped.length - 1] = c;
      continue;
    }
    deduped.push(c);
  }

  // ---- 生成章节 ----
  const chapters: DetectedChapter[] = deduped.map((c, i) => ({
    chapter_index: i,
    title: c.title,
    start_offset: c.lineStart,
    end_offset: i + 1 < deduped.length ? deduped[i + 1].lineStart : n,
    confidence: c.confidence,
  }));

  const bestConfidence = deduped.length ? Math.max(...deduped.map((c) => c.confidence)) : 0;
  return { chapters, bestConfidence };
}

/** 解码单行(容错:非法序列替换) */
function decodeLine(raw: Buffer, encoding: string): string {
  const enc = encoding === 'utf-8-bom' ? 'utf-8' : encoding;
  let text = decodeBuffer(raw, enc);
  if (encoding === 'utf-16le' || encoding === 'utf-16be') return text;
  // iconv 对不完整序列可能产生 \ufffd,标题中直接替换为空
  return text.replace(/\ufffd/g, '');
}

/** 序号递增检验:递增良好 → 数字型候选加分;混乱 → 减分 */
function adjustBySequence(candidates: RawCandidate[]) {
  const withNum = candidates.filter((c) => c.number !== null);
  if (withNum.length < 3) return;
  let inc = 0;
  let total = 0;
  let prev = -Infinity;
  for (const c of withNum) {
    if (c.number! > prev) inc++;
    else if (c.number! === prev) inc += 0.5;
    total++;
    prev = c.number!;
  }
  const ratio = inc / total;
  for (const c of candidates) {
    if (c.number === null) continue;
    if (ratio >= 0.7) c.confidence = Math.min(1, c.confidence + 0.06);
    else if (ratio < 0.3) c.confidence = Math.max(0.3, c.confidence - 0.2);
  }
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
export const _internals = { parseLine, chineseToNumber, iconv };