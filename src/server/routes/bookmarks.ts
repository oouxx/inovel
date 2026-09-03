import { Hono } from 'hono';
import { getDb } from '../database';
import { getBook, getChapter } from '../services/bookService';

export const bookmarkRoutes = new Hono();

interface BookmarkRow {
  id: number;
  book_id: number;
  chapter_index: number;
  position: number;
  note: string | null;
  created_at: number;
}

/** GET /api/books/:id/bookmarks */
bookmarkRoutes.get('/:id/bookmarks', (c) => {
  const bookId = Number(c.req.param('id'));
  if (!getBook(bookId)) return c.json({ error: 'not found' }, 404);
  const rows = getDb()
    .query(
      `SELECT b.id, b.book_id, b.chapter_index, b.position, b.note, b.created_at, c.title AS chapter_title
       FROM bookmarks b LEFT JOIN chapters c ON c.book_id = b.book_id AND c.chapter_index = b.chapter_index
       WHERE b.book_id = ? ORDER BY b.created_at DESC`,
    )
    .all(bookId) as (BookmarkRow & { chapter_title: string | null })[];
  return c.json({ bookmarks: rows });
});

/** POST /api/books/:id/bookmarks { chapter_index, position, note? } */
bookmarkRoutes.post('/:id/bookmarks', async (c) => {
  const bookId = Number(c.req.param('id'));
  if (!getBook(bookId)) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.chapter_index !== 'number') return c.json({ error: 'invalid body' }, 400);
  const chapterIndex = body.chapter_index;
  const position = Math.min(1, Math.max(0, Number(body.position) || 0));
  // 去重:同一章节同一位置(±0.01)不重复添加
  const existing = getDb()
    .query('SELECT id, position FROM bookmarks WHERE book_id = ? AND chapter_index = ?')
    .all(bookId, chapterIndex) as { id: number; position: number }[];
  for (const e of existing) {
    if (Math.abs(e.position - position) < 0.01) {
      return c.json({ ok: true, id: e.id, duplicate: true });
    }
  }
  const r = getDb()
    .query('INSERT INTO bookmarks (book_id, chapter_index, position, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(bookId, chapterIndex, position, body.note ?? null, Date.now());
  return c.json({ ok: true, id: Number(r.lastInsertRowid) });
});

/** DELETE /api/bookmarks/:id */
export const bookmarkDeleteRoutes = new Hono();
bookmarkDeleteRoutes.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  getDb().query('DELETE FROM bookmarks WHERE id = ?').run(id);
  return c.json({ ok: true });
});