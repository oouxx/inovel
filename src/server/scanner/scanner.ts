import { createHash } from 'node:crypto';
import { readdirSync, statSync, existsSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ScanResult, ScanStatus } from '../../shared/types';
import { getDb } from '../database';
import { detectEncoding, decodeBuffer } from '../parser/encoding';
import { detectChapters, fallbackSingleChapter } from '../parser/chapterDetector';

/**
 * TXT Scanner —— 文件系统优先
 *
 * - 递归扫描 NOVELS_DIR 下所有 *.txt
 * - 分类 = 一级子目录名,书名 = 文件名
 * - file hash / size / mtime 判断变化:NEW / UNCHANGED / MODIFIED / DELETED
 */

const status: ScanStatus = { scanning: false, lastResult: null, lastError: null };

export function getScanStatus(): ScanStatus {
  return status;
}

export function getNovelsDir(): string {
  return process.env.NOVELS_DIR || './data/novels';
}

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 递归收集所有 txt 文件 */
export function walkTxtFiles(dir: string): { filePath: string; category: string }[] {
  const out: { filePath: string; category: string }[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string, category: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full, category || e.name); // 分类 = 第一级目录
      } else if (e.isFile() && /\.txt$/i.test(e.name)) {
        out.push({ filePath: full, category });
      }
    }
  };
  walk(dir, '');
  return out;
}

export function parseTitleFromFilename(filePath: string): string {
  return path.basename(filePath).replace(/\.txt$/i, '').trim() || path.basename(filePath);
}

/** 单本 TXT → 编码 + 章节(不写库) */
export function analyzeTxt(filePath: string) {
  const buf = readFileSync(filePath);
  const encoding = detectEncoding(buf);
  const { chapters, bestConfidence } = detectChapters(buf, encoding);
  return {
    size: buf.length,
    encoding,
    chapters: chapters.length ? chapters : fallbackSingleChapter(buf),
    detected: chapters.length > 0,
    bestConfidence,
    buf,
  };
}

/** 写库:新建或重建书籍(含章节索引) */
export function upsertBook(filePath: string, relativeCategory: string, opts: { reparse?: boolean } = {}) {
  const db = getDb();
  const title = parseTitleFromFilename(filePath);
  const now = Date.now();

  const info = analyzeTxt(filePath);
  const hash = hashBuffer(info.buf);

  const existing = db.query('SELECT id FROM books WHERE file_path = ?').get(filePath) as { id: number } | null;
  let bookId: number;

  if (existing && opts.reparse) {
    bookId = existing.id;
    db.query(
      `UPDATE books SET title=?, file_hash=?, file_size=?, file_mtime=?, encoding=?, category=?,
       chapter_count=?, status=?, error=?, updated_at=? WHERE id=?`,
    ).run(
      title, hash, info.size, Math.floor(statSync(filePath).mtimeMs), info.encoding, relativeCategory,
      info.chapters.length, info.detected ? 'ok' : 'warn', info.detected ? null : '未识别到章节结构,按全文单章处理',
      now, bookId,
    );
    db.query('DELETE FROM chapters WHERE book_id = ?').run(bookId);
  } else {
    const r = db
      .query(
        `INSERT INTO books (title, file_path, file_hash, file_size, file_mtime, encoding, category,
         chapter_count, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        title, filePath, hash, info.size, Math.floor(statSync(filePath).mtimeMs), info.encoding, relativeCategory,
        info.chapters.length, info.detected ? 'ok' : 'warn', info.detected ? null : '未识别到章节结构,按全文单章处理',
        now, now,
      );
    bookId = Number(r.lastInsertRowid);
  }

  // 批量插入章节(事务)
  const insert = db.prepare(
    `INSERT INTO chapters (book_id, chapter_index, title, start_offset, end_offset, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const ch of info.chapters) {
      insert.run(bookId, ch.chapter_index, ch.title, ch.start_offset, ch.end_offset, ch.confidence, now);
    }
  })();

  syncFts(bookId);
  return { bookId, chapterCount: info.chapters.length, encoding: info.encoding, detected: info.detected };
}

/** 同步 FTS 索引(中文按字拆分,支持任意子串检索) */
export function syncFts(bookId: number) {
  const db = getDb();
  const book = db.query('SELECT * FROM books WHERE id = ?').get(bookId) as any;
  if (!book) return;
  db.query('DELETE FROM books_fts WHERE book_id = ?').run(bookId);
  db.query('INSERT INTO books_fts (book_id, title, author, category) VALUES (?, ?, ?, ?)').run(
    bookId,
    splitChars(book.title),
    splitChars(book.author || ''),
    splitChars(book.category || ''),
  );
}

function splitChars(s: string): string {
  if (!s) return '';
  return s.length <= 1 ? s : Array.from(s).join(' ');
}

/** 全量扫描(增量) */
export async function scanLibrary(): Promise<ScanResult> {
  if (status.scanning) throw new Error('扫描正在进行中');
  status.scanning = true;
  status.lastError = null;
  const startedAt = Date.now();
  const result: ScanResult = { startedAt, finishedAt: 0, durationMs: 0, added: [], updated: [], removed: [], unchanged: 0, errors: [] };

  try {
    const db = getDb();
    const dir = getNovelsDir();
    const files = walkTxtFiles(dir);
    const seenPaths = new Set<string>();

    for (const { filePath, category } of files) {
      seenPaths.add(filePath);
      try {
        const st = statSync(filePath);
        const existing = db
          .query('SELECT id, file_hash, file_size, file_mtime FROM books WHERE file_path = ?')
          .get(filePath) as { id: number; file_hash: string; file_size: number; file_mtime: number } | null;

        if (!existing) {
          upsertBook(filePath, category);
          result.added.push(filePath);
        } else if (existing.file_size === st.size && existing.file_mtime === Math.floor(st.mtimeMs)) {
          result.unchanged++; // UNCHANGED:不重新解析
        } else {
          // size/mtime 变化 → 复核内容 hash
          const buf = readFileSync(filePath);
          const hash = hashBuffer(buf);
          if (hash === existing.file_hash) {
            db.query('UPDATE books SET file_mtime = ?, file_size = ? WHERE id = ?').run(
              Math.floor(st.mtimeMs), st.size, existing.id,
            );
            result.unchanged++;
          } else {
            upsertBook(filePath, category, { reparse: true }); // MODIFIED → 重建章节索引
            result.updated.push(filePath);
          }
        }
      } catch (err: any) {
        result.errors.push({ file: filePath, message: err?.message || String(err) });
      }
    }

    // DELETED:数据库有但文件系统没有
    const rows = db.query('SELECT id, file_path FROM books').all() as { id: number; file_path: string }[];
    for (const row of rows) {
      if (!seenPaths.has(row.file_path)) {
        db.query('DELETE FROM chapters WHERE book_id = ?').run(row.id);
        db.query('DELETE FROM reading_progress WHERE book_id = ?').run(row.id);
        db.query('DELETE FROM books_fts WHERE book_id = ?').run(row.id);
        db.query('DELETE FROM books WHERE id = ?').run(row.id);
        result.removed.push(row.file_path);
      }
    }

    result.finishedAt = Date.now();
    result.durationMs = result.finishedAt - startedAt;
    status.lastResult = result;
    return result;
  } catch (err: any) {
    status.lastError = err?.message || String(err);
    throw err;
  } finally {
    status.scanning = false;
  }
}

/** 读取章节正文(字节段 → 解码) */
export async function readChapterContent(
  filePath: string,
  encoding: string,
  startOffset: number,
  endOffset: number,
): Promise<string> {
  const size = statSync(filePath).size;
  const start = Math.max(0, Math.min(startOffset, size));
  const end = Math.min(Math.max(endOffset, start), size);
  // Bun.file.slice + arrayBuffer 高效读取指定区间
  const f = Bun.file(filePath);
  const ab = await f.slice(start, end).arrayBuffer();
  const buf = Buffer.from(ab);
  return decodeBuffer(buf, encoding);
}

export { status as scanStatus };