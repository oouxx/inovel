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

// 点击"总结本章"
await page.locator('.ai-panel button:has-text("总结本章")').click();
await page.waitForTimeout(300);
const streamingText = await page.locator('.ai-panel .md-body').textContent().catch(() => '');
ok('流式输出进行中', !!streamingText && streamingText.length > 0, `len=${streamingText?.length}`);

// 等待完成
await page.waitForFunction(
  () => {
    const btns = [...document.querySelectorAll('.ai-panel button')];
    return btns.some((b) => b.textContent?.includes('发送')) || !!document.querySelector('.ai-panel input:not(:disabled)');
  },
  { timeout: 15000 },
);
await page.waitForTimeout(400);

const finalText = await page.locator('.ai-panel .md-body').last().textContent();
ok('总结完整输出', finalText!.includes('剧情概述') && finalText!.includes('mock测试响应'), `${finalText?.length} chars`);

// 再次点击 → 应命中缓存(meta cached=true;输出相同)
await page.locator('.ai-panel button:has-text("总结本章")').click();
await page.waitForTimeout(100);
const cachedEarly = await page.locator('.ai-panel .md-body').last().textContent();
await page.waitForTimeout(1500);
const cachedFinal = await page.locator('.ai-panel .md-body').last().textContent();
ok('缓存命中重放', cachedFinal === finalText, `${cachedFinal?.length} chars`);

// 自由提问
await page.fill('.ai-panel input.input', '萧炎为什么能突破?');
await page.locator('.ai-panel form button[type=submit]').click();
await page.waitForTimeout(2000);
const chatText = await page.locator('.ai-panel .md-body').last().textContent();
ok('AI 问答流式响应', !!chatText && chatText.includes('mock测试响应'), `${chatText?.length} chars`);

await browser.close();
console.log(failures === 0 ? '\n✅ AI E2E PASSED' : `\n❌ ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);