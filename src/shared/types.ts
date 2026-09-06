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
  /** 0 文字 1 音频 2 图片(漫画) */
  sourceType: number;
  error: string | null;
  /** 本次搜索耗时 ms */
  costMs: number;
  books: OnlineSearchBook[];
}

export interface OnlineSearchOrigin {
  sourceUrl: string;
  sourceName: string;
  bookUrl: string;
  /** 0 文字 1 音频 2 图片(漫画) */
  sourceType: number;
  coverUrl: string;
  latestChapter: string;
  kind: string;
  wordCount: string;
}

/** 跨源聚合后的一本书(对齐原版阅读:同书同作者合并,origins 记录全部命中来源) */
export interface OnlineSearchBookMerged {
  name: string;
  author: string;
  kind: string;
  intro: string;
  coverUrl: string;
  latestChapter: string;
  bookUrl: string;
  wordCount: string;
  /** 主展示来源(首次命中) */
  sourceUrl: string;
  sourceName: string;
  origins: OnlineSearchOrigin[];
}

export interface OnlineSearchFlatResult {
  books: OnlineSearchBookMerged[];
  total: number;
  page: number;
  /** 是否可能有下一页(本轮任一源返回了结果) */
  hasMore: boolean;
  processedSources: number;
  totalSources: number;
  failedSources: number;
  /** 聚合结果超过上限被截断 */
  truncated: boolean;
  costMs: number;
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

// ---------- 在线书架(音频/漫画等流式阅读) ----------

export interface OnlineLibraryBook {
  id: number;
  sourceUrl: string;
  bookUrl: string;
  name: string;
  author: string;
  coverUrl: string;
  /** 0 文字 1 音频 2 图片(漫画) */
  sourceType: number;
  chapterCount: number;
  /** position:漫画=章节内滚动比例 0~1;音频=已播放秒数 */
  progress: { chapter_index: number; position: number } | null;
  createdAt: number;
}

export interface OnlineChapterMedia {
  kind: 'image' | 'audio' | 'text';
  items: string[];
}

export interface OnlineProgress {
  online_book_id: number;
  chapter_index: number;
  position: number;
  updated_at: number;
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