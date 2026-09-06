// 统一 API 封装
import type {
  Book,
  BookSource,
  ChapterMeta,
  OnlineBookInfo,
  OnlineChapter,
  OnlineDownloadTask,
  OnlineExploreCategory,
  OnlineSearchBook,
  OnlineSearchResult,
  OnlineSourceTestResult,
  ReadingProgress,
  ScanResult,
  ScanStatus,
  SearchResultItem,
} from '@shared/types';

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listBooks: (params: { category?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.q) qs.set('q', params.q);
    return http<{ books: Book[] }>(`/api/books?${qs}`).then((r) => r.books);
  },
  listBooksPage: (params: { category?: string; q?: string; limit: number; offset: number }) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.q) qs.set('q', params.q);
    qs.set('limit', String(params.limit));
    qs.set('offset', String(params.offset));
    return http<{ books: Book[]; total: number }>(`/api/books?${qs}`);
  },
  getBook: (id: number) => http<{ book: Book }>(`/api/books/${id}`).then((r) => r.book),
  getChapters: (bookId: number) =>
    http<{ book: { id: number; title: string }; chapters: ChapterMeta[] }>(
      `/api/books/${bookId}/chapters`,
    ).then((r) => r.chapters),
  getChapterContent: (bookId: number, index: number) =>
    http<{ chapter: { id: number; book_id: number; chapter_index: number; title: string }; content: string }>(
      `/api/books/${bookId}/chapters/${index}/content`,
    ),
  getProgress: (bookId: number) =>
    http<{ progress: ReadingProgress | null }>(`/api/progress/${bookId}`).then((r) => r.progress),
  saveProgress: (bookId: number, data: { chapter_index: number; page: number; progress: number }) =>
    http<{ ok: boolean }>(`/api/progress/${bookId}`, { method: 'PUT', body: JSON.stringify(data) }),
  search: (q: string) => http<{ results: SearchResultItem[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.results),
  categories: () => http<{ categories: { name: string; count: number }[] }>(`/api/books/categories`).then((r) => r.categories),
  scanStatus: () => http<ScanStatus & { novelsDir: string }>(`/api/scanner/status`),
  triggerScan: (wait = false) =>
    http<{ started: boolean; result?: ScanResult }>(`/api/scanner/scan${wait ? '?wait=1' : ''}`, { method: 'POST' }),
  upload: async (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as { results: { fileName: string; status: string; chapterCount: number; encoding: string; error?: string }[] };
  },
  // ---- 书签 ----
  listBookmarks: (bookId: number) =>
    http<{ bookmarks: Bookmark[] }>(`/api/books/${bookId}/bookmarks`).then((r) => r.bookmarks),
  addBookmark: (bookId: number, data: { chapter_index: number; position: number }) =>
    http<{ ok: boolean; id: number; duplicate?: boolean }>(`/api/books/${bookId}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteBookmark: (id: number) => http<{ ok: boolean }>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
  // ---- 全文搜索 ----
  fullText: (bookId: number, q: string) =>
    http<FullTextResult>(`/api/books/${bookId}/fulltext?q=${encodeURIComponent(q)}`),
  // ---- 阅读统计 ----
  heartbeat: (bookId: number, seconds: number) =>
    http<{ ok: boolean }>(`/api/stats/heartbeat`, { method: 'POST', body: JSON.stringify({ bookId, seconds }) }).catch(
      () => undefined,
    ),
  stats: () =>
    http<StatsSummary>(`/api/stats`),
  aiStatus: () =>
    http<{ provider: string; model: string; configured: boolean }>(`/api/ai/status`),
  aiConfig: () => http<AIConfigInfo>(`/api/ai/config`),
  saveAIConfig: (data: { provider?: string; baseUrl?: string; model?: string; apiKey?: string }) =>
    http<{ ok: boolean } & AIConfigInfo>(`/api/ai/config`, { method: 'PUT', body: JSON.stringify(data) }),
  aiTest: () =>
    http<{ ok: boolean; model?: string; latencyMs?: number; reply?: string; error?: string }>(`/api/ai/test`, {
      method: 'POST',
    }),
  // ---- 封面 / 书籍信息 ----
  coverUrl: (bookId: number) => `/api/books/${bookId}/cover`,
  uploadCover: async (bookId: number, file: File) => {
    const fd = new FormData();
    fd.append('cover', file);
    const res = await fetch(`/api/books/${bookId}/cover`, { method: 'POST', body: fd });
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const d = await res.json();
        if (d?.error) msg = d.error;
      } catch {}
      throw new Error(msg);
    }
    return (await res.json()) as { ok: boolean; coverUrl: string };
  },
  removeCover: (bookId: number) => http<{ ok: boolean }>(`/api/books/${bookId}/cover`, { method: 'DELETE' }),
  updateBook: (
    bookId: number,
    data: { title?: string; author?: string; category?: string; tags?: string[] },
  ) => http<{ ok: boolean; book: Book }>(`/api/books/${bookId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBook: (bookId: number) =>
    http<{ ok: boolean; fileRemoved: boolean; title: string }>(`/api/books/${bookId}`, { method: 'DELETE' }),
  // ---- 在线书源(Legado) ----
  onlineSources: () => http<{ sources: BookSource[] }>(`/api/online/sources`).then((r) => r.sources),
  importSource: (data: { url?: string; text?: string }) =>
    http<{ ok: boolean; added: number; updated: number; total: number }>(`/api/online/sources/import`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteSource: (url: string) => http<{ ok: boolean }>(`/api/online/sources/${encodeURIComponent(url)}`, { method: 'DELETE' }),
  toggleSource: (url: string, enabled: boolean) =>
    http<{ ok: boolean }>(`/api/online/sources/${encodeURIComponent(url)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  testSource: (sourceUrl: string, keyword: string) =>
    http<OnlineSourceTestResult>(`/api/online/sources/test`, {
      method: 'POST',
      body: JSON.stringify({ sourceUrl, keyword }),
    }),
  onlineSearch: (q: string) => http<{ results: OnlineSearchResult[]; total: number }>(`/api/online/search?q=${encodeURIComponent(q)}`),
  onlineBook: (source: string, bookUrl: string) =>
    http<{ info: OnlineBookInfo; messages: string[] }>(
      `/api/online/book?source=${encodeURIComponent(source)}&bookUrl=${encodeURIComponent(bookUrl)}`,
    ),
  onlineToc: (source: string, bookUrl: string) =>
    http<{ chapters: OnlineChapter[]; cached?: boolean; messages?: string[] }>(
      `/api/online/toc?source=${encodeURIComponent(source)}&bookUrl=${encodeURIComponent(bookUrl)}`,
    ),
  onlineContent: (source: string, url: string, title: string) =>
    http<{ content: string; messages: string[] }>(
      `/api/online/content?source=${encodeURIComponent(source)}&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
    ),
  onlineExplore: (source: string) =>
    http<{ categories: OnlineExploreCategory[]; messages?: string[]; disabled?: boolean }>(
      `/api/online/explore?source=${encodeURIComponent(source)}`,
    ),
  onlineExploreBooks: (source: string, url: string) =>
    http<{ books: OnlineSearchBook[]; messages: string[] }>(
      `/api/online/explore/books?source=${encodeURIComponent(source)}&url=${encodeURIComponent(url)}`,
    ),
  createDownload: (source: string, bookUrl: string) =>
    http<{ ok: boolean; task: OnlineDownloadTask }>(`/api/online/download`, {
      method: 'POST',
      body: JSON.stringify({ source, bookUrl }),
    }),
  downloadTasks: () => http<{ tasks: OnlineDownloadTask[] }>(`/api/online/tasks`).then((r) => r.tasks),
  cancelDownload: (id: string) => http<{ ok: boolean }>(`/api/online/tasks/${id}/cancel`, { method: 'POST' }),
};

export interface Bookmark {
  id: number;
  book_id: number;
  chapter_index: number;
  position: number;
  note: string | null;
  created_at: number;
  chapter_title: string | null;
}

export interface FullTextHit {
  chapter_index: number;
  title: string;
  snippet: string;
  position: number;
  count: number;
}

export interface FullTextResult {
  query: string;
  total: number;
  chapters: FullTextHit[];
}

export interface StatsSummary {
  todaySeconds: number;
  totalSeconds: number;
  books: { id: number; title: string; seconds: number }[];
  days: { day: string; seconds: number }[];
}

// ---- AI 配置 ----
export interface AIConfigInfo {
  provider: string;
  baseUrl: string;
  model: string;
  /** 服务端是否已存 key(含环境变量) */
  hasApiKey: boolean;
  /** 打码后的 key 提示,如 sk-…wxyz */
  apiKeyHint: string;
  configured: boolean;
  supportedProviders: string[];
}