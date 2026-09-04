import { createHash } from 'node:crypto';
import { streamText, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI as createGoogle } from '@ai-sdk/google';
import { getDb } from '../database';
import { readChapterContent } from '../scanner/scanner';
import { loadAIConfigFile } from './configStore';

/**
 * AI Service —— 阅读助手,不是聊天机器人
 *
 * - Vercel AI SDK 多 Provider(OpenAI 兼容 / Anthropic / Google / OpenRouter)
 * - 配置来源:管理页配置(ai-config.json)> 环境变量 > 默认值,支持运行时修改
 * - API Key 只存服务端,绝不进前端
 * - 上下文 = 当前章节 + 前后各 1 章;全书问答走关键词检索(检索 → 相关章节 → AI)
 * - summarize / characters / setting / explain 结果缓存(prompt_hash)
 */

export interface AIConfig {
  provider: string;
  model: string;
  configured: boolean;
}

export const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter'] as const;

/** 合并文件配置与环境变量后的最终生效配置 */
export interface EffectiveAIConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function envApiKey(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || '';
    case 'google':
      return process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY || '';
    default:
      return process.env.OPENAI_API_KEY || '';
  }
}

/** 文件配置 > 环境变量 > 默认值 */
export function effectiveAIConfig(): EffectiveAIConfig {
  const f = loadAIConfigFile();
  const provider = (f.provider || process.env.AI_PROVIDER || 'openai').trim();
  const baseUrl = (f.baseUrl || process.env.AI_BASE_URL || '').trim();
  const model = (f.model || process.env.AI_MODEL || defaultModel(provider)).trim();
  const apiKey = (f.apiKey || envApiKey(provider) || '').trim();
  return { provider, baseUrl, model, apiKey };
}

export function isConfigured(cfg: EffectiveAIConfig): boolean {
  return !!cfg.apiKey || (cfg.provider === 'openai' && !!cfg.baseUrl); // 自建兼容端点可不带 key
}

export function getAIConfig(): AIConfig {
  const cfg = effectiveAIConfig();
  return { provider: cfg.provider, model: cfg.model, configured: isConfigured(cfg) };
}

function defaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-20250514';
    case 'google': return 'gemini-2.0-flash';
    case 'openrouter': return 'openai/gpt-4o-mini';
    default: return 'gpt-4o-mini';
  }
}

/** 创建当前生效配置对应的 LanguageModel(供 routes 层测试连通) */
export function resolveModel(cfg: EffectiveAIConfig): LanguageModel {
  const baseURL = cfg.baseUrl || undefined;
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: cfg.apiKey || 'missing', baseURL })(cfg.model);
    case 'google':
      return createGoogle({ apiKey: cfg.apiKey || 'missing', baseURL })(cfg.model);
    case 'openrouter': {
      const openrouter = createOpenAI({
        apiKey: cfg.apiKey,
        baseURL: baseURL || 'https://openrouter.ai/api/v1',
      });
      return openrouter.chat(cfg.model);
    }
    case 'openai':
    default: {
      const openai = createOpenAI({
        apiKey: cfg.apiKey || undefined,
        baseURL,
      });
      // .chat() → Chat Completions API(对第三方兼容端点兼容性最好)
      return openai.chat(cfg.model);
    }
  }
}

// ---------- 上下文构建 ----------

const CONTEXT_CHARS_LIMIT = 20000;

function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return text.slice(0, head) + '\n…(中略)…\n' + text.slice(-tail);
}

/** 加载:前 1 章 + 当前章 + 后 1 章正文 */
export async function loadFullContext(bookId: number, chapterIndex: number): Promise<{
  prev: string | null;
  current: { title: string; content: string; index: number } | null;
  next: string | null;
  book: any;
} | null> {
  const db = getDb();
  const book = db.query('SELECT * FROM books WHERE id = ?').get(bookId) as any;
  if (!book) return null;
  const load = async (idx: number) => {
    const meta = db
      .query('SELECT title, start_offset, end_offset FROM chapters WHERE book_id = ? AND chapter_index = ?')
      .get(bookId, idx) as any;
    if (!meta) return null;
    const content = await readChapterContent(book.file_path, book.encoding, meta.start_offset, meta.end_offset);
    return { title: meta.title || `第 ${idx + 1} 章`, content: trimMiddle(content, CONTEXT_CHARS_LIMIT) };
  };
  const [prev, current, next] = await Promise.all([
    load(chapterIndex - 1),
    load(chapterIndex),
    load(chapterIndex + 1),
  ]);
  return {
    prev: prev?.content ?? null,
    current: current ? { title: current.title, content: current.content, index: chapterIndex } : null,
    next: next?.content ?? null,
    book,
  };
}

// ---------- 全书检索 ----------

const STOPWORDS = new Set([
  '什么', '怎么', '为什么', '为什么', '谁', '哪', '如何', '请问', '一下', '说说', '讲讲',
  '这个', '那个', '本章', '全书', '小说', '人物', '关系', '解释', '介绍', '回顾', '剧情',
  '总结', '之前', '出现', '时候', '哪里', '多少', '突然', '到底', '究竟',
]);

const STOP_CHARS = /[，。！？、：；""''（）【】\s,.!?;:()'"[\]a-zA-Z0-9]/;

/** 简单关键词提取:切出 2~6 字中文串,过滤虚词 */
export function extractKeywords(q: string): string[] {
  if (!q) return [];
  const segments = q.split(STOP_CHARS).filter((s) => s.length >= 2);
  const kws = new Set<string>();
  for (let seg of segments) {
    if (seg.length > 6) seg = seg.slice(0, 6);
    if (!STOPWORDS.has(seg)) kws.add(seg);
  }
  return [...kws].slice(0, 5);
}

/** Search → Relevant chapters → AI:关键词在全书章节中检索,返回最相关的章节片段 */
export async function searchBookChapters(
  bookId: number,
  query: string,
  topN = 3,
): Promise<{ index: number; title: string; content: string }[]> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];
  const db = getDb();
  const book = db.query('SELECT * FROM books WHERE id = ?').get(bookId) as any;
  if (!book) return [];
  const chapters = db
    .query('SELECT chapter_index, title, start_offset, end_offset FROM chapters WHERE book_id = ? ORDER BY chapter_index')
    .all(bookId) as any[];

  const scored: { index: number; title: string; content: string; score: number }[] = [];
  for (const meta of chapters) {
    let score = 0;
    for (const kw of keywords) {
      if ((meta.title || '').includes(kw)) score += 3; // 标题命中权重更高
    }
    if (score === 0) {
      const content = await readChapterContent(book.file_path, book.encoding, meta.start_offset, meta.end_offset);
      let hits = 0;
      let firstPos = -1;
      for (const kw of keywords) {
        const pos = content.indexOf(kw);
        if (pos >= 0) {
          hits++;
          if (firstPos < 0) firstPos = pos;
        }
      }
      if (hits > 0) {
        const snippet = content.slice(Math.max(0, firstPos - 200), firstPos + 1500);
        scored.push({
          index: meta.chapter_index,
          title: meta.title || `第 ${meta.chapter_index + 1} 章`,
          content: trimMiddle(snippet, 3000),
          score: hits,
        });
      }
    } else {
      const content = await readChapterContent(book.file_path, book.encoding, meta.start_offset, meta.end_offset);
      scored.push({
        index: meta.chapter_index,
        title: meta.title || `第 ${meta.chapter_index + 1} 章`,
        content: trimMiddle(content, 6000),
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, topN).map(({ index, title, content }) => ({ index, title, content }));
}

// ---------- Prompt 构建 ----------

const SYSTEM_PROMPT = `你是一位专业的中文小说阅读助手,帮助读者理解小说内容。
你收到的上下文来自用户正在阅读的小说(可能包含上一章、当前章、下一章,以及全书检索片段)。
回答要求:
- 用简体中文,语气自然、简洁,排版清晰。
- 紧扣文本内容,不要凭空编造小说里没有的情节;文本中没有的信息要明确说明"原文未提及"。
- 使用 Markdown,适当使用列表与加粗。`;

export interface BuiltPrompt {
  system: string;
  user: string;
  cacheable: boolean;
}

export async function buildPrompt(req: {
  mode: string;
  bookId: number;
  chapterIndex: number;
  question?: string;
  term?: string;
  context?: string;
}): Promise<BuiltPrompt | null> {
  const ctx = await loadFullContext(req.bookId, req.chapterIndex);
  if (!ctx || !ctx.current) return null;
  const book = ctx.book;
  const cur = ctx.current;
  const parts: string[] = [];
  parts.push(`【小说】《${book.title}》${book.author ? ` 作者:${book.author}` : ''}`);
  if (ctx.prev) parts.push(`【上一章(索引 ${cur.index - 1})】\n${ctx.prev}`);
  parts.push(`【当前章节(索引 ${cur.index}):${cur.title}】\n${cur.content}`);
  if (ctx.next) parts.push(`【下一章(索引 ${cur.index + 1})】\n${ctx.next}`);
  const contextText = parts.join('\n\n');

  switch (req.mode) {
    case 'summarize':
      return {
        cacheable: true,
        system: SYSTEM_PROMPT,
        user: `请总结下面这一章的内容,按以下结构输出:\n\n## 剧情概述\n(2-3 句)\n\n## 关键事件\n(列表,3-5 条)\n\n## 人物变化\n(本章人物的状态/关系/立场变化)\n\n## 重要伏笔\n(值得注意的细节、悬念;没有则写"无明显伏笔")\n\n---\n\n${contextText}`,
      };
    case 'characters':
      return {
        cacheable: true,
        system: SYSTEM_PROMPT,
        user: `请分析下面这一章中出现的人物及其关系:\n\n## 出场人物\n(列出人物及其身份)\n\n## 人物关系\n(人物之间的关系:冲突/合作/亲缘等)\n\n## 本章动态\n(本章中人物的态度或关系变化)\n\n---\n\n${contextText}`,
      };
    case 'setting':
      return {
        cacheable: true,
        system: SYSTEM_PROMPT,
        user: `请解释下面章节中出现的设定、专有名词与世界观(功法、境界、组织、地理、物品等),以列表说明:\n\n## 设定与名词\n- **名称**:解释(若原文信息不足,请说明)\n\n---\n\n${contextText}`,
      };
    case 'explain': {
      const term = req.term || '';
      const around = req.context ? `\n\n【选中词所在段落】\n${req.context}` : '';
      return {
        cacheable: true,
        system: SYSTEM_PROMPT,
        user: `读者在阅读《${book.title}》时选中了词句:「${term}」。请结合上下文解释它在小说中的含义(可能是人名、地名、功法、组织、古语或专有名词等)。先用一句话给出最可能的解释,再补充相关背景;若上下文不足以判断,请说明。\n\n【阅读上下文】\n${contextText}${around}`,
      };
    }
    case 'recap': {
      const question = req.question || '请回顾之前的剧情';
      const retrieved = await searchBookChapters(req.bookId, question, 4);
      const retrievedText = retrieved.length
        ? retrieved.map((r) => `--- 第 ${r.index + 1} 章《${r.title}》 ---\n${r.content}`).join('\n\n')
        : '(全书检索无相关内容)';
      return {
        cacheable: false,
        system: SYSTEM_PROMPT,
        user: `读者正在阅读,想回顾相关剧情:「${question}」。\n下面是全书关键词检索结果与当前阅读上下文,请梳理这条剧情线:何时发生、涉及哪些人物、结果如何,并说明它与当前情节的联系。\n\n【全书检索结果】\n${retrievedText}\n\n【当前阅读上下文】\n${contextText}`,
      };
    }
    case 'chat':
    default: {
      const question = req.question || '';
      const retrieved = await searchBookChapters(req.bookId, question, 3);
      const retrievedText = retrieved.length
        ? retrieved
            .map((r) => `--- 检索命中 · 第 ${r.index + 1} 章《${r.title}》 ---\n${r.content}`)
            .join('\n\n')
        : '(全书检索无相关命中)';
      return {
        cacheable: false,
        system: SYSTEM_PROMPT,
        user: `【问题】${question}\n\n【当前阅读上下文】\n${contextText}\n\n【全书相关章节检索结果】\n${retrievedText}\n\n请结合上下文与检索结果回答问题。`,
      };
    }
  }
}

// ---------- 缓存 ----------

export function promptHash(system: string, user: string, model: string): string {
  return createHash('sha256').update(`${model}\n${system}\n${user}`).digest('hex');
}

export function getCached(bookId: number, chapterIndex: number, hash: string, model: string): string | null {
  const row = getDb()
    .query('SELECT response FROM ai_cache WHERE book_id = ? AND chapter_index = ? AND prompt_hash = ? AND model = ?')
    .get(bookId, chapterIndex, hash, model) as { response: string } | null;
  return row?.response ?? null;
}

export function saveCache(bookId: number, chapterIndex: number, hash: string, model: string, response: string) {
  getDb()
    .query(
      `INSERT INTO ai_cache (book_id, chapter_index, prompt_hash, model, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_id, chapter_index, prompt_hash, model) DO NOTHING`,
    )
    .run(bookId, chapterIndex, hash, model, response, Date.now());
}

// ---------- 流式调用 ----------

export interface StreamResult {
  textStream: AsyncIterable<string>;
  model: string;
  cached: boolean;
}

/** fullStream error 部件 → 可读的 Error(避免 AI SDK v5 静默吞错) */
function formatAIError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') {
    try {
      const obj = JSON.parse(err);
      return obj?.message || obj?.error?.message || err;
    } catch {
      return err;
    }
  }
  try {
    const s = JSON.stringify(err);
    const obj = JSON.parse(s);
    return obj?.message || obj?.error?.message || obj?.error?.code || s;
  } catch {
    return String(err);
  }
}

/** 遍历 fullStream → 文本 delta;error 部件抛出(路由层会写入 SSE error 事件) */
async function* iterateFullStream(result: ReturnType<typeof streamText>, onText?: (t: string) => void) {
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      onText?.(part.text);
      yield part.text;
    } else if (part.type === 'error') {
      throw new Error(formatAIError(part.error));
    }
  }
}

export async function streamAI(
  prompt: BuiltPrompt,
  bookId: number,
  chapterIndex: number,
): Promise<StreamResult> {
  const cfg = getAIConfig();
  if (!cfg.configured) {
    throw new Error(
      'AI 服务未配置。请到「书库管理 → AI 阅读助手」填写 Provider / Base URL / Model / API Key 并保存。',
    );
  }
  const full = effectiveAIConfig();
  const model = resolveModel(full);
  const modelName = cfg.model;

  if (prompt.cacheable) {
    const hash = promptHash(prompt.system, prompt.user, modelName);
    const cached = getCached(bookId, chapterIndex, hash, modelName);
    if (cached) {
      return { textStream: replayStream(cached), model: modelName, cached: true };
    }
    const result = streamText({ model, system: prompt.system, prompt: prompt.user });
    let fullText = '';
    const textStream = iterateFullStream(result, (t) => {
      fullText += t;
    });
    return {
      textStream: {
        async *[Symbol.asyncIterator]() {
          for await (const delta of textStream) yield delta;
          saveCache(bookId, chapterIndex, hash, modelName, fullText);
        },
      },
      model: modelName,
      cached: false,
    };
  }

  const result = streamText({ model, system: prompt.system, prompt: prompt.user });
  return { textStream: iterateFullStream(result), model: modelName, cached: false };
}

/** 缓存命中时模拟流式输出,保证前端体验一致 */
async function* replayStream(text: string): AsyncGenerator<string> {
  const chunk = 30;
  for (let i = 0; i < text.length; i += chunk) {
    yield text.slice(i, i + chunk);
  }
}