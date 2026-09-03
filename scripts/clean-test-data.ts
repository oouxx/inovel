/**
 * 清理测试数据:
 *  - 文件:删除 data/novels 下的测试目录(如 测试/)与文件名含 "-测试" 的 txt
 *  - 数据库:删除对应 books 记录及其 chapters/bookmarks/reading_progress/reading_stats/ai_cache/FTS 行,
 *           并清理指向已不存在书籍的孤儿记录(含 mock-model 测试响应)
 *  - 收尾:WAL checkpoint + VACUUM,保证 db 文件可直接 rsync
 *
 * 用法: bun run scripts/clean-test-data.ts [--dry-run]
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';

const ROOT = path.resolve(import.meta.dir, '..');
const NOVELS_DIR = path.join(ROOT, 'data', 'novels');
const DB_FILE = path.join(ROOT, 'data', 'novel-reader.db');
const DRY_RUN = process.argv.includes('--dry-run');

/** 判定测试文件:路径含 "测试" 目录段,或文件名含 "测试" */
function isTestPath(p: string): boolean {
  const norm = p.split(path.sep).join('/');
  return /(^|\/)测试(\/|$)/.test(norm) || /测试/.test(path.basename(norm));
}

if (!existsSync(NOVELS_DIR)) {
  console.error(`✗ 未找到书库目录: ${NOVELS_DIR}`);
  process.exit(1);
}

// ---------- 1. 扫描测试文件 ----------
const testFiles: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && isTestPath(full)) testFiles.push(full);
  }
};
walk(NOVELS_DIR);

console.log(DRY_RUN ? '== DRY RUN ==\n' : '');
if (testFiles.length === 0) {
  console.log('未发现测试文件');
} else {
  console.log(`将删除 ${testFiles.length} 个测试文件:`);
  for (const f of testFiles) console.log(`  - ${path.relative(ROOT, f)} (${statSync(f).size} B)`);
}

// ---------- 2. 清理数据库 ----------
if (!existsSync(DB_FILE)) {
  console.error(`✗ 未找到数据库: ${DB_FILE}`);
  process.exit(1);
}
const db = new Database(DB_FILE);
const books = db
  .query<{ id: number; title: string; file_path: string }, []>(
    'SELECT id, title, file_path FROM books',
  )
  .all()
  .filter((b) => isTestPath(b.file_path) || false);

if (books.length > 0) {
  console.log(`将删除 ${books.length} 条测试书籍记录:`);
  for (const b of books) console.log(`  - #${b.id} ${b.title} (${b.file_path})`);
}

const CHILD_TABLES = [
  'chapters',
  'bookmarks',
  'reading_progress',
  'reading_stats',
  'ai_cache',
  'books_fts',
];

const del = (sql: string, ...params: any[]) => {
  if (DRY_RUN) return;
  db.run(sql, ...params);
};

db.run('BEGIN');
try {
  if (books.length > 0) {
    const ids = books.map((b) => b.id);
    const ph = ids.map(() => '?').join(',');
    for (const t of CHILD_TABLES) del(`DELETE FROM ${t} WHERE book_id IN (${ph})`, ...ids);
    del(`DELETE FROM books WHERE id IN (${ph})`, ...ids);
  }
  // 孤儿记录:引用已不存在的 book_id(历史扫描残留/mock 测试响应)
  for (const t of CHILD_TABLES) {
    del(`DELETE FROM ${t} WHERE book_id NOT IN (SELECT id FROM books)`);
  }
  // mock 测试响应兜底
  del(`DELETE FROM ai_cache WHERE model = 'mock-model'`);
  db.run('COMMIT');
} catch (e) {
  db.run('ROLLBACK');
  throw e;
}

// ---------- 3. 删除文件 ----------
if (!DRY_RUN && testFiles.length > 0) {
  for (const f of testFiles) rmSync(f);
  // 清掉变空的分类目录
  for (const e of readdirSync(NOVELS_DIR, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const dir = path.join(NOVELS_DIR, e.name);
      if (readdirSync(dir).length === 0) {
        rmSync(dir, { recursive: true });
        console.log(`已删除空目录: ${path.relative(ROOT, dir)}`);
      }
    }
  }
}

// ---------- 4. 收尾 ----------
if (!DRY_RUN) {
  db.run('PRAGMA wal_checkpoint(FULL)');
  db.run('VACUUM');
  const remain = db.query('SELECT id, title, category FROM books').all();
  console.log(`\n✓ 清理完成,剩余书籍 ${remain.length} 本:`);
  for (const b of remain) console.log(`  - #${b.id} [${b.category}] ${b.title}`);
}
db.close();