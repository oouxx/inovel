import { Hono } from 'hono';
import { searchBooks } from '../services/bookService';

export const searchRoutes = new Hono();

/** GET /api/search?q= */
searchRoutes.get('/', (c) => {
  const q = c.req.query('q') || '';
  if (!q.trim()) return c.json({ results: [] });
  return c.json({ results: searchBooks(q) });
});