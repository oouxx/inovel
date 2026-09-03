import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { generateText } from 'ai';
import type { AIMode } from '../../shared/types';
import {
  getAIConfig,
  effectiveAIConfig,
  isConfigured,
  resolveModel,
  SUPPORTED_PROVIDERS,
  buildPrompt,
  streamAI,
} from '../ai/aiService';
import { saveAIConfigFile, maskApiKey } from '../ai/configStore';
import { getBook, getChapter, listBooks } from '../services/bookService';
import { readChapterContent } from '../scanner/scanner';
import { getDb } from '../database';

export const aiRoutes = new Hono();

/** GET /api/ai/status —— 配置状态(不含 key) */
aiRoutes.get('/status', (c) => {
  const cfg = getAIConfig();
  return c.json({
    provider: cfg.provider,
    model: cfg.model,
    configured: cfg.configured,
  });
});

/** 配置信息(供前端表单回显,key 只给掩码) */
function configPayload() {
  const cfg = effectiveAIConfig();
  return {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasApiKey: !!cfg.apiKey,
    apiKeyHint: maskApiKey(cfg.apiKey),
    configured: isConfigured(cfg),
    supportedProviders: SUPPORTED_PROVIDERS,
  };
}

/** GET /api/ai/config —— 回显配置(key 仅掩码) */
aiRoutes.get('/config', (c) => c.json(configPayload()));

/**
 * PUT /api/ai/config —— 保存配置
 * body: { provider?, baseUrl?, model?, apiKey? }
 * apiKey 缺省 = 保持不变;空字符串 = 清除已存 key
 */
aiRoutes.put('/config', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid body' }, 400);

  const patch: Record<string, string> = {};
  if (typeof body.provider === 'string' && body.provider.trim()) {
    const p = body.provider.trim();
    if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(p)) {
      return c.json({ error: `不支持的 provider:${p}` }, 400);
    }
    patch.provider = p;
  }
  if (typeof body.baseUrl === 'string') patch.baseUrl = body.baseUrl.trim();
  if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim().slice(0, 120);
  if (typeof body.apiKey === 'string') patch.apiKey = body.apiKey.trim(); // '' = 清除

  try {
    saveAIConfigFile(patch);
  } catch (err: any) {
    return c.json({ error: err?.message || '保存配置失败' }, 500);
  }
  return c.json({ ok: true, ...configPayload() });
});

/** POST /api/ai/test —— 用当前配置发起一次最小请求,验证连通性 */
aiRoutes.post('/test', async (c) => {
  const cfg = effectiveAIConfig();
  if (!isConfigured(cfg)) {
    return c.json({ ok: false, error: '尚未配置 API Key(自建兼容端点可只填 Base URL)' }, 400);
  }
  const started = Date.now();
  try {
    const { text } = await generateText({
      model: resolveModel(cfg),
      prompt: '连通性测试,请只回复两个字:正常',
      maxOutputTokens: 20,
    });
    return c.json({ ok: true, model: cfg.model, latencyMs: Date.now() - started, reply: text.trim().slice(0, 40) });
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message || String(err), latencyMs: Date.now() - started });
  }
});

/**
 * POST /api/ai/chat —— SSE 流式
 * body: { mode, bookId, chapterIndex, question?, term?, context? }
 */
aiRoutes.post('/chat', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.bookId || body?.chapterIndex === undefined) {
    return c.json({ error: '缺少 bookId / chapterIndex' }, 400);
  }
  const mode: AIMode = body.mode || 'chat';
  const bookId = Number(body.bookId);
  const chapterIndex = Number(body.chapterIndex);

  // 校验书籍存在
  const book = getBook(bookId);
  if (!book) return c.json({ error: '书籍不存在' }, 404);

  let prompt;
  try {
    prompt = await buildPrompt({ mode, bookId, chapterIndex, question: body.question, term: body.term, context: body.context });
  } catch (err: any) {
    return c.json({ error: err?.message || '构建上下文失败' }, 500);
  }
  if (!prompt) return c.json({ error: '章节不存在或无上下文' }, 404);

  let stream;
  try {
    stream = await streamAI(prompt, bookId, chapterIndex);
  } catch (err: any) {
    const msg = err?.message || 'AI 调用失败';
    const code = msg.includes('未配置') ? 400 : 500;
    return c.json({ error: msg }, code);
  }

  return streamSSE(c, async (sseStream) => {
    await sseStream.writeSSE({
      event: 'meta',
      data: JSON.stringify({ model: stream.model, cached: stream.cached }),
    });
    try {
      for await (const delta of stream.textStream) {
        await sseStream.writeSSE({ event: 'delta', data: JSON.stringify({ delta }) });
      }
      await sseStream.writeSSE({ event: 'done', data: '{}' });
    } catch (err: any) {
      await sseStream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: err?.message || 'AI 流式输出中断' }),
      });
    }
  });
});