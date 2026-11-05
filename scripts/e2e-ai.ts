/**
 * AI Streaming 验证:mock OpenAI 端点 → AI SDK → SSE → 前端流式渲染
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080';
let failures = 0;
function ok(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
}

// 找到斗破的 bookId
const booksResp = (await fetch(BASE + '/api/books').then((r) => r.json())) as { books: { id: number; title: string }[] };
const BOOK_ID = booksResp.books.find((b) => b.title.includes('斗破'))!.id;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE + `/reader/${BOOK_ID}/0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 打开 AI 面板
await page.keyboard.press('a');
await page.waitForTimeout(500);

// 自由提问(Enter 发送),验证 SSE 流式输出
await page.fill('.ai-panel textarea', '萧炎为什么能突破?');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const streamingText = await page.locator('.ai-panel .md-stream').textContent().catch(() => '');
ok('流式输出进行中', !!streamingText && streamingText.length > 0, `len=${streamingText?.length}`);

// 等待完成(输入框恢复可用)
await page.waitForFunction(
  () => {
    const ta = document.querySelector('.ai-panel textarea') as HTMLTextAreaElement | null;
    return !!ta && !ta.disabled;
  },
  { timeout: 15000 },
);
await page.waitForTimeout(400);

const finalText = await page.locator('.ai-panel .md-stream').last().textContent();
ok('AI 回答完整输出', !!finalText && finalText.includes('mock测试响应'), `${finalText?.length} chars`);

await browser.close();
console.log(failures === 0 ? '\n✅ AI E2E PASSED' : `\n❌ ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);