import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AIMode } from '../../shared/types';
import {
  getAIConfig,
  buildPrompt,
  streamAI,
} from '../ai/aiService';
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