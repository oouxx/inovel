import { Hono } from 'hono';
import { getNovelsDir, analyzeTxt, upsertBook } from '../scanner/scanner';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../database';

export const uploadRoutes = new Hono();

/**
 * POST /api/upload —— 批量导入
 * multipart: files[] (多个 TXT)
 * 保存到 NOVELS_DIR/uploads/ 并立即解析,返回每个文件的解析结果
 */
uploadRoutes.post('/', async (c) => {
  const body = await c.req.parseBody();
  const files: File[] = [];
  for (const [, value] of Object.entries(body)) {
    if (value instanceof File) files.push(value);
  }
  if (files.length === 0) return c.json({ error: '没有收到文件' }, 400);

  const dir = getNovelsDir();
  const uploadDir = path.join(dir, 'uploads');
  await mkdir(uploadDir, { recursive: true });

  const results: { fileName: string; status: string; chapterCount: number; encoding: string; error?: string }[] = [];

  for (const file of files) {
    if (!/\.txt$/i.test(file.name)) {
      results.push({ fileName: file.name, status: 'error', chapterCount: 0, encoding: '-', error: '仅支持 TXT 文件' });
      continue;
    }
    try {
      const safeName = file.name.replace(/[\\/:*?"<>|]/g, '_');
      const dest = path.join(uploadDir, safeName);
      await Bun.write(dest, file);
      // 快速解析以返回状态
      const info = analyzeTxt(dest);
      upsertBook(dest, 'uploads');
      results.push({
        fileName: safeName,
        status: info.detected ? 'ok' : 'warn',
        chapterCount: info.chapters.length,
        encoding: info.encoding,
        error: info.detected ? undefined : '章节识别异常,按全文单章处理',
      });
    } catch (err: any) {
      results.push({ fileName: file.name, status: 'error', chapterCount: 0, encoding: '-', error: err?.message || String(err) });
    }
  }

  return c.json({ results });
});

/** GET /api/books/:id/file-info —— 书籍文件信息(管理页) */
uploadRoutes.get('/file-info/:bookId', (c) => {
  const bookId = Number(c.req.param('bookId'));
  const book = (getDb().query('SELECT id, title, file_path, file_size, encoding, status, error, chapter_count FROM books WHERE id = ?').get(bookId)) as any;
  if (!book) return c.json({ error: 'not found' }, 404);
  return c.json({ book });
});