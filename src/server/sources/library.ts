// ---------- 在线书架(音频/漫画等流式阅读) ----------
import { getDb } from '../database';
import type { OnlineChapter, OnlineLibraryBook } from '../../shared/types';
import { getBookInfo, getToc } from './engine';

export interface OnlineBookRow {
  id: number;
  source_url: string;
  book_url: string;
  name: string;
  author: string;
  cover_url: string;
  source_type: number;
  toc: string | null;
  toc_updated_at: number | null;
  created_at: number;
}

/** 加入书架:抓取目录并入库(已存在则更新信息与目录) */
export async function addOnlineBook(
  sourceUrl: string,
  bookUrl: string,
  name: string,
  author: string,
  coverUrl: string,
  sourceType: number,
): Promise<OnlineLibraryBook> {
  const db = getDb();
  const now = Date.now();
  // 先取详情(解析 tocUrl 与规范化的书名/作者/封面),再抓目录
  const sessionVars = new Map<string, string>();
  const { info } = await getBookInfo(sourceUrl, bookUrl, sessionVars);
  const finalName = info.name || name;
  const finalAuthor = info.author || author;
  const finalCover = info.coverUrl || coverUrl;
  const chapters = (await getToc(sourceUrl, info.tocUrl || bookUrl, sessionVars)).chapters;

  const existing = db
    .query('SELECT id FROM online_books WHERE source_url = ? AND book_url = ?')
    .get(sourceUrl, bookUrl) as { id: number } | undefined;

  let id: number;
  if (existing) {
    id = existing.id;
    db.query(
      `UPDATE online_books SET name=?, author=?, cover_url=?, source_type=?, toc=?, toc_updated_at=? WHERE id=?`,
    ).run(finalName, finalAuthor, finalCover, sourceType, JSON.stringify(chapters), now, id);
  } else {
    const r = db
      .query(
        `INSERT INTO online_books (source_url, book_url, name, author, cover_url, source_type, toc, toc_updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sourceUrl, bookUrl, finalName, finalAuthor, finalCover, sourceType, JSON.stringify(chapters), now, now);
    id = Number(r.lastInsertRowid);
  }
  return getOnlineBook(id)!;
}

export function getOnlineBook(id: number): OnlineLibraryBook | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT b.*, p.chapter_index AS p_chapter, p.position AS p_position
       FROM online_books b LEFT JOIN online_progress p ON p.online_book_id = b.id
       WHERE b.id = ?`,
    )
    .get(id) as any;
  if (!row) return null;
  const chapters: OnlineChapter[] = row.toc ? JSON.parse(row.toc) : [];
  return {
    id: row.id,
    sourceUrl: row.source_url,
    bookUrl: row.book_url,
    name: row.name,
    author: row.author,
    coverUrl: row.cover_url,
    sourceType: row.source_type,
    chapterCount: chapters.filter((c) => c.url).length,
    progress: row.toc_updated_at
      ? { chapter_index: row.chapter_index ?? 0, position: row.position ?? 0 }
      : null,
    createdAt: row.created_at,
  };
}

export function getOnlineBookToc(id: number): OnlineChapter[] {
  const db = getDb();
  const row = db.query('SELECT toc FROM online_books WHERE id = ?').get(id) as { toc: string | null } | undefined;
  if (!row?.toc) return [];
  try {
    return JSON.parse(row.toc) as OnlineChapter[];
  } catch {
    return [];
  }
}

export function listOnlineBooks(): OnlineLibraryBook[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT b.id, b.source_url, b.book_url, b.name, b.author, b.cover_url, b.source_type,
              b.toc, b.toc_updated_at, b.created_at, p.chapter_index AS p_chapter, p.position AS p_position
       FROM online_books b LEFT JOIN online_progress p ON p.online_book_id = b.id
       ORDER BY COALESCE(p.updated_at, b.created_at) DESC`,
    )
    .all() as any[];
  return rows.map((row) => {
    let chapterCount = 0;
    try {
      chapterCount = row.toc ? (JSON.parse(row.toc) as OnlineChapter[]).filter((c) => c.url).length : 0;
    } catch {}
    return {
      id: row.id,
      sourceUrl: row.source_url,
      bookUrl: row.book_url,
      name: row.name,
      author: row.author,
      coverUrl: row.cover_url,
      sourceType: row.source_type,
      chapterCount,
      progress: row.created_at
        ? { chapter_index: row.p_chapter ?? 0, position: row.p_position ?? 0 }
        : null,
      createdAt: row.created_at,
    };
  });
}

export function deleteOnlineBook(id: number): boolean {
  const db = getDb();
  db.query('DELETE FROM online_progress WHERE online_book_id = ?').run(id);
  return db.query('DELETE FROM online_books WHERE id = ?').run(id).changes > 0;
}

export function getOnlineProgress(id: number): { chapter_index: number; position: number } | null {
  const row = getDb()
    .query('SELECT chapter_index, position FROM online_progress WHERE online_book_id = ?')
    .get(id) as { chapter_index: number; position: number } | undefined;
  return row ?? null;
}

export function saveOnlineProgress(id: number, chapterIndex: number, position: number) {
  getDb()
    .query(
      `INSERT INTO online_progress (online_book_id, chapter_index, position, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(online_book_id) DO UPDATE SET chapter_index=excluded.chapter_index,
         position=excluded.position, updated_at=excluded.updated_at`,
    )
    .run(id, chapterIndex, position, Date.now());
}