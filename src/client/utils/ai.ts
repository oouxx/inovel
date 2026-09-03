// AI SSE 流式请求
export interface AIStreamHandlers {
  onMeta?: (meta: { model: string; cached: boolean }) => void;
  onDelta: (delta: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export interface AIRequest {
  mode: string;
  bookId: number;
  chapterIndex: number;
  question?: string;
  term?: string;
  context?: string;
}

/** POST /api/ai/chat,SSE 流式回调 */
export async function streamAI(req: AIRequest, h: AIStreamHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok || !res.body) {
    let msg = `AI 请求失败(${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {}
    h.onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以 \n\n 分隔
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '{}') continue;
          try {
            const data = JSON.parse(payload);
            if (data.delta !== undefined) h.onDelta(data.delta);
            else if (data.error) h.onError?.(data.error);
          } catch {}
        }
      }
    }
    h.onDone?.();
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      h.onError?.(err?.message || '连接中断');
    }
  }
}