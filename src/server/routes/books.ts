import { Hono } from 'hono';
import { listBooks, getBook, getBookChapters, listCategories } from '../services/bookService';

export const bookRoutes = new Hono();

/** GET /api/books?category=&q= */
bookRoutes.get('/', (c) => {
  const category = c.req.query('category');
  const q = c.req.query('q');
  const books = listBooks({ category, q });
  return c.json({ books });
});

/** GET /api/books/categories */
bookRoutes.get('/categories', (c) => {
  return c.json({ categories: listCategories() });
});

/** GET /api/books/:id */
bookRoutes.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const book = getBook(id);
  if (!book) return c.json({ error: 'not found' }, 404);
  return c.json({ book });
});

/** GET /api/books/:id/chapters */
bookRoutes.get('/:id/chapters', (c) => {
  const id = Number(c.req.param('id'));
  const book = getBook(id);
  if (!book) return c.json({ error: 'not found' }, 404);
  const chapters = getBookChapters(id);
  return c.json({ book: { id: book.id, title: book.title }, chapters });
});