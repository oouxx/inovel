import { Hono } from 'hono';
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
import { bookMetaRoutes } from './routes/bookMeta';
import { onlineRoutes } from './routes/online';
import { existsSync, statSync } from 'node:fs';
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
api.route('/books', bookMetaRoutes); // 封面 / 编辑书籍信息
api.route('/online', onlineRoutes); // 在线书源(Legado)

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

const STATIC_MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

if (hasDist) {
  const indexHtml = await Bun.file(indexFile).text();

  /**
   * 自实现静态服务,确保 MIME 永远正确:
   * - /assets/* 等 hash 资源:immutable 强缓存;缺失时 404(绝不返回 HTML 冒充 JS/CSS)
   * - index.html:Cache-Control: no-cache,防止浏览器缓存旧 HTML 引用失效资源
   * - 无扩展名路径(/books/3 等):SPA fallback → index.html
   */
  app.get('/*', (c) => {
    const raw = c.req.path;
    if (raw.startsWith('/api/')) return c.notFound();

    let p: string;
    try {
      p = decodeURIComponent(raw);
    } catch {
      return c.notFound();
    }
    const ext = path.extname(p);

    if (ext) {
      // 静态文件请求
      const rel = p.replace(/^\/+/, '');
      if (rel.includes('..')) return c.notFound(); // 防目录穿越
      const abs = path.join(distDir, rel);
      if (existsSync(abs) && statSync(abs).isFile()) {
        const headers: Record<string, string> = {
          'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
          // hash 文件名 → 可强缓存;html 例外(index.html 理论上走无扩展名分支)
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        };
        return new Response(Bun.file(abs), { headers });
      }
      // 资源缺失:明确 404,而不是返回 index.html
      return c.notFound();
    }

    // SPA 路由 → index.html
    return new Response(indexHtml, {
      headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache' },
    });
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
