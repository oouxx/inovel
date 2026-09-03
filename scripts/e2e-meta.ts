/**
 * P1-b 验证:封面上传/删除、书籍信息编辑、划词 AI 解释
 */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8080';
let failures = 0;
function ok(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
}

const booksResp = (await fetch(BASE + '/api/books').then((r) => r.json())) as { books: { id: number; title: string }[] };
const BOOK_ID = booksResp.books.find((b) => b.title.includes('斗破'))!.id;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// ---- 详情页:编辑信息 ----
await page.goto(BASE + `/books/${BOOK_ID}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.click('button[title="编辑信息"]');
await page.waitForTimeout(300);
await page.fill('input[placeholder="作者"]', '天蚕土豆');
await page.click('button:has-text("保存")');
await page.waitForTimeout(600);
const author = await page.locator('text=天蚕土豆').first().isVisible().catch(() => false);
ok('编辑作者保存', author);

// ---- 封面上传(UI)----
// 注意:过小的图片(如 2x2)会被系统代理的广告拦截当作 tracking pixel,须用正常尺寸
const png = await Bun.file('/tmp/test-cover.jpg').arrayBuffer();
await page.setInputFiles('input[type="file"][accept="image/*"]', { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(png) });
await page.waitForTimeout(1000);
const coverImg = await page.locator('.book-cover img').count();
ok('封面上传显示', coverImg >= 1);

// 封面 API
const cov = await fetch(`${BASE}/api/books/${BOOK_ID}/cover`);
ok('封面接口', cov.ok, `${cov.status} ${cov.headers.get('content-type')}`);

// 书架卡片显示封面
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const cardImgs = await page.locator('.book-cover img').count();
ok('书架封面显示', cardImgs >= 1, `found ${cardImgs}`);
await page.click('button:has-text("跟随系统")').catch(() => {});

// ---- 划词 AI 解释 ----
await page.goto(BASE + `/reader/${BOOK_ID}/0?page=0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const p = document.querySelector('.reader-content p') as HTMLElement;
  const range = document.createRange();
  // 选中段落前 8 个字符
  const textNode = p.firstChild!;
  range.setStart(textNode, 0);
  range.setEnd(textNode, 8);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
});
await page.waitForTimeout(600);
const popup = await page.locator('button:has-text("AI 解释")').isVisible().catch(() => false);
ok('划词弹出 AI 解释', popup);
if (popup) {
  await page.locator('button:has-text("AI 解释")').click();
  await page.waitForTimeout(2000);
  const panel = await page.locator('.ai-panel').isVisible();
  ok('划词打开 AI 面板', panel);
  const explained = await page.locator('.ai-panel').textContent();
  ok('解释请求已发出(mock 返回)', explained?.includes('mock测试响应') || explained?.includes('正在分析') || explained?.includes('剧情概述') || false);
}

await browser.close();
console.log(failures === 0 ? '\n✅ META ALL PASSED' : `\n❌ ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
