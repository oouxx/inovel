import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

let _db: Database | null = null;
let _dataDir = './data';

export const DATA_DIR = () => _dataDir;
export const DB_PATH = () => path.join(_dataDir, 'novel-reader.db');

export function getDb(): Database {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}

export function initDb(dataDir: string): Database {
  _dataDir = dataDir;
  mkdirSync(dataDir, { recursive: true });
  _db = new Database(DB_PATH());
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA synchronous = NORMAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  migrate(_db);
  return _db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      author        TEXT NOT NULL DEFAULT '',
      file_path     TEXT NOT NULL UNIQUE,
      file_hash     TEXT,
      file_size     INTEGER DEFAULT 0,
      file_mtime    INTEGER DEFAULT 0,
      encoding      TEXT DEFAULT 'unknown',
      category      TEXT DEFAULT '',
      chapter_count INTEGER DEFAULT 0,
      status        TEXT DEFAULT 'ok',
      error         TEXT,
      created_at    INTEGER,
      updated_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id       INTEGER NOT NULL,
      chapter_index INTEGER NOT NULL,
      title         TEXT,
      start_offset  INTEGER,
      end_offset    INTEGER,
      confidence    REAL,
      created_at    INTEGER,
      UNIQUE(book_id, chapter_index)
    );
    CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, chapter_index);

    CREATE TABLE IF NOT EXISTS reading_progress (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id       INTEGER UNIQUE NOT NULL,
      chapter_index INTEGER DEFAULT 0,
      page          INTEGER DEFAULT 0,
      progress      REAL DEFAULT 0,
      updated_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id       INTEGER NOT NULL,
      chapter_index INTEGER,
      position      REAL,
      note          TEXT,
      created_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS ai_cache (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id       INTEGER,
      chapter_index INTEGER,
      prompt_hash   TEXT,
      model         TEXT,
      response      TEXT,
      created_at    INTEGER,
      UNIQUE(book_id, chapter_index, prompt_hash, model)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
      book_id UNINDEXED,
      title,
      author,
      category,
      tokenize = 'unicode61'
    );
  `);
}

/** 关闭数据库(测试/退出时用) */
export function closeDb() {
  _db?.close();
  _db = null;
}