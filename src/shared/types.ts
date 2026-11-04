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