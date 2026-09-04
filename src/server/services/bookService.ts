import type { Book, ChapterMeta, ReadingProgress } from '../../shared/types';
export type { ChapterMeta };
import { existsSync, unlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getDb, DATA_DIR } from '../database';

export function listBooks(opts: { category?: string; q?: string; limit?: number; offset?: number } = {}): Book[] {
  const db = getDb();
  const conds: string[] = [];
  const params: any[] = [];
  if (opts.category !== undefined && opts.category !== '') {
    conds.push('category = ?');
    params.push(opts.category);
  }
  if (opts.q) {
    conds.push('(title LIKE ? OR author LIKE ? OR category LIKE ? OR tags LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .query(`SELECT * FROM books ${where} ORDER BY title LIMIT ? OFFSET ?`)
    .all(...params, opts.limit ?? 500, opts.offset ?? 0) as Book[];
  return rows;
}

/** 与 listBooks 同条件的总数(分页用) */
export function countBooks(opts: { category?: string; q?: string } = {}): number {
  const db = getDb();
  const conds: string[] = [];
  const params: any[] = [];
  if (opts.category !== undefined && opts.category !== '') {
    conds.push('category = ?');
    params.push(opts.category);
  }
  if (opts.q) {
    conds.push('(title LIKE ? OR author LIKE ? OR category LIKE ? OR tags LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const row = db.query(`SELECT COUNT(*) AS c FROM books ${where}`).get() as { c: number } | undefined;
  return row?.c ?? 0;
}

export function getBook(id: number): Book | null {
  return (getDb().query('SELECT * FROM books WHERE id = ?').get(id) as Book) || null;
}

const COVER_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/**
 * 删除书籍:清理磁盘文件(仅限 NOVELS_DIR 内)、封面及所有关联数据
 * 返回是否成功移除了源文件
 */
export function deleteBook(id: number): { fileRemoved: boolean; title: string } {
  const db = getDb();
  const book = getBook(id);
  if (!book) return { fileRemoved: false, title: '' };

  // 1) 源文件:仅当位于 NOVELS_DIR 下才删,避免误删外部文件
  let fileRemoved = false;
  const novelsDir = path.resolve(process.env.NOVELS_DIR || path.join(DATA_DIR(), 'novels'));
  const fp = path.resolve(book.file_path);
  if (fp.startsWith(novelsDir + path.sep) || fp === novelsDir) {
    try {
      rmSync(fp, { force: true });
      fileRemoved = true;
    } catch {
      // 删文件失败不阻断 DB 清理(下次扫描可能还会重新收录)
    }
  }

  // 2) 封面文件
  for (const ext of COVER_EXTS) {
    const p = path.join(DATA_DIR(), 'covers', `${id}${ext}`);
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {}
    }
  }

  // 3) 数据库关联数据(章节/书签/进度/统计/AI 缓存/FTS 索引/主记录)
  db.transaction(() => {
    for (const sql of [
      'DELETE FROM chapters WHERE book_id = ?',
      'DELETE FROM bookmarks WHERE book_id = ?',
      'DELETE FROM reading_progress WHERE book_id = ?',
      'DELETE FROM reading_stats WHERE book_id = ?',
      'DELETE FROM ai_cache WHERE book_id = ?',
      'DELETE FROM books_fts WHERE book_id = ?',
      'DELETE FROM books WHERE id = ?',
    ]) {
      db.query(sql).run(id);
    }
  })();

  return { fileRemoved, title: book.title };
}

export function getBookChapters(bookId: number): ChapterMeta[] {
  return getDb()
    .query(
      'SELECT id, book_id, chapter_index, title, start_offset, end_offset, confidence FROM chapters WHERE book_id = ? ORDER BY chapter_index',
    )
    .all(bookId) as ChapterMeta[];
}

export function getChapter(bookId: number, chapterIndex: number): ChapterMeta | null {
  return (
    (getDb()
      .query('SELECT id, book_id, chapter_index, title, start_offset, end_offset, confidence FROM chapters WHERE book_id = ? AND chapter_index = ?')
      .get(bookId, chapterIndex) as ChapterMeta) || null
  );
}

export function getProgress(bookId: number): ReadingProgress | null {
  const row = getDb()
    .query('SELECT book_id, chapter_index, page, progress, updated_at FROM reading_progress WHERE book_id = ?')
    .get(bookId) as ReadingProgress | null;
  return row || null;
}

export function saveProgress(bookId: number, data: { chapter_index: number; page: number; progress: number }) {
  const db = getDb();
  const now = Date.now();
  db.query(
    `INSERT INTO reading_progress (book_id, chapter_index, page, progress, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET chapter_index=excluded.chapter_index, page=excluded.page,
     progress=excluded.progress, updated_at=excluded.updated_at`,
  ).run(bookId, data.chapter_index, data.page, data.progress, now);
}

/** 解析书籍标签(JSON 数组,容错) */
export function parseTags(book: Book): string[] {
  try {
    const arr = JSON.parse(book.tags || '[]');
    return Array.isArray(arr) ? arr.filter((t) => typeof t === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function saveTags(bookId: number, tags: string[]) {
  getDb()
    .query('UPDATE books SET tags = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(tags.slice(0, 12)), Date.now(), bookId);
}

export function listCategories(): { name: string; count: number }[] {
  return getDb()
    .query(`SELECT category AS name, COUNT(*) AS count FROM books GROUP BY category ORDER BY count DESC, name`)
    .all() as { name: string; count: number }[];
}

/** FTS5 + LIKE 混合搜索 */
export function searchBooks(q: string): SearchResult[] {
  const db = getDb();
  const trimmed = q.trim();
  if (!trimmed) return [];
  const results = new Map<number, SearchResult>();
  // 1) FTS:中文字符拆字匹配(AND 语义,相当于包含所有字)
  try {
    const ftsQuery = Array.from(trimmed).join(' ');
    const rows = db
      .query(
        `SELECT b.* FROM books_fts f JOIN books b ON b.id = f.book_id
         WHERE books_fts MATCH ? ORDER BY rank LIMIT 50`,
      )
      .all(ftsQuery) as unknown as Book[];
    for (const r of rows) results.set(r.id, toSearchItem(r));
  } catch {
    // FTS 查询语法问题则忽略
  }
  // 2) LIKE 兜底(英文单词 / 混合 / FTS 未命中 / 标签)
  const like = `%${trimmed}%`;
  const likeRows = db
    .query(`SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR category LIKE ? OR tags LIKE ? LIMIT 50`)
    .all(like, like, like, like) as unknown as Book[];
  for (const r of likeRows) results.set(r.id, toSearchItem(r));
  return [...results.values()];
}

export interface SearchResult {
  id: number;
  title: string;
  author: string;
  category: string;
  chapter_count: number;
  status: string;
  encoding: string;
}

function toSearchItem(b: Book): SearchResult {
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    category: b.category,
    chapter_count: b.chapter_count,
    status: b.status,
    encoding: b.encoding,
  };
}