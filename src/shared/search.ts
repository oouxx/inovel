// ---------- 聚合搜索(行为对齐原版阅读 Legado SearchModel) ----------
// 同书同作者跨源合并为一条;分桶排序:精确匹配 → 标签命中 → 包含匹配 → 其他,
// 桶内按命中源数降序。前后端共用(纯函数,无 Node 依赖)。
import type { OnlineSearchBook, OnlineSearchBookMerged, OnlineSearchOrigin } from './types';

export interface SourceSearchPart {
  sourceUrl: string;
  sourceName: string;
  sourceType: number;
  books: OnlineSearchBook[];
}

/** 原版按 name+author 全等去重 */
export function searchMergeKey(name: string, author: string): string {
  return `${name}\u0000${author}`;
}

/** 原版精确搜索(precisionSearch):书名/作者/标签任一包含关键词才保留 */
export function precisionMatch(b: Pick<OnlineSearchBook, 'name' | 'author' | 'kind'>, keyword: string): boolean {
  return b.name.includes(keyword) || b.author.includes(keyword) || b.kind.includes(keyword);
}

/** 原版分桶:精确 → 标签 → 包含 → 其他;桶内按命中源数(origins)降序 */
export function sortSearchBooks(books: OnlineSearchBookMerged[], keyword: string): OnlineSearchBookMerged[] {
  const equal: OnlineSearchBookMerged[] = [];
  const tags: OnlineSearchBookMerged[] = [];
  const contains: OnlineSearchBookMerged[] = [];
  const other: OnlineSearchBookMerged[] = [];
  for (const b of books) {
    if (b.name === keyword || b.author === keyword) equal.push(b);
    else if (b.kind.includes(keyword)) tags.push(b);
    else if (b.name.includes(keyword) || b.author.includes(keyword)) contains.push(b);
    else other.push(b);
  }
  const byOrigins = (a: OnlineSearchBookMerged, c: OnlineSearchBookMerged) => c.origins.length - a.origins.length;
  equal.sort(byOrigins);
  tags.sort(byOrigins);
  contains.sort(byOrigins);
  return [...equal, ...tags, ...contains, ...other];
}

/**
 * 跨源合并去重(原版 mergeItems):
 * - key = (name, author) 全等
 * - 主字段取首次命中来源,origins 累积全部来源(含各自的 bookUrl/sourceType)
 */
export function mergeSourceBooks(
  parts: SourceSearchPart[],
  keyword: string,
  precision: boolean,
  limit = 1000,
): { merged: OnlineSearchBookMerged[]; truncated: boolean } {
  const map = new Map<string, OnlineSearchBookMerged>();
  for (const part of parts) {
    for (const b of part.books) {
      if (precision && !precisionMatch(b, keyword)) continue;
      const k = searchMergeKey(b.name, b.author);
      const origin: OnlineSearchOrigin = {
        sourceUrl: part.sourceUrl,
        sourceName: part.sourceName,
        bookUrl: b.bookUrl,
        sourceType: part.sourceType,
        coverUrl: b.coverUrl,
        latestChapter: b.latestChapter,
        kind: b.kind,
        wordCount: b.wordCount,
      };
      const existing = map.get(k);
      if (existing) {
        existing.origins.push(origin);
      } else {
        map.set(k, {
          name: b.name,
          author: b.author,
          kind: b.kind,
          intro: b.intro,
          coverUrl: b.coverUrl,
          latestChapter: b.latestChapter,
          bookUrl: b.bookUrl,
          wordCount: b.wordCount,
          sourceUrl: part.sourceUrl,
          sourceName: part.sourceName,
          origins: [origin],
        });
      }
    }
  }
  const merged = sortSearchBooks([...map.values()], keyword);
  return { merged: merged.slice(0, limit), truncated: merged.length > limit };
}

/** 客户端增量合并(翻页追加):同名书合并 origins,重复来源去重 */
export function mergeFlatPage(
  existing: OnlineSearchBookMerged[],
  incoming: OnlineSearchBookMerged[],
  keyword: string,
  limit = 1000,
): OnlineSearchBookMerged[] {
  const map = new Map<string, OnlineSearchBookMerged>();
  for (const b of existing) map.set(searchMergeKey(b.name, b.author), b);
  for (const b of incoming) {
    const k = searchMergeKey(b.name, b.author);
    const ex = map.get(k);
    if (ex) {
      const seen = new Set(ex.origins.map((o) => `${o.sourceUrl}\u0000${o.bookUrl}`));
      for (const o of b.origins) {
        if (!seen.has(`${o.sourceUrl}\u0000${o.bookUrl}`)) ex.origins.push(o);
      }
    } else {
      map.set(k, { ...b, origins: [...b.origins] });
    }
  }
  return sortSearchBooks([...map.values()], keyword).slice(0, limit);
}