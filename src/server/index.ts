import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { initDb, getDb } from './database';
import { scanLibrary, getNovelsDir } from './scanner/scanner';
import { bookRoutes } from './routes/books';
import { chapterRoutes, contentRoutes, progressRoutes } from './routes/chapters';
import { searchRoutes } from './routes/search';
import { scannerRoutes } from './routes/scanner';
import { aiRoutes } from './routes/ai';
import { uploadRoutes } from './routes/upload';
import { bookmarkRoutes, bookmarkDeleteRoutes } from './routes/bookmarks';
import { statsRoutes } from './routes/stats';
import { fullTextSearch, type FullTextResult } from './services/searchService';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ---------- 配置 ----------
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || './data';
const NOVELS_DIR = process.env.NOVELS_DIR || path.join(DATA_DIR, 'novels');
process.env.NOVELS_DIR = NOVELS_DIR; // scanner 读取

// ---------- 数据库 ----------
initDb(DATA_DIR);

const app = new Hono();

// ---------- API ----------
const api = new Hono();
api.route('/books', bookRoutes);
api.route('/books', contentRoutes); // /api/books/:bookId/chapters/:index/content
api.route('/chapters', chapterRoutes);
api.route('/progress', progressRoutes);
api.route('/search', searchRoutes);
api.route('/scanner', scannerRoutes);
api.route('/ai', aiRoutes);
api.route('/upload', uploadRoutes);
api.route('/books', bookmarkRoutes); // /api/books/:id/bookmarks
api.route('/bookmarks', bookmarkDeleteRoutes);
api.route('/stats', statsRoutes);

// GET /api/books/:id/fulltext?q= —— 全书全文搜索
api.get('/books/:id/fulltext', (c) => {
  const id = Number(c.req.param('id'));
  const q = c.req.query('q') ?? '';
  const result: FullTextResult = fullTextSearch(id, q);
  return c.json(result);
});
api.get('/health', (c) => c.json({ ok: true, novelsDir: NOVELS_DIR }));
app.route('/api', api);

// ---------- 静态资源(Vue build 产物)+ SPA fallback ----------
const distDir = path.resolve(import.meta.dir, '../../dist');
const indexFile = path.join(distDir, 'index.html');
const hasDist = existsSync(indexFile);

if (hasDist) {
  const staticRoot = path.relative(process.cwd(), distDir);
  const indexHtml = await Bun.file(indexFile).text();
  app.use('/*', serveStatic({ root: staticRoot }));
  // SPA fallback:非 /api 路由回 index.html
  app.get('/*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    return c.html(indexHtml);
  });
} else {
  app.get('/', (c) =>
    c.html(
      `<h1>Novel Reader API</h1><p>前端未构建。开发时请运行 <code>bun run dev:client</code>(Vite :5173),或 <code>bun run build</code> 后重启。</p>`,
    ),
  );
}

// ---------- 启动 ----------
const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  development: process.env.NODE_ENV !== 'production',
});
console.log(`\n📖 Novel Reader`);
console.log(`   http://localhost:${PORT}`);
console.log(`   novels dir: ${path.resolve(NOVELS_DIR)}`);
console.log(`   data dir:   ${path.resolve(DATA_DIR)}`);
if (!hasDist) console.log('   (前端未构建,使用 Vite dev server 调试)');

// 启动时自动扫描书库(后台,不阻塞)
if (existsSync(NOVELS_DIR)) {
  scanLibrary()
    .then((r) => {
      const db = getDb();
      const count = (db.query('SELECT COUNT(*) AS n FROM books').get() as any).n;
      console.log(`   扫描完成:新增 ${r.added.length} · 更新 ${r.updated.length} · 未变化 ${r.unchanged} · 移除 ${r.removed.length} · 书库共 ${count} 本`);
    })
    .catch((e) => console.error('   扫描失败:', e));
} else {
  console.log('   (novels 目录不存在,等待放入 TXT 后调用 POST /api/scanner/scan)');
}

export default app;