import type { Book, ChapterMeta, ReadingProgress } from '../../shared/types';
export type { ChapterMeta };
import { getDb } from '../database';

export function listBooks(opts: { category?: string; q?: string; limit?: number; offset?: number } = {}): Book[] {
  const db = getDb();
  const conds: string[] = [];
  const params: any[] = [];
  if (opts.category !== undefined && opts.category !== '') {
    conds.push('category = ?');
    params.push(opts.category);
  }
  if (opts.q) {
    conds.push('(title LIKE ? OR author LIKE ? OR category LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .query(`SELECT * FROM books ${where} ORDER BY title LIMIT ? OFFSET ?`)
    .all(...params, opts.limit ?? 500, opts.offset ?? 0) as Book[];
  return rows;
}

export function getBook(id: number): Book | null {
  return (getDb().query('SELECT * FROM books WHERE id = ?').get(id) as Book) || null;
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
  // 2) LIKE 兜底(英文单词 / 混合 / FTS 未命中)
  const like = `%${trimmed}%`;
  const likeRows = db
    .query(`SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR category LIKE ? LIMIT 50`)
    .all(like, like, like) as unknown as Book[];
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