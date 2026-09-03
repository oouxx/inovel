// 统一 API 封装
import type { Book, ChapterMeta, ReadingProgress, ScanResult, ScanStatus, SearchResultItem } from '@shared/types';

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
};