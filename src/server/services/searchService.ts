import iconv from 'iconv-lite';
import { readFileSync, statSync } from 'node:fs';
import { decodeBuffer } from '../parser/encoding';
import { getBook, getBookChapters, type ChapterMeta } from './bookService';

/**
 * 全书全文搜索:
 * 关键词按书籍编码编码为字节模式 → 整文件 Buffer.indexOf(memchr 级速度)→
 * 命中点二分定位章节 → 提取命中行片段。
 * 避免 5000 章逐章解码:一次 IO + 一次内存搜索。
 */

export interface FullTextHit {
  chapter_index: number;
  title: string;
  /** 命中行(围绕命中截断) */
  snippet: string;
  /** 章内位置比例 0~1(用于跳转定位) */
  position: number;
  /** 该章命中次数 */
  count: number;
}

export interface FullTextResult {
  query: string;
  total: number;
  chapters: FullTextHit[];
}

function normalizeEnc(e: string): string {
  if (!e || e === 'unknown') return 'utf-8';
  return e;
}

function encodeQuery(q: string, enc: string): Buffer {
  try {
    if (enc === 'utf-8') return Buffer.from(q, 'utf8');
    if (enc.startsWith('utf-16')) return iconv.encode(q, enc);
    return iconv.encode(q, enc); // gbk / gb18030 / big5
  } catch {
    return Buffer.from(q, 'utf8');
  }
}

/** 二分定位字节位置所在章节 */
function locateChapter(rows: ChapterMeta[], bytePos: number): ChapterMeta | null {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid];
    if (bytePos < r.start_offset) hi = mid - 1;
    else if (bytePos >= r.end_offset) lo = mid + 1;
    else return r;
  }
  return null;
}

/** 提取命中所在行,围绕命中位置截断到 ~100 字 */
function extractHitLine(buf: Buffer, hitPos: number, enc: string): string {
  let lineStart = buf.lastIndexOf(0x0a, Math.max(0, hitPos - 1));
  lineStart = lineStart === -1 ? 0 : lineStart + 1;
  let lineEnd = buf.indexOf(0x0a, hitPos);
  if (lineEnd === -1) lineEnd = buf.length;
  const raw = buf.subarray(lineStart, lineEnd);
  let line = decodeBuffer(raw, enc).replace(/\r/g, '').trim();
  if (line.length > 100) {
    const ratio = Math.min(0.9, (hitPos - lineStart) / Math.max(1, lineEnd - lineStart));
    const center = Math.floor(ratio * line.length);
    const start = Math.max(0, center - 50);
    line = (start > 0 ? '…' : '') + line.slice(start, start + 100) + (start + 100 < line.length ? '…' : '');
  }
  return line;
}

export function fullTextSearch(bookId: number, q: string, maxChapters = 20): FullTextResult {
  const query = q.trim();
  if (!query) return { query, total: 0, chapters: [] };
  const book = getBook(bookId);
  if (!book) return { query, total: 0, chapters: [] };
  const size = statSync(book.file_path).size;
  if (size === 0) return { query, total: 0, chapters: [] };

  const buf = readFileSync(book.file_path);
  const enc = normalizeEnc(book.encoding);
  const pattern = encodeQuery(query, enc);
  if (pattern.length === 0) return { query, total: 0, chapters: [] };

  // 全文扫描命中点(上限 2000,防超大书爆量)
  const hitPositions: number[] = [];
  let pos = 0;
  const MAX_HITS = 2000;
  while (hitPositions.length < MAX_HITS) {
    const idx = buf.indexOf(pattern, pos);
    if (idx === -1) break;
    hitPositions.push(idx);
    pos = idx + pattern.length;
  }
  if (hitPositions.length === 0) return { query, total: 0, chapters: [] };

  // 按章节分组
  const rows = getBookChapters(bookId);
  const byChapter = new Map<number, number[]>(); // chapter_index -> positions
  for (const p of hitPositions) {
    const row = locateChapter(rows, p);
    if (!row) continue;
    let arr = byChapter.get(row.chapter_index);
    if (!arr) {
      arr = [];
      byChapter.set(row.chapter_index, (arr = []));
    }
    arr.push(p);
  }

  const results: FullTextHit[] = [];
  for (const [chapterIndex, positions] of byChapter) {
    const row = rows.find((r) => r.chapter_index === chapterIndex)!;
    const firstPos = positions[0];
    results.push({
      chapter_index: chapterIndex,
      title: row.title || `第 ${chapterIndex + 1} 章`,
      snippet: extractHitLine(buf, firstPos, enc),
      position: Math.min(1, Math.max(0, (firstPos - row.start_offset) / Math.max(1, row.end_offset - row.start_offset))),
      count: positions.length,
    });
  }

  results.sort((a, b) => a.chapter_index - b.chapter_index);
  return { query, total: hitPositions.length, chapters: results.slice(0, maxChapters) };
}