// ---------- 共享类型:前后端共用 ----------

export interface Book {
  id: number;
  title: string;
  author: string;
  file_path: string;
  file_hash: string | null;
  file_size: number;
  file_mtime: number;
  encoding: string;
  category: string;
  chapter_count: number;
  /** JSON 字符串数组 */
  tags: string;
  /** ok | warn | error */
  status: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChapterMeta {
  id: number;
  book_id: number;
  chapter_index: number;
  title: string;
  start_offset: number;
  end_offset: number;
  confidence: number;
}

export interface ChapterContent extends ChapterMeta {
  content: string;
}

export interface ReadingProgress {
  book_id: number;
  chapter_index: number;
  page: number;
  /** 0 ~ 1 */
  progress: number;
  updated_at: number;
}

export interface ScanResult {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
  errors: { file: string; message: string }[];
}

export interface ScanStatus {
  scanning: boolean;
  lastResult: ScanResult | null;
  lastError: string | null;
}

export interface SearchResultItem {
  id: number;
  title: string;
  author: string;
  category: string;
  chapter_count: number;
  status: string;
  encoding: string;
}

// ---------- 在线书源(Legado) ----------

/** Legado 书源(仅保留运行所需字段的完整 JSON 保留在 raw 中) */
export interface BookSource {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup: string | null;
  enabled: boolean;
  enabledExplore: boolean;
  customOrder: number;
  lastImportAt: number | null;
  /** 最近一次搜索测试的耗时(ms) */
  respondTime: number | null;
}

export interface OnlineSearchBook {
  name: string;
  author: string;
  kind: string;
  intro: string;
  coverUrl: string;
  latestChapter: string;
  bookUrl: string;
  wordCount: string;
}

export interface OnlineSearchResult {
  sourceUrl: string;
  sourceName: string;
  error: string | null;
  /** 本次搜索耗时 ms */
  costMs: number;
  books: OnlineSearchBook[];
}

export interface OnlineBookInfo extends OnlineSearchBook {
  tocUrl: string;
}

export interface OnlineChapter {
  title: string;
  url: string;
  updateTime?: string;
  isVip?: boolean;
}

export interface OnlineExploreCategory {
  title: string;
  url: string;
}

export interface OnlineDownloadTask {
  id: string;
  sourceUrl: string;
  sourceName: string;
  bookName: string;
  author: string;
  bookUrl: string;
  /** pending | running | done | error | canceled */
  status: string;
  total: number;
  finished: number;
  currentTitle: string;
  filePath: string | null;
  /** 下载完成后入库的 book id */
  bookId: number | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
  canceled: boolean;
}

export interface OnlineSourceTestResult {
  sourceUrl: string;
  sourceName: string;
  ok: boolean;
  count: number;
  costMs: number;
  sample: string;
  error: string | null;
}

// ---------- AI ----------

export type AIMode = 'chat' | 'summarize' | 'explain' | 'characters' | 'setting' | 'recap';

export interface AIChatRequest {
  mode: AIMode;
  bookId: number;
  chapterIndex: number;
  /** chat / explain 需要 */
  question?: string;
  /** explain:被选中的词 */
  term?: string;
  /** explain:选中词所在段落上下文 */
  context?: string;
}