import { Hono } from 'hono';
import { getBook, getChapter, getProgress, saveProgress } from '../services/bookService';
import { readChapterContent } from '../scanner/scanner';

export const chapterRoutes = new Hono();

/** GET /api/chapters/:id/content?id 方式或 /api/books/:bookId/chapters/:index/content */
export const contentRoutes = new Hono();

/** GET /api/chapters/:id/content —— 章节内容 */
chapterRoutes.get('/:id/content', async (c) => {
  const chapterId = Number(c.req.param('id'));
  const db = (await import('../database')).getDb();
  const meta = db
    .query('SELECT id, book_id, chapter_index, title, start_offset, end_offset FROM chapters WHERE id = ?')
    .get(chapterId) as any;
  if (!meta) return c.json({ error: 'not found' }, 404);
  const book = getBook(meta.book_id);
  if (!book) return c.json({ error: 'book not found' }, 404);
  try {
    const content = await readChapterContent(book.file_path, book.encoding, meta.start_offset, meta.end_offset);
    return c.json({
      chapter: {
        id: meta.id,
        book_id: meta.book_id,
        chapter_index: meta.chapter_index,
        title: meta.title,
      },
      content,
    });
  } catch (err: any) {
    return c.json({ error: err?.message || '读取章节失败' }, 500);
  }
});

/** GET /api/books/:bookId/chapters/:index/content —— 按索引读取(阅读器主用) */
contentRoutes.get('/:bookId/chapters/:index/content', async (c) => {
  const bookId = Number(c.req.param('bookId'));
  const index = Number(c.req.param('index'));
  const book = getBook(bookId);
  if (!book) return c.json({ error: 'book not found' }, 404);
  const meta = getChapter(bookId, index);
  if (!meta) return c.json({ error: 'chapter not found' }, 404);
  try {
    const content = await readChapterContent(book.file_path, book.encoding, meta.start_offset, meta.end_offset);
    return c.json({
      chapter: {
        id: meta.id,
        book_id: bookId,
        chapter_index: meta.chapter_index,
        title: meta.title,
      },
      content,
    });
  } catch (err: any) {
    return c.json({ error: err?.message || '读取章节失败' }, 500);
  }
});

export const progressRoutes = new Hono();

/** GET /api/progress/:bookId */
progressRoutes.get('/:bookId', (c) => {
  const bookId = Number(c.req.param('bookId'));
  const progress = getProgress(bookId);
  return c.json({ progress });
});

/** PUT /api/progress/:bookId { chapter_index, page, progress } */
progressRoutes.put('/:bookId', async (c) => {
  const bookId = Number(c.req.param('bookId'));
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.chapter_index !== 'number') {
    return c.json({ error: 'invalid body' }, 400);
  }
  saveProgress(bookId, {
    chapter_index: body.chapter_index,
    page: Math.max(0, Number(body.page) || 0),
    progress: Math.min(1, Math.max(0, Number(body.progress) || 0)),
  });
  return c.json({ ok: true });
});