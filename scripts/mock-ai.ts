/**
 * Mock OpenAI 兼容端点(测试 AI 链路,无需真实 Key)
 * POST /v1/chat/completions → SSE chunks
 */
Bun.serve({
  port: 9310,
  fetch: async (req) => {
    const url = new URL(req.url);
    console.log('[mock] =>', req.method, url.pathname);
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await req.json();
      console.log('[mock] model:', body.model, '| system len:', body.messages?.[0]?.content?.length ?? 0, '| user len:', body.messages?.[body.messages.length - 1]?.content?.length ?? 0);
      const text = `## 剧情概述\n萧炎在本章中完成了修炼突破,这是mock测试响应。\n\n## 关键事件\n- **事件一**:测试内容\n- 事件二:测试内容\n\n## 人物变化\n萧炎状态提升。\n\n## 重要伏笔\n无明显伏笔。`;
      const id = 'chatcmpl-mock';
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          for (const ch of text.match(/.{1,12}/gs) || []) {
            const payload = {
              id,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: { content: ch }, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            await new Promise((r) => setTimeout(r, 8));
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }
    return new Response('mock ok', { status: 200 });
  },
});
console.log('[mock-ai] listening on http://127.0.0.1:9310');