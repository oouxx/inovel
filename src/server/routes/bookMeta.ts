import { Hono } from 'hono';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { getDb, DATA_DIR } from '../database';
import { getBook } from '../services/bookService';
import { syncFts } from '../scanner/scanner';

export const bookMetaRoutes = new Hono();

const COVER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/** 封面文件路径(存在则返回,否则 null) */
export function findCover(bookId: number): string | null {
  for (const ext of COVER_EXT) {
    const p = path.join(DATA_DIR(), 'covers', `${bookId}${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** 无封面时动态生成默认封面 SVG(渐变 + 书名首字) */
export function defaultCoverSvg(title: string): string {
  let hue = 210;
  try {
    for (const ch of title) hue = (hue * 31 + (ch.codePointAt(0) || 0)) % 360;
  } catch {}
  const hue2 = (hue + 40) % 360;
  const initial = (title || '书').slice(0, 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue}, 42%, 52%)"/>
    <stop offset="1" stop-color="hsl(${hue2}, 38%, 38%)"/>
  </linearGradient></defs>
  <rect width="300" height="420" fill="url(#g)"/>
  <text x="150" y="200" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif"
    font-size="96" font-weight="600" fill="#ffffff" opacity="0.95">${escapeXml(initial)}</text>
  <text x="150" y="370" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif"
    font-size="18" fill="#ffffff" opacity="0.85">${escapeXml(escapeXml(title).slice(0, 12))}</text>
</svg>`;
  return svg;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** GET /api/books/:id/cover —— 封面图片(无封面时返回生成的占位 SVG) */
bookMetaRoutes.get('/:id/cover', (c) => {
  const id = Number(c.req.param('id'));
  const book = getBook(id);
  if (!book) return c.notFound();
  const p = findCover(id);
  if (!p) {
    return new Response(defaultCoverSvg(book.title), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' },
    });
  }
  const ext = path.extname(p).toLowerCase();
  const mime =
    ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return new Response(Bun.file(p), { headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' } });
});

/** POST /api/books/:id/cover —— 上传封面(multipart: cover) */
bookMetaRoutes.post('/:id/cover', async (c) => {
  const id = Number(c.req.param('id'));
  if (!getBook(id)) return c.json({ error: 'book not found' }, 404);
  const body = await c.req.parseBody();
  const file = body['cover'];
  if (!(file instanceof File)) return c.json({ error: '缺少封面文件' }, 400);
  if (!file.type.startsWith('image/')) return c.json({ error: '仅支持图片' }, 400);

  const extMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  const ext = extMap[file.type] || '.jpg';
  const dir = path.join(DATA_DIR(), 'covers');
  mkdirSync(dir, { recursive: true });
  // 删除旧封面(不同扩展名)
  const old = findCover(id);
  if (old && path.extname(old) !== ext) {
    try {
      unlinkSync(old);
    } catch {}
  }
  const dest = path.join(dir, `${id}${ext}`);
  await Bun.write(dest, file);
  return c.json({ ok: true, coverUrl: `/api/books/${id}/cover` });
});

/** DELETE /api/books/:id/cover */
bookMetaRoutes.delete('/:id/cover', (c) => {
  const id = Number(c.req.param('id'));
  const old = findCover(id);
  if (old) {
    try {
      unlinkSync(old);
    } catch {}
  }
  return c.json({ ok: true });
});

/** PATCH /api/books/:id { title?, author?, category? } —— 编辑书籍信息 */
bookMetaRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const book = getBook(id);
  if (!book) return c.json({ error: 'book not found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : book.title;
  const author = typeof body.author === 'string' ? body.author.trim().slice(0, 100) : book.author;
  const category = typeof body.category === 'string' ? body.category.trim().slice(0, 50) : book.category;
  let tagsJson: string | null = null;
  if (Array.isArray(body.tags)) {
    const tags = body.tags
      .filter((t: unknown) => typeof t === 'string' && t.trim())
      .map((t: string) => t.trim().slice(0, 20))
      .slice(0, 12);
    tagsJson = JSON.stringify(tags);
  }
  getDb()
    .query('UPDATE books SET title = ?, author = ?, category = ?, tags = COALESCE(?, tags), updated_at = ? WHERE id = ?')
    .run(title, author, category, tagsJson, Date.now(), id);
  syncFts(id);
  return c.json({ ok: true, book: getBook(id) });
});