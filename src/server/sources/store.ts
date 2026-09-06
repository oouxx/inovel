// ---------- 书源存储与导入 ----------
import { getDb } from '../database';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { RawBookSource } from './types';
import type { BookSource } from '../../shared/types';

/** 解析书源 JSON 文本 → 规范化书源数组(去重) */
export function parseSourceJson(text: string): { sources: RawBookSource[]; error?: string } {
  const t = text.trim();
  if (!t) return { sources: [], error: '内容为空' };
  // Legado 导出可能带 BOM 或前后杂文本:找第一个 [ 或 {
  const start = Math.min(
    ...['[', '{'].map((c) => { const i = t.indexOf(c); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }),
  );
  const jsonText = Number.isFinite(start) && start < t.length ? t.slice(start) : t;
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch (e: any) {
    return { sources: [], error: `JSON 解析失败: ${String(e?.message || e).slice(0, 120)}` };
  }
  const arr: any[] = Array.isArray(data) ? data : [data];
  const sources: RawBookSource[] = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    if (!s.bookSourceUrl || !s.bookSourceName) continue;
    sources.push(s as RawBookSource);
  }
  if (!sources.length) return { sources: [], error: '未找到有效书源(缺少 bookSourceUrl/bookSourceName)' };
  return { sources };
}

export interface ImportResult {
  added: number;
  updated: number;
  total: number;
  error?: string;
}

export function importSources(text: string, opts: { preserveState?: boolean } = {}): ImportResult {
  const { sources, error } = parseSourceJson(text);
  if (error || !sources.length) return { added: 0, updated: 0, total: 0, error: error || '无效书源' };
  const db = getDb();
  const now = Date.now();
  let added = 0;
  let updated = 0;
  // preserveState: 已存在的源保留用户的启停状态(用于内置书源升级规则)
  const stateExpr = opts.preserveState ? 'book_sources.enabled' : 'excluded.enabled';
  const exploreExpr = opts.preserveState ? 'book_sources.enabled_explore' : 'excluded.enabled_explore';
  const upsert = db.prepare(
    `INSERT INTO book_sources (book_source_url, name, group_name, enabled, enabled_explore, custom_order, raw, last_import_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_source_url) DO UPDATE SET
       name=excluded.name, group_name=excluded.group_name, enabled=${stateExpr},
       enabled_explore=${exploreExpr}, custom_order=excluded.custom_order,
       raw=excluded.raw, last_import_at=excluded.last_import_at`,
  );
  db.transaction(() => {
    for (const s of sources) {
      const exists = db.query('SELECT 1 FROM book_sources WHERE book_source_url = ?').get(s.bookSourceUrl);
      if (exists) updated++;
      else added++;
      upsert.run(
        s.bookSourceUrl,
        s.bookSourceName,
        s.bookSourceGroup ?? null,
        s.enabled === false ? 0 : 1,
        s.enabledExplore ? 1 : 0,
        s.customOrder ?? 0,
        JSON.stringify(s),
        now,
      );
    }
  })();
  return { added, updated, total: sources.length };
}

/** 启动时导入内置书源(builtin 目录),已存在只升级规则、保留启停状态 */
export function importBuiltinSources(): { file: string; result: ImportResult }[] {
  const out: { file: string; result: ImportResult }[] = [];
  try {
    const dir = path.join(import.meta.dir, 'builtin');
    if (!existsSync(dir)) return out;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const text = readFileSync(path.join(dir, f), 'utf-8');
        out.push({ file: f, result: importSources(text, { preserveState: true }) });
      } catch (e) {
        console.error(`  内置书源 ${f} 导入失败:`, e);
      }
    }
  } catch {}
  return out;
}

export function listSources(): BookSource[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT book_source_url, name, group_name, enabled, enabled_explore, custom_order, last_import_at, respond_time
       FROM book_sources ORDER BY custom_order ASC, name ASC`,
    )
    .all() as any[];
  return rows.map((r) => ({
    bookSourceUrl: r.book_source_url,
    bookSourceName: r.name,
    bookSourceGroup: r.group_name,
    enabled: !!r.enabled,
    enabledExplore: !!r.enabled_explore,
    customOrder: r.custom_order,
    lastImportAt: r.last_import_at,
    respondTime: r.respond_time,
  }));
}

export function getSourceRaw(sourceUrl: string): RawBookSource | null {
  const db = getDb();
  const row = db.query('SELECT raw FROM book_sources WHERE book_source_url = ?').get(sourceUrl) as
    | { raw: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.raw) as RawBookSource;
  } catch {
    return null;
  }
}

export function getSourceVariable(sourceUrl: string): string {
  const db = getDb();
  const row = db.query(`SELECT variable FROM book_sources WHERE book_source_url = ?`).get(sourceUrl) as
    | { variable: string | null }
    | undefined;
  return row?.variable ?? '';
}

export function setSourceVariable(sourceUrl: string, v: string) {
  const db = getDb();
  db.query('UPDATE book_sources SET variable = ? WHERE book_source_url = ?').run(v, sourceUrl);
}

export function getLoginInfo(sourceUrl: string): Record<string, string> {
  const db = getDb();
  const row = db.query(`SELECT login_info FROM book_sources WHERE book_source_url = ?`).get(sourceUrl) as
    | { login_info: string | null }
    | undefined;
  if (!row?.login_info) return {};
  try {
    return JSON.parse(row.login_info);
  } catch {
    return {};
  }
}

export function setSourceEnabled(sourceUrl: string, enabled: boolean) {
  getDb().query('UPDATE book_sources SET enabled = ? WHERE book_source_url = ?').run(enabled ? 1 : 0, sourceUrl);
}

export function setSourceRespondTime(sourceUrl: string, ms: number) {
  getDb().query('UPDATE book_sources SET respond_time = ? WHERE book_source_url = ?').run(ms, sourceUrl);
}

export function deleteSource(sourceUrl: string): boolean {
  const r = getDb().query('DELETE FROM book_sources WHERE book_source_url = ?').run(sourceUrl);
  return r.changes > 0;
}

export function countSources(): number {
  return (getDb().query('SELECT COUNT(*) AS n FROM book_sources').get() as any).n;
}