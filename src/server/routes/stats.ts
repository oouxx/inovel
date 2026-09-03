import { Hono } from 'hono';
import { getDb } from '../database';
import { getBook } from '../services/bookService';

export const statsRoutes = new Hono();

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** POST /api/stats/heartbeat { bookId, seconds } —— 阅读心跳(前端每 30s) */
statsRoutes.post('/heartbeat', async (c) => {
  const body = await c.req.json().catch(() => null);
  const bookId = Number(body?.bookId);
  const seconds = Math.min(120, Math.max(1, Math.round(Number(body?.seconds) || 0)));
  if (!bookId || !getBook(bookId)) return c.json({ error: 'book not found' }, 404);
  const day = today();
  getDb()
    .query(
      `INSERT INTO reading_stats (book_id, day, seconds) VALUES (?, ?, ?)
       ON CONFLICT(book_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`,
    )
    .run(bookId, day, seconds);
  return c.json({ ok: true });
});

/** GET /api/stats —— 汇总 */
statsRoutes.get('/', (c) => {
  const db = getDb();
  const day = today();
  const todayRow = db
    .query('SELECT COALESCE(SUM(seconds), 0) AS s FROM reading_stats WHERE day = ?')
    .get(day) as { s: number };
  const totalRow = db.query('SELECT COALESCE(SUM(seconds), 0) AS s FROM reading_stats').get() as { s: number };
  const books = db
    .query(
      `SELECT rs.book_id AS id, b.title, SUM(rs.seconds) AS seconds
       FROM reading_stats rs JOIN books b ON b.id = rs.book_id
       GROUP BY rs.book_id ORDER BY seconds DESC LIMIT 10`,
    )
    .all() as { id: number; title: string; seconds: number }[];
  const days = db
    .query(
      `SELECT day, SUM(seconds) AS seconds FROM reading_stats
       WHERE day >= date('now', '-13 days') GROUP BY day ORDER BY day`,
    )
    .all() as { day: string; seconds: number }[];
  return c.json({
    todaySeconds: todayRow.s,
    totalSeconds: totalRow.s,
    books: books.map((b) => ({ id: b.id, title: b.title, seconds: b.seconds })),
    days,
  });
});